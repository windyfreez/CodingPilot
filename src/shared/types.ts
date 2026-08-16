/**
 * 共享类型定义（主进程 / 预加载 / 渲染进程共用）
 */

/** 项目生命周期状态 */
export type Lifecycle = 'developing' | 'maintaining' | 'launched' | 'archived'

/** 主语言类型 */
export type ProjectType = 'node' | 'java' | 'python' | 'go' | 'rust' | 'other'

export interface Tag {
  id: number
  name: string
  color: string
}

export interface GitStatus {
  branch: string | null
  clean: boolean
  ahead: number
  behind: number
  remoteUrl: string | null
  lastCommitAt: number | null
  commits30d: number
  syncedAt: number | null
}

export interface Project {
  id: number
  path: string
  name: string
  type: ProjectType
  language: string
  /** 检测到的技术栈/框架数组 */
  stack: string[]
  isGit: boolean
  remoteUrl: string | null
  lifecycle: Lifecycle
  sizeBytes: number | null
  lastModifiedAt: number | null
  createdAt: number
  updatedAt: number
  lastOpenedAt: number | null
  commits30d: number
  active30d: boolean
  exists: boolean
  description: string
  defaultIde: string | null
  defaultScript: string | null
  tags: Tag[]
  git?: GitStatus | null
}

export interface Settings {
  scanRoots: string[]
  defaultIde: string
  autoScanEnabled: boolean
  scanIntervalMinutes: number
  defaultScript: string
}

export interface ScanProgress {
  scanning: boolean
  phase: string
  /** 当前处理的根目录序号（从 1 开始） */
  current: number
  total: number
  /** 本次扫描新发现/更新的项目数 */
  found: number
  message?: string
}

export interface GitSyncProgress {
  syncing: boolean
  done: number
  total: number
  current?: string
}

export interface SizeProgress {
  computing: boolean
  done: number
  total: number
  current?: string
}

export interface ServiceStatus {
  running: boolean
  pid?: number
  startedAt?: number
  command?: string
  log: string[]
}

export interface ScanLog {
  id: number
  startedAt: number
  finishedAt: number | null
  roots: string[]
  found: number
  newProjects: number
  error: string | null
}

export interface StatsSummary {
  total: number
  active30d: number
  totalSizeBytes: number | null
  remoteRate: number
  dirtyCount: number
}

export interface NameValue {
  name: string
  value: number
}

export interface HealthStats {
  lifecycle: NameValue[]
  gitState: NameValue[]
}

export interface DiskUsageItem {
  projectId: number
  name: string
  path: string
  sizeBytes: number
}

export interface HeatmapPoint {
  date: string
  count: number
}

export interface ProjectFilters {
  search?: string
  types?: string[]
  lifecycle?: Lifecycle[]
  tagIds?: number[]
  gitState?: 'all' | 'clean' | 'dirty' | 'unpushed'
  sortBy?: 'updated' | 'name' | 'size' | 'created'
  sortDir?: 'asc' | 'desc'
}

export interface ProjectUpdate {
  lifecycle?: Lifecycle
  description?: string
  defaultIde?: string | null
  defaultScript?: string | null
  tags?: number[]
}

export interface ActionResult {
  ok: boolean
  error?: string
  data?: unknown
}

export interface IdeInfo {
  id: string
  name: string
  command: string
}

export const IDE_LIST: IdeInfo[] = [
  { id: 'vscode', name: 'VS Code', command: 'code' },
  { id: 'idea', name: 'IntelliJ IDEA', command: 'idea' },
  { id: 'webstorm', name: 'WebStorm', command: 'webstorm' },
  { id: 'pycharm', name: 'PyCharm', command: 'pycharm' },
  { id: 'goland', name: 'GoLand', command: 'goland' },
  { id: 'clion', name: 'CLion', command: 'clion' }
]

export const LIFECYCLE_LABELS: Record<Lifecycle, string> = {
  developing: '开发中',
  maintaining: '维护中',
  launched: '已上线',
  archived: '已归档'
}

export const LIFECYCLE_TYPES: Lifecycle[] = ['developing', 'maintaining', 'launched', 'archived']

export const LIFECYCLE_COLORS: Record<Lifecycle, string> = {
  developing: '#00d4ff',
  maintaining: '#ffb454',
  launched: '#00e5a0',
  archived: '#64748b'
}

export const TYPE_LABELS: Record<ProjectType, string> = {
  node: 'Node.js',
  java: 'Java',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  other: '其他'
}
