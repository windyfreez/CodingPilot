/**
 * DeepSeek Harness 采集适配器
 * 记录位置：~/.dsh/sessions/<工作目录slug>/<会话id>/session.jsonl.zstd（或 .jsonl 明文）
 * - 每行事件：{ type, seq, time(epoch ms), data:{…} }
 * - 会话头：首行 type='session' → { id, createdAt, cwd, parentSession?, origin:'subagent'?, delegationDepth, agentPreset? }
 * - usage：assistant/message.data.usage → { inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?, reasoningTokens? }
 * - model：request/context.data.model / request/header.data.config.model
 * - 文件改动：tool/call name ∈ write|edit|str_replace_editor，路径在 data.arguments.file_path，
 *   write 带 content（全量新内容），edit / str_replace_editor 带 old_string/new_string
 * - 子代理：独立会话文件（同一 slug 下 UUID 目录），header.parentSession 指向父会话 → parent_external_id
 * - zstd 容器：Node 内置 zlib 的 zstd 逐帧拼接；按帧魔数切帧解压拼接，尾部撕裂帧丢弃
 */
import { readFileSync, statSync, readdirSync, appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { decompress } from 'fzstd'
import { app } from 'electron'
import * as db from '../../db'

interface CursorMap {
  [path: string]: { size: number; mtime: number }
}

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 会话根目录下递归找 session 文件 */
function findSessionFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === '.' || e.name === '..') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (e.isFile() && (e.name === 'session.jsonl.zstd' || e.name.endsWith('.jsonl.zstd') || e.name === 'session.jsonl')) {
        out.push(full)
      }
    }
  }
  walk(root)
  return out
}

export async function ingestHarness(
  dir: string,
  cursors: Record<string, CursorMap>,
  tool = 'harness'
): Promise<{ sessions: number; usage: number; edits: number; skipped: number }> {
  const out = { sessions: 0, usage: 0, edits: 0, skipped: 0 }
  const myCursor = cursors[tool] ?? {}
  for (const file of findSessionFiles(dir)) {
    try {
      const st = statSync(file)
      const prev = myCursor[file]
      if (prev && prev.size === st.size && prev.mtime === st.mtimeMs) {
        out.skipped++
        continue
      }
      usageLog(`[harness] parse ${file} size=${st.size}`)
      const res = await parseFile(file)
      out.sessions += res.sessions
      out.usage += res.usage
      out.edits += res.edits
      usageLog(`[harness] parsed ${file} sessions=${res.sessions} usage=${res.usage} edits=${res.edits}`)
      myCursor[file] = { size: st.size, mtime: st.mtimeMs }
    } catch (e) {
      usageLog(`[harness] parse failed ${file}: ${(e as Error).message}`)
      console.warn(`[usage/harness] parse failed ${file}:`, (e as Error).message)
    }
  }
  cursors[tool] = myCursor
  return out
}

/** 轻量日志（与 usage.ts writeLog 同文件） */
function usageLog(line: string): void {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'app.log'), `${new Date().toISOString()} ${line}\n`)
  } catch {
    // 静默
  }
}

/**
 * 解压 zstd 帧拼接容器。
 * 使用纯 JS 解码器 fzstd：Node 内置 zlib 的 zstd 实验性实现会在个别帧上原生崩溃（abort 进程），
 * 因此不在此处使用 node:zlib；fzstd 无原生依赖，坏帧只会抛 JS 异常（可捕获忽略）。
 */
function decompressZstd(buf: Buffer): string | null {
  try {
    // 定位所有帧起点（魔数），逐帧解压后拼接
    const starts: number[] = []
    let idx = buf.indexOf(ZSTD_MAGIC)
    while (idx !== -1) {
      starts.push(idx)
      idx = buf.indexOf(ZSTD_MAGIC, idx + 1)
    }
    if (starts.length <= 1) {
      return Buffer.from(decompress(new Uint8Array(buf))).toString('utf8')
    }
    let text = ''
    let failed = 0
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1] : buf.length
      try {
        text += Buffer.from(decompress(new Uint8Array(buf.subarray(starts[i], end)))).toString('utf8')
      } catch {
        // 撕裂/损坏帧忽略（常见于写入中断的尾部帧）
        failed++
      }
    }
    if (failed > 0) usageLog(`[harness:zstd] ${failed}/${starts.length} frames skipped`)
    return text
  } catch (e) {
    usageLog(`[harness:zstd] decompress error: ${(e as Error).message}`)
    return null
  }
}

interface ParsedFile {
  sessions: number
  usage: number
  edits: number
}

async function parseFile(file: string): Promise<ParsedFile> {
  const raw = readFileSync(file)
  const text = file.endsWith('.zstd') ? decompressZstd(raw) : raw.toString('utf8')
  if (text === null) {
    usageLog('[usage/harness] zstd 解压失败，跳过:' + file)
    return { sessions: 0, usage: 0, edits: 0 }
  }
  const out: ParsedFile = { sessions: 0, usage: 0, edits: 0 }

  let sessionId: string | null = null
  let parentId: string | null = null
  let cwd: string | null = null
  let createdAt: number | null = null
  let model: string | null = null
  let dbSessionId: number | null = null
  let title: string | null = null
  let msgs = 0
  let lastTs: number | null = null

  const ensureSession = (): number | null => {
    if (!sessionId) return null
    if (dbSessionId === null) {
      const r = db.upsertAgentSession('harness', sessionId, {
        parentExternalId: parentId,
        cwd,
        startedAt: createdAt,
        title,
        messageCount: msgs
      })
      dbSessionId = r.id
      if (r.created) out.sessions++
    }
    return dbSessionId
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let rec: { type?: string; time?: number; data?: Record<string, unknown> }
    try {
      rec = JSON.parse(trimmed) as typeof rec
    } catch {
      continue
    }
    const ts = typeof rec.time === 'number' ? rec.time : null
    if (ts !== null && (lastTs === null || ts > lastTs)) lastTs = ts
    const data = rec.data ?? {}

    if (rec.type === 'session') {
      const d = data as { id?: string; parentSession?: string; cwd?: string; createdAt?: number; origin?: string }
      sessionId = d.id ?? null
      parentId = d.parentSession ?? null
      cwd = d.cwd ?? null
      createdAt = typeof d.createdAt === 'number' ? d.createdAt : ts
      continue
    }
    if (!sessionId) continue

    switch (rec.type) {
      case 'request/context': {
        const d = data as { model?: string }
        if (d.model) model = d.model
        break
      }
      case 'request/header': {
        const d = data as { config?: { model?: string; provider?: string } }
        if (d.config?.model) model = d.config.model
        break
      }
      case 'assistant/message': {
        const d = data as { message?: { content?: unknown[] }; usage?: Record<string, number>; interrupted?: boolean }
        msgs++
        // 标题：取第一条 assistant 文本或首条用户文本的片段（懒加载：只在标题为空且为本会话首条消息时尝试）
        if (title === null && Array.isArray(d.message?.content)) {
          for (const c of d.message.content as { type?: string; text?: string }[]) {
            if (c.type === 'text' && c.text && c.text.trim()) {
              title = c.text.trim().slice(0, 120)
              break
            }
          }
        }
        const usage = d.usage
        if (usage && ts !== null) {
          const sid = ensureSession()
          if (sid !== null) {
            db.insertAgentUsage(sid, {
              recordedAt: ts,
              model,
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              cacheReadTokens: usage.cacheReadTokens ?? 0,
              cacheWriteTokens: usage.cacheWriteTokens ?? 0,
              reasoningTokens: usage.reasoningTokens ?? 0
            })
            out.usage++
          }
        }
        break
      }
      case 'user/message': {
        const d = data as { message?: { content?: unknown[] } }
        if (title === null && Array.isArray(d.message?.content)) {
          for (const c of d.message.content as { type?: string; text?: string }[]) {
            if (c.type === 'text' && c.text && c.text.trim()) {
              title = c.text.trim().slice(0, 120)
              break
            }
          }
        }
        break
      }
      case 'tool/call': {
        const d = data as { name?: string; arguments?: string | Record<string, unknown> }
        const name = d.name
        if (name === 'write' || name === 'edit' || name === 'str_replace_editor') {
          let args: Record<string, unknown>
          try {
            args = typeof d.arguments === 'string' ? (JSON.parse(d.arguments) as Record<string, unknown>) : (d.arguments ?? {})
          } catch {
            args = {}
          }
          const filePath = typeof args.file_path === 'string' ? args.file_path : typeof args.path === 'string' ? args.path : null
          if (filePath && ts !== null) {
            const sid = ensureSession()
            if (sid !== null) {
              const { add, del } = diffFromArgs(name, args)
              db.insertAgentEdit(sid, { ts, filePath, addedLines: add, deletedLines: del })
              out.edits++
            }
          }
        }
        break
      }
      default:
        break
    }
  }

  if (sessionId && dbSessionId !== null) {
    db.upsertAgentSession('harness', sessionId, {
      parentExternalId: parentId,
      cwd,
      title,
      startedAt: createdAt,
      endedAt: lastTs,
      messageCount: msgs
    })
  }
  return out
}

/** 从 write/edit 参数估算本次改动新增/删除行数（无旧文时按整文件行数计） */
function diffFromArgs(name: string, args: Record<string, unknown>): { add: number; del: number } {
  if (name === 'write') {
    const content = typeof args.content === 'string' ? args.content : ''
    return { add: content ? content.split('\n').length : 0, del: 0 }
  }
  const oldStr = typeof args.old_string === 'string' ? args.old_string : ''
  const newStr = typeof args.new_string === 'string' ? args.new_string : ''
  if (!oldStr && !newStr) return { add: 0, del: 0 }
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  // 去掉相同前缀/后缀后，剩余部分估算增删
  let a = 0
  let b = oldLines.length - 1
  let x = 0
  let y = newLines.length - 1
  while (a <= b && x <= y && oldLines[a] === newLines[x]) {
    a++
    x++
  }
  while (b >= a && y >= x && oldLines[b] === newLines[y]) {
    b--
    y--
  }
  const del = Math.max(b - a + 1, 0)
  const add = Math.max(y - x + 1, 0)
  return { add, del }
}
