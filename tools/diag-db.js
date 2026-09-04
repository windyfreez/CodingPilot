/** 一次性诊断：列出 project-pilot userData 数据库中的所有表（显式路径）。
 * 用法：npx electron tools/diag-db.js */
const { app } = require('electron')
const { join } = require('path')
const { homedir } = require('os')
const Database = require('better-sqlite3')

app.whenReady().then(() => {
  try {
    const file = join(homedir(), 'AppData', 'Roaming', 'project-pilot', 'local-project-manager.db')
    console.log('[diag] db file =', file)
    const db = new Database(file, { readonly: true })
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    console.log('[diag] tables:', rows.map((r) => r.name).join(', '))
  } catch (e) {
    console.error('[diag]', e)
  } finally {
    app.exit(0)
  }
})
