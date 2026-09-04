/**
 * Electron 主进程入口
 */
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { appendFileSync, mkdirSync } from 'fs'
import { registerIpc, loadSettings, runScan, isScanning } from './ipc'
import { setServiceLogEmitter, cleanupServices } from './services/system'
import { getDb } from './db'

// ---------- 崩溃/错误日志（写入 userData/logs/app.log，便于复现主进程级闪退） ----------
function writeLog(line: string): void {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'app.log'), `${new Date().toISOString()} ${line}\n`)
  } catch {
    // 日志不可用时静默
  }
}

process.on('uncaughtException', (err) => {
  writeLog(`[uncaughtException] ${err?.stack ?? String(err)}`)
  console.error('[uncaughtException]', err)
})
process.on('unhandledRejection', (reason) => {
  writeLog(`[unhandledRejection] ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`)
  console.error('[unhandledRejection]', reason)
})

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'CodingPilot',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 渲染进程/加载错误也写入日志（开发期同时转发到主进程控制台）
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) writeLog(`[renderer:${level}] ${message} (${sourceId}:${line})`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    writeLog(`[renderer-gone] reason=${details.reason} exitCode=${details.exitCode}`)
    console.log(`[renderer-gone] ${details.reason} ${details.exitCode}`)
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    writeLog(`[renderer-fail-load] ${code} ${desc}`)
    console.log(`[renderer-fail-load] ${code} ${desc}`)
  })
  mainWindow.webContents.on('preload-error', (_e, path, err) => {
    writeLog(`[preload-error] ${path}: ${err?.message ?? String(err)}`)
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 单实例锁
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    // 初始化数据库（触发建表）
    getDb()

    registerIpc()
    setServiceLogEmitter((projectId, line) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) {
        win.webContents.send('service:log', { projectId, line })
      }
    })

    createWindow()

    // 启动自动扫描（若开启）
    const settings = loadSettings()
    if (settings.autoScanEnabled && settings.scanRoots.length > 0) {
      setTimeout(() => {
        void runScan()
      }, 3000)
      setInterval(() => {
        if (!isScanning() && loadSettings().autoScanEnabled) {
          void runScan()
        }
      }, Math.max(settings.scanIntervalMinutes, 1) * 60 * 1000)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    cleanupServices()
  })
}
