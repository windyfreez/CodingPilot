<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  Search,
  Refresh,
  FolderOpened,
  Promotion,
  Link,
  MoreFilled,
  Cpu,
  Delete
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useProjectsStore } from '@/store/projects'
import type { Project } from '@shared/types'
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS, LIFECYCLE_TYPES, TYPE_LABELS, IDE_LIST } from '@shared/types'

const router = useRouter()
const store = useProjectsStore()

const page = ref(1)
const pageSize = ref(20)
const searchInput = ref('')

const typeOptions = computed(() => {
  const types = new Set(store.projects.map((p) => p.type))
  return (Object.keys(TYPE_LABELS) as (keyof typeof TYPE_LABELS)[])
    .filter((t) => types.has(t))
    .map((t) => ({ value: t, label: TYPE_LABELS[t] }))
})

const pagedProjects = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return store.projects.slice(start, start + pageSize.value)
})

const total = computed(() => store.projects.length)

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(searchInput, (v) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    store.filters.search = v
    page.value = 1
    void store.fetchProjects()
  }, 300)
})

watch(
  () => store.filters,
  () => {
    page.value = 1
  },
  { deep: true }
)

function onFilterChange() {
  page.value = 1
  void store.fetchProjects()
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function gitDotClass(p: Project): string {
  if (!p.isGit) return 'dot dot-none'
  if (p.git?.clean) return 'dot dot-clean'
  return 'dot dot-dirty'
}

function gitTitle(p: Project): string {
  if (!p.isGit) return '非 Git 仓库'
  if (p.git?.clean) return '工作区干净'
  return '有未提交修改'
}

async function openIde(p: Project, ideId?: string) {
  const res = await store.openIde(p, ideId)
  if (!res.ok) ElMessage.error(res.error ?? '打开失败')
}

async function openFolder(p: Project) {
  const res = await window.api.actions.openFolder(p.path)
  if (!res.ok) ElMessage.error(res.error ?? '打开失败')
}

async function openTerminal(p: Project) {
  const res = await window.api.actions.openTerminal(p.path)
  if (!res.ok) ElMessage.error(res.error ?? '打开失败')
}

async function openRemote(p: Project) {
  const res = await window.api.actions.openRemote(p.id)
  if (!res.ok) ElMessage.error(res.error ?? '打开失败')
}

async function removeProject(p: Project) {
  try {
    await ElMessageBox.confirm(
      `确定要将「${p.name}」从项目列表移除吗？<br/><span style="font-size:12px;color:#64748b">仅移除记录，不会删除磁盘文件。</span>`,
      '移除项目',
      { dangerouslyUseHTMLString: true, type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const res = await window.api.projects.remove(p.id)
  if (res.ok) {
    ElMessage.success('已移除')
    void store.fetchProjects()
  }
}

function typeTagColor(type: string): string {
  const map: Record<string, string> = {
    node: '#00e5a0',
    java: '#ff8a5c',
    python: '#6ea8ff',
    go: '#22d3ee',
    rust: '#ffb454',
    other: '#64748b'
  }
  return map[type] ?? '#64748b'
}

function goDetail(p: Project) {
  void router.push(`/projects/${p.id}`)
}

onMounted(() => {
  void store.fetchProjects()
})
</script>

<template>
  <div class="projects-page">
    <!-- 筛选工具栏 -->
    <el-card shadow="never" class="mb-4">
      <div class="filter-bar">
        <el-input
          v-model="searchInput"
          placeholder="搜索项目名称…"
          :prefix-icon="Search"
          clearable
          class="filter-search"
          size="default"
        />
        <el-select
          v-model="store.filters.types"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="技术栈"
          class="filter-item"
          @change="onFilterChange"
        >
          <el-option v-for="t in typeOptions" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
        <el-select
          v-model="store.filters.lifecycle"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="生命周期"
          class="filter-item"
          @change="onFilterChange"
        >
          <el-option v-for="l in LIFECYCLE_TYPES" :key="l" :label="LIFECYCLE_LABELS[l]" :value="l" />
        </el-select>
        <el-select
          v-model="store.filters.tagIds"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="标签"
          class="filter-item"
          @change="onFilterChange"
        >
          <el-option v-for="t in store.tags" :key="t.id" :label="t.name" :value="t.id" />
        </el-select>
        <el-select
          v-model="store.filters.gitState"
          placeholder="Git 状态"
          class="filter-item filter-git"
          @change="onFilterChange"
        >
          <el-option label="全部" value="all" />
          <el-option label="干净" value="clean" />
          <el-option label="有未提交修改" value="dirty" />
          <el-option label="未推送" value="unpushed" />
        </el-select>
        <el-select
          v-model="store.filters.sortBy"
          placeholder="排序"
          class="filter-item filter-sort"
          @change="onFilterChange"
        >
          <el-option label="最近更新" value="updated" />
          <el-option label="项目名称" value="name" />
          <el-option label="磁盘占用" value="size" />
          <el-option label="创建时间" value="created" />
        </el-select>
        <el-button
          :icon="store.filters.sortDir === 'asc' ? 'SortUp' : 'SortDown'"
          @click="store.filters.sortDir = store.filters.sortDir === 'asc' ? 'desc' : 'asc'; onFilterChange()"
        >
          {{ store.filters.sortDir === 'asc' ? '升序' : '降序' }}
        </el-button>
        <el-button :icon="Refresh" :loading="store.loading" @click="store.fetchProjects()">刷新</el-button>
        <el-button
          type="primary"
          plain
          :loading="store.gitSyncing"
          @click="store.syncGitAll()"
        >
          {{ store.gitSyncing ? `同步 Git ${store.gitProgress.done}/${store.gitProgress.total}` : '同步 Git 状态' }}
        </el-button>
      </div>
    </el-card>

    <!-- 项目表格 -->
    <el-card shadow="never">
      <el-table
        v-loading="store.loading"
        :data="pagedProjects"
        row-key="id"
        class="project-table"
        @row-click="(row: Project) => goDetail(row)"
      >
        <el-table-column label="项目" min-width="240">
          <template #default="{ row }: { row: Project }">
            <div class="proj-cell">
              <span class="proj-dot" :class="gitDotClass(row)" :title="gitTitle(row)" />
              <div class="proj-name-wrap">
                <div class="proj-name">{{ row.name }}</div>
                <div class="proj-path">{{ row.path }}</div>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="技术栈" min-width="160">
          <template #default="{ row }: { row: Project }">
            <div class="stack-cell">
              <el-tag size="small" :color="typeTagColor(row.type)" class="stack-tag" effect="dark">
                {{ row.language }}
              </el-tag>
              <template v-for="s in row.stack.filter((x) => x !== row.language).slice(0, 3)" :key="s">
                <el-tag size="small" effect="plain" class="stack-tag">{{ s }}</el-tag>
              </template>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="标签" width="150">
          <template #default="{ row }: { row: Project }">
            <div class="tag-cell">
              <el-tag
                v-for="t in row.tags.slice(0, 3)"
                :key="t.id"
                size="small"
                class="tag-item"
                :style="{ backgroundColor: t.color + '22', color: t.color, borderColor: t.color + '55' }"
              >
                {{ t.name }}
              </el-tag>
              <span v-if="row.tags.length === 0" class="cell-muted text-xs">—</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="生命周期" width="100">
          <template #default="{ row }: { row: Project }">
            <el-tag size="small" :color="LIFECYCLE_COLORS[row.lifecycle]" effect="dark" class="border-0">
              {{ LIFECYCLE_LABELS[row.lifecycle] }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="Git" min-width="150">
          <template #default="{ row }: { row: Project }">
            <div v-if="row.isGit" class="git-cell">
              <span class="git-branch" :title="row.git?.branch ?? ''">
                <el-icon class="mr-1"><Cpu /></el-icon>{{ row.git?.branch ?? '—' }}
              </span>
              <span
                v-if="row.git && !row.git.clean"
                class="git-badge git-badge-dirty"
                title="有未提交修改"
              >脏</span>
              <span
                v-if="row.git && (row.git.ahead > 0 || row.git.behind > 0)"
                class="git-badge git-badge-push"
                :title="`超前 ${row.git.ahead} / 落后 ${row.git.behind}`"
              >↑{{ row.git.ahead }}↓{{ row.git.behind }}</span>
            </div>
            <span v-else class="cell-muted text-xs">非 Git</span>
          </template>
        </el-table-column>

        <el-table-column label="大小" width="100" sortable :sort-method="(a: Project, b: Project) => (a.sizeBytes ?? -1) - (b.sizeBytes ?? -1)">
          <template #default="{ row }: { row: Project }">
            <span class="cell-text text-sm">{{ formatSize(row.sizeBytes) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="最近更新" width="110">
          <template #default="{ row }: { row: Project }">
            <span class="cell-text text-xs">{{ formatTime(row.lastModifiedAt) }}</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }: { row: Project }">
            <div class="op-cell" @click.stop>
              <el-dropdown trigger="click" @command="(cmd: string) => openIde(row, cmd)">
                <el-button size="small" type="primary" plain>
                  <el-icon class="mr-1"><Cpu /></el-icon>打开 IDE
                  <el-icon class="el-icon--right"><MoreFilled /></el-icon>
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
                <el-button size="small" circle :icon="FolderOpened" @click="openFolder(row)" />
              </el-tooltip>
              <el-tooltip content="打开终端" placement="top">
                <el-button size="small" circle :icon="Promotion" @click="openTerminal(row)" />
              </el-tooltip>
              <el-tooltip content="打开远程仓库" placement="top">
                <el-button size="small" circle :icon="Link" :disabled="!row.remoteUrl" @click="openRemote(row)" />
              </el-tooltip>
              <el-tooltip content="移除项目" placement="top">
                <el-button size="small" circle type="danger" plain :icon="Delete" @click="removeProject(row)" />
              </el-tooltip>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          background
        />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.filter-search {
  width: 220px;
}
.filter-item {
  width: 150px;
}
.filter-git {
  width: 150px;
}
.filter-sort {
  width: 130px;
}
.proj-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.proj-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-clean {
  background: #00e5a0;
  box-shadow: 0 0 6px rgba(0, 229, 160, 0.8);
}
.dot-dirty {
  background: #ff5c7a;
  box-shadow: 0 0 6px rgba(255, 92, 122, 0.8);
}
.dot-none {
  background: #3a4a6a;
}
.proj-name-wrap {
  min-width: 0;
}
.proj-name {
  font-weight: 500;
  color: #e8f1ff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.proj-path {
  font-size: 11px;
  color: #4d5f82;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
}
.stack-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.stack-tag {
  margin-right: 0;
}
.tag-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tag-item {
  margin-right: 0;
  border-width: 1px;
  border-style: solid;
}
.git-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.git-branch {
  font-size: 12px;
  color: #a9bad6;
  font-family: Consolas, 'Courier New', monospace;
  display: inline-flex;
  align-items: center;
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.git-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  line-height: 1.4;
}
.git-badge-dirty {
  background: rgba(255, 92, 122, 0.15);
  color: #ff7a93;
}
.git-badge-push {
  background: rgba(255, 180, 84, 0.15);
  color: #ffb454;
}
.op-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}
.cell-text {
  color: #a9bad6;
  font-family: Consolas, 'Courier New', monospace;
}
.cell-muted {
  color: #4d5f82;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
</style>
