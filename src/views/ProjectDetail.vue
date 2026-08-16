<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  Cpu,
  FolderOpened,
  Promotion,
  Link,
  Plus,
  Delete,
  VideoPlay,
  VideoPause,
  Refresh
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import { useProjectsStore } from '@/store/projects'
import type { Project, ServiceStatus, Tag } from '@shared/types'
import {
  LIFECYCLE_LABELS,
  LIFECYCLE_TYPES,
  LIFECYCLE_COLORS,
  TYPE_LABELS,
  IDE_LIST
} from '@shared/types'

const route = useRoute()
const router = useRouter()
const store = useProjectsStore()

const projectId = computed(() => Number(route.params.id))
const project = ref<Project | null>(null)
const noteContent = ref('')
const noteDirty = ref(false)
const newTagName = ref('')
const service = ref<ServiceStatus>({ running: false, log: [] })
const loading = ref(true)

const lifecycleOptions = LIFECYCLE_TYPES.map((l) => ({ value: l, label: LIFECYCLE_LABELS[l] }))
const ideOptions = IDE_LIST.map((i) => ({ value: i.id, label: i.name }))

async function load() {
  loading.value = true
  try {
    const res = await window.api.projects.get(projectId.value)
    if (res.ok && res.data) {
      project.value = res.data
    } else {
      ElMessage.error(res.error ?? '项目不存在')
      void router.push('/projects')
      return
    }
    const note = await window.api.notes.get(projectId.value)
    if (note.ok) noteContent.value = note.data ?? ''
    const svc = await window.api.service.status(projectId.value)
    if (svc.ok && svc.data) service.value = svc.data
  } finally {
    loading.value = false
  }
}

async function saveMeta(patch: Partial<Project>) {
  if (!project.value) return
  const res = await window.api.projects.update(projectId.value, patch)
  if (res.ok && res.data) project.value = res.data
}

async function saveNote() {
  const res = await window.api.notes.save(projectId.value, noteContent.value)
  if (res.ok) {
    noteDirty.value = false
    ElMessage.success('笔记已保存')
  } else {
    ElMessage.error(res.error ?? '保存失败')
  }
}

async function addTag() {
  const name = newTagName.value.trim()
  if (!name) return
  const tag = await store.createTag(name)
  if (tag) {
    const ids = (project.value?.tags ?? []).map((t) => t.id)
    ids.push(tag.id)
    await saveMeta({ tags: ids })
    newTagName.value = ''
  }
}

async function removeTag(tagId: number) {
  if (!project.value) return
  const ids = project.value.tags.filter((t) => t.id !== tagId).map((t) => t.id)
  await saveMeta({ tags: ids })
}

async function toggleService() {
  if (!project.value) return
  if (service.value.running) {
    await window.api.service.stop(projectId.value)
    service.value = { running: false, log: service.value.log }
    ElMessage.info('服务已停止')
  } else {
    const res = await window.api.service.start(projectId.value)
    if (res.ok && res.data) {
      service.value = res.data
      ElMessage.success(`服务已启动：${res.data.command}`)
    } else {
      ElMessage.error(res.error ?? '启动失败')
    }
  }
}

async function openIde(ideId?: string) {
  if (!project.value) return
  const res = await window.api.actions.openIde(projectId.value, ideId ?? project.value.defaultIde ?? undefined)
  if (!res.ok) ElMessage.error(res.error ?? '打开失败')
}

async function openFolder() {
  if (!project.value) return
  const res = await window.api.actions.openFolder(project.value.path)
  if (!res.ok) ElMessage.error(res.error ?? '打开失败')
}

async function openTerminal() {
  if (!project.value) return
  const res = await window.api.actions.openTerminal(project.value.path)
  if (!res.ok) ElMessage.error(res.error ?? '打开失败')
}

async function openRemote() {
  if (!project.value) return
  const res = await window.api.actions.openRemote(projectId.value)
  if (!res.ok) ElMessage.error(res.error ?? '打开失败')
}

let serviceUnsub: (() => void) | null = null
onMounted(() => {
  void load()
  serviceUnsub = window.api.on('service:log', (data) => {
    const d = data as { projectId: number; line: string }
    if (d.projectId === projectId.value) {
      service.value.log.push(d.line)
      if (service.value.log.length > 500) service.value.log.splice(0, service.value.log.length - 500)
    }
  })
})

onBeforeUnmount(() => {
  serviceUnsub?.()
})

watch(projectId, () => {
  void load()
})

function formatSize(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDate(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const logBox = ref<HTMLElement | null>(null)
watch(
  () => service.value.log.length,
  () => {
    if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
  }
)
</script>

<template>
  <div v-loading="loading" class="detail-page">
    <template v-if="project">
      <!-- 头部 -->
      <el-card shadow="never" class="mb-4">
        <div class="detail-head">
          <div class="head-left">
            <el-button :icon="ArrowLeft" circle @click="router.push('/projects')" />
            <div>
              <div class="proj-title">
                {{ project.name }}
                <el-tag size="small" :color="LIFECYCLE_COLORS[project.lifecycle]" effect="dark" class="ml-2">
                  {{ LIFECYCLE_LABELS[project.lifecycle] }}
                </el-tag>
              </div>
              <div class="proj-path">{{ project.path }}</div>
            </div>
          </div>
          <div class="head-actions">
            <el-dropdown trigger="click" @command="(cmd: string) => openIde(cmd)">
              <el-button type="primary" :icon="Cpu">
                打开 IDE
                <el-icon class="el-icon--right"><ArrowLeft class="rotate-90" /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="ide in IDE_LIST" :key="ide.id" :command="ide.id">
                    {{ ide.name }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-tooltip content="打开文件夹" placement="top">
              <el-button :icon="FolderOpened" @click="openFolder" />
            </el-tooltip>
            <el-tooltip content="打开终端" placement="top">
              <el-button :icon="Promotion" @click="openTerminal" />
            </el-tooltip>
            <el-tooltip content="打开远程仓库" placement="top">
              <el-button :icon="Link" :disabled="!project.remoteUrl" @click="openRemote" />
            </el-tooltip>
          </div>
        </div>
      </el-card>

      <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div class="xl:col-span-2 space-y-4">
          <!-- 笔记区 -->
          <el-card shadow="never">
            <template #header>
              <div class="card-title flex items-center justify-between">
                <span>📝 项目备忘录（Markdown / TODO）</span>
                <el-tag v-if="noteDirty" size="small" type="warning" effect="plain">有未保存修改</el-tag>
              </div>
            </template>
            <div style="height: 420px">
              <MarkdownEditor v-model="noteContent" @save="saveNote" @update:model-value="noteDirty = true" />
            </div>
          </el-card>

          <!-- 服务管理 -->
          <el-card shadow="never">
            <template #header>
              <div class="card-title flex items-center justify-between">
                <span>🚀 服务快捷启动</span>
                <el-button
                  :type="service.running ? 'danger' : 'success'"
                  size="small"
                  :icon="service.running ? VideoPause : VideoPlay"
                  @click="toggleService"
                >
                  {{ service.running ? '停止服务' : '启动服务' }}
                </el-button>
              </div>
            </template>
            <div v-if="service.running" class="mb-2 text-sm">
              <el-tag type="success" size="small" class="mr-2">运行中</el-tag>
              <span class="text-slate-400">命令：<code class="cmd-code">{{ service.command }}</code>（PID: {{ service.pid }}）</span>
            </div>
            <el-input v-model="project.defaultScript" placeholder="启动命令（留空则自动推断，如 npm run dev）" size="small" class="mb-2">
              <template #prepend>启动命令</template>
            </el-input>
            <el-button size="small" type="primary" plain @click="saveMeta({ defaultScript: project.defaultScript })">
              保存命令
            </el-button>
            <div ref="logBox" class="service-log">
              <div v-if="service.log.length === 0" class="text-slate-500 text-sm">暂无日志，点击"启动服务"开始。</div>
              <div v-for="(line, i) in service.log" :key="i" class="log-line">{{ line }}</div>
            </div>
          </el-card>
        </div>

        <!-- 右侧信息栏 -->
        <div class="space-y-4">
          <!-- Git 信息 -->
          <el-card shadow="never">
            <template #header>
              <div class="card-title flex items-center justify-between">
                <span>🔄 Git 信息</span>
                <el-button size="small" text type="primary" :icon="Refresh" @click="load()">刷新</el-button>
              </div>
            </template>
            <el-descriptions :column="1" size="small" class="git-desc">
              <el-descriptions-item label="仓库">
                <el-tag :type="project.isGit ? 'success' : 'info'" size="small">{{ project.isGit ? 'Git 仓库' : '非 Git' }}</el-tag>
              </el-descriptions-item>
              <template v-if="project.isGit">
                <el-descriptions-item label="当前分支">
                  <span class="font-mono">{{ project.git?.branch ?? '—' }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="工作区">
                  <el-tag :type="project.git?.clean ? 'success' : 'danger'" size="small">
                    {{ project.git?.clean ? '干净' : '有未提交修改' }}
                  </el-tag>
                </el-descriptions-item>
                <el-descriptions-item label="远程同步">
                  <span v-if="project.git && (project.git.ahead > 0 || project.git.behind > 0)" class="text-amber-500">
                    超前 {{ project.git.ahead }} / 落后 {{ project.git.behind }}
                  </span>
                  <span v-else class="text-green-500">已同步</span>
                </el-descriptions-item>
                <el-descriptions-item label="30 天提交">
                  <span>{{ project.git?.commits30d ?? 0 }} 次</span>
                </el-descriptions-item>
                <el-descriptions-item label="最近提交">
                  {{ formatDate(project.git?.lastCommitAt ?? null) }}
                </el-descriptions-item>
                <el-descriptions-item label="远程地址">
                  <span class="remote-url" :title="project.git?.remoteUrl ?? ''">{{ project.git?.remoteUrl ?? '—' }}</span>
                </el-descriptions-item>
              </template>
            </el-descriptions>
          </el-card>

          <!-- 项目属性 -->
          <el-card shadow="never">
            <template #header>
              <div class="card-title">⚙️ 项目属性</div>
            </template>
            <el-form label-position="top" size="small">
              <el-form-item label="生命周期">
                <el-select v-model="project.lifecycle" class="w-full" @change="saveMeta({ lifecycle: project.lifecycle })">
                  <el-option v-for="l in lifecycleOptions" :key="l.value" :label="l.label" :value="l.value" />
                </el-select>
              </el-form-item>
              <el-form-item label="默认 IDE">
                <el-select v-model="project.defaultIde" clearable placeholder="使用全局默认" class="w-full" @change="saveMeta({ defaultIde: project.defaultIde ?? null })">
                  <el-option v-for="i in ideOptions" :key="i.value" :label="i.label" :value="i.value" />
                </el-select>
              </el-form-item>
              <el-form-item label="描述">
                <el-input
                  v-model="project.description"
                  type="textarea"
                  :rows="2"
                  placeholder="项目简介…"
                  @blur="saveMeta({ description: project.description })"
                />
              </el-form-item>
            </el-form>
          </el-card>

          <!-- 标签 -->
          <el-card shadow="never">
            <template #header>
              <div class="card-title">🏷️ 标签</div>
            </template>
            <div class="tag-editor">
              <div class="tag-list">
                <el-tag
                  v-for="t in project.tags"
                  :key="t.id"
                  closable
                  size="small"
                  class="tag-item"
                  :style="{ backgroundColor: t.color + '22', color: t.color, borderColor: t.color + '55' }"
                  @close="removeTag(t.id)"
                >
                  {{ t.name }}
                </el-tag>
                <span v-if="project.tags.length === 0" class="text-slate-500 text-xs">暂无标签</span>
              </div>
              <div class="tag-add">
                <el-input
                  v-model="newTagName"
                  size="small"
                  placeholder="新标签名称（如：工作/开源/副业）"
                  @keyup.enter="addTag"
                />
                <el-button size="small" type="primary" :icon="Plus" @click="addTag">添加</el-button>
              </div>
            </div>
          </el-card>

          <!-- 基本信息 -->
          <el-card shadow="never">
            <template #header>
              <div class="card-title">ℹ️ 基本信息</div>
            </template>
            <el-descriptions :column="1" size="small">
              <el-descriptions-item label="主语言">
                <el-tag size="small" effect="plain">{{ project.language }}</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="技术栈">
                <div class="stack-list">
                  <el-tag v-for="s in project.stack" :key="s" size="small" effect="plain" class="mr-1 mb-1">{{ s }}</el-tag>
                </div>
              </el-descriptions-item>
              <el-descriptions-item label="磁盘占用">{{ formatSize(project.sizeBytes) }}</el-descriptions-item>
              <el-descriptions-item label="创建时间">{{ formatDate(project.createdAt) }}</el-descriptions-item>
              <el-descriptions-item label="最近修改">{{ formatDate(project.lastModifiedAt) }}</el-descriptions-item>
              <el-descriptions-item label="最近打开">{{ formatDate(project.lastOpenedAt) }}</el-descriptions-item>
            </el-descriptions>
          </el-card>

          <el-button type="danger" plain class="w-full" :icon="Delete" @click="router.push('/projects')">
            从列表中移除该项目（不删除磁盘文件）
          </el-button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.head-left {
  display: flex;
  align-items: center;
  gap: 14px;
}
.proj-title {
  font-size: 18px;
  font-weight: 600;
  color: #e8f1ff;
  display: flex;
  align-items: center;
  text-shadow: 0 0 14px rgba(0, 212, 255, 0.25);
}
.proj-path {
  font-size: 12px;
  color: #4d5f82;
  font-family: Consolas, 'Courier New', monospace;
  margin-top: 2px;
}
.head-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.card-title {
  font-size: 15px;
  font-weight: 600;
  color: #e8f1ff;
  letter-spacing: 0.5px;
}
.rotate-90 {
  transform: rotate(90deg);
}
.cmd-code {
  background: rgba(0, 212, 255, 0.12);
  padding: 1px 6px;
  border-radius: 3px;
  color: #4ee3ff;
  font-size: 12px;
  font-family: Consolas, monospace;
}
.service-log {
  margin-top: 8px;
  background: #0a1120;
  color: #a8c5e8;
  border: 1px solid rgba(0, 212, 255, 0.12);
  border-radius: 6px;
  padding: 10px 12px;
  height: 220px;
  overflow-y: auto;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.6;
}
.log-line {
  white-space: pre-wrap;
  word-break: break-all;
}
.remote-url {
  max-width: 200px;
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.tag-item {
  border-width: 1px;
  border-style: solid;
}
.tag-add {
  display: flex;
  gap: 8px;
}
.stack-list {
  line-height: 1.8;
}
.git-desc :deep(.el-descriptions__label) {
  color: #7d90b5;
}
.git-desc :deep(.el-descriptions__content) {
  color: #c9d8ee;
}
</style>
