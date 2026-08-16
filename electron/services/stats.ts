/**
 * 仪表盘统计服务
 * 核心指标、技术栈分布、健康度、磁盘占用排行、提交热力图。
 */
import fg from 'fast-glob'
import type { NameValue, StatsSummary } from '@shared/types'
import * as db from '../db'

export function getSummary(): StatsSummary {
  const d = db.getDb()
  const totalRow = d.prepare('SELECT COUNT(*) AS c FROM projects WHERE is_existing = 1').get() as { c: number }
  const activeRow = d.prepare('SELECT COUNT(*) AS c FROM projects WHERE is_existing = 1 AND active_30d = 1').get() as {
    c: number
  }
  const sizeRow = d
    .prepare('SELECT SUM(size_bytes) AS s FROM projects WHERE is_existing = 1 AND size_bytes IS NOT NULL')
    .get() as { s: number | null }
  const remoteRow = d
    .prepare('SELECT COUNT(*) AS c FROM projects WHERE is_existing = 1 AND remote_url IS NOT NULL')
    .get() as { c: number }
  const dirtyRow = d
    .prepare(
      'SELECT COUNT(*) AS c FROM git_cache g JOIN projects p ON p.id = g.project_id WHERE p.is_existing = 1 AND g.is_clean = 0'
    )
    .get() as { c: number }
  return {
    total: totalRow.c,
    active30d: activeRow.c,
    totalSizeBytes: sizeRow.s ?? null,
    remoteRate: totalRow.c > 0 ? Math.round((remoteRow.c / totalRow.c) * 1000) / 10 : 0,
    dirtyCount: dirtyRow.c
  }
}

export function getTechStack(): NameValue[] {
  const rows = db.listProjects('WHERE is_existing = 1')
  const map = new Map<string, number>()
  for (const r of rows) {
    map.set(r.language, (map.get(r.language) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
}

/** 框架/技术栈细分统计（从 stack 数组中提取非主语言的项） */
const FRAMEWORK_BUCKETS = [
  'Vue',
  'React',
  'Next.js',
  'Nuxt',
  'Angular',
  'Svelte',
  'Electron',
  'Express',
  'Koa',
  'NestJS',
  'Fastify',
  'Spring Boot',
  'Spring Cloud',
  'MyBatis',
  'Django',
  'FastAPI',
  'Flask',
  'Scrapy',
  'Vite',
  'Webpack',
  'TailwindCSS',
  'TypeScript',
  'Jest',
  'Vitest',
  'ESLint',
  'Element Plus',
  'Ant Design'
]

export function getFrameworks(): NameValue[] {
  const rows = db.listProjects('WHERE is_existing = 1')
  const map = new Map<string, number>()
  for (const r of rows) {
    let stack: string[] = []
    try {
      stack = JSON.parse(r.stack) as string[]
    } catch {
      continue
    }
    for (const item of stack) {
      if (FRAMEWORK_BUCKETS.includes(item) && item !== r.language) {
        map.set(item, (map.get(item) ?? 0) + 1)
      }
    }
  }
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12)
}

export function getHealth() {
  const rows = db.listProjects('WHERE is_existing = 1')
  const lifecycleMap = new Map<string, number>()
  for (const r of rows) {
    lifecycleMap.set(r.lifecycle, (lifecycleMap.get(r.lifecycle) ?? 0) + 1)
  }
  const order = ['developing', 'maintaining', 'launched', 'archived']
  const lifecycle: NameValue[] = order.map((k) => ({ name: k, value: lifecycleMap.get(k) ?? 0 }))

  const clean = db.getDb()
    .prepare(
      'SELECT COUNT(*) AS c FROM git_cache g JOIN projects p ON p.id = g.project_id WHERE p.is_existing = 1 AND p.is_git = 1 AND g.is_clean = 1'
    )
    .get() as { c: number }
  const dirty = db.getDb()
    .prepare(
      'SELECT COUNT(*) AS c FROM git_cache g JOIN projects p ON p.id = g.project_id WHERE p.is_existing = 1 AND p.is_git = 1 AND g.is_clean = 0'
    )
    .get() as { c: number }
  const noGit = rows.filter((r) => !r.is_git).length

  return {
    lifecycle,
    gitState: [
      { name: '干净', value: clean.c },
      { name: '有未提交修改', value: dirty.c },
      { name: '非 Git 仓库', value: noGit }
    ]
  }
}

export function getDiskUsage(limit = 10): { projectId: number; name: string; path: string; sizeBytes: number }[] {
  return db
    .getDb()
    .prepare(
      `SELECT id AS projectId, name, path, size_bytes AS sizeBytes FROM projects
       WHERE is_existing = 1 AND size_bytes IS NOT NULL ORDER BY size_bytes DESC LIMIT ?`
    )
    .all(limit) as { projectId: number; name: string; path: string; sizeBytes: number }[]
}

export function getHeatmap(days = 365): { date: string; count: number }[] {
  return db.loadCommitDaily(days)
}

// ---------- 磁盘占用计算 ----------
export type SizeProgressEmitter = (p: {
  computing: boolean
  done: number
  total: number
  current?: string
}) => void

let computing = false

export function isComputing(): boolean {
  return computing
}

/**
 * 计算所有项目磁盘占用（排除 .git/.idea 等系统目录，保留 node_modules 以便发现空间大户）
 */
export async function computeAllSizes(emit?: SizeProgressEmitter): Promise<{ done: number; total: number }> {
  if (computing) return { done: 0, total: 0 }
  computing = true
  try {
    const projects = db.listProjects('WHERE is_existing = 1 AND size_bytes IS NULL')
    // 同时把 24h 前的旧数据也刷新
    const stale = db.listProjects('WHERE is_existing = 1 AND size_bytes IS NOT NULL').filter((p) => {
      const row = db.getDb()
        .prepare('SELECT updated_at AS u FROM projects WHERE id = ?')
        .get(p.id) as { u: number }
      return Date.now() - row.u > 24 * 3600 * 1000
    })
    const targets = [...projects, ...stale]
    const total = targets.length
    let done = 0
    emit?.({ computing: true, done: 0, total })

    let idx = 0
    const workers = Array.from({ length: Math.min(6, total || 1) }, async () => {
      while (idx < targets.length) {
        const p = targets[idx++]
        try {
          const size = await computeProjectSize(p.path)
          db.setProjectSize(p.id, size)
        } catch (e) {
          console.warn('[stats] size compute failed for', p.path, (e as Error).message)
        }
        done++
        if (done % 3 === 0 || done === total) {
          emit?.({ computing: true, done, total, current: p.name })
        }
      }
    })
    await Promise.all(workers)
    emit?.({ computing: false, done, total })
    return { done, total }
  } finally {
    computing = false
  }
}

async function computeProjectSize(projectPath: string): Promise<number> {
  const entries = await fg('**/*', {
    cwd: projectPath,
    onlyFiles: true,
    stats: true,
    dot: false,
    suppressErrors: true,
    deep: 20,
    ignore: ['**/.git/**', '**/.idea/**', '**/.vscode/**', '**/__pycache__/**', '**/.cache/**']
  })
  let total = 0
  for (const e of entries) {
    if (e.stats && typeof e.stats.size === 'number') total += e.stats.size
  }
  return total
}
