import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import {
  PieChart,
  BarChart,
  HeatmapChart,
  LineChart
} from 'echarts/charts'
import {
  TooltipComponent,
  LegendComponent,
  GridComponent,
  TitleComponent,
  VisualMapComponent,
  CalendarComponent
} from 'echarts/components'

import App from './App.vue'
import router from './router'
import './assets/main.css'

// 按需注册 ECharts 模块
use([
  CanvasRenderer,
  PieChart,
  BarChart,
  CalendarComponent,
  HeatmapChart,
  LineChart,
  TooltipComponent,
  LegendComponent,
  GridComponent,
  TitleComponent,
  VisualMapComponent
])

// 启用深色科幻主题
document.documentElement.classList.add('dark')

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')

// 全局错误捕获：将未处理异常转发到主进程控制台（开发期可见堆栈）
window.addEventListener('error', (e) => {
  console.error('[global-error]', e.error instanceof Error ? e.error.stack : e.message)
})
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason
  console.error('[unhandledrejection]', reason instanceof Error ? reason.stack : String(reason))
})
