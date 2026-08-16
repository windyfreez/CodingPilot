/**
 * Git 集成服务
 * 使用 simple-git 读取分支、脏状态、超前/落后、提交历史（热力图数据）。
 * 结果缓存在 git_cache / commit_daily 表中。
 */
import { simpleGit, type SimpleGit } from 'simple-git'
import type { GitStatus } from '@shared/types'
import * as db from '../db'
import { readRemoteUrl } from './scanner'

export interface GitRaw {
  branch: string | null
  clean: boolean
  ahead: number
  behind: number
  remoteUrl: string | null
  lastCommitAt: number | null
  commits30d: number
}

function gitFor(path: string): SimpleGit {
  return simpleGit({ baseDir: path, binary: 'git', maxConcurrentProcesses: 1, timeout: { block: 20000 } })
}

/** 并发池：限制同时执行的 git 子进程数量 */
async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let idx = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const item = items[idx++]
      try {
        await worker(item)
      } catch (e) {
        console.warn('[git] worker error:', (e as Error).message)
      }
    }
  })
  await Promise.all(runners)
}

async function readGitStatus(path: string): Promise<GitRaw> {
  const git = gitFor(path)
  const raw: GitRaw = {
    branch: null,
    clean: true,
    ahead: 0,
    behind: 0,
    remoteUrl: readRemoteUrl(path + '/.git'),
    lastCommitAt: null,
    commits30d: 0
  }

  const branch = await git
    .raw(['rev-parse', '--abbrev-ref', 'HEAD'])
    .catch(() => '')
  raw.branch = branch && branch.trim() !== 'HEAD' ? branch.trim() : await git.raw(['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '').then((b) => (b ? b.trim() : null))

  const status = await git.status().catch(() => null)
  raw.clean = status ? status.isClean() : true

  const ahead = await git.raw(['rev-list', '--count', '@{upstream}..HEAD']).catch(() => '')
  raw.ahead = ahead ? parseInt(ahead.trim(), 10) || 0 : 0
  const behind = await git.raw(['rev-list', '--count', 'HEAD..@{upstream}']).catch(() => '')
  raw.behind = behind ? parseInt(behind.trim(), 10) || 0 : 0

  const lastCommit = await git.raw(['log', '-1', '--format=%ct']).catch(() => '')
  raw.lastCommitAt = lastCommit ? parseInt(lastCommit.trim(), 10) || null : null

  const c30 = await git.raw(['rev-list', '--count', '--since=30 days ago', 'HEAD']).catch(() => '')
  raw.commits30d = c30 ? parseInt(c30.trim(), 10) || 0 : 0

  return raw
}

export async function syncProjectGit(projectId: number, projectPath: string): Promise<GitRaw | null> {
  const raw = await readGitStatus(projectPath)
  db.saveGitCache(projectId, {
    branch: raw.branch,
    is_clean: raw.clean ? 1 : 0,
    ahead: raw.ahead,
    behind: raw.behind,
    remote_url: raw.remoteUrl,
    last_commit_at: raw.lastCommitAt,
    commits_30d: raw.commits30d,
    synced_at: Date.now()
  })
  const row = db.getProjectRow(projectId)
  if (row) db.setProjectActive(projectId, raw.commits30d, row.last_opened_at)
  return raw
}

export type GitProgressEmitter = (p: { syncing: boolean; done: number; total: number; current?: string }) => void

/** 同步所有 Git 项目的状态（含并发限制），供列表页与仪表盘使用 */
export async function syncAllGitStatus(emit?: GitProgressEmitter): Promise<{ done: number; total: number }> {
  const projects = db.listProjects('WHERE is_existing = 1 AND is_git = 1')
  const total = projects.length
  let done = 0
  emit?.({ syncing: true, done: 0, total })
  await runPool(projects, 8, async (p) => {
    try {
      await syncProjectGit(p.id, p.path)
    } catch (e) {
      console.warn('[git] sync failed for', p.path, (e as Error).message)
    }
    done++
    emit?.({ syncing: true, done, total, current: p.name })
  })
  emit?.({ syncing: false, done, total })
  return { done, total }
}

/** 获取单个项目的 Git 状态（缓存 TTL 60s） */
export async function getGitStatus(projectId: number): Promise<GitStatus | null> {
  const row = db.getProjectRow(projectId)
  if (!row) return null
  if (!row.is_git) {
    return { branch: null, clean: true, ahead: 0, behind: 0, remoteUrl: row.remote_url, lastCommitAt: null, commits30d: 0, syncedAt: null }
  }
  const cached = db.getGitCache(projectId)
  if (cached && cached.synced_at && Date.now() - cached.synced_at < 60_000) {
    return toGitStatus(cached)
  }
  try {
    await syncProjectGit(projectId, row.path)
  } catch {
    // 失败则返回缓存或空状态
  }
  const fresh = db.getGitCache(projectId)
  return fresh ? toGitStatus(fresh) : null
}

function toGitStatus(c: db.GitCacheRow): GitStatus {
  return {
    branch: c.branch,
    clean: c.is_clean === 1,
    ahead: c.ahead,
    behind: c.behind,
    remoteUrl: c.remote_url,
    lastCommitAt: c.last_commit_at,
    commits30d: c.commits_30d,
    syncedAt: c.synced_at
  }
}

/** 拉取单个仓库近 N 天提交历史（按日期聚合），写入 commit_daily */
export async function syncProjectCommits(projectId: number, path: string, days = 365): Promise<Map<string, number>> {
  const git = gitFor(path)
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const out = await git.raw(['log', '--all', `--since=${since}`, '--pretty=format:%ad', '--date=short']).catch(() => '')
  const counts = new Map<string, number>()
  for (const line of out.split('\n')) {
    const d = line.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  db.saveCommitDaily(projectId, counts)
  return counts
}

/** 统计需要刷新热力图数据的仓库数量（基于 commit_synced_at，避免与 Git 状态同步混淆） */
export function countStaleHeatmapRepos(): number {
  const projects = db.listProjects('WHERE is_existing = 1 AND is_git = 1')
  return projects.filter((p) => {
    const row = db.getGitCache(p.id)
    return !row || !row.commit_synced_at || Date.now() - row.commit_synced_at > 6 * 3600 * 1000
  }).length
}

/** 刷新所有仓库的热力图数据（基于 commit_synced_at，超过 6 小时才刷新） */
export async function refreshHeatmapData(emit?: GitProgressEmitter, force = false): Promise<void> {
  const projects = db.listProjects('WHERE is_existing = 1 AND is_git = 1')
  const stale = force
    ? projects
    : projects.filter((p) => {
        const row = db.getGitCache(p.id)
        return !row || !row.commit_synced_at || Date.now() - row.commit_synced_at > 6 * 3600 * 1000
      })
  let done = 0
  emit?.({ syncing: true, done: 0, total: stale.length })
  await runPool(stale, 4, async (p) => {
    try {
      await syncProjectCommits(p.id, p.path)
    } catch (e) {
      console.warn('[git] commit sync failed for', p.path, (e as Error).message)
    }
    done++
    emit?.({ syncing: true, done, total: stale.length, current: p.name })
  })
  emit?.({ syncing: false, done, total: stale.length })
}
