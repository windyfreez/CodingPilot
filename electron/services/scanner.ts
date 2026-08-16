/**
 * 项目扫描与智能识别服务
 * 使用 fast-glob 递归扫描根目录，通过特征文件识别项目类型与技术栈。
 */
import fg from 'fast-glob'
import { readFile, stat } from 'fs/promises'
import { readFileSync, existsSync } from 'fs'
import { join, dirname, basename } from 'path'
import type { ProjectType } from '@shared/types'
import * as db from '../db'

export type ProgressEmitter = (p: {
  scanning: boolean
  phase: string
  current: number
  total: number
  found: number
  message?: string
}) => void

/** 扫描时忽略的目录（避免把 node_modules 里的包误识别为项目） */
const IGNORE_DIRS = [
  '**/node_modules/**',
  '**/target/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.git/**',
  '**/.idea/**',
  '**/.vscode/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.cache/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/.tox/**',
  '**/.pytest_cache/**',
  '**/coverage/**',
  '**/Pods/**',
  '**/.gradle/**',
  '**/.mvn/**',
  '**/.hg/**',
  '**/.svn/**',
  '**/.turbo/**'
]

interface MarkerDef {
  file: string
  type: ProjectType
}

/** Git 发现时的忽略列表：必须去掉对 .git 目录自身的排除模式，否则仓库根目录无法被发现 */
const GIT_IGNORE_DIRS = IGNORE_DIRS.filter((p) => p !== '**/.git/**')

const MARKERS: MarkerDef[] = [
  { file: 'package.json', type: 'node' },
  { file: 'pom.xml', type: 'java' },
  { file: 'build.gradle', type: 'java' },
  { file: 'go.mod', type: 'go' },
  { file: 'requirements.txt', type: 'python' },
  { file: 'pyproject.toml', type: 'python' },
  { file: 'Cargo.toml', type: 'rust' }
]

const TYPE_PRIORITY: Record<ProjectType, number> = {
  node: 0,
  java: 1,
  python: 2,
  go: 3,
  rust: 4,
  other: 99
}

interface Candidate {
  path: string
  markers: string[] // 命中的特征文件名
  isGit: boolean
}

export async function scanRoots(roots: string[], emit?: ProgressEmitter): Promise<{ found: number; newProjects: number; error: string | null }> {
  const startedAt = Date.now()
  const logId = db.insertScanLog(startedAt)
  let found = 0
  let newProjects = 0

  try {
    const validRoots: string[] = []
    for (const root of roots) {
      try {
        const s = await stat(root)
        if (s.isDirectory()) validRoots.push(root)
        else throw new Error(`不是目录: ${root}`)
      } catch (e) {
        emit?.({
          scanning: true,
          phase: '跳过无效根目录',
          current: 0,
          total: roots.length,
          found,
          message: `${root} (${(e as Error).message})`
        })
      }
    }

    const candidates = new Map<string, Candidate>()
    let rootIndex = 0
    for (const root of validRoots) {
      rootIndex++
      emit?.({
        scanning: true,
        phase: `扫描 ${basename(root)}`,
        current: rootIndex,
        total: validRoots.length,
        found,
        message: root
      })

      // 1) 特征文件识别
      const patterns = MARKERS.map((m) => `**/${m.file}`)
      const entries = await fg(patterns, {
        cwd: root,
        onlyFiles: true,
        ignore: IGNORE_DIRS,
        suppressErrors: true,
        deep: 12,
        dot: false
      })

      for (const entry of entries) {
        const full = join(root, entry)
        const dir = dirname(full)
        const key = normalizePath(dir)
        const marker = basename(full)
        let c = candidates.get(key)
        if (!c) {
          c = { path: dir, markers: [], isGit: false }
          candidates.set(key, c)
        }
        if (!c.markers.includes(marker)) c.markers.push(marker)
      }

      // 2) Git 仓库识别（.git 目录）
      const gitDirs = await fg('**/.git', {
        cwd: root,
        onlyDirectories: true,
        ignore: GIT_IGNORE_DIRS,
        suppressErrors: true,
        deep: 12,
        dot: true
      })
      for (const g of gitDirs) {
        const repoRoot = dirname(join(root, g))
        const key = normalizePath(repoRoot)
        let c = candidates.get(key)
        if (!c) {
          c = { path: repoRoot, markers: [], isGit: true }
          candidates.set(key, c)
        } else {
          c.isGit = true
        }
      }
    }

    // 3) 逐个识别并入库
    const foundPaths = new Set<string>()
    let count = 0
    for (const c of candidates.values()) {
      count++
      if (count % 20 === 0 || count === candidates.size) {
        emit?.({
          scanning: true,
          phase: '识别项目特征',
          current: rootIndex,
          total: validRoots.length,
          found,
          message: `${count}/${candidates.size}`
        })
      }
      const norm = normalizePath(c.path)
      foundPaths.add(norm)
      try {
        const info = await analyzeCandidate(c)
        const res = db.upsertProject(info)
        found++
        if (res.isNew) newProjects++
      } catch (e) {
        // 单个项目失败不影响整体
        console.warn('[scanner] analyze failed:', c.path, e)
      }
    }

    // 4) 标记已失效项目（被扫描根目录覆盖但未再发现）
    const missing = db.markMissing(validRoots.map(normalizePath), foundPaths)
    void missing

    emit?.({
      scanning: false,
      phase: '扫描完成',
      current: validRoots.length,
      total: validRoots.length,
      found,
      message: `发现 ${found} 个项目，新增 ${newProjects} 个`
    })
    db.finishScanLog(logId, validRoots, found, newProjects, null)
    return { found, newProjects, error: null }
  } catch (e) {
    const err = (e as Error).message
    emit?.({
      scanning: false,
      phase: '扫描失败',
      current: roots.length,
      total: roots.length,
      found,
      message: err
    })
    db.finishScanLog(logId, roots, found, newProjects, err)
    return { found, newProjects, error: err }
  }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
}

async function analyzeCandidate(c: Candidate): Promise<{
  path: string
  name: string
  type: ProjectType
  language: string
  stack: string[]
  isGit: boolean
  remoteUrl: string | null
  lastModifiedAt: number | null
}> {
  const stack: string[] = []
  let type: ProjectType = 'other'
  let name = basename(c.path)
  let remoteUrl: string | null = null

  // 主语言：按优先级取第一个命中
  for (const m of MARKERS) {
    if (c.markers.includes(m.file)) {
      if (TYPE_PRIORITY[m.type] < TYPE_PRIORITY[type]) type = m.type
    }
  }

  // 语言展示名 + 框架检测
  if (c.markers.includes('package.json')) {
    const pkg = await safeReadJson(join(c.path, 'package.json'))
    if (pkg && typeof pkg.name === 'string' && pkg.name.trim()) name = pkg.name.trim()
    stack.push('Node.js', ...detectNodeFrameworks(pkg))
  }
  if (c.markers.includes('pom.xml')) {
    stack.push('Java', ...detectJavaFrameworks(await safeReadText(join(c.path, 'pom.xml'))))
  }
  if (c.markers.includes('build.gradle')) {
    stack.push('Java', 'Gradle')
  }
  if (c.markers.includes('go.mod')) {
    stack.push('Go')
    const mod = await safeReadText(join(c.path, 'go.mod'))
    const m = mod.match(/^module\s+(\S+)/m)
    if (m && m[1] && !m[1].includes('/')) name = m[1]
  }
  if (c.markers.includes('requirements.txt')) {
    stack.push('Python', ...detectPythonFromRequirements(await safeReadText(join(c.path, 'requirements.txt'))))
  }
  if (c.markers.includes('pyproject.toml')) {
    stack.push('Python', ...detectPythonFromPyproject(await safeReadText(join(c.path, 'pyproject.toml'))))
  }
  if (c.markers.includes('Cargo.toml')) {
    stack.push('Rust')
  }
  if (stack.length === 0 && c.isGit) {
    stack.push('Git 仓库')
  }
  if (stack.length === 0) {
    stack.push('其他')
  }

  const languageMap: Record<ProjectType, string> = {
    node: 'Node.js',
    java: 'Java',
    python: 'Python',
    go: 'Go',
    rust: 'Rust',
    other: '其他'
  }

  // Git 信息
  const isGit = c.isGit || existsSync(join(c.path, '.git'))
  if (isGit) {
    remoteUrl = readRemoteUrl(join(c.path, '.git'))
  }

  let lastModifiedAt: number | null = null
  try {
    const s = await stat(c.path)
    lastModifiedAt = Math.floor(s.mtimeMs)
  } catch {
    lastModifiedAt = null
  }

  const uniqueStack = Array.from(new Set(stack)).slice(0, 8)
  return {
    path: c.path,
    name,
    type,
    language: languageMap[type],
    stack: uniqueStack,
    isGit,
    remoteUrl,
    lastModifiedAt
  }
}

async function safeReadJson(p: string): Promise<Record<string, unknown> | null> {
  try {
    const txt = await readFile(p, 'utf-8')
    return JSON.parse(txt.slice(0, 256 * 1024)) as Record<string, unknown>
  } catch {
    return null
  }
}

async function safeReadText(p: string): Promise<string> {
  try {
    return await readFile(p, 'utf-8')
  } catch {
    return ''
  }
}

const NODE_FRAMEWORK_MAP: Record<string, string> = {
  vue: 'Vue',
  'nuxt': 'Nuxt',
  react: 'React',
  next: 'Next.js',
  angular: 'Angular',
  svelte: 'Svelte',
  electron: 'Electron',
  express: 'Express',
  koa: 'Koa',
  'fastify': 'Fastify',
  nest: 'NestJS',
  '@nestjs/core': 'NestJS',
  vite: 'Vite',
  webpack: 'Webpack',
  tailwindcss: 'TailwindCSS',
  typescript: 'TypeScript',
  jest: 'Jest',
  vitest: 'Vitest',
  eslint: 'ESLint',
  prettier: 'Prettier',
  'antd': 'Ant Design',
  'element-plus': 'Element Plus',
  'element-ui': 'Element UI',
  'pinia': 'Pinia',
  'vue-router': 'Vue Router',
  'react-router-dom': 'React Router',
  'axios': 'Axios',
  'umi': 'Umi',
  'taro': 'Taro',
  'uni-app': 'uni-app',
  'electron-builder': 'Electron',
  'moment': 'Moment',
  'dayjs': 'Day.js'
}

function detectNodeFrameworks(pkg: Record<string, unknown> | null): string[] {
  if (!pkg) return []
  const deps: Record<string, string> = {}
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const d = pkg[key]
    if (d && typeof d === 'object') Object.assign(deps, d as Record<string, string>)
  }
  const names = Object.keys(deps)
  const found: string[] = []
  for (const n of names) {
    const label = NODE_FRAMEWORK_MAP[n]
    if (label && !found.includes(label)) found.push(label)
  }
  return found.slice(0, 6)
}

function detectJavaFrameworks(pom: string): string[] {
  const out: string[] = []
  if (/spring-boot|spring boot/i.test(pom)) out.push('Spring Boot')
  if (/spring-cloud/i.test(pom)) out.push('Spring Cloud')
  if (/mybatis/i.test(pom)) out.push('MyBatis')
  if (/junit/i.test(pom)) out.push('JUnit')
  if (/lombok/i.test(pom)) out.push('Lombok')
  if (/<packaging>war<\/packaging>/i.test(pom)) out.push('WAR')
  if (out.length === 0) out.push('Maven')
  return out
}

function detectPythonFromRequirements(req: string): string[] {
  const out: string[] = []
  if (/django/i.test(req)) out.push('Django')
  if (/fastapi/i.test(req)) out.push('FastAPI')
  if (/flask/i.test(req)) out.push('Flask')
  if (/tornado/i.test(req)) out.push('Tornado')
  if (/scrapy/i.test(req)) out.push('Scrapy')
  if (/celery/i.test(req)) out.push('Celery')
  return out
}

function detectPythonFromPyproject(py: string): string[] {
  const out: string[] = []
  if (/django/i.test(py)) out.push('Django')
  if (/fastapi/i.test(py)) out.push('FastAPI')
  if (/flask/i.test(py)) out.push('Flask')
  if (/poetry/i.test(py)) out.push('Poetry')
  if (/pytest/i.test(py)) out.push('Pytest')
  return out
}

/** 从 .git/config 中读取 origin 远程地址（避免子进程开销） */
export function readRemoteUrl(gitDir: string): string | null {
  try {
    const configPath = join(gitDir, 'config')
    const text = readConfigText(configPath)
    if (!text) return null
    const m = text.match(/\[remote\s+"origin"\]\s*([^\[]*)/i)
    if (!m) return null
    const urlMatch = m[1].match(/url\s*=\s*(\S+)/i)
    return urlMatch ? urlMatch[1] : null
  } catch {
    return null
  }
}

function readConfigText(configPath: string): string {
  try {
    return readFileSync(configPath, 'utf-8')
  } catch {
    return ''
  }
}
