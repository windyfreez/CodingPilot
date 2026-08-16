/**
 * IPC 通道注册（主进程侧）
 * 所有处理器返回 { ok, data?, error? } 信封，渲染进程统一解包。
 */
import { ipcMain, dialog, BrowserWindow } from 'electron'
import type {
  Project,
  ProjectFilters,
  ProjectUpdate,
  Settings,
  Tag,
  GitStatus,
  ScanProgress,
  GitSyncProgress,
  SizeProgress,
  HeatmapPoint
} from '@shared/types'
import { IDE_LIST } from '@shared/types'
import * as db from './db'
import { scanRoots } from './services/scanner'
import * as gitSvc from './services/git'
import * as sysSvc from './services/system'
import * as statsSvc from './services/stats'

type Handler<T = unknown, R = unknown> = (args: T) => R | Promise<R>

function safe<T, R>(fn: Handler<T, R>): (event: Electron.IpcMainInvokeEvent, args: T) => Promise<{ ok: boolean; data?: R; error?: string }> {
  return async (_event, args: T) => {
    try {
      const data = await fn(args)
      return { ok: true, data }
    } catch (e) {
      console.error('[ipc]', (e as Error).message)
      return { ok: false, error: (e as Error).message }
    }
  }
}

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function send(channel: string, payload: unknown): void {
  const win = getWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

// ---------- 扫描状态 ----------
let scanning = false

export function isScanning(): boolean {
  return scanning
}

export async function runScan(): Promise<void> {
  if (scanning) return
  const settings = loadSettings()
  if (settings.scanRoots.length === 0) return
  scanning = true
  const emit = (p: ScanProgress) => send('scan:progress', p)
  const res = await scanRoots(settings.scanRoots, emit)
  scanning = false
  // 扫描完成后后台同步 Git 状态，并主动拉取提交历史（热力图数据）
  if (res.found > 0) {
    void gitSvc.syncAllGitStatus((p: GitSyncProgress) => send('git:progress', p)).then(() => {
      void gitSvc.refreshHeatmapData((p: GitSyncProgress) => send('git:progress', p)).then(() => {
        send('heatmap:ready', {})
      })
    })
  }
}

// ---------- 设置 ----------
function loadSettings(): Settings {
  return {
    scanRoots: db.getSettingsJson<string[]>('scanRoots', []),
    defaultIde: db.getSetting('defaultIde', 'vscode'),
    autoScanEnabled: db.getSetting('autoScanEnabled', 'true') === 'true',
    scanIntervalMinutes: parseInt(db.getSetting('scanIntervalMinutes', '30'), 10) || 30,
    defaultScript: db.getSetting('defaultScript', '')
  }
}

function saveSettings(patch: Partial<Settings>): Settings {
  const cur = loadSettings()
  const next = { ...cur, ...patch }
  db.setSetting('scanRoots', JSON.stringify(next.scanRoots))
  db.setSetting('defaultIde', next.defaultIde)
  db.setSetting('autoScanEnabled', String(next.autoScanEnabled))
  db.setSetting('scanIntervalMinutes', String(next.scanIntervalMinutes))
  db.setSetting('defaultScript', next.defaultScript)
  return next
}

// ---------- 项目行 → API 对象 ----------
function rowToProject(row: db.ProjectRow, tagsById: Map<number, Tag[]>, gitById: Map<number, GitStatus>): Project {
  let stack: string[] = []
  try {
    stack = JSON.parse(row.stack) as string[]
  } catch {
    stack = []
  }
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    type: row.type,
    language: row.language,
    stack,
    isGit: row.is_git === 1,
    remoteUrl: row.remote_url,
    lifecycle: row.lifecycle,
    sizeBytes: row.size_bytes,
    lastModifiedAt: row.last_modified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
    commits30d: row.commits_30d,
    active30d: row.active_30d === 1,
    exists: row.exists === 1,
    description: row.description,
    defaultIde: row.default_ide,
    defaultScript: row.default_script,
    tags: tagsById.get(row.id) ?? [],
    git: gitById.get(row.id) ?? null
  }
}

function attachAssociations(rows: db.ProjectRow[]): { tags: Map<number, Tag[]>; git: Map<number, GitStatus> } {
  const d = db.getDb()
  const tags = new Map<number, Tag[]>()
  const git = new Map<number, GitStatus>()
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id)
    const ph = ids.map(() => '?').join(',')
    const tagRows = d
      .prepare(
        `SELECT pt.project_id AS pid, t.id, t.name, t.color FROM project_tags pt JOIN tags t ON t.id = pt.tag_id
         WHERE pt.project_id IN (${ph}) ORDER BY t.id`
      )
      .all(...ids) as { pid: number; id: number; name: string; color: string }[]
    for (const t of tagRows) {
      const arr = tags.get(t.pid) ?? []
      arr.push({ id: t.id, name: t.name, color: t.color })
      tags.set(t.pid, arr)
    }
    const gitRows = d
      .prepare(
        `SELECT g.*, p.remote_url AS p_remote FROM git_cache g JOIN projects p ON p.id = g.project_id
         WHERE g.project_id IN (${ph})`
      )
      .all(...ids) as (db.GitCacheRow & { p_remote: string | null })[]
    for (const g of gitRows) {
      git.set(g.project_id, {
        branch: g.branch,
        clean: g.is_clean === 1,
        ahead: g.ahead,
        behind: g.behind,
        remoteUrl: g.remote_url ?? g.p_remote,
        lastCommitAt: g.last_commit_at,
        commits30d: g.commits_30d,
        syncedAt: g.synced_at
      })
    }
  }
  return { tags, git }
}

// ---------- 查询过滤器 ----------
function buildProjectQuery(filters: ProjectFilters): { where: string; params: unknown[] } {
  const conds: string[] = ['p.is_existing = 1']
  const params: unknown[] = []
  if (filters.search && filters.search.trim()) {
    conds.push('p.name LIKE ?')
    params.push(`%${filters.search.trim()}%`)
  }
  if (filters.types && filters.types.length > 0) {
    conds.push(`p.type IN (${filters.types.map(() => '?').join(',')})`)
    params.push(...filters.types)
  }
  if (filters.lifecycle && filters.lifecycle.length > 0) {
    conds.push(`p.lifecycle IN (${filters.lifecycle.map(() => '?').join(',')})`)
    params.push(...filters.lifecycle)
  }
  if (filters.tagIds && filters.tagIds.length > 0) {
    conds.push(`EXISTS (SELECT 1 FROM project_tags pt WHERE pt.project_id = p.id AND pt.tag_id IN (${filters.tagIds.map(() => '?').join(',')}))`)
    params.push(...filters.tagIds)
  }
  if (filters.gitState && filters.gitState !== 'all') {
    if (filters.gitState === 'clean') conds.push('EXISTS (SELECT 1 FROM git_cache g WHERE g.project_id = p.id AND g.is_clean = 1)')
    if (filters.gitState === 'dirty') conds.push('EXISTS (SELECT 1 FROM git_cache g WHERE g.project_id = p.id AND g.is_clean = 0)')
    if (filters.gitState === 'unpushed') conds.push('EXISTS (SELECT 1 FROM git_cache g WHERE g.project_id = p.id AND (g.ahead > 0 OR g.behind > 0))')
  }
  let order = 'p.updated_at DESC'
  switch (filters.sortBy ?? 'updated') {
    case 'name':
      order = `p.name COLLATE NOCASE ${filters.sortDir === 'asc' ? 'ASC' : 'DESC'}`
      break
    case 'size':
      order = `p.size_bytes IS NULL, p.size_bytes ${filters.sortDir === 'asc' ? 'ASC' : 'DESC'}`
      break
    case 'created':
      order = `p.created_at ${filters.sortDir === 'asc' ? 'ASC' : 'DESC'}`
      break
    default:
      order = `p.updated_at ${filters.sortDir === 'asc' ? 'ASC' : 'DESC'}`
  }
  return { where: `WHERE ${conds.join(' AND ')} ORDER BY ${order}`, params }
}

export function registerIpc(): void {
  // ---------- 设置 ----------
  // 注意：settings:get / dialog:selectDirectory 返回纯数据（不走 safe 信封），
  // 与渲染层类型契约 Promise<Settings> / Promise<string|null> 保持一致
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:update', safe((patch: Partial<Settings>) => saveSettings(patch)))
  ipcMain.handle('dialog:selectDirectory', async () => {
    try {
      const res = await dialog.showOpenDialog({
        title: '选择扫描根目录',
        properties: ['openDirectory', 'createDirectory']
      })
      return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
    } catch {
      return null
    }
  })

  // ---------- 扫描 ----------
  ipcMain.handle('scan:start', safe(() => {
    if (scanning) return { started: false }
    void runScan()
    return { started: true }
  }))
  ipcMain.handle('scan:status', safe(() => {
    const progress: ScanProgress = {
      scanning,
      phase: scanning ? '扫描中' : '空闲',
      current: 0,
      total: 0,
      found: 0
    }
    return progress
  }))
  ipcMain.handle('scan:logs', safe(() => {
    return db.listScanLogs(20).map((l) => ({
      id: l.id,
      startedAt: l.started_at,
      finishedAt: l.finished_at,
      roots: JSON.parse(l.roots) as string[],
      found: l.found,
      newProjects: l.new_projects,
      error: l.error
    }))
  }))

  // ---------- 项目 ----------
  ipcMain.handle('projects:list', safe((filters: ProjectFilters = {}) => {
    const { where, params } = buildProjectQuery(filters)
    const rows = db.getDb()
      .prepare(`SELECT p.* FROM projects p ${where}`)
      .all(...params) as db.ProjectRow[]
    const { tags, git } = attachAssociations(rows)
    return rows.map((r) => rowToProject(r, tags, git))
  }))

  ipcMain.handle('projects:get', safe((id: number) => {
    const row = db.getProjectRow(id)
    if (!row) throw new Error('项目不存在')
    const { tags, git } = attachAssociations([row])
    return rowToProject(row, tags, git)
  }))

  ipcMain.handle('projects:update', safe((args: { id: number; patch: ProjectUpdate }) => {
    const { id, patch } = args
    if (patch.tags !== undefined) {
      db.assignTags(id, patch.tags)
    }
    db.updateProjectMeta(id, {
      lifecycle: patch.lifecycle,
      description: patch.description,
      defaultIde: patch.defaultIde,
      defaultScript: patch.defaultScript
    })
    const row = db.getProjectRow(id)
    if (!row) throw new Error('项目不存在')
    const { tags, git } = attachAssociations([row])
    return rowToProject(row, tags, git)
  }))

  ipcMain.handle('projects:remove', safe((id: number) => {
    db.removeProject(id)
    return { removed: true }
  }))

  ipcMain.handle('projects:touchOpened', safe((id: number) => {
    db.touchOpened(id)
    return { touched: true }
  }))

  // ---------- 标签 ----------
  ipcMain.handle('tags:list', safe(() => db.listTags()))
  ipcMain.handle('tags:create', safe((name: string) => {
    const t = db.createTag(name)
    return t as Tag
  }))
  ipcMain.handle('tags:remove', safe((id: number) => {
    db.deleteTag(id)
    return { removed: true }
  }))
  ipcMain.handle('tags:assign', safe((args: { projectId: number; tagIds: number[] }) => {
    db.assignTags(args.projectId, args.tagIds)
    return { assigned: true }
  }))

  // ---------- 笔记 ----------
  ipcMain.handle('notes:get', safe((projectId: number) => db.getNote(projectId)))
  ipcMain.handle('notes:save', safe((args: { projectId: number; content: string }) => {
    db.saveNote(args.projectId, args.content)
    return { saved: true }
  }))

  // ---------- Git ----------
  ipcMain.handle('git:status', safe((projectId: number) => gitSvc.getGitStatus(projectId)))
  ipcMain.handle('git:syncAll', safe(() => {
    void gitSvc.syncAllGitStatus((p: GitSyncProgress) => send('git:progress', p))
    return { started: true }
  }))

  // ---------- 快捷操作 ----------
  ipcMain.handle('actions:openFolder', safe((path: string) => sysSvc.openFolder(path)))
  ipcMain.handle('actions:openTerminal', safe((path: string) => sysSvc.openTerminal(path)))
  ipcMain.handle('actions:openIde', safe(async (args: { projectId: number; ideId?: string }) => {
    const row = db.getProjectRow(args.projectId)
    if (!row) throw new Error('项目不存在')
    db.touchOpened(args.projectId)
    const ideId = args.ideId ?? row.default_ide ?? loadSettings().defaultIde
    return sysSvc.openIde(row.path, ideId)
  }))
  ipcMain.handle('actions:openRemote', safe(async (projectId: number) => {
    const row = db.getProjectRow(projectId)
    if (!row) throw new Error('项目不存在')
    return sysSvc.openRemote(row.remote_url ?? null)
  }))

  // ---------- 服务 ----------
  ipcMain.handle('service:start', safe((projectId: number) => {
    const res = sysSvc.startService(projectId)
    if (!res.ok) throw new Error(res.error)
    return res.status
  }))
  ipcMain.handle('service:stop', safe((projectId: number) => {
    const res = sysSvc.stopService(projectId)
    return { stopped: res.stopped ?? false }
  }))
  ipcMain.handle('service:status', safe((projectId: number) => sysSvc.getServiceStatus(projectId)))

  // ---------- 统计 ----------
  ipcMain.handle('stats:summary', safe(() => statsSvc.getSummary()))
  ipcMain.handle('stats:techStack', safe(() => statsSvc.getTechStack()))
  ipcMain.handle('stats:frameworks', safe(() => statsSvc.getFrameworks()))
  ipcMain.handle('stats:health', safe(() => statsSvc.getHealth()))
  ipcMain.handle('stats:diskUsage', safe((limit = 10) => statsSvc.getDiskUsage(limit)))
  ipcMain.handle('stats:heatmap', safe(async (days = 365) => {
    const points: HeatmapPoint[] = statsSvc.getHeatmap(days)
    // 仅当存在超过 6h 未刷新的仓库时，才后台刷新热力图并通知渲染进程（避免事件循环）
    if (gitSvc.countStaleHeatmapRepos() > 0) {
      void gitSvc
        .refreshHeatmapData((p: GitSyncProgress) => send('git:progress', p))
        .then(() => {
          send('heatmap:ready', { days })
        })
    }
    return points
  }))
  ipcMain.handle('stats:computeSizes', safe(() => {
    void statsSvc.computeAllSizes((p: SizeProgress) => send('size:progress', p))
    return { started: true }
  }))

  // 手动强制刷新热力图（force=true 时无视 6h 缓存，立即重新拉取所有仓库提交历史）
  ipcMain.handle('stats:refreshHeatmap', safe((force = false) => {
    void gitSvc
      .refreshHeatmapData((p: GitSyncProgress) => send('git:progress', p), !!force)
      .then(() => {
        send('heatmap:ready', {})
      })
    return { started: true }
  }))
}

export { loadSettings }
