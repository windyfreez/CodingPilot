/**
 * 当日工作量服务
 * - worklog_git：按 项目×日期×作者 聚合 git 提交/文件/增删行（git log --numstat 增量同步）
 * - 将 agent_edits / agent_usage 按天聚合成 "Agent 写入行数 / token" 口径
 * - 读取手动补录/修正条目（worklog_manual，含 self_lines 自己手写行数修正）
 */
import { simpleGit } from 'simple-git'
import * as db from '../db'
import type { WorklogDayData, WorklogGitAuthorRow, WorklogManualEntry, WorklogProjectRow } from '@shared/types'

const CURSOR_KEY = 'worklogGitCursors'
/** 全量回看窗口：首次同步（无游标仓库）拉取最近多少天 */
const FULL_LOOKBACK_DAYS = 180

interface ProjectCursor {
  hash: string
  /** 上次同步覆盖到哪一天（含） YYYY-MM-DD */
  date: string
}

export type WorklogEmitter = (p: { syncing: boolean; done: number; total: number; current?: string }) => void

function todayStr(): string {
  return localDateStr(new Date())
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 本地日期起止毫秒 */
export function dayRange(date: string): [number, number] {
  const [y, m, d] = date.split('-').map(Number)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
  return [start, start + 24 * 3600 * 1000 - 1]
}

function readCursors(): Record<string, ProjectCursor> {
  return db.getSettingsJson<Record<string, ProjectCursor>>(CURSOR_KEY, {})
}

function writeCursors(c: Record<string, ProjectCursor>): void {
  db.setSetting(CURSOR_KEY, JSON.stringify(c))
}

interface NumstatMeta {
  hash: string
  author: string
  email: string
  date: string
}

interface NumstatRow {
  meta: NumstatMeta
  add: number
  del: number
}

/**
 * 拉取某仓库自 since（YYYY-MM-DD，含）以来、作者日期在 since..today 的逐提交 numstat。
 * 输出格式：--pretty 行 '@@hash\u0001author\u0001email\u0001date'，随后 numstat 行 'a\td\tpath'。
 */
async function fetchNumstat(projectPath: string, since: string): Promise<NumstatRow[]> {
  const git = simpleGit({ baseDir: projectPath, binary: 'git', maxConcurrentProcesses: 1, timeout: { block: 60000 } })
  const out = await git.raw([
    'log',
    '--all',
    `--since=${since} 00:00:00`,
    '--numstat',
    '--pretty=format:@@%H%x1f%an%x1f%ae%x1f%ad',
    '--date=short'
  ])
  const rows: NumstatRow[] = []
  let meta: NumstatMeta | null = null
  for (const line of out.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('@@')) {
      const [hash, author, email, date] = trimmed.slice(2).split('\u0001')
      meta = { hash, author: author ?? '', email: email ?? '', date: date ?? '' }
      continue
    }
    if (!meta || !trimmed || trimmed === '') continue
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(trimmed)
    if (!m) continue
    const add = m[1] === '-' ? 0 : parseInt(m[1], 10) || 0
    const del = m[2] === '-' ? 0 : parseInt(m[2], 10) || 0
    if (add + del === 0) continue
    rows.push({ meta, add, del })
  }
  return rows
}

/**
 * 同步所有 git 项目的工作量数据（增量：仅当 HEAD 变化或超过一天未同步才拉取）。
 */
export async function syncAllWorklogGit(emit?: WorklogEmitter): Promise<{ done: number; total: number }> {
  const projects = db.listProjects('WHERE is_existing = 1 AND is_git = 1')
  const cursors = readCursors()
  const total = projects.length
  let done = 0
  emit?.({ syncing: true, done: 0, total })

  const today = todayStr()
  let idx = 0
  const workers = Array.from({ length: Math.min(4, total || 1) }, async () => {
    while (idx < projects.length) {
      const p = projects[idx++]
      try {
        const git = simpleGit({ baseDir: p.path, binary: 'git', maxConcurrentProcesses: 1, timeout: { block: 20000 } })
        const head = await git.raw(['rev-parse', 'HEAD']).catch(() => '')
        const cursor = cursors[String(p.id)]
        const needFull = !cursor || !cursor.hash || !cursor.date
        const hashChanged = !cursor || cursor.hash !== head.trim()
        const stale = !cursor || cursor.date < today
        if (!needFull && !hashChanged && !stale) {
          // 无新增提交且今天已同步过 → 跳过
          done++
          continue
        }
        const since = needFull
          ? localDateStr(new Date(Date.now() - FULL_LOOKBACK_DAYS * 24 * 3600 * 1000))
          : localDateStr(new Date(Date.now() - 2 * 24 * 3600 * 1000))
        const rows = await fetchNumstat(p.path, since)
        // 聚合：按 日期×作者(邮箱) 汇总
        const agg = new Map<string, { date: string; author: string; email: string; commits: Set<string>; files: number; insertions: number; deletions: number }>()
        for (const r of rows) {
          const key = `${r.meta.date}|${r.meta.author}|${r.meta.email}`
          let a = agg.get(key)
          if (!a) {
            a = { date: r.meta.date, author: r.meta.author, email: r.meta.email, commits: new Set(), files: 0, insertions: 0, deletions: 0 }
            agg.set(key, a)
          }
          a.commits.add(r.meta.hash)
          a.files++
          a.insertions += r.add
          a.deletions += r.del
        }
        const outRows: db.WorklogGitRow[] = Array.from(agg.values()).map((a) => ({
          project_id: p.id,
          date: a.date,
          author: a.author,
          email: a.email,
          commits: a.commits.size,
          files_changed: a.files,
          insertions: a.insertions,
          deletions: a.deletions
        }))
        // 只替换本次窗口涉及日期的数据（避免污染窗口外历史）
        replaceWindow(p.id, since, today, outRows)
        cursors[String(p.id)] = { hash: head.trim(), date: today }
        if (total > 0 && done % 3 === 0) {
          emit?.({ syncing: true, done, total, current: p.name })
        }
      } catch (e) {
        console.warn('[worklog] git sync failed for', p.path, (e as Error).message)
      }
      done++
    }
  })
  await Promise.all(workers)
  writeCursors(cursors)
  emit?.({ syncing: false, done, total })
  return { done, total }
}

/** 删除项目窗口内旧数据再写入新聚合结果 */
function replaceWindow(projectId: number, since: string, until: string, rows: db.WorklogGitRow[]): void {
  const d = db.getDb()
  const tx = d.transaction(() => {
    d.prepare('DELETE FROM worklog_git WHERE project_id = ? AND date >= ? AND date <= ?').run(projectId, since, until)
    const ins = d.prepare(
      `INSERT OR REPLACE INTO worklog_git (project_id, date, author, email, commits, files_changed, insertions, deletions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const r of rows) {
      if (r.date >= since && r.date <= until) {
        ins.run(projectId, r.date, r.author, r.email, r.commits, r.files_changed, r.insertions, r.deletions)
      }
    }
  })
  tx()
}

/** 组装某天的工作量完整数据（页面一次拉取） */
export function getDayData(date: string): WorklogDayData {
  const [start, end] = dayRange(date)
  const d = db.getDb()
  const gitRows = db.queryWorklogDaily(date)

  // 按项目聚合 git 指标与作者维度
  const byProject = new Map<
    number,
    { projectId: number; projectName: string; projectPath: string; commits: number; filesChanged: number; insertions: number; deletions: number; authors: WorklogGitAuthorRow[] }
  >()
  for (const r of gitRows) {
    let p = byProject.get(r.project_id)
    if (!p) {
      p = {
        projectId: r.project_id,
        projectName: r.project_name,
        projectPath: r.project_path,
        commits: 0,
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
        authors: []
      }
      byProject.set(r.project_id, p)
    }
    p.commits += r.commits
    p.filesChanged += r.files_changed
    p.insertions += r.insertions
    p.deletions += r.deletions
    p.authors.push({
      author: r.author,
      email: r.email,
      commits: r.commits,
      filesChanged: r.files_changed,
      insertions: r.insertions,
      deletions: r.deletions
    })
  }

  // Agent 当日改动行数（按项目）与用量
  const editRows = d
    .prepare(
      `SELECT project_id, COUNT(*) AS edits, COALESCE(SUM(added_lines), 0) AS added, COALESCE(SUM(deleted_lines), 0) AS deleted
       FROM agent_edits WHERE ts >= ? AND ts <= ? GROUP BY project_id`
    )
    .all(start, end) as { project_id: number | null; edits: number; added: number; deleted: number }[]
  const agentMap = new Map<number | null, { edits: number; added: number; deleted: number }>()
  for (const e of editRows) agentMap.set(e.project_id, { edits: e.edits, added: e.added, deleted: e.deleted })

  const usageRow = d
    .prepare(
      `SELECT COUNT(DISTINCT u.session_id) AS sessions, COALESCE(SUM(u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens + u.reasoning_tokens), 0) AS tokens,
       COALESCE(SUM(u.cost), 0) AS cost
       FROM agent_usage u JOIN agent_sessions s ON s.id = u.session_id
       WHERE u.recorded_at >= ? AND u.recorded_at <= ?`
    )
    .get(start, end) as { sessions: number; tokens: number; cost: number }

  const manual = db.listWorklogManual(date).map(
    (m): WorklogManualEntry => ({
      id: m.id,
      date: m.date,
      projectId: m.project_id,
      category: m.category,
      title: m.title,
      value: m.value,
      note: m.note,
      createdAt: m.created_at
    })
  )
  const selfMap = new Map<number | null, number>()
  for (const m of manual) {
    if (m.category === 'self_lines') selfMap.set(m.projectId, m.value)
  }

  const projects: WorklogProjectRow[] = Array.from(byProject.values()).map((p) => {
    const agent = agentMap.get(p.projectId) ?? { edits: 0, added: 0, deleted: 0 }
    return {
      projectId: p.projectId,
      projectName: p.projectName,
      projectPath: p.projectPath,
      commits: p.commits,
      filesChanged: p.filesChanged,
      insertions: p.insertions,
      deletions: p.deletions,
      byAuthor: p.authors.sort((a, b) => b.insertions - a.insertions),
      agentAddedLines: agent.added,
      agentDeletedLines: agent.deleted,
      selfLinesOverride: selfMap.get(p.projectId) ?? null
    }
  })
  projects.sort((a, b) => b.insertions - a.insertions)

  const gitTotals = projects.reduce(
    (acc, p) => {
      acc.commits += p.commits
      acc.filesChanged += p.filesChanged
      acc.insertions += p.insertions
      acc.deletions += p.deletions
      return acc
    },
    { commits: 0, filesChanged: 0, insertions: 0, deletions: 0 }
  )

  const agentTotals = { sessions: usageRow.sessions, edits: 0, addedLines: 0, deletedLines: 0, tokens: usageRow.tokens, cost: usageRow.cost }
  for (const a of agentMap.values()) {
    agentTotals.edits += a.edits
    agentTotals.addedLines += a.added
    agentTotals.deletedLines += a.deleted
  }
  // Agent 会话数取“当天有用量或改动”的会话数（usage 已有，若当天只有改动无用量则统计不到，这里并入改动会话）
  if (usageRow.sessions === 0) {
    const s = d
      .prepare('SELECT COUNT(DISTINCT session_id) AS c FROM agent_edits WHERE ts >= ? AND ts <= ?')
      .get(start, end) as { c: number }
    agentTotals.sessions = s.c
  }

  return {
    date,
    git: gitTotals,
    agent: agentTotals,
    projects,
    manual
  }
}

export function listDayManual(date: string): WorklogManualEntry[] {
  return db.listWorklogManual(date).map((m) => ({
    id: m.id,
    date: m.date,
    projectId: m.project_id,
    category: m.category,
    title: m.title,
    value: m.value,
    note: m.note,
    createdAt: m.created_at
  }))
}
