import { createRouter, createWebHistory } from 'vue-router'
import Layout from '@/components/Layout.vue'
import Home from '@/views/Home.vue'
import Lessons from '@/views/Lessons.vue'
import LessonDetail from '@/views/LessonDetail.vue'
import Badges from '@/views/Badges.vue'
import Timeline from '@/views/Timeline.vue'
import Stats from '@/views/Stats.vue'
import Museums from '@/views/Museums.vue'
import MuseumDetail from '@/views/MuseumDetail.vue'
import Login from '@/views/Login.vue'
import Friends from '@/views/Friends.vue'
import PK from '@/views/PK.vue'
import HistoryStudy from '@/views/HistoryStudy.vue'
import WrongAnswers from '@/views/WrongAnswers.vue'
import Review from '@/views/Review.vue'
import AdminLayout from '@/views/admin/AdminLayout.vue'
import AdminCourses from '@/views/admin/AdminCourses.vue'
import AdminCourseEdit from '@/views/admin/AdminCourseEdit.vue'
import AdminQuestions from '@/views/admin/AdminQuestions.vue'
import AdminQuestionEdit from '@/views/admin/AdminQuestionEdit.vue'
import AdminPlaceholder from '@/views/admin/AdminPlaceholder.vue'
import { useUserStore } from '@/stores/user'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: Login,
      // 唯一不需要登录的页面
      meta: { requiresAuth: false },
    },
    {
      path: '/',
      component: Layout,
      // 其余页面全部需要登录（游客模式也算已登录）
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'Home', component: Home },
        { path: 'lessons', name: 'Lessons', component: Lessons },
        { path: 'lessons/:id', name: 'LessonDetail', component: LessonDetail },
        { path: 'badges', name: 'Badges', component: Badges },
        { path: 'timeline', name: 'Timeline', component: Timeline },
        { path: 'stats', name: 'Stats', component: Stats },
        { path: 'museums', name: 'Museums', component: Museums },
        { path: 'museums/:id', name: 'MuseumDetail', component: MuseumDetail },
        { path: 'friends', name: 'Friends', component: Friends },
        { path: 'pk', name: 'PK', component: PK },
        { path: 'history-study', name: 'HistoryStudy', component: HistoryStudy },
        { path: 'wrong-answers', name: 'WrongAnswers', component: WrongAnswers },
        { path: 'review', name: 'Review', component: Review },
      ],
    },
    // 后台：独立外壳（侧边栏 + 中性骨架），与学习端明显区分
    {
      path: '/admin',
      component: AdminLayout,
      meta: { requiresAuth: true, requiresAdmin: true },
      children: [
        { path: '', name: 'AdminOverview', component: AdminPlaceholder },
        { path: 'courses', name: 'AdminCourses', component: AdminCourses },
        { path: 'courses/new', name: 'AdminCourseNew', component: AdminCourseEdit },
        { path: 'courses/:id', name: 'AdminCourseEdit', component: AdminCourseEdit },
        { path: 'courses/:id/questions', name: 'AdminQuestions', component: AdminQuestions },
        {
          path: 'courses/:id/questions/new',
          name: 'AdminQuestionNew',
          component: AdminQuestionEdit,
        },
        {
          path: 'courses/:id/questions/:questionId',
          name: 'AdminQuestionEdit',
          component: AdminQuestionEdit,
        },
        { path: 'events', name: 'AdminEvents', component: AdminPlaceholder },
        { path: 'museums', name: 'AdminMuseums', component: AdminPlaceholder },
        { path: 'artifacts', name: 'AdminArtifacts', component: AdminPlaceholder },
        { path: 'badges', name: 'AdminBadges', component: AdminPlaceholder },
        { path: 'students', name: 'AdminStudents', component: AdminPlaceholder },
      ],
    },
    // 未匹配的路径回首页（避免白屏）
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

/**
 * 全局路由守卫
 * ---------------------------------------------------------------
 * 1. 首次进入时等待认证状态初始化完成，避免误判为未登录
 * 2. 未登录访问受保护页面 → 跳登录页，并记住原目标以便登录后返回
 * 3. 已登录访问登录页 → 直接回首页
 */
router.beforeEach(async (to) => {
  // 必须在守卫内部获取 store（此时 Pinia 已安装）
  const userStore = useUserStore()

  // 等待认证初始化；幂等，不会重复执行
  await userStore.ensureInitialized()

  const requiresAuth = to.meta.requiresAuth !== false

  if (requiresAuth && !userStore.isLoggedIn) {
    // 首页不用带 redirect，其余页面记住目标路径
    const query = to.fullPath && to.fullPath !== '/' ? { redirect: to.fullPath } : undefined
    return { path: '/login', query }
  }

  // 后台仅管理员可进。注意：这只是界面层的友善拦截，
  // 真正的权限边界在数据库 RLS（非管理员即使绕过前端也读不到数据）
  if (to.meta.requiresAdmin && !userStore.isAdmin) {
    return { path: '/' }
  }

  if (to.path === '/login' && userStore.isLoggedIn) {
    return { path: '/' }
  }

  return true
})

export default router
