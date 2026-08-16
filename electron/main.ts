/**
 * Electron 主进程入口
 */
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerIpc, loadSettings, runScan, isScanning } from './ipc'
import { setServiceLogEmitter, cleanupServices } from './services/system'
import { getDb } from './db'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: '本地项目管理系统',
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

  // 开发期转发渲染进程控制台与错误，便于排查
  if (!app.isPackaged) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`)
    })
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      console.log(`[renderer-gone] ${details.reason} ${details.exitCode}`)
    })
    mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
      console.log(`[renderer-fail-load] ${code} ${desc}`)
    })
  }

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
