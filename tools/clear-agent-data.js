/** 一次性开发工具：清空 agent 相关数据表（崩溃重试可能产生重复行，重新全量采集前清库）。
 * 用法：npx electron tools/clear-agent-data.js（注意用 electron 运行以匹配 better-sqlite3 ABI） */
const { app } = require('electron')
const { join } = require('path')
const { homedir } = require('os')
const Database = require('better-sqlite3')

app.whenReady().then(() => {
  try {
    const file = join(homedir(), 'AppData', 'Roaming', 'project-pilot', 'local-project-manager.db')
    const db = new Database(file)
    db.pragma('journal_mode = WAL')
    db.exec(
      'DELETE FROM agent_usage; DELETE FROM agent_edits; DELETE FROM agent_sessions; DELETE FROM worklog_manual;'
    )
    console.log('[clear-agent-data] cleared tables in', file)
  } catch (e) {
    console.error('[clear-agent-data]', e)
  } finally {
    app.exit(0)
  }
})
