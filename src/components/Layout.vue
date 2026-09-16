<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import AIChat from './AIChat.vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const isMenuOpen = ref(false)
const isAIChatOpen = ref(false)

const handleLogout = () => {
  void userStore.logout()
  router.push('/login')
  isMenuOpen.value = false
}

/** 游客 → 去注册/登录 */
const handleExitGuest = () => {
  void userStore.logout()
  router.push('/login')
}

const navigation = [
  { name: '首页', path: '/', routeName: 'Home' },
  { name: '课程', path: '/lessons', routeName: 'Lessons' },
  { name: '历史学习', path: '/history-study', routeName: 'HistoryStudy' },
  { name: '学习路径', path: '/timeline', routeName: 'Timeline' },
  { name: '错题本', path: '/wrong-answers', routeName: 'WrongAnswers' },
  { name: '博物馆', path: '/museums', routeName: 'Museums' },
  { name: '好友', path: '/friends', routeName: 'Friends' },
  { name: '勋章', path: '/badges', routeName: 'Badges' },
  { name: '统计', path: '/stats', routeName: 'Stats' },
]

const isActive = (path: string, routeName?: string) => {
  // 精确匹配首页
  if (path === '/') {
    return route.path === '/'
  }
  // 对于其他路径，检查是否以该路径开头（支持子路由）
  return route.path.startsWith(path) || (routeName && route.name === routeName)
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-red-50">
    <!-- 导航栏 -->
    <nav class="bg-white/80 backdrop-blur-md shadow-lg sticky top-0 z-50">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center h-16">
          <!-- Logo -->
          <div class="flex items-center space-x-2">
            <img class="w-14 h-14" src="/images/history_logo.png" />
            <span class="text-xl font-bold text-gray-800">HistoriaQuest</span>
          </div>

          <!-- 桌面导航 -->
          <div class="hidden md:flex space-x-1">
            <router-link
              v-for="item in navigation"
              :key="item.path"
              :to="item.path"
              :class="[
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive(item.path, item.routeName)
                  ? 'bg-amber-500 text-white'
                  : 'text-gray-700 hover:bg-black/[0.04]',
              ]"
            >
              {{ item.name }}
            </router-link>
          </div>

          <!-- 用户信息 -->
          <div class="flex items-center space-x-4">
            <!-- 管理入口：仅管理员可见（真正的权限边界在数据库 RLS） -->
            <router-link
              v-if="userStore.isAdmin"
              to="/admin"
              class="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#111827] text-white text-[13px] font-medium hover:bg-[#1f2937] transition-colors"
            >
              <span class="text-xs leading-none">◧</span>
              <span>后台管理</span>
            </router-link>
            <div v-if="userStore.isLoggedIn" class="hidden sm:flex items-center space-x-2">
              <span class="text-sm text-gray-600">{{ userStore.username }}</span>
              <div
                class="w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center text-white text-sm"
              >
                {{ userStore.username.charAt(0) }}
              </div>
              <button
                @click="handleLogout"
                class="text-sm text-gray-600 hover:text-gray-800 px-2"
                title="登出"
              >
                登出
              </button>
            </div>
            <router-link
              v-else
              to="/login"
              class="hidden sm:flex items-center px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 transition-colors"
            >
              登录
            </router-link>
            <!-- 移动端菜单按钮 -->
            <button
              @click="isMenuOpen = !isMenuOpen"
              class="md:hidden p-2 rounded-lg hover:bg-gray-100"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 移动端菜单 -->
      <div v-if="isMenuOpen" class="md:hidden border-t border-gray-200 bg-white">
        <div class="px-2 pt-2 pb-3 space-y-1">
          <router-link
            v-for="item in navigation"
            :key="item.path"
            :to="item.path"
            @click="isMenuOpen = false"
            :class="[
              'block px-3 py-2 rounded-md text-base font-medium',
              isActive(item.path, item.routeName)
                ? 'bg-amber-500 text-white'
                : 'text-gray-700 hover:bg-black/[0.04]',
            ]"
          >
            {{ item.name }}
          </router-link>
          <!-- 移动端登录/登出 -->
          <div class="border-t border-gray-200 mt-2 pt-2">
            <div v-if="userStore.isLoggedIn" class="px-3 py-2 flex items-center justify-between">
              <span class="text-gray-700">{{ userStore.username }}</span>
              <button
                @click="handleLogout"
                class="text-amber-600 hover:text-amber-700 text-sm font-semibold"
              >
                登出
              </button>
            </div>
            <router-link
              v-else
              to="/login"
              @click="isMenuOpen = false"
              class="block px-3 py-2 rounded-md text-base font-medium text-amber-600 hover:bg-amber-100"
            >
              登录
            </router-link>
          </div>
        </div>
      </div>
    </nav>

    <!-- 主内容区 -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <!-- 游客模式提示条：进度不会保存 -->
      <div
        v-if="userStore.userId === 'guest'"
        class="mb-6 flex flex-col sm:flex-row sm:items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3"
      >
        <span class="text-2xl">👤</span>
        <div class="flex-1">
          <p class="text-sm font-semibold text-amber-900">你正在以游客身份浏览</p>
          <p class="text-xs text-amber-700 mt-0.5">
            学习进度不会保存，刷新页面后会重置。注册账号即可自动保存进度。
          </p>
        </div>
        <button
          @click="handleExitGuest"
          class="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 transition-colors whitespace-nowrap"
        >
          注册 / 登录
        </button>
      </div>

      <RouterView />
    </main>

    <!-- AI聊天按钮 -->
    <button
      @click="isAIChatOpen = !isAIChatOpen"
      class="fixed bottom-4 left-4 z-40 w-14 h-14 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-full shadow-2xl hover:from-amber-600 hover:to-orange-600 transition-all transform hover:scale-110 flex items-center justify-center group"
      :class="isAIChatOpen ? 'rotate-180' : ''"
      title="AI 历史助手"
    >
      <span class="text-2xl transition-transform duration-300">🤖</span>
      <div
        v-if="!isAIChatOpen"
        class="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-white animate-pulse"
      ></div>
    </button>

    <!-- AI聊天组件 -->
    <AIChat v-model:is-open="isAIChatOpen" />

    <!-- 页脚 -->
    <footer class="bg-white/50 backdrop-blur-sm border-t border-gray-200 mt-16">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <p class="text-center text-sm text-gray-600">© 2024 HistoriaQuest - 探索历史的奥秘</p>
      </div>
    </footer>
  </div>
</template>
