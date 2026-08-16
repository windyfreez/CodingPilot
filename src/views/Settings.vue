<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Plus, Delete, FolderOpened, Refresh, Monitor } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useSettingsStore } from '@/store/settings'
import { useProjectsStore } from '@/store/projects'
import type { ScanLog } from '@shared/types'
import { IDE_LIST } from '@shared/types'

const settingsStore = useSettingsStore()
const projectsStore = useProjectsStore()

const scanLogs = ref<ScanLog[]>([])
const loadingLogs = ref(false)

async function addRoot() {
  const path = await window.api.dialog.selectDirectory()
  if (!path) return
  if (settingsStore.settings.scanRoots.includes(path)) {
    ElMessage.warning('该目录已在列表中')
    return
  }
  const res = await settingsStore.update({
    scanRoots: [...settingsStore.settings.scanRoots, path]
  })
  if (res.ok) ElMessage.success('已添加扫描根目录')
}

async function removeRoot(path: string) {
  const res = await settingsStore.update({
    scanRoots: settingsStore.settings.scanRoots.filter((r) => r !== path)
  })
  if (res.ok) ElMessage.success('已移除')
}

async function loadLogs() {
  loadingLogs.value = true
  try {
    const res = await window.api.scan.logs()
    if (res.ok) scanLogs.value = res.data ?? []
  } finally {
    loadingLogs.value = false
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function duration(start: number, end: number | null): string {
  if (!end) return '—'
  const s = Math.max(Math.round((end - start) / 1000), 0)
  return `${s}s`
}

onMounted(() => {
  void settingsStore.load()
  void loadLogs()
})
</script>

<template>
  <div class="settings-page">
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <!-- 扫描根目录 -->
      <el-card shadow="never">
        <template #header>
          <div class="card-title">📂 扫描根目录</div>
        </template>
        <div class="mb-3 text-sm text-slate-400">
          系统将递归扫描以下目录，通过特征文件（package.json、pom.xml、go.mod 等）自动识别项目。
        </div>
        <div class="root-list">
          <div v-for="root in settingsStore.settings.scanRoots" :key="root" class="root-item">
            <el-icon class="text-blue-500 mr-2"><FolderOpened /></el-icon>
            <span class="root-path">{{ root }}</span>
            <el-button size="small" type="danger" text :icon="Delete" @click="removeRoot(root)" />
          </div>
          <div v-if="settingsStore.settings.scanRoots.length === 0" class="text-slate-500 text-sm py-6 text-center">
            尚未添加扫描根目录
          </div>
        </div>
        <div class="flex gap-3 mt-3">
          <el-button type="primary" :icon="Plus" @click="addRoot">添加根目录</el-button>
          <el-button
            type="success"
            :icon="Refresh"
            :loading="settingsStore.scanning"
            @click="settingsStore.startScan()"
          >
            {{ settingsStore.scanning ? `扫描中 ${settingsStore.scanProgress.current}/${settingsStore.scanProgress.total}` : '立即扫描' }}
          </el-button>
        </div>
      </el-card>

      <!-- 通用设置 -->
      <el-card shadow="never">
        <template #header>
          <div class="card-title">⚙️ 通用设置</div>
        </template>
        <el-form label-position="top">
          <el-form-item label="默认 IDE（项目无单独配置时使用）">
            <el-select v-model="settingsStore.settings.defaultIde" class="w-full" @change="settingsStore.update({ defaultIde: settingsStore.settings.defaultIde })">
              <el-option v-for="i in IDE_LIST" :key="i.id" :label="`${i.name} (${i.command})`" :value="i.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="默认服务启动命令（如 npm run dev，留空则自动推断）">
            <el-input
              v-model="settingsStore.settings.defaultScript"
              placeholder="npm run dev"
              @blur="settingsStore.update({ defaultScript: settingsStore.settings.defaultScript })"
            />
          </el-form-item>
          <el-form-item label="自动扫描">
            <div class="flex items-center gap-4">
              <el-switch
                v-model="settingsStore.settings.autoScanEnabled"
                @change="settingsStore.update({ autoScanEnabled: settingsStore.settings.autoScanEnabled })"
              />
              <span class="text-sm text-slate-400">开启后应用启动时自动扫描，并定时刷新</span>
            </div>
          </el-form-item>
          <el-form-item label="自动扫描间隔（分钟）">
            <el-input-number
              v-model="settingsStore.settings.scanIntervalMinutes"
              :min="1"
              :max="1440"
              @change="settingsStore.update({ scanIntervalMinutes: settingsStore.settings.scanIntervalMinutes })"
            />
          </el-form-item>
        </el-form>
        <div class="text-xs text-slate-500">
          <el-icon class="mr-1"><Monitor /></el-icon>
          数据全部存储在本地 SQLite 数据库中，不会上传任何路径与代码。
        </div>
      </el-card>

      <!-- 扫描日志 -->
      <el-card shadow="never" class="xl:col-span-2">
        <template #header>
          <div class="card-title flex items-center justify-between">
            <span>📋 扫描日志</span>
            <el-button size="small" text type="primary" :icon="Refresh" @click="loadLogs">刷新</el-button>
          </div>
        </template>
        <el-table v-loading="loadingLogs" :data="scanLogs" size="small">
          <el-table-column label="开始时间" width="170">
            <template #default="{ row }">{{ formatTime(row.startedAt) }}</template>
          </el-table-column>
          <el-table-column label="耗时" width="80">
            <template #default="{ row }">{{ duration(row.startedAt, row.finishedAt) }}</template>
          </el-table-column>
          <el-table-column label="扫描根目录" min-width="200">
            <template #default="{ row }">
              <span class="text-xs text-slate-400">{{ (row.roots ?? []).join('、') || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="发现项目" width="90">
            <template #default="{ row }">{{ row.found }}</template>
          </el-table-column>
          <el-table-column label="新增" width="70">
            <template #default="{ row }">{{ row.newProjects }}</template>
          </el-table-column>
          <el-table-column label="结果" min-width="140">
            <template #default="{ row }">
              <el-tag v-if="row.error" type="danger" size="small">{{ row.error }}</el-tag>
              <el-tag v-else type="success" size="small">成功</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.card-title {
  font-size: 15px;
  font-weight: 600;
  color: #e8f1ff;
  letter-spacing: 0.5px;
}
.root-list {
  max-height: 300px;
  overflow-y: auto;
}
.root-item {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  border-radius: 6px;
  margin-bottom: 4px;
  border: 1px solid transparent;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}
.root-item:hover {
  background: rgba(0, 212, 255, 0.06);
  border-color: rgba(0, 212, 255, 0.15);
}
.root-path {
  flex: 1;
  font-size: 13px;
  color: #a9bad6;
  word-break: break-all;
  font-family: Consolas, 'Courier New', monospace;
}
</style>
