<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import VChart from 'vue-echarts'
import { useRouter } from 'vue-router'
import { Refresh, Loading } from '@element-plus/icons-vue'
import StatCard from '@/components/StatCard.vue'
import HeatmapChart from '@/components/HeatmapChart.vue'
import type { DiskUsageItem, HealthStats, HeatmapPoint, NameValue, StatsSummary } from '@shared/types'
import { LIFECYCLE_LABELS, LIFECYCLE_COLORS, TYPE_LABELS } from '@shared/types'
import { useProjectsStore } from '@/store/projects'

const router = useRouter()
const projectsStore = useProjectsStore()

const summary = ref<StatsSummary | null>(null)
const techStack = ref<NameValue[]>([])
const frameworks = ref<NameValue[]>([])
const health = ref<HealthStats | null>(null)
const diskUsage = ref<DiskUsageItem[]>([])
const heatmap = ref<HeatmapPoint[]>([])
const loading = ref(false)

const TYPE_COLORS: Record<string, string> = {
  'Node.js': '#00e5a0',
  Java: '#ff8a5c',
  Python: '#6ea8ff',
  Go: '#22d3ee',
  Rust: '#ffb454',
  其他: '#64748b'
}

// 科幻霓虹色板
const PIE_COLORS = ['#00d4ff', '#3b82f6', '#00e5a0', '#a78bfa', '#f472b6', '#64748b']

const AXIS_TEXT = '#7d90b5'
const SPLIT_LINE = '#1a2540'
const TOOLTIP_STYLE = {
  backgroundColor: '#111b30',
  borderColor: 'rgba(0, 212, 255, 0.3)',
  textStyle: { color: '#e8f1ff' }
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const totalSizeText = computed(() => formatSize(summary.value?.totalSizeBytes ?? null))

const techOption = computed(() => ({
  tooltip: { ...TOOLTIP_STYLE, trigger: 'item', formatter: '{b}: {c} 个 ({d}%)' },
  legend: {
    orient: 'vertical',
    right: 10,
    top: 'center',
    textStyle: { fontSize: 12, color: AXIS_TEXT }
  },
  color: PIE_COLORS,
  series: [
    {
      name: '技术栈分布',
      type: 'pie',
      radius: ['45%', '72%'],
      center: ['38%', '50%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: '#0d1526', borderWidth: 2 },
      label: { show: false },
      emphasis: {
        label: { show: true, fontSize: 16, fontWeight: 'bold', color: '#e8f1ff' },
        itemStyle: { shadowBlur: 16, shadowColor: 'rgba(0, 212, 255, 0.4)' }
      },
      data: techStack.value.map((t) => ({ name: t.name, value: t.value }))
    }
  ]
}))

const frameworkOption = computed(() => ({
  tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0,212,255,0.05)' } } },
  grid: { left: 10, right: 30, top: 10, bottom: 10, containLabel: true },
  xAxis: {
    type: 'value',
    minInterval: 1,
    axisLabel: { color: AXIS_TEXT },
    splitLine: { lineStyle: { color: SPLIT_LINE } }
  },
  yAxis: {
    type: 'category',
    inverse: true,
    data: frameworks.value.map((f) => f.name),
    axisLabel: { color: AXIS_TEXT, fontSize: 11 },
    axisLine: { lineStyle: { color: SPLIT_LINE } }
  },
  series: [
    {
      type: 'bar',
      data: frameworks.value.map((f) => f.value),
      barWidth: 14,
      itemStyle: { color: '#00d4ff', borderRadius: [0, 7, 7, 0], shadowBlur: 8, shadowColor: 'rgba(0, 212, 255, 0.35)' },
      label: { show: true, position: 'right', color: '#5a6b8c', fontSize: 11 }
    }
  ]
}))

const healthOption = computed(() => ({
  tooltip: { ...TOOLTIP_STYLE, trigger: 'axis' },
  legend: { data: ['生命周期分布', 'Git 状态'], textStyle: { fontSize: 12, color: AXIS_TEXT } },
  grid: { left: 10, right: 20, top: 36, bottom: 10, containLabel: true },
  xAxis: {
    type: 'category',
    data: ['开发中', '维护中', '已上线', '已归档', '干净', '有未提交', '非Git'],
    axisLabel: { color: AXIS_TEXT, fontSize: 11, interval: 0 },
    axisLine: { lineStyle: { color: SPLIT_LINE } }
  },
  yAxis: {
    type: 'value',
    minInterval: 1,
    axisLabel: { color: AXIS_TEXT },
    splitLine: { lineStyle: { color: SPLIT_LINE } }
  },
  series: [
    {
      name: '生命周期分布',
      type: 'bar',
      barWidth: 22,
      data: (health.value?.lifecycle ?? []).map((h, i) => ({
        value: h.value,
        itemStyle: { color: LIFECYCLE_COLORS[h.name as keyof typeof LIFECYCLE_COLORS] ?? PIE_COLORS[i], borderRadius: [4, 4, 0, 0] }
      })),
      label: { show: true, position: 'top', color: '#5a6b8c', fontSize: 11 }
    },
    {
      name: 'Git 状态',
      type: 'bar',
      barWidth: 22,
      data: (health.value?.gitState ?? []).map((h) => ({
        value: h.value,
        itemStyle: {
          color: h.name === '干净' ? '#00e5a0' : h.name === '有未提交修改' ? '#ff5c7a' : '#64748b',
          borderRadius: [4, 4, 0, 0]
        }
      })),
      label: { show: true, position: 'top', color: '#5a6b8c', fontSize: 11 }
    }
  ]
}))

function diskBarColor(index: number): string {
  const colors = ['#ff5c7a', '#ffb454', '#00d4ff', '#00e5a0', '#a78bfa']
  return colors[Math.min(index, colors.length - 1)]
}

async function loadAll() {
  await Promise.all([loadSummary(), loadHeatmapOnly()])
}

async function loadSummary() {
  loading.value = true
  try {
    const [s, ts, fw, h, du] = await Promise.all([
      window.api.stats.summary(),
      window.api.stats.techStack(),
      window.api.stats.frameworks(),
      window.api.stats.health(),
      window.api.stats.diskUsage(10)
    ])
    if (s.ok) summary.value = s.data ?? null
    if (ts.ok) techStack.value = ts.data ?? []
    if (fw.ok) frameworks.value = fw.data ?? []
    if (h.ok) health.value = h.data ?? null
    if (du.ok) diskUsage.value = du.data ?? []
  } finally {
    loading.value = false
  }
}

async function loadHeatmapOnly() {
  const hm = await window.api.stats.heatmap(365)
  if (hm.ok) heatmap.value = hm.data ?? []
}

async function refreshHeatmap() {
  // 强制重新拉取所有仓库的提交历史（无视 6h 缓存）
  await window.api.stats.refreshHeatmap(true)
}

async function recomputeSizes() {
  await projectsStore.computeSizes()
}

// Git 状态同步完成后刷新统计数据（活跃项目、健康度等依赖 Git 同步结果；不触发热力图，避免循环）
watch(
  () => projectsStore.gitProgress.syncing,
  (syncing) => {
    if (!syncing) void loadSummary()
  }
)

let heatmapUnsub: (() => void) | null = null
onMounted(() => {
  void loadAll()
  heatmapUnsub = window.api.on('heatmap:ready', () => {
    void loadHeatmapOnly()
  })
})

onBeforeUnmount(() => {
  heatmapUnsub?.()
})
</script>

<template>
  <div v-loading="loading" class="dashboard">
    <!-- 核心指标卡片 -->
    <div class="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
      <StatCard title="项目总数" :value="summary?.total ?? 0" icon="📁" color="#409EFF" hint="本地纳管项目总量" />
      <StatCard title="活跃项目" :value="summary?.active30d ?? 0" icon="🔥" color="#67C23A" hint="最近 30 天有提交或打开记录" />
      <StatCard
        title="总占用空间"
        :value="totalSizeText"
        icon="💾"
        color="#E6A23C"
        hint="不含 .git 等系统目录"
      />
      <StatCard title="远程关联率" :value="summary?.remoteRate ?? 0" suffix="%" icon="🌐" color="#F56C6C" hint="关联 GitHub/Gitee 等项目占比" />
    </div>

    <!-- 图表区 -->
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
      <el-card shadow="never" class="chart-card">
        <template #header>
          <div class="card-title">技术栈分布</div>
        </template>
        <div class="chart-wrap">
          <v-chart :option="techOption" autoresize />
        </div>
      </el-card>

      <el-card shadow="never" class="chart-card">
        <template #header>
          <div class="card-title">框架 / 技术细分</div>
        </template>
        <div class="chart-wrap">
          <v-chart :option="frameworkOption" autoresize />
        </div>
      </el-card>
    </div>

    <!-- 提交热力图 -->
    <el-card shadow="never" class="mb-4">
      <template #header>
        <div class="card-title flex items-center justify-between">
          <span>开发活跃度（近 365 天提交热力图）</span>
          <el-button
            size="small"
            text
            type="primary"
            :icon="Refresh"
            :loading="projectsStore.gitSyncing"
            @click="refreshHeatmap"
          >
            {{ projectsStore.gitSyncing && projectsStore.gitProgress.total > 0
              ? `同步中 ${projectsStore.gitProgress.done}/${projectsStore.gitProgress.total}`
              : '刷新' }}
          </el-button>
        </div>
      </template>
      <div class="heatmap-wrap">
        <HeatmapChart :points="heatmap" :days="365" />
      </div>
    </el-card>

    <!-- 健康度 + 空间排行 -->
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <el-card shadow="never" class="chart-card">
        <template #header>
          <div class="card-title">项目健康度</div>
        </template>
        <div class="chart-wrap">
          <v-chart :option="healthOption" autoresize />
        </div>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div class="card-title flex items-center justify-between">
            <span>空间大户排行榜（Top 10）</span>
            <el-button
              size="small"
              text
              type="primary"
              :icon="Refresh"
              :loading="projectsStore.sizeComputing"
              @click="recomputeSizes"
            >
              {{ projectsStore.sizeComputing ? `计算中 ${projectsStore.sizeProgress.done}/${projectsStore.sizeProgress.total}` : '重新计算空间' }}
            </el-button>
          </div>
        </template>
        <div v-loading="projectsStore.sizeComputing" class="disk-list">
          <div v-if="diskUsage.length === 0" class="text-center text-sm py-8 disk-empty">
            暂无空间数据，点击右上角"重新计算空间"
          </div>
          <div
            v-for="(item, index) in diskUsage"
            :key="item.projectId"
            class="disk-item"
            @click="router.push(`/projects/${item.projectId}`)"
          >
            <span class="disk-rank" :style="{ backgroundColor: diskBarColor(index) }">{{ index + 1 }}</span>
            <div class="disk-info">
              <div class="disk-name">{{ item.name }}</div>
              <div class="disk-path">{{ item.path }}</div>
            </div>
            <div class="disk-size">{{ formatSize(item.sizeBytes) }}</div>
            <div class="disk-bar">
              <div
                class="disk-bar-fill"
                :style="{
                  width: `${diskUsage.length ? Math.max((item.sizeBytes / (diskUsage[0]?.sizeBytes || 1)) * 100, 2) : 0}%`,
                  backgroundColor: diskBarColor(index)
                }"
              />
            </div>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  min-height: 100%;
}
.card-title {
  font-size: 15px;
  font-weight: 600;
  color: #e8f1ff;
  letter-spacing: 0.5px;
}
.chart-card :deep(.el-card__body) {
  padding: 10px 12px;
}
.chart-wrap {
  height: 300px;
  width: 100%;
}
.heatmap-wrap {
  height: 210px;
  width: 100%;
}
.disk-list {
  min-height: 120px;
  max-height: 330px;
  overflow-y: auto;
}
.disk-empty {
  color: #4d5f82;
}
.disk-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 6px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}
.disk-item:hover {
  background: rgba(0, 212, 255, 0.06);
}
.disk-rank {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: #04121c;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-weight: 700;
  font-family: Consolas, monospace;
}
.disk-info {
  flex: 1;
  min-width: 0;
}
.disk-name {
  font-size: 13px;
  font-weight: 500;
  color: #c9d8ee;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.disk-path {
  font-size: 11px;
  color: #4d5f82;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.disk-size {
  font-size: 13px;
  font-weight: 600;
  color: #a9bad6;
  flex-shrink: 0;
  font-family: Consolas, 'Courier New', monospace;
}
.disk-bar {
  width: 80px;
  height: 6px;
  background: rgba(0, 212, 255, 0.08);
  border-radius: 3px;
  flex-shrink: 0;
  overflow: hidden;
}
.disk-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
  box-shadow: 0 0 8px currentColor;
}
</style>
