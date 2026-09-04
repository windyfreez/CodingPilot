/**
 * Agent 用量服务（token / 消费）
 * - 配置读写（记录目录、自动同步、模型单价）
 * - 用量聚合查询（卡片 / 趋势 / 分布 / 会话明细）
 * - 同步编排：调用三个采集适配器 → 入库 → 会话归属项目 → 返回增量结果
 */
import { homedir } from 'os'
import { join } from 'path'
import { appendFileSync, mkdirSync } from 'fs'
import { app } from 'electron'
import * as db from '../db'
import type {
  ModelPrice,
  NameValue,
  UsageBreakdown,
  UsageCards,
  UsageConfig,
  UsageOverview,
  UsageSessionBrief,
  UsageSyncResult,
  UsageTrendPoint
} from '@shared/types'
import { DEFAULT_USAGE_CONFIG } from '@shared/types'
import { ingestClaude } from './adapters/claude'
import { ingestCodex } from './adapters/codex'
import { ingestHarness } from './adapters/harness'

const CONFIG_KEY = 'usageConfig'
const CURSOR_KEY = 'agentSyncCursors'
const LAST_SYNC_KEY = 'usageLastSyncAt'

export type SyncEmitter = (p: { syncing: boolean; phase: string; done?: number; total?: number }) => void

/** 写入 userData/logs/app.log（排查原生崩溃用，须在解压等操作前留下痕迹） */
export function writeLog(line: string): void {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'app.log'), `${new Date().toISOString()} ${line}\n`)
  } catch {
    // 静默
  }
}

let syncing = false

// ---------- 配置 ----------
export function getUsageConfig(): UsageConfig {
  const saved = db.getSettingsJson<Partial<UsageConfig>>(CONFIG_KEY, {})
  return { ...DEFAULT_USAGE_CONFIG, ...saved, modelPrices: saved.modelPrices ?? DEFAULT_USAGE_CONFIG.modelPrices }
}

export function saveUsageConfig(patch: Partial<UsageConfig>): UsageConfig {
  const next = { ...getUsageConfig(), ...patch }
  db.setSetting(CONFIG_KEY, JSON.stringify(next))
  return next
}

export function defaultToolDir(tool: 'harness' | 'claude' | 'codex'): string {
  const home = homedir()
  switch (tool) {
    case 'harness':
      return join(home, '.dsh')
    case 'claude':
      return join(home, '.claude')
    case 'codex':
      return join(home, '.codex')
  }
}

// ---------- 时间工具（本地时区） ----------
export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function dayRange(date: string): [number, number] {
  const [y, m, d] = date.split('-').map(Number)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
  return [start, start + 24 * 3600 * 1000 - 1]
}

function daysAgoDate(days: number): string {
  return localDateStr(new Date(Date.now() - days * 24 * 3600 * 1000))
}

// ---------- 成本估算 ----------
function matchModel(model: string, pattern: string): boolean {
  if (!pattern.includes('*')) return model.toLowerCase() === pattern.toLowerCase()
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')
  return re.test(model)
}

export function priceFor(model: string | null, prices: ModelPrice[]): { in: number; out: number; cacheR: number; cacheW: number } | null {
  if (!model) return null
  for (const p of prices) {
    if (matchModel(model, p.model)) {
      return { in: p.inputPerMillion, out: p.outputPerMillion, cacheR: p.cacheReadPerMillion ?? 0, cacheW: p.cacheWritePerMillion ?? 0 }
    }
  }
  return null
}

function estCost(
  u: { model: string | null; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost: number },
  prices: ModelPrice[]
): number {
  if (u.cost > 0) return u.cost
  const p = priceFor(u.model, prices)
  if (!p) return 0
  return (
    (u.input_tokens / 1e6) * p.in +
    (u.output_tokens / 1e6) * p.out +
    (u.cache_read_tokens / 1e6) * p.cacheR +
    (u.cache_write_tokens / 1e6) * p.cacheW
  )
}

interface UsageRowAgg {
  model: string | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  cost: number
  cnt: number
}

function enrichCost(rows: UsageRowAgg[]): void {
  const prices = getUsageConfig().modelPrices
  for (const r of rows) {
    if (r.cost <= 0) r.cost = estCost(r, prices)
  }
}

// ---------- 查询 ----------
function sumTokens(r: UsageRowAgg): number {
  return r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens + r.reasoning_tokens
}

export function queryCards(): UsageCards {
  const d = db.getDb()
  const today = localDateStr()
  const [dayStart, dayEnd] = dayRange(today)
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()

  const fetch = (where: string, params: unknown[]): UsageRowAgg[] =>
    d
      .prepare(
        `SELECT model, COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens,
         COALESCE(SUM(cache_read_tokens),0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens),0) AS cache_write_tokens,
         COALESCE(SUM(reasoning_tokens),0) AS reasoning_tokens, COALESCE(SUM(cost),0) AS cost
         FROM agent_usage WHERE ${where}`
      )
      .all(...params) as UsageRowAgg[]

  const todayRows = fetch('recorded_at >= ? AND recorded_at <= ?', [dayStart, dayEnd])
  const monthRows = fetch('recorded_at >= ?', [monthStart])
  const totalRows = fetch('1=1', [])
  enrichCost(todayRows)
  enrichCost(monthRows)
  enrichCost(totalRows)

  const sum = (rows: UsageRowAgg[]) =>
    rows.reduce((a, r) => a + sumTokens(r), 0)
  const cost = (rows: UsageRowAgg[]) => rows.reduce((a, r) => a + r.cost, 0)

  const todaySessions = (
    d
      .prepare(
        `SELECT COUNT(DISTINCT s.id) AS c FROM agent_sessions s
         WHERE EXISTS (SELECT 1 FROM agent_usage u WHERE u.session_id = s.id AND u.recorded_at >= ? AND u.recorded_at <= ?)
            OR EXISTS (SELECT 1 FROM agent_edits e WHERE e.session_id = s.id AND e.ts >= ? AND e.ts <= ?)`
      )
      .get(dayStart, dayEnd, dayStart, dayEnd) as { c: number }
  ).c

  const lastSync = db.getSetting(LAST_SYNC_KEY, '')
  return {
    todayTokens: sum(todayRows),
    todayInput: todayRows.reduce((a, r) => a + r.input_tokens, 0),
    todayOutput: todayRows.reduce((a, r) => a + r.output_tokens, 0),
    todayCache: todayRows.reduce((a, r) => a + r.cache_read_tokens + r.cache_write_tokens, 0),
    todayCost: cost(todayRows),
    monthTokens: sum(monthRows),
    monthCost: cost(monthRows),
    totalTokens: sum(totalRows),
    totalCost: cost(totalRows),
    todaySessions,
    lastSyncAt: lastSync ? parseInt(lastSync, 10) : null
  }
}

export function queryTrend(days = 30): UsageTrendPoint[] {
  const d = db.getDb()
  const since = daysAgoDate(days)
  const rows = d
    .prepare(
      `SELECT date(recorded_at/1000, 'unixepoch', 'localtime') AS date,
       COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens,
       COALESCE(SUM(cache_read_tokens),0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens),0) AS cache_write_tokens,
       COALESCE(SUM(reasoning_tokens),0) AS reasoning_tokens, COALESCE(SUM(cost),0) AS cost, COUNT(*) AS cnt
       FROM agent_usage WHERE date(recorded_at/1000,'unixepoch','localtime') >= ? GROUP BY date ORDER BY date`
    )
    .all(since) as (UsageRowAgg & { date: string })[]
  enrichCost(rows)
  return rows.map((r) => ({
    date: r.date,
    input: r.input_tokens,
    output: r.output_tokens,
    cacheRead: r.cache_read_tokens,
    cacheWrite: r.cache_write_tokens,
    reasoning: r.reasoning_tokens,
    cost: r.cost
  }))
}

export function queryBreakdown(days = 30): UsageBreakdown {
  const d = db.getDb()
  const since = daysAgoDate(days)
  const group = (sql: string): NameValue[] =>
    d
      .prepare(sql)
      .all(since) as { name: string; value: number }[]

  const byTool = group(
    `SELECT s.tool AS name, SUM(u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens + u.reasoning_tokens) AS value
     FROM agent_usage u JOIN agent_sessions s ON s.id = u.session_id
     WHERE date(u.recorded_at/1000,'unixepoch','localtime') >= ? GROUP BY s.tool ORDER BY value DESC`
  )
  const byModel = group(
    `SELECT COALESCE(u.model, '未知') AS name, SUM(u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens + u.reasoning_tokens) AS value
     FROM agent_usage u
     WHERE date(u.recorded_at/1000,'unixepoch','localtime') >= ? GROUP BY u.model ORDER BY value DESC LIMIT 12`
  )
  const byProject = group(
    `SELECT COALESCE(p.name, '(未关联项目)') AS name,
       SUM(u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens + u.reasoning_tokens) AS value
     FROM agent_usage u JOIN agent_sessions s ON s.id = u.session_id LEFT JOIN projects p ON p.id = s.project_id
     WHERE date(u.recorded_at/1000,'unixepoch','localtime') >= ? GROUP BY s.project_id ORDER BY value DESC LIMIT 15`
  )
  return { byTool, byModel, byProject }
}

export function querySessions(limit = 50): UsageSessionBrief[] {
  const d = db.getDb()
  const rows = d
    .prepare(
      `SELECT s.id, s.tool, s.title, s.started_at, s.ended_at, p.name AS project_name, s.cwd,
       COALESCE((SELECT u.model FROM agent_usage u WHERE u.session_id = s.id ORDER BY u.recorded_at DESC LIMIT 1), '') AS model,
       COALESCE((SELECT SUM(input_tokens) FROM agent_usage WHERE session_id = s.id),0) AS input_tokens,
       COALESCE((SELECT SUM(output_tokens) FROM agent_usage WHERE session_id = s.id),0) AS output_tokens,
       COALESCE((SELECT SUM(cache_read_tokens + cache_write_tokens) FROM agent_usage WHERE session_id = s.id),0) AS cache_tokens,
       COALESCE((SELECT SUM(cost) FROM agent_usage WHERE session_id = s.id),0) AS cost
       FROM agent_sessions s LEFT JOIN projects p ON p.id = s.project_id
       ORDER BY COALESCE(s.started_at, s.created_at) DESC LIMIT ?`
    )
    .all(limit) as {
    id: number
    tool: 'harness' | 'claude' | 'codex'
    title: string | null
    started_at: number | null
    ended_at: number | null
    project_name: string | null
    cwd: string | null
    model: string
    input_tokens: number
    output_tokens: number
    cache_tokens: number
    cost: number
  }[]
  const prices = getUsageConfig().modelPrices
  return rows.map((r) => ({
    id: r.id,
    tool: r.tool,
    title: r.title,
    projectName: r.project_name,
    model: r.model || null,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheTokens: r.cache_tokens,
    cost:
      r.cost > 0
        ? r.cost
        : estCost(
            { model: r.model || null, input_tokens: r.input_tokens, output_tokens: r.output_tokens, cache_read_tokens: r.cache_tokens, cache_write_tokens: 0, cost: r.cost },
            prices
          )
  }))
}

export function getOverview(days = 30): UsageOverview {
  return { cards: queryCards(), trend: queryTrend(days), breakdown: queryBreakdown(days) }
}

// ---------- 同步编排 ----------
export function isSyncing(): boolean {
  return syncing
}

function readCursors(): Record<string, Record<string, { size: number; mtime: number }>> {
  return db.getSettingsJson<Record<string, Record<string, { size: number; mtime: number }>>>(CURSOR_KEY, {})
}

export function writeCursors(c: Record<string, Record<string, { size: number; mtime: number }>>): void {
  db.setSetting(CURSOR_KEY, JSON.stringify(c))
}

export function setLastSyncAt(ts: number): void {
  db.setSetting(LAST_SYNC_KEY, String(ts))
}

/**
 * 执行一次完整采集（可只采集指定工具，null=全部启用工具）。
 * 返回：本次新增会话数 / 用量条数 / 改动条数 / 归属项目数 / 跳过文件数。
 */
export async function syncNow(tool?: 'harness' | 'claude' | 'codex', emit?: SyncEmitter): Promise<UsageSyncResult> {
  if (syncing) return { sessions: 0, usageRows: 0, edits: 0, linked: 0, skipped: 0 }
  syncing = true
  try {
    const cfg = getUsageConfig()
    const cursors = readCursors()
    const result: UsageSyncResult = { sessions: 0, usageRows: 0, edits: 0, linked: 0, skipped: 0 }

    const adapters: {
      tool: 'harness' | 'claude' | 'codex'
      ingest: (
        dir: string,
        cursors: Record<string, Record<string, { size: number; mtime: number }>>
      ) => Promise<{ sessions: number; usage: number; edits: number; skipped: number }>
    }[] = [
      { tool: 'harness', ingest: ingestHarness },
      { tool: 'claude', ingest: ingestClaude },
      { tool: 'codex', ingest: ingestCodex }
    ]
    for (const a of adapters) {
      if (tool && a.tool !== tool) continue
      emit?.({ syncing: true, phase: `${a.tool}:scanning` })
      const dir =
        (a.tool === 'harness' ? cfg.harnessDir : a.tool === 'claude' ? cfg.claudeDir : cfg.codexDir) || defaultToolDir(a.tool)
      writeLog(`[usage:${a.tool}] start dir=${dir}`)
      try {
        const r = await a.ingest(dir, cursors)
        result.sessions += r.sessions
        result.usageRows += r.usage
        result.edits += r.edits
        result.skipped += r.skipped
        writeLog(`[usage:${a.tool}] done sessions=${r.sessions} usage=${r.usage} edits=${r.edits} skipped=${r.skipped}`)
      } catch (e) {
        const msg = e instanceof Error ? (e.stack ?? e.message) : String(e)
        writeLog(`[usage:${a.tool}] error ${msg}`)
        console.warn(`[usage] adapter ${a.tool} failed:`, e)
      }
    }
    result.linked = db.linkAgentSessionsToProjects()
    writeLog(`[usage:link] linked=${result.linked}`)
    writeCursors(cursors)
    setLastSyncAt(Date.now())
    writeLog('[usage] syncNow finished')
    return result
  } finally {
    syncing = false
  }
}
