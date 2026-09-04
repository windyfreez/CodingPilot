/**
 * Codex CLI 采集适配器
 * 记录位置：~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl（Codex Desktop / CLI 0.146+）
 * 行格式：{ timestamp: RFC3339(ms, UTC), type, payload }
 * - usage：event_msg.payload.type === 'token_count' → info.last_token_usage / total_token_usage
 *   (input_tokens, output_tokens, reasoning_output_tokens, cached_input_tokens, cache_write_input_tokens)
 * - model：thread_settings_applied.payload.thread_settings.model（或 world_state）
 * - cwd：session_meta.payload.cwd / turn_context.payload.cwd
 * - 文件改动：event_msg.payload.type === 'patch_apply_end' → changes[path].unified_diff
 * - 会话：session_meta.payload.session_id（一个线程跨多个 rollout 文件，按 session_id 归并）
 */
import { readFileSync, statSync } from 'fs'
import fg from 'fast-glob'
import * as db from '../../db'

interface CursorMap {
  [path: string]: { size: number; mtime: number }
}

export async function ingestCodex(
  dir: string,
  cursors: Record<string, CursorMap>,
  tool = 'codex'
): Promise<{ sessions: number; usage: number; edits: number; skipped: number }> {
  const out = { sessions: 0, usage: 0, edits: 0, skipped: 0 }
  const files = await fg('**/*.jsonl', {
    cwd: dir,
    onlyFiles: true,
    absolute: true,
    suppressErrors: true,
    ignore: ['plugins/**', '.tmp/**', 'node_modules/**', 'cache/**', 'logs/**', '**/archive/**', '**/trash/**']
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
      const res = await parseFile(file)
      out.sessions += res.sessions
      out.usage += res.usage
      out.edits += res.edits
      myCursor[file] = { size: st.size, mtime: st.mtimeMs }
    } catch (e) {
      console.warn(`[usage/codex] parse failed ${file}:`, (e as Error).message)
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

async function parseFile(file: string): Promise<ParsedFile> {
  const raw = readFileSync(file, 'utf8')
  const out: ParsedFile = { sessions: 0, usage: 0, edits: 0 }
  let cwd: string | null = null
  let model: string | null = null
  let sessionId: string | null = null
  let firstTs: number | null = null
  let lastTs: number | null = null
  let msgs = 0
  let dbSessionId: number | null = null
  let title: string | null = null

  const ensureSession = (): number | null => {
    if (!sessionId) return null
    if (dbSessionId === null) {
      const r = db.upsertAgentSession(toolOf(file), sessionId, {
        cwd,
        startedAt: firstTs ?? undefined,
        endedAt: lastTs,
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
    let rec: { timestamp?: string; type?: string; payload?: Record<string, unknown> }
    try {
      rec = JSON.parse(trimmed) as typeof rec
    } catch {
      continue
    }
    if (!rec.payload) continue
    const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN
    const tsMs = Number.isFinite(ts) ? ts : null
    if (tsMs !== null) {
      if (firstTs === null || tsMs < firstTs) firstTs = tsMs
      if (lastTs === null || tsMs > lastTs) lastTs = tsMs
    }
    const p = rec.payload as {
      type?: string
      session_id?: string
      id?: string
      cwd?: string
      thread_settings?: { model?: string }
      info?: {
        last_token_usage?: TokenUsage
        total_token_usage?: TokenUsage
      }
      changes?: Record<string, { type?: string; unified_diff?: string }>
      stdout?: string
      message?: string
      phase?: string
    }
    switch (rec.type) {
      case 'session_meta': {
        sessionId = p.session_id ?? p.id ?? null
        if (p.cwd) cwd = p.cwd
        break
      }
      case 'world_state': {
        const state = (rec.payload as { state?: { collaboration_mode?: { model?: string } } }).state
        if (state?.collaboration_mode?.model) model = state.collaboration_mode.model
        break
      }
      case 'turn_context': {
        if (p.cwd) cwd = p.cwd
        break
      }
      case 'thread_settings_applied': {
        if (p.thread_settings?.model) model = p.thread_settings.model
        break
      }
      case 'response_item': {
        const pi = rec.payload as { type?: string; content?: { type?: string; text?: string }[]; role?: string }
        if (pi.type === 'message') {
          msgs++
          if (title === null && pi.role === 'user' && Array.isArray(pi.content)) {
            for (const c of pi.content) {
              if (c.type === 'input_text' && c.text && c.text.trim()) {
                title = c.text.trim().slice(0, 120)
                break
              }
            }
          }
        }
        break
      }
      case 'event_msg': {
        const ev = p.type
        if (ev === 'token_count') {
          const last = p.info?.last_token_usage ?? p.info?.total_token_usage
          if (last) {
            const sid = ensureSession()
            if (sid !== null && tsMs !== null) {
              db.insertAgentUsage(sid, {
                recordedAt: tsMs,
                model,
                inputTokens: last.input_tokens ?? 0,
                outputTokens: last.output_tokens ?? 0,
                cacheReadTokens: last.cached_input_tokens ?? 0,
                cacheWriteTokens: last.cache_write_input_tokens ?? 0,
                reasoningTokens: last.reasoning_output_tokens ?? 0
              })
              out.usage++
            }
          }
        } else if (ev === 'patch_apply_end') {
          const changes = p.changes
          const sid = ensureSession()
          if (sid !== null && changes && tsMs !== null) {
            for (const [path, ch] of Object.entries(changes)) {
              if (!ch || typeof ch.unified_diff !== 'string') continue
              const { add, del } = countDiff(ch.unified_diff)
              if (add + del > 0) {
                db.insertAgentEdit(sid, { ts: tsMs, filePath: path, addedLines: add, deletedLines: del })
                out.edits++
              }
            }
          }
        }
        break
      }
      default:
        break
    }
  }

  // 汇总本文件所属会话的元数据
  if (sessionId && dbSessionId !== null) {
    db.upsertAgentSession(toolOf(file), sessionId, {
      cwd,
      title,
      startedAt: firstTs,
      endedAt: lastTs,
      messageCount: msgs
    })
  }
  return out
}

function toolOf(_file: string): 'codex' {
  return 'codex'
}

interface TokenUsage {
  input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  cached_input_tokens?: number
  cache_write_input_tokens?: number
  total_tokens?: number
}

/** 解析 unified_diff：统计 + / - 前缀行（排除 --- / +++ 路径头与 @@ hunk 头） */
function countDiff(diff: string): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const line of diff.split('\n')) {
    const t = line.trim()
    if (t.startsWith('+++') || t.startsWith('---') || t.startsWith('@@')) continue
    if (t.startsWith('+')) add++
    else if (t.startsWith('-')) del++
  }
  return { add, del }
}
