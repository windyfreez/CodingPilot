<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import VChart from 'vue-echarts'
import { Refresh, DataLine } from '@element-plus/icons-vue'
import StatCard from '@/components/StatCard.vue'
import type { UsageOverview, UsageSessionBrief, UsageSyncResult } from '@shared/types'
import { AGENT_TOOL_LABELS } from '@shared/types'

const loading = ref(false)
const syncing = ref(false)
const overview = ref<UsageOverview | null>(null)
const sessions = ref<UsageSessionBrief[]>([])
const lastSyncResult = ref<UsageSyncResult | null>(null)

const AXIS_TEXT = '#7d90b5'
const SPLIT_LINE = '#1a2540'
const TOOLTIP_STYLE = {
  backgroundColor: '#111b30',
  borderColor: 'rgba(0, 212, 255, 0.3)',
  textStyle: { color: '#e8f1ff' }
}
const PALETTE = ['#00d4ff', '#3b82f6', '#00e5a0', '#a78bfa', '#f472b6', '#ffb454', '#64748b', '#38bdf8', '#34d399', '#fb7185']

function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return `${n}`
}

function fmtCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  if (n > 0) return `$${n.toPrecision(2)}`
  return '$0.00'
}

function fmtTime(ts: number | null): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function loadAll() {
  loading.value = true
  try {
    const [ov, ss] = await Promise.all([window.api.usage.overview(30), window.api.usage.sessions(30)])
    if (ov.ok) overview.value = ov.data ?? null
    if (ss.ok) sessions.value = ss.data ?? []
  } finally {
    loading.value = false
  }
}

async function doSync() {
  if (syncing.value) return
  syncing.value = true
  try {
    const res = await window.api.usage.syncNow()
    if (res.ok) {
      lastSyncResult.value = res.data ?? null
      await loadAll()
    }
  } finally {
    syncing.value = false
  }
}

const trendOption = computed(() => {
  const trend = overview.value?.trend ?? []
  return {
    tooltip: {
      ...TOOLTIP_STYLE,
      trigger: 'axis',
      valueFormatter: (v: number) => fmtTokens(v)
    },
    legend: { data: ['输入', '输出', '缓存读取', '缓存写入', '推理'], textStyle: { color: AXIS_TEXT, fontSize: 12 }, top: 0 },
    grid: { left: 10, right: 10, top: 36, bottom: 10, containLabel: true },
    xAxis: { type: 'category', data: trend.map((t) => t.date), axisLabel: { color: AXIS_TEXT, fontSize: 11 }, axisLine: { lineStyle: { color: SPLIT_LINE } } },
    yAxis: {
      type: 'value',
      axisLabel: { color: AXIS_TEXT, formatter: (v: number) => fmtTokens(v) },
      splitLine: { lineStyle: { color: SPLIT_LINE } }
    },
    series: [
      { name: '输入', type: 'bar', stack: 't', barWidth: 14, itemStyle: { color: '#3b82f6' }, data: trend.map((t) => t.input) },
      { name: '输出', type: 'bar', stack: 't', itemStyle: { color: '#00d4ff' }, data: trend.map((t) => t.output) },
      { name: '缓存读取', type: 'bar', stack: 't', itemStyle: { color: '#00e5a0' }, data: trend.map((t) => t.cacheRead) },
      { name: '缓存写入', type: 'bar', stack: 't', itemStyle: { color: '#a78bfa' }, data: trend.map((t) => t.cacheWrite) },
      { name: '推理', type: 'bar', stack: 't', itemStyle: { color: '#f472b6' }, data: trend.map((t) => t.reasoning) }
    ]
  }
})

const costOption = computed(() => {
  const trend = overview.value?.trend ?? []
  return {
    tooltip: { ...TOOLTIP_STYLE, trigger: 'axis', valueFormatter: (v: number) => fmtCost(v) },
    grid: { left: 10, right: 10, top: 20, bottom: 10, containLabel: true },
    xAxis: { type: 'category', data: trend.map((t) => t.date), axisLabel: { color: AXIS_TEXT, fontSize: 11 }, axisLine: { lineStyle: { color: SPLIT_LINE } } },
    yAxis: { type: 'value', axisLabel: { color: AXIS_TEXT, formatter: (v: number) => fmtCost(v) }, splitLine: { lineStyle: { color: SPLIT_LINE } } },
    series: [
      {
        name: '消费',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        data: trend.map((t) => t.cost),
        lineStyle: { color: '#ffb454', width: 2 },
        itemStyle: { color: '#ffb454' },
        areaStyle: { color: 'rgba(255, 180, 84, 0.15)' }
      }
    ]
  }
})

function pieOption(title: string, data: { name: string; value: number }[], color: string[]) {
  return {
    tooltip: { ...TOOLTIP_STYLE, trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    color,
    series: [
      {
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '52%'],
        itemStyle: { borderRadius: 6, borderColor: '#0d1526', borderWidth: 2 },
        label: { show: true, fontSize: 11, color: AXIS_TEXT, formatter: '{b}: {d}%' },
        data
      }
    ]
  }
}

const byToolOption = computed(() => {
  const list = (overview.value?.breakdown.byTool ?? []).map((t) => ({ name: AGENT_TOOL_LABELS[t.name as keyof typeof AGENT_TOOL_LABELS] ?? t.name, value: t.value }))
  return pieOption('工具分布', list, PALETTE)
})

const byModelOption = computed(() => {
  const list = (overview.value?.breakdown.byModel ?? []).map((t) => ({ name: t.name, value: t.value }))
  return pieOption('模型分布', list, PALETTE)
})

const byProjectOption = computed(() => {
  const list = (overview.value?.breakdown.byProject ?? []).map((t) => ({ name: t.name, value: t.value }))
  return pieOption('项目分布', list, PALETTE)
})

let unsubSynced: (() => void) | null = null
onMounted(() => {
  void loadAll()
  unsubSynced = window.api.usage.onSynced((r) => {
    lastSyncResult.value = r
    void loadAll()
  })
})
onBeforeUnmount(() => {
  unsubSynced?.()
})
</script>

<template>
  <div v-loading="loading" class="usage-page">
    <div class="flex items-center justify-between mb-4">
      <div class="text-sm text-slate-400 flex items-center gap-2">
        <el-icon><DataLine /></el-icon>
        数据来自 Claude Code / Codex CLI / DeepSeek Harness 的本地会话记录，全部本地解析。
      </div>
      <div class="flex items-center gap-3">
        <span v-if="overview?.cards.lastSyncAt" class="text-xs text-slate-500">上次同步 {{ fmtTime(overview.cards.lastSyncAt) }}</span>
        <el-button type="primary" size="small" :icon="Refresh" :loading="syncing" @click="doSync">
          {{ syncing ? '同步中…' : '立即同步' }}
        </el-button>
      </div>
    </div>

    <div v-if="lastSyncResult" class="text-xs text-cyan-300/80 mb-3">
      本次同步：新增会话 {{ lastSyncResult.sessions }} · 用量记录 {{ lastSyncResult.usageRows }} · 改动记录 {{ lastSyncResult.edits }} · 关联项目 {{ lastSyncResult.linked }} · 跳过 {{ lastSyncResult.skipped }}
    </div>

    <!-- 核心指标 -->
    <div class="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
      <StatCard title="今日 Token" :value="fmtTokens(overview?.cards.todayTokens ?? 0)" icon="🔢" color="#00d4ff" :hint="`输入 ${fmtTokens(overview?.cards.todayInput ?? 0)} · 输出 ${fmtTokens(overview?.cards.todayOutput ?? 0)}`" />
      <StatCard title="今日消费" :value="fmtCost(overview?.cards.todayCost ?? 0)" icon="💰" color="#ffb454" :hint="`今日会话 ${overview?.cards.todaySessions ?? 0} 个`" />
      <StatCard title="本月 Token / 消费" :value="fmtTokens(overview?.cards.monthTokens ?? 0)" icon="📈" color="#00e5a0" :hint="`约 ${fmtCost(overview?.cards.monthCost ?? 0)}`" />
      <StatCard title="累计 Token / 消费" :value="fmtTokens(overview?.cards.totalTokens ?? 0)" icon="🗃️" color="#a78bfa" :hint="`约 ${fmtCost(overview?.cards.totalCost ?? 0)}`" />
    </div>

    <!-- 趋势 -->
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
      <el-card shadow="never" class="chart-card">
        <template #header><div class="card-title">近 30 天 Token 用量（按日堆叠）</div></template>
        <div class="chart-wrap"><v-chart :option="trendOption" autoresize /></div>
      </el-card>
      <el-card shadow="never" class="chart-card">
        <template #header><div class="card-title">近 30 天消费趋势</div></template>
        <div class="chart-wrap"><v-chart :option="costOption" autoresize /></div>
      </el-card>
    </div>

    <!-- 分布 -->
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
      <el-card shadow="never" class="chart-card">
        <template #header><div class="card-title">按工具</div></template>
        <div class="chart-wrap-sm"><v-chart :option="byToolOption" autoresize /></div>
      </el-card>
      <el-card shadow="never" class="chart-card">
        <template #header><div class="card-title">按模型</div></template>
        <div class="chart-wrap-sm"><v-chart :option="byModelOption" autoresize /></div>
      </el-card>
      <el-card shadow="never" class="chart-card">
        <template #header><div class="card-title">按项目</div></template>
        <div class="chart-wrap-sm"><v-chart :option="byProjectOption" autoresize /></div>
      </el-card>
    </div>

    <!-- 会话明细 -->
    <el-card shadow="never">
      <template #header>
        <div class="card-title">最近会话</div>
      </template>
      <el-table :data="sessions" size="small" v-loading="loading">
        <el-table-column label="时间" width="150">
          <template #default="{ row }">{{ row.startedAt ? fmtTime(row.startedAt) : '—' }}</template>
        </el-table-column>
        <el-table-column label="工具" width="150">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ AGENT_TOOL_LABELS[row.tool] ?? row.tool }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="标题 / 会话" min-width="220">
          <template #default="{ row }">
            <div class="truncate text-xs">{{ row.title || row.id }}</div>
          </template>
        </el-table-column>
        <el-table-column label="项目" width="150">
          <template #default="{ row }">{{ row.projectName || '—' }}</template>
        </el-table-column>
        <el-table-column label="模型" min-width="130">
          <template #default="{ row }">{{ row.model || '—' }}</template>
        </el-table-column>
        <el-table-column label="Token" width="110" align="right">
          <template #default="{ row }">{{ fmtTokens(row.inputTokens + row.outputTokens + row.cacheTokens) }}</template>
        </el-table-column>
        <el-table-column label="消费" width="90" align="right">
          <template #default="{ row }">{{ fmtCost(row.cost) }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.usage-page {
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
  height: 260px;
  width: 100%;
}
.chart-wrap-sm {
  height: 220px;
  width: 100%;
}
.truncate {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
