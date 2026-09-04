<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { Monitor, FolderOpened, Setting, Refresh, Loading, DataLine, Timer } from '@element-plus/icons-vue'
import { useSettingsStore } from '@/store/settings'
import { useProjectsStore } from '@/store/projects'

const route = useRoute()
const settingsStore = useSettingsStore()
const projectsStore = useProjectsStore()

const activeMenu = computed(() => {
  if (route.path.startsWith('/projects')) return '/projects'
  return route.path
})

const pageTitle = computed(() => (route.meta.title as string) ?? '')

const scanText = computed(() => {
  const p = settingsStore.scanProgress
  if (!settingsStore.scanning) return '扫描空闲'
  if (p.total > 0 && p.current > 0) return `${p.phase} (${p.current}/${p.total})`
  return p.phase
})

const gitText = computed(() => {
  const g = projectsStore.gitProgress
  if (g.syncing && g.total > 0) return `Git 状态同步 ${g.done}/${g.total}`
  return ''
})

async function doScan() {
  await settingsStore.startScan()
}

onMounted(() => {
  void settingsStore.load()
  void settingsStore.setupProgressListener()
  void projectsStore.setupGitProgress()
  void projectsStore.setupSizeProgress()
  void projectsStore.fetchTags()
})
</script>

<template>
  <el-container class="h-full">
    <el-aside width="220px" class="app-aside">
      <div class="logo">
        <div class="logo-icon">
          <el-icon :size="16" color="#00d4ff"><Monitor /></el-icon>
        </div>
        <div>
          <div class="logo-text">CodingPilot</div>
          <div class="logo-sub">AI DEV WORKSPACE</div>
        </div>
      </div>
      <el-menu
        :default-active="activeMenu"
        router
        background-color="transparent"
        text-color="#7d90b5"
        active-text-color="#00d4ff"
        class="app-menu"
      >
        <el-menu-item index="/dashboard">
          <el-icon><Monitor /></el-icon>
          <span>仪表盘</span>
        </el-menu-item>
        <el-menu-item index="/projects">
          <el-icon><FolderOpened /></el-icon>
          <span>项目列表</span>
        </el-menu-item>
        <el-menu-item index="/usage">
          <el-icon><DataLine /></el-icon>
          <span>用量统计</span>
        </el-menu-item>
        <el-menu-item index="/workload">
          <el-icon><Timer /></el-icon>
          <span>当日工作量</span>
        </el-menu-item>
        <el-menu-item index="/settings">
          <el-icon><Setting /></el-icon>
          <span>设置</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="app-header">
        <div class="header-title">{{ pageTitle }}</div>
        <div class="header-actions">
          <el-tag v-if="gitText" type="info" size="small" effect="plain" class="mr-2">
            <el-icon class="is-loading mr-1"><Loading /></el-icon>{{ gitText }}
          </el-tag>
          <el-tag
            :type="settingsStore.scanning ? 'warning' : 'success'"
            size="small"
            effect="plain"
            class="mr-3"
          >
            <el-icon v-if="settingsStore.scanning" class="is-loading mr-1"><Loading /></el-icon>
            {{ scanText }}
          </el-tag>
          <el-button
            type="primary"
            size="small"
            :icon="Refresh"
            :loading="settingsStore.scanning"
            @click="doScan"
          >
            立即扫描
          </el-button>
        </div>
      </el-header>

      <el-main class="app-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.app-aside {
  background: linear-gradient(180deg, rgba(13, 21, 38, 0.9), rgba(9, 14, 26, 0.95));
  border-right: 1px solid rgba(0, 212, 255, 0.12);
  display: flex;
  flex-direction: column;
  user-select: none;
}
.logo {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  border-bottom: 1px solid rgba(0, 212, 255, 0.12);
  position: relative;
}
.logo::after {
  content: '';
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, rgba(0, 212, 255, 0.6), transparent);
}
.logo-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: rgba(0, 212, 255, 0.12);
  border: 1px solid rgba(0, 212, 255, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 12px rgba(0, 212, 255, 0.25);
  flex-shrink: 0;
}
.logo-text {
  color: #e8f1ff;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 2px;
  font-family: 'Segoe UI', 'PingFang SC', sans-serif;
  text-shadow: 0 0 12px rgba(0, 212, 255, 0.4);
}
.logo-sub {
  font-size: 9px;
  color: #4d5f82;
  letter-spacing: 3px;
  text-transform: uppercase;
  font-family: Consolas, monospace;
}
.app-menu {
  border-right: none;
  flex: 1;
  padding-top: 8px;
}
.app-menu :deep(.el-menu-item) {
  margin: 2px 10px;
  border-radius: 8px;
  height: 44px;
  transition: background-color 0.2s ease, color 0.2s ease;
}
.app-menu :deep(.el-menu-item.is-active) {
  background: rgba(0, 212, 255, 0.12) !important;
  box-shadow: inset 3px 0 0 #00d4ff, 0 0 16px rgba(0, 212, 255, 0.12);
}
.app-menu :deep(.el-menu-item.is-active .el-icon) {
  color: #00d4ff;
}
.app-menu :deep(.el-menu-item:hover) {
  background: rgba(0, 212, 255, 0.07) !important;
}
.app-header {
  background: rgba(10, 16, 30, 0.7);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(0, 212, 255, 0.12);
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
}
.header-title {
  font-size: 16px;
  font-weight: 600;
  color: #e8f1ff;
  letter-spacing: 1px;
}
.header-title::before {
  content: '▍';
  color: #00d4ff;
  margin-right: 8px;
  text-shadow: 0 0 8px rgba(0, 212, 255, 0.8);
}
.header-actions {
  display: flex;
  align-items: center;
}
.app-main {
  padding: 16px;
  overflow-y: auto;
}
</style>
