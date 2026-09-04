<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { Refresh, Plus, Delete, Timer } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import StatCard from '@/components/StatCard.vue'
import type { WorklogDayData } from '@shared/types'

const loading = ref(false)
const syncingGit = ref(false)
const date = ref(todayStr())
const data = ref<WorklogDayData | null>(null)

const CATEGORY_LABELS: Record<string, string> = {
  interface: '接口/功能',
  bugfix: '修复问题',
  doc: '文档/设计',
  custom: '自定义',
  self_lines: '自己手写行数修正'
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

async function load() {
  loading.value = true
  try {
    const res = await window.api.worklog.daily(date.value)
    if (res.ok) data.value = res.data ?? null
  } finally {
    loading.value = false
  }
}

async function syncGit() {
  if (syncingGit.value) return
  syncingGit.value = true
  try {
    const res = await window.api.worklog.syncGitNow()
    if (res.ok) ElMessage.success('Git 工作量同步已开始，完成后自动刷新')
  } finally {
    syncingGit.value = false
  }
}

async function onDateChange() {
  if (!date.value) date.value = todayStr()
  await load()
}

// ---------- 手动补录 ----------
const showManual = ref(false)
const manualForm = ref<{ date: string; projectId: number | null; category: string; title: string; value: number; note: string }>({
  date: todayStr(),
  projectId: null,
  category: 'interface',
  title: '',
  value: 1,
  note: ''
})

function openManual() {
  manualForm.value = { date: date.value, projectId: null, category: 'interface', title: '', value: 1, note: '' }
  showManual.value = true
}

async function addManual() {
  const f = manualForm.value
  if (!f.title.trim() && f.category !== 'custom') {
    ElMessage.warning('请填写说明')
    return
  }
  const res = await window.api.worklog.addManual({
    date: f.date,
    projectId: f.projectId,
    category: f.category,
    title: f.title.trim(),
    value: f.value,
    note: f.note.trim() || null
  })
  if (res.ok) {
    ElMessage.success('已记录')
    showManual.value = false
    await load()
  }
}

async function removeManual(id: number) {
  const res = await window.api.worklog.removeManual(id)
  if (res.ok) {
    ElMessage.success('已删除')
    await load()
  }
}

async function setSelfLines(projectId: number, value: string) {
  const n = parseInt(value, 10)
  if (Number.isNaN(n) || n < 0) return
  await window.api.worklog.setSelfLines(date.value, projectId, n)
  await load()
}

// ---------- 派生 ----------
const git = computed(() => data.value?.git ?? { commits: 0, filesChanged: 0, insertions: 0, deletions: 0 })
const agent = computed(() => data.value?.agent ?? { sessions: 0, edits: 0, addedLines: 0, deletedLines: 0, tokens: 0, cost: 0 })
const projects = computed(() => data.value?.projects ?? [])
const manual = computed(() => data.value?.manual ?? [])

const selfOverrideTotal = computed(() =>
  projects.value.reduce((acc, p) => acc + (p.selfLinesOverride ?? 0), 0)
)
/** 展示口径：Agent 写入 = 工具日志；未归因 = git 增行 − Agent 增行（可叠加手动修正“自己手写”） */
const selfLines = computed(() => {
  const inferred = Math.max(git.value.insertions - agent.value.addedLines, 0)
  return selfOverrideTotal.value > 0 ? selfOverrideTotal.value : inferred
})

const manualVisible = computed(() => manual.value.filter((m) => m.category !== 'self_lines'))

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return `${n}`
}

function fmtCost(n: number): string {
  if (n >= 0.01) return `$${n.toFixed(2)}`
  return n > 0 ? `$${n.toPrecision(2)}` : '$0'
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

let unsubGit: (() => void) | null = null
onMounted(() => {
  void load()
  unsubGit = window.api.worklog.onGitSynced(() => {
    ElMessage.success('Git 工作量已刷新')
    void load()
  })
})
onBeforeUnmount(() => {
  unsubGit?.()
})
</script>

<template>
  <div v-loading="loading" class="workload-page">
    <!-- 工具栏 -->
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div class="flex items-center gap-3">
        <el-icon class="text-cyan-400"><Timer /></el-icon>
        <span class="text-sm text-slate-400">工作量日期</span>
        <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" :clearable="false" @change="onDateChange" />
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs text-slate-500">git 提交按作者日期统计；Agent 行数来自工具改动日志</span>
        <el-button type="primary" size="small" :icon="Refresh" :loading="syncingGit" @click="syncGit">
          同步 Git 工作量
        </el-button>
        <el-button type="success" size="small" :icon="Plus" @click="openManual">补录工作项</el-button>
      </div>
    </div>

    <!-- 核心指标 -->
    <div class="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
      <StatCard title="提交数" :value="git.commits" icon="📌" color="#00d4ff" hint="当日全部纳管项目" />
      <StatCard title="改动文件" :value="git.filesChanged" icon="📄" color="#3b82f6" hint="按 git numstat" />
      <StatCard title="新增行数" :value="git.insertions" icon="➕" color="#00e5a0" :hint="`删除 ${git.deletions} 行`" />
      <StatCard title="Agent 写入行" :value="agent.addedLines" icon="🤖" color="#a78bfa" :hint="`编辑 ${agent.edits} 次 · 会话 ${agent.sessions}`" />
    </div>

    <!-- 归属口径：自己 vs Agent -->
    <el-card shadow="never" class="mb-4">
      <template #header>
        <div class="card-title flex items-center justify-between">
          <span>代码归属（Agent vs 自己）</span>
          <span class="text-xs text-slate-500">Agent 行=工具日志；未归因≈你自己写/后续覆盖的部分，可在表格里手动修正</span>
        </div>
      </template>
      <div class="grid grid-cols-2 xl:grid-cols-3 gap-4">
        <div class="belong-item" style="--c: #a78bfa">
          <div class="belong-label">Agent 写入（日志精确）</div>
          <div class="belong-value">{{ agent.addedLines }} 行</div>
        </div>
        <div class="belong-item" style="--c: #00e5a0">
          <div class="belong-label">git 提交增行（总量）</div>
          <div class="belong-value">{{ git.insertions }} 行</div>
        </div>
        <div class="belong-item" style="--c: #00d4ff">
          <div class="belong-label">自己手写（未归因差值 / 手动修正）</div>
          <div class="belong-value">{{ selfLines }} 行</div>
        </div>
      </div>
    </el-card>

    <!-- 项目明细 -->
    <el-card shadow="never" class="mb-4">
      <template #header>
        <div class="card-title">按项目明细（{{ projects.length }}）</div>
      </template>
      <el-table :data="projects" size="small" v-loading="loading">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="px-4 py-2">
              <div class="text-xs text-slate-500 mb-1">路径：{{ row.projectPath }}</div>
              <el-table :data="row.byAuthor" size="small">
                <el-table-column label="作者" prop="author" min-width="160" />
                <el-table-column label="提交" prop="commits" width="80" align="right" />
                <el-table-column label="文件" prop="filesChanged" width="80" align="right" />
                <el-table-column label="增行" prop="insertions" width="90" align="right" />
                <el-table-column label="删行" prop="deletions" width="90" align="right" />
                <el-table-column label="邮箱" prop="email" min-width="180" />
              </el-table>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="项目" min-width="180">
          <template #default="{ row }">{{ row.projectName }}</template>
        </el-table-column>
        <el-table-column label="提交" width="80" align="right">
          <template #default="{ row }">{{ row.commits }}</template>
        </el-table-column>
        <el-table-column label="增行" width="90" align="right">
          <template #default="{ row }">
            <span class="text-emerald-400">{{ row.insertions }}</span>
          </template>
        </el-table-column>
        <el-table-column label="删行" width="90" align="right">
          <template #default="{ row }">
            <span class="text-rose-400">{{ row.deletions }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Agent 增行" width="100" align="right">
          <template #default="{ row }">
            <span class="text-violet-400">{{ row.agentAddedLines }}</span>
          </template>
        </el-table-column>
        <el-table-column label="自己手写（修正）" width="160" align="right">
          <template #default="{ row }">
            <el-input-number
              v-model="row.selfLinesOverride"
              :min="0"
              :controls="false"
              size="small"
              placeholder="估算"
              @change="(v: number | undefined) => setSelfLines(row.projectId, v === undefined ? '0' : String(v))"
            />
          </template>
        </el-table-column>
      </el-table>
      <div class="text-xs text-slate-600 mt-2">提示：若不填“自己手写”，默认用 git 增行 − Agent 增行 的差值估算。</div>
    </el-card>

    <!-- 手动补录 -->
    <el-card shadow="never">
      <template #header>
        <div class="card-title">手动补录（{{ manualVisible.length }}）</div>
      </template>
      <el-empty v-if="manualVisible.length === 0" description="暂无补录条目" :image-size="60" />
      <div v-else class="manual-list">
        <div v-for="m in manualVisible" :key="m.id" class="manual-item">
          <div class="manual-main">
            <span class="manual-tag">{{ CATEGORY_LABELS[m.category] ?? m.category }}</span>
            <span class="manual-title">{{ m.title || '（无标题）' }}</span>
            <span class="manual-count">×{{ m.value }}</span>
            <span v-if="m.note" class="manual-note">{{ m.note }}</span>
            <span class="manual-time">{{ fmtTime(m.createdAt) }}</span>
          </div>
          <el-button size="small" type="danger" text :icon="Delete" @click="removeManual(m.id)" />
        </div>
      </div>
    </el-card>

    <!-- 补录对话框 -->
    <el-dialog v-model="showManual" title="补录工作项" width="480px">
      <el-form label-position="top">
        <el-form-item label="类型">
          <el-select v-model="manualForm.category" class="w-full">
            <el-option v-for="(label, key) in CATEGORY_LABELS" :key="key" :label="label" :value="key" />
          </el-select>
        </el-form-item>
        <el-form-item label="说明（接口/任务/问题等）">
          <el-input v-model="manualForm.title" placeholder="例如：完成用户登录接口联调" />
        </el-form-item>
        <el-form-item label="数量 / 次数">
          <el-input-number v-model="manualForm.value" :min="1" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="manualForm.note" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showManual = false">取消</el-button>
        <el-button type="primary" @click="addManual">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.workload-page {
  min-height: 100%;
}
.card-title {
  font-size: 15px;
  font-weight: 600;
  color: #e8f1ff;
  letter-spacing: 0.5px;
}
.belong-item {
  background: rgba(13, 21, 38, 0.75);
  border: 1px solid rgba(0, 212, 255, 0.12);
  border-left: 3px solid var(--c);
  border-radius: 8px;
  padding: 14px 18px;
}
.belong-label {
  font-size: 12px;
  color: #7d90b5;
  margin-bottom: 6px;
}
.belong-value {
  font-size: 20px;
  font-weight: 700;
  color: #e8f1ff;
  font-family: Consolas, 'Courier New', monospace;
}
.manual-list {
  max-height: 320px;
  overflow-y: auto;
}
.manual-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  transition: background-color 0.2s ease, border-color 0.2s ease;
}
.manual-item:hover {
  background: rgba(0, 212, 255, 0.05);
  border-color: rgba(0, 212, 255, 0.15);
}
.manual-main {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.manual-tag {
  font-size: 11px;
  color: #00d4ff;
  border: 1px solid rgba(0, 212, 255, 0.35);
  border-radius: 4px;
  padding: 1px 6px;
  flex-shrink: 0;
}
.manual-title {
  font-size: 13px;
  color: #c9d8ee;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.manual-count {
  font-size: 13px;
  color: #ffb454;
  font-family: Consolas, monospace;
  flex-shrink: 0;
}
.manual-note {
  font-size: 12px;
  color: #64748b;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.manual-time {
  font-size: 11px;
  color: #4d5f82;
  flex-shrink: 0;
}
</style>
