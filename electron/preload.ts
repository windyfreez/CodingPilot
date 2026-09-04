/**
 * 预加载脚本：通过 contextBridge 暴露类型安全的 IPC API
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api } from '@shared/ipc'
import { IDE_LIST } from '@shared/types'

const EVENT_CHANNELS = ['scan:progress', 'git:progress', 'size:progress', 'service:log', 'heatmap:ready'] as const

const api: Api = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch)
  },
  dialog: {
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory')
  },
  scan: {
    start: () => ipcRenderer.invoke('scan:start'),
    status: () => ipcRenderer.invoke('scan:status'),
    logs: () => ipcRenderer.invoke('scan:logs')
  },
  projects: {
    list: (filters) => ipcRenderer.invoke('projects:list', filters ?? {}),
    get: (id) => ipcRenderer.invoke('projects:get', id),
    update: (id, patch) => ipcRenderer.invoke('projects:update', { id, patch }),
    remove: (id) => ipcRenderer.invoke('projects:remove', id),
    touchOpened: (id) => ipcRenderer.invoke('projects:touchOpened', id)
  },
  tags: {
    list: () => ipcRenderer.invoke('tags:list'),
    create: (name) => ipcRenderer.invoke('tags:create', name),
    remove: (id) => ipcRenderer.invoke('tags:remove', id),
    assign: (projectId, tagIds) => ipcRenderer.invoke('tags:assign', { projectId, tagIds })
  },
  notes: {
    get: (projectId) => ipcRenderer.invoke('notes:get', projectId),
    save: (projectId, content) => ipcRenderer.invoke('notes:save', { projectId, content })
  },
  git: {
    status: (projectId) => ipcRenderer.invoke('git:status', projectId),
    syncAll: () => ipcRenderer.invoke('git:syncAll')
  },
  actions: {
    openFolder: (path) => ipcRenderer.invoke('actions:openFolder', path),
    openTerminal: (path) => ipcRenderer.invoke('actions:openTerminal', path),
    openIde: (projectId, ideId) => ipcRenderer.invoke('actions:openIde', { projectId, ideId }),
    openRemote: (projectId) => ipcRenderer.invoke('actions:openRemote', projectId)
  },
  service: {
    start: (projectId) => ipcRenderer.invoke('service:start', projectId),
    stop: (projectId) => ipcRenderer.invoke('service:stop', projectId),
    status: (projectId) => ipcRenderer.invoke('service:status', projectId)
  },
  stats: {
    summary: () => ipcRenderer.invoke('stats:summary'),
    techStack: () => ipcRenderer.invoke('stats:techStack'),
    frameworks: () => ipcRenderer.invoke('stats:frameworks'),
    health: () => ipcRenderer.invoke('stats:health'),
    diskUsage: (limit) => ipcRenderer.invoke('stats:diskUsage', limit ?? 10),
    heatmap: (days) => ipcRenderer.invoke('stats:heatmap', days ?? 365),
    computeSizes: () => ipcRenderer.invoke('stats:computeSizes'),
    refreshHeatmap: (force) => ipcRenderer.invoke('stats:refreshHeatmap', force ?? false)
  },
  ides: {
    list: () => IDE_LIST
  },
  usage: {
    getConfig: () => ipcRenderer.invoke('usage:getConfig'),
    saveConfig: (patch) => ipcRenderer.invoke('usage:saveConfig', patch),
    syncNow: () => ipcRenderer.invoke('usage:syncNow'),
    overview: (days) => ipcRenderer.invoke('usage:overview', days ?? 30),
    sessions: (limit) => ipcRenderer.invoke('usage:sessions', limit ?? 50),
    onSynced: (cb) => {
      const listener = (_e: IpcRendererEvent, r: Parameters<typeof cb>[0]): void => cb(r)
      ipcRenderer.on('usage:synced', listener)
      return () => {
        ipcRenderer.removeListener('usage:synced', listener)
      }
    }
  },
  worklog: {
    daily: (date) => ipcRenderer.invoke('worklog:daily', date ?? null),
    syncGitNow: () => ipcRenderer.invoke('worklog:syncGitNow'),
    addManual: (entry) => ipcRenderer.invoke('worklog:addManual', entry),
    removeManual: (id) => ipcRenderer.invoke('worklog:removeManual', id),
    setSelfLines: (date, projectId, value) => ipcRenderer.invoke('worklog:setSelfLines', { date, projectId, value }),
    onGitSynced: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on('worklog:gitSynced', listener)
      return () => {
        ipcRenderer.removeListener('worklog:gitSynced', listener)
      }
    }
  },
  on: (channel, cb) => {
    if (!EVENT_CHANNELS.includes(channel as (typeof EVENT_CHANNELS)[number])) {
      throw new Error(`不允许订阅的通道: ${channel}`)
    }
    const listener = (_e: IpcRendererEvent, data: unknown): void => cb(data)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
