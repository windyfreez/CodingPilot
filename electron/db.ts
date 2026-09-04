/**
 * SQLite 数据库层（better-sqlite3）
 * 存储项目元数据、标签、备忘录、Git 缓存、扫描日志与系统配置。
 */
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import type { Lifecycle, ProjectType } from '@shared/types'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'local-project-manager.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'other',
      language TEXT NOT NULL DEFAULT '其他',
      stack TEXT NOT NULL DEFAULT '[]',
      is_git INTEGER NOT NULL DEFAULT 0,
      remote_url TEXT,
      lifecycle TEXT NOT NULL DEFAULT 'developing',
      size_bytes INTEGER,
      last_modified_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_opened_at INTEGER,
      commits_30d INTEGER NOT NULL DEFAULT 0,
      active_30d INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      default_ide TEXT,
      default_script TEXT,
      is_existing INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
    CREATE INDEX IF NOT EXISTS idx_projects_type ON projects(type);
    CREATE INDEX IF NOT EXISTS idx_projects_lifecycle ON projects(lifecycle);

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#409EFF',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_tags (
      project_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (project_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS notes (
      project_id INTEGER PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commit_daily (
      project_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, date)
    );

    CREATE TABLE IF NOT EXISTS git_cache (
      project_id INTEGER PRIMARY KEY,
      branch TEXT,
      is_clean INTEGER NOT NULL DEFAULT 1,
      ahead INTEGER NOT NULL DEFAULT 0,
      behind INTEGER NOT NULL DEFAULT 0,
      remote_url TEXT,
      last_commit_at INTEGER,
      commits_30d INTEGER NOT NULL DEFAULT 0,
      synced_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS scan_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      roots TEXT NOT NULL DEFAULT '[]',
      found INTEGER NOT NULL DEFAULT 0,
      new_projects INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
  `)

  // 迁移：git_cache 增加 commit_synced_at 列（提交热力图数据的独立新鲜度时间戳，
  // 避免与 Git 状态同步时间混淆导致热力图数据永远不刷新）
  const gitCacheCols = d.prepare('PRAGMA table_info(git_cache)').all() as { name: string }[]
  if (!gitCacheCols.some((c) => c.name === 'commit_synced_at')) {
    d.exec('ALTER TABLE git_cache ADD COLUMN commit_synced_at INTEGER')
  }

  // ---------- Agent 用量与工作量统计（数据中心） ----------
  // agent_sessions：外部 AI 工具的会话（主会话；子代理/子会话归入 parent_external_id 指向主会话）
  d.exec(`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool TEXT NOT NULL,
      external_id TEXT NOT NULL,
      parent_external_id TEXT,
      title TEXT,
      cwd TEXT,
      project_id INTEGER,
      started_at INTEGER,
      ended_at INTEGER,
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      UNIQUE(tool, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_project ON agent_sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_started ON agent_sessions(started_at);

    -- agent_usage：每次模型调用的 token 用量与成本（按条入库，展示时聚合）
    CREATE TABLE IF NOT EXISTS agent_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      recorded_at INTEGER NOT NULL,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD'
    );
    CREATE INDEX IF NOT EXISTS idx_agent_usage_recorded ON agent_usage(recorded_at);
    CREATE INDEX IF NOT EXISTS idx_agent_usage_session ON agent_usage(session_id);

    -- agent_edits：Agent 对文件的写操作（行级归属统计的原始依据）
    CREATE TABLE IF NOT EXISTS agent_edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      rel_path TEXT,
      project_id INTEGER,
      added_lines INTEGER NOT NULL DEFAULT 0,
      deleted_lines INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_agent_edits_ts ON agent_edits(ts);
    CREATE INDEX IF NOT EXISTS idx_agent_edits_project ON agent_edits(project_id);

    -- worklog_git：按 项目×日期×作者 聚合的 git 工作量（numstat）
    CREATE TABLE IF NOT EXISTS worklog_git (
      project_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      commits INTEGER NOT NULL DEFAULT 0,
      files_changed INTEGER NOT NULL DEFAULT 0,
      insertions INTEGER NOT NULL DEFAULT 0,
      deletions INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, date, author, email)
    );
    CREATE INDEX IF NOT EXISTS idx_worklog_git_date ON worklog_git(date);

    -- worklog_manual：手动补录/校正条目（self_lines=自己写行数修正、interface=接口数、custom 等）
    CREATE TABLE IF NOT EXISTS worklog_manual (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      project_id INTEGER,
      category TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      value INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_worklog_manual_date ON worklog_manual(date);
  `)
}

// ---------- 配置读写 ----------
export function getSetting(key: string, fallback = ''): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? row.value : fallback
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}

export function getSettingsJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(getSetting(key, '')) as T
  } catch {
    return fallback
  }
}

// ---------- 项目 ----------
export interface ProjectRow {
  id: number
  path: string
  name: string
  type: ProjectType
  language: string
  stack: string
  is_git: number
  remote_url: string | null
  lifecycle: Lifecycle
  size_bytes: number | null
  last_modified_at: number | null
  created_at: number
  updated_at: number
  last_opened_at: number | null
  commits_30d: number
  active_30d: number
  description: string
  default_ide: string | null
  default_script: string | null
  exists: number
}

export function upsertProject(p: {
  path: string
  name: string
  type: ProjectType
  language: string
  stack: string[]
  isGit: boolean
  remoteUrl: string | null
  lastModifiedAt: number | null
  sizeBytes?: number | null
}): { id: number; isNew: boolean } {
  const d = getDb()
  const now = Date.now()
  const existing = d.prepare('SELECT id, name, lifecycle, size_bytes FROM projects WHERE path = ?').get(p.path) as
    | { id: number; name: string; lifecycle: string; size_bytes: number | null }
    | undefined
  if (existing) {
    d.prepare(
      `UPDATE projects SET name = ?, type = ?, language = ?, stack = ?, is_git = ?, remote_url = ?,
       last_modified_at = ?, updated_at = ?, size_bytes = COALESCE(?, size_bytes), is_existing = 1
       WHERE id = ?`
    ).run(
      p.name,
      p.type,
      p.language,
      JSON.stringify(p.stack),
      p.isGit ? 1 : 0,
      p.remoteUrl,
      p.lastModifiedAt ?? null,
      now,
      p.sizeBytes ?? null,
      existing.id
    )
    return { id: existing.id, isNew: false }
  }
  const info = d
    .prepare(
      `INSERT INTO projects (path, name, type, language, stack, is_git, remote_url, last_modified_at, size_bytes, created_at, updated_at, lifecycle)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      p.path,
      p.name,
      p.type,
      p.language,
      JSON.stringify(p.stack),
      p.isGit ? 1 : 0,
      p.remoteUrl,
      p.lastModifiedAt ?? null,
      p.sizeBytes ?? null,
      now,
      now,
      'developing'
    )
  return { id: Number(info.lastInsertRowid), isNew: true }
}

export function markMissing(roots: string[], foundPaths: Set<string>): number {
  const d = getDb()
  const rows = d
    .prepare('SELECT id, path FROM projects WHERE is_existing = 1')
    .all() as { id: number; path: string }[]
  let marked = 0
  const update = d.prepare('UPDATE projects SET is_existing = 0, updated_at = ? WHERE id = ?')
  const tx = d.transaction(() => {
    for (const r of rows) {
      const normalized = r.path.replace(/\\/g, '/').toLowerCase()
      const underRoot = roots.some((root) => {
        const nr = root.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
        return normalized.startsWith(nr + '/')
      })
      if (underRoot && !foundPaths.has(normalized)) {
        update.run(Date.now(), r.id)
        marked++
      }
    }
  })
  tx()
  return marked
}

export function touchOpened(projectId: number): void {
  getDb()
    .prepare('UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?')
    .run(Date.now(), Date.now(), projectId)
}

export function updateProjectMeta(
  projectId: number,
  patch: { lifecycle?: Lifecycle; description?: string; defaultIde?: string | null; defaultScript?: string | null }
): void {
  const d = getDb()
  const sets: string[] = []
  const vals: unknown[] = []
  if (patch.lifecycle !== undefined) {
    sets.push('lifecycle = ?')
    vals.push(patch.lifecycle)
  }
  if (patch.description !== undefined) {
    sets.push('description = ?')
    vals.push(patch.description)
  }
  if (patch.defaultIde !== undefined) {
    sets.push('default_ide = ?')
    vals.push(patch.defaultIde)
  }
  if (patch.defaultScript !== undefined) {
    sets.push('default_script = ?')
    vals.push(patch.defaultScript)
  }
  if (sets.length === 0) return
  sets.push('updated_at = ?')
  vals.push(Date.now())
  vals.push(projectId)
  d.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function setProjectSize(projectId: number, sizeBytes: number): void {
  getDb()
    .prepare('UPDATE projects SET size_bytes = ?, updated_at = ? WHERE id = ?')
    .run(sizeBytes, Date.now(), projectId)
}

export function setProjectActive(projectId: number, commits30d: number, lastOpenedAt: number | null): void {
  const active = commits30d > 0 || (lastOpenedAt !== null && Date.now() - lastOpenedAt < 30 * 24 * 3600 * 1000)
  getDb()
    .prepare('UPDATE projects SET commits_30d = ?, active_30d = ?, updated_at = ? WHERE id = ?')
    .run(commits30d, active ? 1 : 0, Date.now(), projectId)
}

export function removeProject(projectId: number): void {
  const d = getDb()
  const tx = d.transaction(() => {
    d.prepare('DELETE FROM worklog_git WHERE project_id = ?').run(projectId)
    d.prepare('DELETE FROM worklog_manual WHERE project_id = ?').run(projectId)
    d.prepare('UPDATE agent_sessions SET project_id = NULL WHERE project_id = ?').run(projectId)
    d.prepare('DELETE FROM project_tags WHERE project_id = ?').run(projectId)
    d.prepare('DELETE FROM commit_daily WHERE project_id = ?').run(projectId)
    d.prepare('DELETE FROM git_cache WHERE project_id = ?').run(projectId)
    d.prepare('DELETE FROM notes WHERE project_id = ?').run(projectId)
    d.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
  })
  tx()
}

export function listProjects(where = '', params: unknown[] = []): ProjectRow[] {
  const sql = `SELECT * FROM projects ${where} ORDER BY updated_at DESC`
  return getDb().prepare(sql).all(...params) as ProjectRow[]
}

export function getProjectRow(id: number): ProjectRow | undefined {
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
}

export function getProjectByPath(path: string): ProjectRow | undefined {
  return getDb().prepare('SELECT * FROM projects WHERE path = ?').get(path) as ProjectRow | undefined
}

// ---------- 标签 ----------
export interface TagRow {
  id: number
  name: string
  color: string
}

export function listTags(): TagRow[] {
  return getDb().prepare('SELECT * FROM tags ORDER BY id').all() as TagRow[]
}

export function createTag(name: string, color?: string): TagRow {
  const d = getDb()
  const existing = d.prepare('SELECT * FROM tags WHERE name = ?').get(name) as TagRow | undefined
  if (existing) return existing
  const info = d
    .prepare('INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)')
    .run(name, color ?? randomColor(), Date.now())
  return { id: Number(info.lastInsertRowid), name, color: color ?? randomColor() }
}

export function deleteTag(tagId: number): void {
  const d = getDb()
  const tx = d.transaction(() => {
    d.prepare('DELETE FROM project_tags WHERE tag_id = ?').run(tagId)
    d.prepare('DELETE FROM tags WHERE id = ?').run(tagId)
  })
  tx()
}

function randomColor(): string {
  const palette = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399', '#8E44AD', '#16A085', '#E67E22', '#2C3E50', '#7F8C8D']
  return palette[Math.floor(Math.random() * palette.length)]
}

export function getProjectTags(projectId: number): TagRow[] {
  return getDb()
    .prepare(
      `SELECT t.* FROM tags t JOIN project_tags pt ON pt.tag_id = t.id WHERE pt.project_id = ? ORDER BY t.id`
    )
    .all(projectId) as TagRow[]
}

export function assignTags(projectId: number, tagIds: number[]): void {
  const d = getDb()
  const tx = d.transaction(() => {
    d.prepare('DELETE FROM project_tags WHERE project_id = ?').run(projectId)
    const ins = d.prepare('INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)')
    for (const tid of tagIds) ins.run(projectId, tid)
  })
  tx()
}

// ---------- 笔记 ----------
export function getNote(projectId: number): string {
  const row = getDb().prepare('SELECT content FROM notes WHERE project_id = ?').get(projectId) as
    | { content: string }
    | undefined
  return row ? row.content : ''
}

export function saveNote(projectId: number, content: string): void {
  getDb()
    .prepare(
      'INSERT INTO notes (project_id, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
    )
    .run(projectId, content, Date.now())
}

// ---------- Git 缓存 ----------
export interface GitCacheRow {
  project_id: number
  branch: string | null
  is_clean: number
  ahead: number
  behind: number
  remote_url: string | null
  last_commit_at: number | null
  commits_30d: number
  synced_at: number | null
  commit_synced_at: number | null
}

export function saveGitCache(
  projectId: number,
  g: Omit<GitCacheRow, 'project_id' | 'commit_synced_at'> & { commit_synced_at?: number | null }
): void {
  // 注意：不更新 commit_synced_at（该列由 saveCommitDaily 单独维护）
  getDb()
    .prepare(
      `INSERT INTO git_cache (project_id, branch, is_clean, ahead, behind, remote_url, last_commit_at, commits_30d, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         branch = excluded.branch, is_clean = excluded.is_clean, ahead = excluded.ahead, behind = excluded.behind,
         remote_url = excluded.remote_url, last_commit_at = excluded.last_commit_at,
         commits_30d = excluded.commits_30d, synced_at = excluded.synced_at`
    )
    .run(projectId, g.branch, g.is_clean, g.ahead, g.behind, g.remote_url, g.last_commit_at, g.commits_30d, g.synced_at)
}

export function getGitCache(projectId: number): GitCacheRow | undefined {
  return getDb().prepare('SELECT * FROM git_cache WHERE project_id = ?').get(projectId) as GitCacheRow | undefined
}

// ---------- 提交热力图 ----------
export function saveCommitDaily(projectId: number, counts: Map<string, number>): void {
  const d = getDb()
  const tx = d.transaction(() => {
    d.prepare('DELETE FROM commit_daily WHERE project_id = ?').run(projectId)
    const ins = d.prepare('INSERT OR REPLACE INTO commit_daily (project_id, date, count) VALUES (?, ?, ?)')
    for (const [date, count] of counts) ins.run(projectId, date, count)
    // 记录本次提交历史的同步时间（独立于 Git 状态同步）
    d.prepare(
      `INSERT INTO git_cache (project_id, commit_synced_at) VALUES (?, ?)
       ON CONFLICT(project_id) DO UPDATE SET commit_synced_at = excluded.commit_synced_at`
    ).run(projectId, Date.now())
  })
  tx()
}

export function loadCommitDaily(days: number): { date: string; count: number }[] {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10)
  return getDb()
    .prepare(
      `SELECT date, SUM(count) AS count FROM commit_daily WHERE date >= ? GROUP BY date ORDER BY date`
    )
    .all(since) as { date: string; count: number }[]
}

// ---------- 扫描日志 ----------
export function insertScanLog(startedAt: number): number {
  const info = getDb()
    .prepare('INSERT INTO scan_logs (started_at) VALUES (?)')
    .run(startedAt)
  return Number(info.lastInsertRowid)
}

export function finishScanLog(id: number, roots: string[], found: number, newProjects: number, error: string | null): void {
  getDb()
    .prepare('UPDATE scan_logs SET finished_at = ?, roots = ?, found = ?, new_projects = ?, error = ? WHERE id = ?')
    .run(Date.now(), JSON.stringify(roots), found, newProjects, error, id)
}

export function listScanLogs(limit = 20): {
  id: number
  started_at: number
  finished_at: number | null
  roots: string
  found: number
  new_projects: number
  error: string | null
}[] {
  return getDb()
    .prepare('SELECT * FROM scan_logs ORDER BY id DESC LIMIT ?')
    .all(limit) as {
    id: number
    started_at: number
    finished_at: number | null
    roots: string
    found: number
    new_projects: number
    error: string | null
  }[]
}

// ---------- Agent 用量采集（agent_sessions / agent_usage / agent_edits） ----------
export interface AgentSessionRow {
  id: number
  tool: string
  external_id: string
  parent_external_id: string | null
  title: string | null
  cwd: string | null
  project_id: number | null
  started_at: number | null
  ended_at: number | null
  message_count: number
  created_at: number
}

export function getAgentSessionByExternal(tool: string, externalId: string): AgentSessionRow | undefined {
  return getDb().prepare('SELECT * FROM agent_sessions WHERE tool = ? AND external_id = ?').get(tool, externalId) as
    | AgentSessionRow
    | undefined
}

export function upsertAgentSession(
  tool: string,
  externalId: string,
  meta: {
    parentExternalId?: string | null
    title?: string | null
    cwd?: string | null
    projectId?: number | null
    startedAt?: number | null
    endedAt?: number | null
    messageCount?: number
  }
): { id: number; created: boolean } {
  const d = getDb()
  const now = Date.now()
  const existing = getAgentSessionByExternal(tool, externalId)
  if (existing) {
    d.prepare(
      `UPDATE agent_sessions SET parent_external_id = COALESCE(?, parent_external_id),
       title = COALESCE(?, title), cwd = COALESCE(?, cwd), project_id = COALESCE(?, project_id),
       started_at = COALESCE(?, started_at), ended_at = ?, message_count = MAX(message_count, ?)
       WHERE id = ?`
    ).run(
      meta.parentExternalId ?? null,
      meta.title ?? null,
      meta.cwd ?? null,
      meta.projectId ?? null,
      meta.startedAt ?? null,
      meta.endedAt ?? existing.ended_at,
      meta.messageCount ?? 0,
      existing.id
    )
    return { id: existing.id, created: false }
  }
  const info = d
    .prepare(
      `INSERT INTO agent_sessions
       (tool, external_id, parent_external_id, title, cwd, project_id, started_at, ended_at, message_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      tool,
      externalId,
      meta.parentExternalId ?? null,
      meta.title ?? null,
      meta.cwd ?? null,
      meta.projectId ?? null,
      meta.startedAt ?? null,
      meta.endedAt ?? null,
      meta.messageCount ?? 0,
      now
    )
  return { id: Number(info.lastInsertRowid), created: true }
}

export function insertAgentUsage(
  sessionId: number,
  u: {
    recordedAt: number
    model?: string | null
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    reasoningTokens?: number
    cost?: number
    currency?: string
  }
): void {
  getDb()
    .prepare(
      `INSERT INTO agent_usage
       (session_id, recorded_at, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, cost, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      sessionId,
      u.recordedAt,
      u.model ?? null,
      u.inputTokens ?? 0,
      u.outputTokens ?? 0,
      u.cacheReadTokens ?? 0,
      u.cacheWriteTokens ?? 0,
      u.reasoningTokens ?? 0,
      u.cost ?? 0,
      u.currency ?? 'USD'
    )
}

export function insertAgentEdit(
  sessionId: number,
  e: { ts: number; filePath: string; relPath?: string | null; projectId?: number | null; addedLines: number; deletedLines: number }
): void {
  getDb()
    .prepare(
      `INSERT INTO agent_edits (session_id, ts, file_path, rel_path, project_id, added_lines, deleted_lines)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(sessionId, e.ts, e.filePath, e.relPath ?? null, e.projectId ?? null, e.addedLines, e.deletedLines)
}

/** 会话归属项目：将 agent_sessions.cwd 与纳管项目路径做前缀匹配（兼容 slug 形式，如 D--Codespace-...） */
export function linkAgentSessionsToProjects(): number {
  const d = getDb()
  const sessions = d
    .prepare('SELECT id, cwd FROM agent_sessions WHERE project_id IS NULL AND cwd IS NOT NULL')
    .all() as { id: number; cwd: string }[]
  if (sessions.length === 0) return 0
  const projects = d.prepare('SELECT id, path FROM projects WHERE is_existing = 1').all() as { id: number; path: string }[]
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
  const slugOf = (p: string): string => p.replace(/\\/g, '-').replace(/:/g, '-').toLowerCase()
  const update = d.prepare('UPDATE agent_sessions SET project_id = ? WHERE id = ?')
  let linked = 0
  for (const s of sessions) {
    const sc = norm(s.cwd)
    const isSlug = !s.cwd.includes('\\') && !s.cwd.includes('/') && !s.cwd.includes(':')
    let best: { id: number; len: number } | null = null
    for (const p of projects) {
      if (isSlug) {
        if (slugOf(p.path) === s.cwd.toLowerCase() && (!best || p.path.length > best.len)) {
          best = { id: p.id, len: p.path.length }
        }
      } else {
        const pc = norm(p.path)
        if (sc === pc || sc.startsWith(pc + '/')) {
          if (!best || pc.length > best.len) best = { id: p.id, len: pc.length }
        }
      }
    }
    if (best) {
      update.run(best.id, s.id)
      linked++
    }
  }
  // 同步会话改动/用量记录的 project_id（用于按项目聚合）
  d.exec(
    `UPDATE agent_edits SET project_id = (SELECT s.project_id FROM agent_sessions s WHERE s.id = agent_edits.session_id)
     WHERE project_id IS NULL`
  )
  return linked
}

/** 移除项目时清掉相关工作量数据，并解除会话归属 */
export function clearProjectUsage(projectId: number): void {
  const d = getDb()
  d.prepare('DELETE FROM worklog_git WHERE project_id = ?').run(projectId)
  d.prepare('DELETE FROM worklog_manual WHERE project_id = ?').run(projectId)
  d.prepare('UPDATE agent_sessions SET project_id = NULL WHERE project_id = ?').run(projectId)
}

// ---------- 当日工作量（worklog_git / worklog_manual） ----------
export interface WorklogGitRow {
  project_id: number
  date: string
  author: string
  email: string
  commits: number
  files_changed: number
  insertions: number
  deletions: number
}

export function replaceWorklogGit(projectId: number, rows: WorklogGitRow[]): void {
  const d = getDb()
  const tx = d.transaction(() => {
    d.prepare('DELETE FROM worklog_git WHERE project_id = ?').run(projectId)
    const ins = d.prepare(
      `INSERT OR REPLACE INTO worklog_git (project_id, date, author, email, commits, files_changed, insertions, deletions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const r of rows) ins.run(projectId, r.date, r.author, r.email, r.commits, r.files_changed, r.insertions, r.deletions)
  })
  tx()
}

/** 按日期聚合查询工作量（可只查某天；date 为 YYYY-MM-DD） */
export function queryWorklogDaily(
  date: string
): (WorklogGitRow & { project_name: string; project_path: string })[] {
  return getDb()
    .prepare(
      `SELECT w.*, p.name AS project_name, p.path AS project_path FROM worklog_git w
       JOIN projects p ON p.id = w.project_id
       WHERE w.date = ? ORDER BY w.insertions DESC`
    )
    .all(date) as (WorklogGitRow & { project_name: string; project_path: string })[]
}

export function queryWorklogRange(startDate: string, endDate: string): (WorklogGitRow & { project_name: string })[] {
  return getDb()
    .prepare(
      `SELECT w.*, p.name AS project_name FROM worklog_git w
       JOIN projects p ON p.id = w.project_id
       WHERE w.date >= ? AND w.date <= ?`
    )
    .all(startDate, endDate) as (WorklogGitRow & { project_name: string })[]
}

export interface WorklogManualRow {
  id: number
  date: string
  project_id: number | null
  category: string
  title: string
  value: number
  note: string | null
  created_at: number
}

export function addWorklogManual(entry: {
  date: string
  projectId?: number | null
  category: string
  title?: string
  value?: number
  note?: string | null
}): number {
  const info = getDb()
    .prepare(
      `INSERT INTO worklog_manual (date, project_id, category, title, value, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.date,
      entry.projectId ?? null,
      entry.category,
      entry.title ?? '',
      entry.value ?? 1,
      entry.note ?? null,
      Date.now()
    )
  return Number(info.lastInsertRowid)
}

export function listWorklogManual(date: string): WorklogManualRow[] {
  return getDb()
    .prepare('SELECT * FROM worklog_manual WHERE date = ? ORDER BY id')
    .all(date) as WorklogManualRow[]
}

export function deleteWorklogManual(id: number): void {
  getDb().prepare('DELETE FROM worklog_manual WHERE id = ?').run(id)
}

export function upsertSelfLines(date: string, projectId: number | null, value: number): void {
  const d = getDb()
  const existing = d
    .prepare('SELECT id FROM worklog_manual WHERE date = ? AND project_id IS ? AND category = ?')
    .all(date, projectId, 'self_lines') as { id: number }[]
  if (existing.length > 0) {
    d.prepare('UPDATE worklog_manual SET value = ? WHERE id = ?').run(value, existing[0].id)
  } else {
    addWorklogManual({ date, projectId, category: 'self_lines', title: '自己手写行数修正', value })
  }
}
