/**
 * Claude Code 采集适配器
 * 记录位置：~/.claude/projects/<目录slug>/<会话uuid>.jsonl
 *           子代理：~/.claude/projects/<slug>/<会话uuid>/subagents/agent-<hex>.jsonl
 * 行公共字段：{ type: user|assistant|ai-title|..., timestamp(ISO8601), sessionId, cwd, isSidechain, agentId?, message }
 * - usage：assistant.message.usage.{ input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }
 *   （无 cost 字段 → 消费按单价表估算）
 * - model：assistant 行顶层 model 或 message.model（如缺失则为 null，消费估算跳过）
 * - 编辑：assistant.message.content[] 中 type='tool_use'，name ∈ Write|Edit|MultiEdit|NotebookEdit
 *   Write.input={file_path, content}；Edit.input={file_path, old_string, new_string}；
 *   MultiEdit.input={file_path, edits:[{old_string,new_string}]}
 * - 子代理：isSidechain=true + agentId，归属同主会话 uuid → 用 parent_external_id 关联
 */
import { readFileSync, statSync } from 'fs'
import { basename, relative, sep } from 'path'
import fg from 'fast-glob'
import * as db from '../../db'
import { diffFromStrings } from './common'

interface CursorMap {
  [path: string]: { size: number; mtime: number }
}

interface FileRole {
  /** 主会话 uuid（来自文件名或所在目录名） */
  mainExternalId: string
  /** slug 目录名（用于去重展示） */
  slug: string
  /** 是否为子代理文件 */
  subagent: boolean
  /** 子代理 id（agent-xxx） */
  agentId?: string
}

function roleOf(dir: string, file: string): FileRole {
  const relPath = relative(dir, file).split(/[\\/]/)
  // relPath: [slug, mainUuid.jsonl] 或 [slug, uuid, 'subagents', 'agent-x.jsonl']
  const slug = relPath[0] ?? ''
  if (relPath.length >= 4 && relPath[2] === 'subagents') {
    const agentId = basename(file).replace(/\.jsonl$/i, '')
    return { mainExternalId: relPath[1] ?? '', slug, subagent: true, agentId }
  }
  const mainExternalId = basename(file).replace(/\.jsonl$/i, '')
  return { mainExternalId, slug, subagent: false }
}

export async function ingestClaude(
  dir: string,
  cursors: Record<string, CursorMap>,
  tool = 'claude'
): Promise<{ sessions: number; usage: number; edits: number; skipped: number }> {
  const out = { sessions: 0, usage: 0, edits: 0, skipped: 0 }
  const files = await fg('projects/**/*.jsonl', {
    cwd: dir,
    onlyFiles: true,
    absolute: true,
    suppressErrors: true,
    ignore: ['**/subagents/*.meta.json', '**/telemetry/**']
  })
  const myCursor = cursors[tool] ?? {}
  for (const file of files) {
    try {
      const st = statSync(file)
      const prev = myCursor[file]
      if (prev && prev.size === st.size && prev.mtime === st.mtimeMs) {
        out.skipped++
        continue
      }
      const res = await parseFile(dir, file)
      out.sessions += res.sessions
      out.usage += res.usage
      out.edits += res.edits
      myCursor[file] = { size: st.size, mtime: st.mtimeMs }
    } catch (e) {
      console.warn(`[usage/claude] parse failed ${file}:`, (e as Error).message)
    }
  }
  cursors[tool] = myCursor
  return out
}

interface ParsedFile {
  sessions: number
  usage: number
  edits: number
}

interface ToolUseBlock {
  name?: string
  input?: Record<string, unknown>
}

function toToolUseBlocks(content: unknown): ToolUseBlock[] {
  if (!Array.isArray(content)) return []
  const blocks: ToolUseBlock[] = []
  for (const c of content) {
    if (c && typeof c === 'object' && (c as { type?: string }).type === 'tool_use') {
      blocks.push(c as ToolUseBlock)
    }
  }
  return blocks
}

async function parseFile(dir: string, file: string): Promise<ParsedFile> {
  const raw = readFileSync(file, 'utf8')
  const out: ParsedFile = { sessions: 0, usage: 0, edits: 0 }
  const role = roleOf(dir, file)

  let cwd: string | null = null
  let title: string | null = null
  let firstTs: number | null = null
  let lastTs: number | null = null
  let msgs = 0
  let dbSessionId: number | null = null

  // 子代理会话的 external_id：<主会话uuid>:agent-xxx；主会话直接用 uuid
  const externalId = role.subagent ? `${role.mainExternalId}:${role.agentId ?? 'agent'}` : role.mainExternalId
  const parentExternalId = role.subagent ? role.mainExternalId : null

  const ensureSession = (): number | null => {
    if (dbSessionId === null) {
      const r = db.upsertAgentSession('claude', externalId, {
        parentExternalId,
        cwd,
        title,
        startedAt: firstTs ?? undefined,
        messageCount: msgs
      })
      dbSessionId = r.id
      if (r.created) out.sessions++
    }
    return dbSessionId
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let rec: {
      type?: string
      timestamp?: string
      sessionId?: string
      cwd?: string
      isSidechain?: boolean
      agentId?: string
      model?: string
      aiTitle?: string
      message?: {
        role?: string
        model?: string
        usage?: Record<string, number>
        content?: unknown
      }
    }
    try {
      rec = JSON.parse(trimmed) as typeof rec
    } catch {
      continue
    }
    if (!rec.type) continue
    // 主会话文件里若混入子代理行则跳过（子代理内容由独立文件采集，避免重复）
    if (!role.subagent && rec.isSidechain) continue
    if (role.subagent && typeof rec.agentId === 'string' && role.agentId && rec.agentId !== role.agentId.replace(/^agent-/, '')) {
      // agentId 形态可能不一致，宽容处理：不一致时仍尝试采集（主键幂等去重兜底）
    }
    if (rec.cwd) cwd = rec.cwd
    const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN
    const tsMs = Number.isFinite(ts) ? ts : null
    if (tsMs !== null) {
      if (firstTs === null || tsMs < firstTs) firstTs = tsMs
      if (lastTs === null || tsMs > lastTs) lastTs = tsMs
    }

    if (rec.type === 'ai-title' && rec.aiTitle) {
      if (title === null) title = rec.aiTitle
      continue
    }
    if (rec.type !== 'user' && rec.type !== 'assistant') continue

    const msg = rec.message
    if (!msg) continue
    msgs++

    if (title === null && rec.type === 'user') {
      const text = firstTextOf(msg.content)
      if (text) title = text.slice(0, 120)
    }

    if (rec.type === 'assistant') {
      const model = rec.model ?? msg.model ?? null
      const usage = msg.usage
      if (usage && tsMs !== null && (usage.input_tokens ?? usage.output_tokens ?? 0) > 0) {
        const sid = ensureSession()
        if (sid !== null) {
          db.insertAgentUsage(sid, {
            recordedAt: tsMs,
            model,
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            cacheReadTokens: usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: usage.cache_creation_input_tokens ?? 0
          })
          out.usage++
        }
      }
      // 文件编辑
      if (tsMs !== null) {
        for (const block of toToolUseBlocks(msg.content)) {
          const name = block.name
          const input = block.input ?? {}
          if (name === 'Write' || name === 'Edit' || name === 'MultiEdit') {
            const filePath = typeof input.file_path === 'string' ? input.file_path : null
            if (!filePath) continue
            let add = 0
            let del = 0
            if (name === 'Write') {
              const content = typeof input.content === 'string' ? input.content : ''
              add = content ? content.split('\n').length : 0
            } else if (name === 'Edit') {
              const d = diffFromStrings(input.old_string as string | undefined, input.new_string as string | undefined)
              add = d.add
              del = d.del
            } else {
              // MultiEdit：edits 数组
              const edits = Array.isArray(input.edits) ? (input.edits as { old_string?: string; new_string?: string }[]) : []
              for (const e of edits) {
                const d = diffFromStrings(e.old_string, e.new_string)
                add += d.add
                del += d.del
              }
            }
            if (add + del > 0) {
              const sid = ensureSession()
              if (sid !== null) {
                db.insertAgentEdit(sid, { ts: tsMs, filePath, addedLines: add, deletedLines: del })
                out.edits++
              }
            }
          }
        }
      }
    }
  }

  if (dbSessionId !== null) {
    db.upsertAgentSession('claude', externalId, {
      parentExternalId,
      cwd: cwd ?? role.slug, // 找不到真实 cwd 时用 slug 目录名，交由项目匹配层还原
      title,
      startedAt: firstTs,
      endedAt: lastTs,
      messageCount: msgs
    })
  }
  return out
}

function firstTextOf(content: unknown): string | null {
  if (typeof content === 'string') return content.trim() || null
  if (Array.isArray(content)) {
    for (const c of content) {
      if (c && typeof c === 'object' && (c as { type?: string; text?: string }).type === 'text') {
        const t = (c as { text?: string }).text
        if (t && t.trim()) return t.trim()
      }
    }
  }
  return null
}
