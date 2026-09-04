import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('@/views/Dashboard.vue'),
      meta: { title: '仪表盘' }
    },
    {
      path: '/projects',
      name: 'projects',
      component: () => import('@/views/Projects.vue'),
      meta: { title: '项目列表' }
    },
    {
      path: '/projects/:id',
      name: 'project-detail',
      component: () => import('@/views/ProjectDetail.vue'),
      meta: { title: '项目详情' }
    },
    {
      path: '/usage',
      name: 'usage',
      component: () => import('@/views/Usage.vue'),
      meta: { title: '用量统计' }
    },
    {
      path: '/workload',
      name: 'workload',
      component: () => import('@/views/Workload.vue'),
      meta: { title: '当日工作量' }
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/Settings.vue'),
      meta: { title: '设置' }
    }
  ]
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} - CodingPilot` : 'CodingPilot'
})

export default router
