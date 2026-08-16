<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import type { HeatmapPoint } from '@shared/types'

const props = defineProps<{
  points: HeatmapPoint[]
  days?: number
}>()

const today = new Date()
const days = computed(() => props.days ?? 365)

const startDate = computed(() => {
  const d = new Date(today)
  d.setDate(d.getDate() - (days.value - 1))
  return d
})

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const maxCount = computed(() => {
  let max = 0
  for (const p of props.points) if (p.count > max) max = p.count
  return max
})

const countMap = computed(() => {
  const m = new Map<string, number>()
  for (const p of props.points) m.set(p.date, p.count)
  return m
})

const option = computed(() => {
  const end = formatDate(today)
  const start = formatDate(startDate.value)
  const data: [string, number][] = []
  const cur = new Date(startDate.value)
  while (cur <= today) {
    const ds = formatDate(cur)
    data.push([ds, countMap.value.get(ds) ?? 0])
    cur.setDate(cur.getDate() + 1)
  }
  return {
    tooltip: {
      backgroundColor: '#111b30',
      borderColor: 'rgba(0, 212, 255, 0.3)',
      textStyle: { color: '#e8f1ff' },
      formatter: (params: { value: [string, number] }) => {
        const [date, count] = params.value
        return `${date}<br/>提交次数：<b>${count}</b>`
      }
    },
    visualMap: {
      min: 0,
      max: Math.max(maxCount.value, 1),
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      top: 0,
      textStyle: { color: '#7d90b5', fontSize: 11 },
      inRange: {
        color: ['#0d1526', '#0e3a52', '#0e7490', '#06b6d4', '#22e0ff']
      },
      show: false
    },
    calendar: {
      range: [start, end],
      cellSize: ['auto', 14],
      top: 30,
      left: 30,
      right: 10,
      itemStyle: {
        color: '#0d1526',
        borderWidth: 2,
        borderColor: '#0a101f'
      },
      splitLine: { show: false },
      yearLabel: { show: false },
      dayLabel: {
        firstDay: 1,
        nameMap: ['日', '一', '二', '三', '四', '五', '六'],
        color: '#5a6b8c',
        fontSize: 11
      },
      monthLabel: {
        nameMap: 'CN',
        color: '#5a6b8c',
        fontSize: 11
      }
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data,
        emphasis: {
          itemStyle: {
            shadowBlur: 8,
            shadowColor: 'rgba(0, 212, 255, 0.5)'
          }
        }
      }
    ]
  }
})
</script>

<template>
  <v-chart :option="option" autoresize style="height: 100%; width: 100%" />
</template>
