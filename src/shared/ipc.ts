/**
 * 渲染进程可用的 API 契约（window.api）
 * 由 preload 通过 contextBridge 注入，类型与主进程 ipc.ts 保持一致。
 */
import type {
  ActionResult,
  DiskUsageItem,
  GitStatus,
  GitSyncProgress,
  HealthStats,
  HeatmapPoint,
  IdeInfo,
  NameValue,
  Project,
  ProjectFilters,
  ProjectUpdate,
  ScanLog,
  ScanProgress,
  ServiceStatus,
  Settings,
  SizeProgress,
  StatsSummary,
  Tag,
  UsageConfig,
  UsageOverview,
  UsageSessionBrief,
  UsageSyncResult,
  WorklogDayData,
  WorklogManualEntry
} from './types'

export interface IpcResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

export interface Api {
  settings: {
    get: () => Promise<Settings>
    update: (patch: Partial<Settings>) => Promise<IpcResult<Settings>>
  }
  dialog: {
    selectDirectory: () => Promise<string | null>
  }
  scan: {
    start: () => Promise<IpcResult<{ started: boolean }>>
    status: () => Promise<ScanProgress>
    logs: () => Promise<ScanLog[]>
  }
  projects: {
    list: (filters?: ProjectFilters) => Promise<IpcResult<Project[]>>
    get: (id: number) => Promise<IpcResult<Project>>
    update: (id: number, patch: ProjectUpdate) => Promise<IpcResult<Project>>
    remove: (id: number) => Promise<IpcResult<{ removed: boolean }>>
    touchOpened: (id: number) => Promise<void>
  }
  tags: {
    list: () => Promise<IpcResult<Tag[]>>
    create: (name: string) => Promise<IpcResult<Tag>>
    remove: (id: number) => Promise<IpcResult<{ removed: boolean }>>
    assign: (projectId: number, tagIds: number[]) => Promise<IpcResult<{ assigned: boolean }>>
  }
  notes: {
    get: (projectId: number) => Promise<IpcResult<string>>
    save: (projectId: number, content: string) => Promise<IpcResult<{ saved: boolean }>>
  }
  git: {
    status: (projectId: number) => Promise<IpcResult<GitStatus | null>>
    syncAll: () => Promise<IpcResult<{ started: boolean }>>
  }
  actions: {
    openFolder: (path: string) => Promise<IpcResult<ActionResult>>
    openTerminal: (path: string) => Promise<IpcResult<ActionResult>>
    openIde: (projectId: number, ideId?: string) => Promise<IpcResult<ActionResult>>
    openRemote: (projectId: number) => Promise<IpcResult<ActionResult>>
  }
  service: {
    start: (projectId: number) => Promise<IpcResult<ServiceStatus>>
    stop: (projectId: number) => Promise<IpcResult<{ stopped: boolean }>>
    status: (projectId: number) => Promise<IpcResult<ServiceStatus>>
  }
  stats: {
    summary: () => Promise<IpcResult<StatsSummary>>
    techStack: () => Promise<IpcResult<NameValue[]>>
    frameworks: () => Promise<IpcResult<NameValue[]>>
    health: () => Promise<IpcResult<HealthStats>>
    diskUsage: (limit?: number) => Promise<IpcResult<DiskUsageItem[]>>
    heatmap: (days?: number) => Promise<IpcResult<HeatmapPoint[]>>
    computeSizes: () => Promise<IpcResult<{ started: boolean }>>
    refreshHeatmap: (force?: boolean) => Promise<IpcResult<{ started: boolean }>>
  }
  ides: {
    list: () => IdeInfo[]
  }
  usage: {
    getConfig: () => Promise<UsageConfig>
    saveConfig: (patch: Partial<UsageConfig>) => Promise<IpcResult<UsageConfig>>
    syncNow: () => Promise<IpcResult<UsageSyncResult>>
    overview: (days?: number) => Promise<IpcResult<UsageOverview>>
    sessions: (limit?: number) => Promise<IpcResult<UsageSessionBrief[]>>
    onSynced: (cb: (r: UsageSyncResult) => void) => () => void
  }
  worklog: {
    daily: (date?: string) => Promise<IpcResult<WorklogDayData>>
    syncGitNow: () => Promise<IpcResult<{ started: boolean }>>
    addManual: (entry: {
      date: string
      projectId?: number | null
      category: string
      title?: string
      value?: number
      note?: string | null
    }) => Promise<IpcResult<{ id: number }>>
    removeManual: (id: number) => Promise<IpcResult<{ removed: boolean }>>
    setSelfLines: (date: string, projectId: number | null, value: number) => Promise<IpcResult<{ saved: boolean }>>
    onGitSynced: (cb: () => void) => () => void
  }
  on: (
    channel: 'scan:progress' | 'git:progress' | 'size:progress' | 'service:log' | 'heatmap:ready',
    cb: (data: unknown) => void
  ) => () => void
}
