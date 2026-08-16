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
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/Settings.vue'),
      meta: { title: '设置' }
    }
  ]
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} - 本地项目管理系统` : '本地项目管理系统'
})

export default router
