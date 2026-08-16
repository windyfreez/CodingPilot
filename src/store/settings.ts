import { defineStore } from 'pinia'
import type { ScanProgress, Settings } from '@shared/types'

const DEFAULTS: Settings = {
  scanRoots: [],
  defaultIde: 'vscode',
  autoScanEnabled: true,
  scanIntervalMinutes: 30,
  defaultScript: ''
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: { ...DEFAULTS } as Settings,
    loaded: false,
    scanning: false,
    scanProgress: {
      scanning: false,
      phase: '空闲',
      current: 0,
      total: 0,
      found: 0
    } as ScanProgress
  }),
  actions: {
    async load() {
      this.settings = await window.api.settings.get()
      this.loaded = true
    },
    async update(patch: Partial<Settings>) {
      const res = await window.api.settings.update(patch)
      if (res.ok && res.data) this.settings = res.data
      return res
    },
    async startScan() {
      if (this.scanning) return
      this.scanning = true
      await window.api.scan.start()
    },
    setupProgressListener() {
      window.api.on('scan:progress', (data) => {
        const p = data as ScanProgress
        this.scanProgress = p
        this.scanning = p.scanning
        if (!p.scanning) {
          // 扫描完成后刷新项目
          void this.refreshAfterScan()
        }
      })
    },
    async refreshAfterScan() {
      const { useProjectsStore } = await import('./projects')
      const projectsStore = useProjectsStore()
      await projectsStore.fetchProjects()
    }
  }
})
