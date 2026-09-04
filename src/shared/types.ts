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

// ==================== Agent 用量与当日工作量（数据中心） ====================

/** 支持的外部 AI 工具 */
export type AgentTool = 'harness' | 'claude' | 'codex'

export const AGENT_TOOL_LABELS: Record<AgentTool, string> = {
  harness: 'DeepSeek Harness',
  claude: 'Claude Code',
  codex: 'Codex CLI'
}

/** 模型单价（每百万 token，美元）；model 支持通配符 * */
export interface ModelPrice {
  model: string
  inputPerMillion: number
  outputPerMillion: number
  cacheReadPerMillion?: number
  cacheWritePerMillion?: number
}

export interface UsageConfig {
  /** 记录目录覆盖（留空自动探测 ~/.dsh 等默认位置） */
  harnessDir: string
  claudeDir: string
  codexDir: string
  autoSyncEnabled: boolean
  autoSyncIntervalMinutes: number
  modelPrices: ModelPrice[]
  /** 同步游标（主进程维护，不在设置页展示） */
}

export const DEFAULT_USAGE_CONFIG: UsageConfig = {
  harnessDir: '',
  claudeDir: '',
  codexDir: '',
  autoSyncEnabled: true,
  autoSyncIntervalMinutes: 15,
  modelPrices: [
    { model: 'deepseek-*', inputPerMillion: 0.27, outputPerMillion: 1.1, cacheReadPerMillion: 0.07 },
    { model: 'claude-sonnet-4-*', inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
    { model: 'claude-sonnet-4-5-*', inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
    { model: 'claude-3-5-sonnet-*', inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
    { model: 'claude-3-7-sonnet-*', inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
    { model: 'gpt-5-*', inputPerMillion: 1.25, outputPerMillion: 10, cacheReadPerMillion: 0.125 },
    { model: 'o4-mini', inputPerMillion: 1.1, outputPerMillion: 4.4 },
    { model: 'gpt-4.1-*', inputPerMillion: 2, outputPerMillion: 8, cacheReadPerMillion: 0.5 },
    { model: 'gpt-4o', inputPerMillion: 2.5, outputPerMillion: 10, cacheReadPerMillion: 1.25 }
  ]
}

/** 用量统计页顶部卡片数据 */
export interface UsageCards {
  todayInput: number
  todayOutput: number
  todayCache: number
  todayCost: number
  monthTokens: number
  monthCost: number
  totalTokens: number
  totalCost: number
  todaySessions: number
  lastSyncAt: number | null
  todayTokens: number
}

/** 按日趋势点 */
export interface UsageTrendPoint {
  date: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  cost: number
}

/** 用量分布（近 N 天） */
export interface UsageBreakdown {
  byTool: NameValue[]
  byProject: NameValue[]
  byModel: NameValue[]
}

/** 用量统计页一次拉全量的响应 */
export interface UsageOverview {
  cards: UsageCards
  trend: UsageTrendPoint[]
  breakdown: UsageBreakdown
}

/** 会话简要（明细列表） */
export interface UsageSessionBrief {
  id: number
  tool: AgentTool
  title: string | null
  projectName: string | null
  model: string | null
  startedAt: number | null
  endedAt: number | null
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  cost: number
}

export interface UsageSyncResult {
  sessions: number
  usageRows: number
  edits: number
  linked: number
  skipped: number
}

/** 单项目当日 git 工作量（作者维度） */
export interface WorklogGitAuthorRow {
  author: string
  email: string
  commits: number
  filesChanged: number
  insertions: number
  deletions: number
}

/** 单项目当日汇总 */
export interface WorklogProjectRow {
  projectId: number
  projectName: string
  projectPath: string
  commits: number
  filesChanged: number
  insertions: number
  deletions: number
  byAuthor: WorklogGitAuthorRow[]
  agentAddedLines: number
  agentDeletedLines: number
  /** 手动修正的“自己手写行数”（未设置则为 null） */
  selfLinesOverride: number | null
}

/** 手动补录条目 */
export interface WorklogManualEntry {
  id: number
  date: string
  projectId: number | null
  category: string
  title: string
  value: number
  note: string | null
  createdAt: number
}

/** 当日工作量页一次拉全量的响应 */
export interface WorklogDayData {
  date: string
  git: {
    commits: number
    filesChanged: number
    insertions: number
    deletions: number
  }
  agent: {
    sessions: number
    edits: number
    addedLines: number
    deletedLines: number
    tokens: number
    cost: number
  }
  projects: WorklogProjectRow[]
  manual: WorklogManualEntry[]
}
