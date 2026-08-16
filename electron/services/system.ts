/**
 * 系统调用服务
 * 一键唤醒 IDE、打开文件夹/终端、启动/停止后台服务、打开远程仓库。
 */
import { spawn, exec } from 'child_process'
import { shell } from 'electron'
import { join } from 'path'
import { readFileSync, accessSync } from 'fs'
import type { ServiceStatus } from '@shared/types'
import { IDE_LIST } from '@shared/types'
import * as db from '../db'

export interface ActionResult {
  ok: boolean
  error?: string
}

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

// ---------- 打开文件夹 ----------
export function openFolder(path: string): ActionResult {
  try {
    if (isWin) {
      spawn('explorer.exe', [path], { detached: true, stdio: 'ignore' }).unref()
    } else if (isMac) {
      spawn('open', [path], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [path], { detached: true, stdio: 'ignore' }).unref()
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ---------- 打开终端 ----------
export function openTerminal(path: string): ActionResult {
  try {
    if (isWin) {
      // 打开新的 cmd 窗口并定位到目标目录
      spawn('cmd.exe', ['/c', 'start', 'cmd', '/k', `cd /d "${path}"`], { detached: true, stdio: 'ignore' }).unref()
    } else if (isMac) {
      spawn('open', ['-a', 'Terminal', path], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('x-terminal-emulator', ['--working-directory', path], { detached: true, stdio: 'ignore' }).unref()
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ---------- 打开 IDE ----------
export function openIde(projectPath: string, ideId: string): Promise<ActionResult> {
  const ide = IDE_LIST.find((i) => i.id === ideId) ?? IDE_LIST[0]
  return new Promise<ActionResult>((resolve) => {
    let child
    try {
      child = spawn(ide.command, [projectPath], {
        shell: isWin,
        detached: true,
        stdio: 'ignore'
      })
    } catch (e) {
      resolve({ ok: false, error: (e as Error).message })
      return
    }
    child.once('error', (err) => {
      resolve({
        ok: false,
        error: `启动 ${ide.name} 失败，请确认已安装并将其加入系统 PATH（${(err as NodeJS.ErrnoException).code ?? err.message}）`
      })
    })
    child.once('spawn', () => {
      child.unref()
      resolve({ ok: true })
    })
  })
}

// ---------- 打开远程仓库 ----------
export async function openRemote(remoteUrl: string | null): Promise<ActionResult> {
  if (!remoteUrl) return { ok: false, error: '该项目未配置远程仓库' }
  const httpUrl = toHttpUrl(remoteUrl)
  if (!httpUrl) return { ok: false, error: `无法识别的远程地址: ${remoteUrl}` }
  await shell.openExternal(httpUrl)
  return { ok: true }
}

function toHttpUrl(url: string): string | null {
  if (/^https?:\/\//i.test(url)) return url
  const m = url.match(/^git@([^:]+):(.+)\.git$/)
  if (m) return `https://${m[1]}/${m[2]}`
  const m2 = url.match(/^git@([^:]+):(.+)$/)
  if (m2) return `https://${m2[1]}/${m2[2]}`
  return null
}

// ---------- 后台服务管理 ----------
interface RunningService {
  projectId: number
  projectName: string
  command: string
  pid: number
  startedAt: number
  child: ReturnType<typeof spawn>
  log: string[]
  killed: boolean
}

const services = new Map<number, RunningService>()

export type ServiceLogEmitter = (projectId: number, line: string) => void

let logEmitter: ServiceLogEmitter | null = null

export function setServiceLogEmitter(emitter: ServiceLogEmitter | null): void {
  logEmitter = emitter
}

/** 推断服务启动命令 */
export function inferStartCommand(projectPath: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(projectPath, 'package.json'), 'utf-8'))
    const scripts = pkg?.scripts ?? {}
    if (typeof scripts.dev === 'string') return 'npm run dev'
    if (typeof scripts.start === 'string') return 'npm start'
  } catch {
    // no package.json
  }
  try {
    accessSync(join(projectPath, 'pom.xml'))
    return 'mvn spring-boot:run'
  } catch {
    // no pom.xml
  }
  try {
    accessSync(join(projectPath, 'go.mod'))
    return 'go run .'
  } catch {
    // no go.mod
  }
  return ''
}

function resolveStartCommand(projectPath: string, projectDefault: string | null, globalDefault: string): string {
  if (projectDefault && projectDefault.trim()) return projectDefault.trim()
  if (globalDefault && globalDefault.trim()) return globalDefault.trim()
  return inferStartCommand(projectPath)
}

export function startService(projectId: number): { ok: boolean; error?: string; status?: ServiceStatus } {
  const row = db.getProjectRow(projectId)
  if (!row) return { ok: false, error: '项目不存在' }
  const existing = services.get(projectId)
  if (existing && !existing.killed) {
    return { ok: true, status: toStatus(existing) }
  }
  const command = resolveStartCommand(row.path, row.default_script, db.getSetting('defaultScript', ''))
  if (!command) {
    return { ok: false, error: '未找到启动命令，请在项目详情或设置中配置（如 npm run dev）' }
  }
  const child = spawn(command, {
    cwd: row.path,
    shell: true,
    detached: isWin ? false : true,
    env: { ...process.env, FORCE_COLOR: '0' },
    windowsHide: false
  })
  const svc: RunningService = {
    projectId,
    projectName: row.name,
    command,
    pid: child.pid ?? 0,
    startedAt: Date.now(),
    child,
    log: [],
    killed: false
  }
  services.set(projectId, svc)
  const push = (buf: Buffer | string) => {
    if (svc.killed) return
    const text = buf.toString()
    const lines = text.split('\n')
    for (const l of lines) {
      if (l.trim() === '') continue
      svc.log.push(l)
      if (svc.log.length > 2000) svc.log.splice(0, svc.log.length - 2000)
      logEmitter?.(projectId, l)
    }
  }
  child.stdout?.on('data', push)
  child.stderr?.on('data', push)
  child.on('error', (err) => push(`[启动失败] ${err.message}`))
  child.on('exit', (code) => {
    svc.killed = true
    push(`[进程退出] code=${code ?? 'unknown'}`)
    services.delete(projectId)
  })
  return { ok: true, status: toStatus(svc) }
}

export function stopService(projectId: number): { ok: boolean; stopped?: boolean } {
  const svc = services.get(projectId)
  if (!svc || svc.killed) return { ok: true, stopped: false }
  svc.killed = true
  try {
    if (isWin) {
      exec(`taskkill /pid ${svc.pid} /T /F`, { windowsHide: true })
    } else {
      try {
        process.kill(-svc.pid, 'SIGTERM')
      } catch {
        process.kill(svc.pid, 'SIGTERM')
      }
    }
  } catch {
    // ignore
  }
  services.delete(projectId)
  return { ok: true, stopped: true }
}

export function getServiceStatus(projectId: number): ServiceStatus {
  const svc = services.get(projectId)
  return svc && !svc.killed ? toStatus(svc) : { running: false, log: [] }
}

function toStatus(svc: RunningService): ServiceStatus {
  return {
    running: !svc.killed,
    pid: svc.pid,
    startedAt: svc.startedAt,
    command: svc.command,
    log: svc.log.slice(-500)
  }
}

/** 退出时清理所有子进程 */
export function cleanupServices(): void {
  for (const [, svc] of services) {
    try {
      if (isWin) {
        exec(`taskkill /pid ${svc.pid} /T /F`, { windowsHide: true })
      } else {
        try {
          process.kill(-svc.pid, 'SIGTERM')
        } catch {
          process.kill(svc.pid, 'SIGTERM')
        }
      }
    } catch {
      // ignore
    }
  }
  services.clear()
}
