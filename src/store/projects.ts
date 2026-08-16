import { defineStore } from 'pinia'
import type { Project, ProjectFilters, Tag } from '@shared/types'

export const useProjectsStore = defineStore('projects', {
  state: () => ({
    projects: [] as Project[],
    tags: [] as Tag[],
    loading: false,
    filters: {
      search: '',
      types: [] as string[],
      lifecycle: [] as string[],
      tagIds: [] as number[],
      gitState: 'all',
      sortBy: 'updated',
      sortDir: 'desc'
    } as ProjectFilters,
    gitSyncing: false,
    gitProgress: { syncing: false, done: 0, total: 0 },
    sizeComputing: false,
    sizeProgress: { computing: false, done: 0, total: 0 }
  }),
  actions: {
    async fetchProjects(extra?: Partial<ProjectFilters>) {
      this.loading = true
      try {
        const filters = { ...this.filters, ...(extra ?? {}) }
        // 深拷贝为纯数据，避免响应式 Proxy 无法通过 IPC 结构化克隆
        const plain = JSON.parse(JSON.stringify(filters)) as ProjectFilters
        const res = await window.api.projects.list(plain)
        if (res.ok && res.data) this.projects = res.data
      } finally {
        this.loading = false
      }
    },
    async fetchTags() {
      const res = await window.api.tags.list()
      if (res.ok && res.data) this.tags = res.data
    },
    async createTag(name: string): Promise<Tag | null> {
      const res = await window.api.tags.create(name)
      if (res.ok && res.data) {
        await this.fetchTags()
        return res.data
      }
      return null
    },
    async removeTag(id: number) {
      await window.api.tags.remove(id)
      await this.fetchTags()
      await this.fetchProjects()
    },
    setupGitProgress() {
      window.api.on('git:progress', (data) => {
        const p = data as { syncing: boolean; done: number; total: number }
        this.gitProgress = { syncing: p.syncing, done: p.done, total: p.total }
        this.gitSyncing = p.syncing
        if (!p.syncing) void this.fetchProjects()
      })
    },
    setupSizeProgress() {
      window.api.on('size:progress', (data) => {
        const p = data as { computing: boolean; done: number; total: number }
        this.sizeProgress = { computing: p.computing, done: p.done, total: p.total }
        this.sizeComputing = p.computing
        if (!p.computing) void this.fetchProjects()
      })
    },
    async syncGitAll() {
      await window.api.git.syncAll()
    },
    async computeSizes() {
      await window.api.stats.computeSizes()
    },
    async openIde(project: Project, ideId?: string) {
      const res = await window.api.actions.openIde(project.id, ideId)
      return res
    }
  },
  getters: {
    /** 技术栈可选值（用于筛选下拉） */
    availableTypes(): string[] {
      return Array.from(new Set(this.projects.map((p) => p.type))).sort()
    }
  }
})
