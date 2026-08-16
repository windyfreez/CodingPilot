// 临时测试用 electron 模块桩（仅运行服务层逻辑，不启动真实 Electron 应用）
const os = require('os')
const path = require('path')

module.exports = {
  app: {
    getPath: () => path.join(os.tmpdir(), 'lpm-e2e-test')
  },
  shell: {
    openExternal: async () => {}
  },
  ipcMain: { handle: () => {} },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  BrowserWindow: class {
    static getAllWindows() {
      return []
    }
  }
}
