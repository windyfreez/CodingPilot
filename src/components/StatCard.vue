<script setup lang="ts">
defineProps<{
  title: string
  value: string | number
  suffix?: string
  icon?: string
  color?: string
  hint?: string
}>()
</script>

<template>
  <div class="stat-card">
    <div class="stat-icon" :style="{ backgroundColor: (color ?? '#00d4ff') + '1f', color: color ?? '#00d4ff' }">
      <span class="text-xl">{{ icon ?? '📊' }}</span>
    </div>
    <div class="stat-info">
      <div class="stat-title">{{ title }}</div>
      <div class="stat-value" :style="{ textShadow: `0 0 18px ${(color ?? '#00d4ff')}66` }">
        {{ value }}
        <span v-if="suffix" class="stat-suffix">{{ suffix }}</span>
      </div>
      <div v-if="hint" class="stat-hint">{{ hint }}</div>
    </div>
  </div>
</template>

<style scoped>
.stat-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: rgba(13, 21, 38, 0.75);
  border: 1px solid rgba(0, 212, 255, 0.12);
  border-radius: 10px;
  padding: 18px 20px;
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
  transition: transform 0.15s ease, border-color 0.25s ease, box-shadow 0.25s ease;
  position: relative;
  overflow: hidden;
}
.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, rgba(0, 212, 255, 0.5), transparent 60%);
}
.stat-card:hover {
  transform: translateY(-2px);
  border-color: rgba(0, 212, 255, 0.35);
  box-shadow: 0 6px 28px rgba(0, 212, 255, 0.1), 0 10px 30px rgba(0, 0, 0, 0.45);
}
.stat-icon {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid currentColor;
}
.stat-info {
  min-width: 0;
}
.stat-title {
  font-size: 12px;
  color: #7d90b5;
  letter-spacing: 1px;
  margin-bottom: 4px;
  text-transform: uppercase;
}
.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: #e8f1ff;
  line-height: 1.2;
  font-family: 'Segoe UI', Consolas, 'Courier New', 'PingFang SC', monospace;
  letter-spacing: 0.5px;
}
.stat-suffix {
  font-size: 13px;
  font-weight: 400;
  color: #7d90b5;
  margin-left: 2px;
}
.stat-hint {
  font-size: 12px;
  color: #4d5f82;
  margin-top: 2px;
}
</style>
