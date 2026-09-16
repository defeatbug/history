<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const sidebarCollapsed = ref(false)

/** 导航分组 —— 照参考图的分组式侧栏（Operations / Clinical / Revenue） */
const navGroups = [
  {
    label: '内容',
    items: [
      { name: '概览', path: '/admin', icon: '◍', exact: true },
      { name: '课程', path: '/admin/courses', icon: '▤' },
      { name: '历史事件', path: '/admin/events', icon: '◈' },
      { name: '博物馆', path: '/admin/museums', icon: '▣' },
      { name: '文物', path: '/admin/artifacts', icon: '◐' },
      { name: '勋章', path: '/admin/badges', icon: '◇' },
    ],
  },
  {
    label: '数据',
    items: [{ name: '学习统计', path: '/admin/students', icon: '◔' }],
  },
]

const isActive = (path: string, exact = false) => {
  if (exact) return route.path === path
  return route.path === path || route.path.startsWith(path + '/')
}

const backToApp = () => router.push('/')

/** 「新建」按钮的目标随当前模块变化 */
const newTarget = computed(() => {
  if (route.path.startsWith('/admin/events')) return '/admin/events/new'
  if (route.path.startsWith('/admin/museums')) return '/admin/museums/new'
  if (route.path.startsWith('/admin/artifacts')) return '/admin/artifacts/new'
  return '/admin/courses/new'
})

const pageTitle = computed(() => {
  const flat = navGroups.flatMap((g) => g.items)
  const hit = flat.find((i) => isActive(i.path, i.exact))
  return hit?.name ?? '后台管理'
})
</script>

<template>
  <div class="min-h-screen bg-[#f7f6f4] text-[#111827]">
    <div class="flex">
      <!-- ===================== 侧栏 ===================== -->
      <aside
        :class="[
          'flex-shrink-0 flex flex-col h-screen sticky top-0 transition-all duration-200',
          sidebarCollapsed ? 'w-[68px]' : 'w-[232px]',
        ]"
      >
        <!-- 标识行 -->
        <div class="h-16 flex items-center gap-2.5 px-5">
          <div
            class="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
          >
            H
          </div>
          <span v-if="!sidebarCollapsed" class="font-semibold text-[15px] tracking-tight">
            HistoriaQuest
          </span>
          <button
            class="ml-auto text-[#9ca3af] hover:text-[#6b7280] transition-colors"
            :title="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <span class="text-lg leading-none">{{ sidebarCollapsed ? '»' : '«' }}</span>
          </button>
        </div>

        <!-- 导航 -->
        <nav class="flex-1 overflow-y-auto px-3 pb-4">
          <div v-for="group in navGroups" :key="group.label" class="mb-5">
            <p
              v-if="!sidebarCollapsed"
              class="px-3 mb-1.5 text-[11px] font-medium text-[#9ca3af] tracking-wide"
            >
              {{ group.label }}
            </p>
            <RouterLink
              v-for="item in group.items"
              :key="item.path"
              :to="item.path"
              :title="sidebarCollapsed ? item.name : undefined"
              :class="[
                'flex items-center gap-3 rounded-xl text-[13.5px] transition-colors mb-0.5',
                sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5',
                isActive(item.path, item.exact)
                  ? 'bg-amber-500 text-white font-medium shadow-sm'
                  : 'text-[#4b5563] hover:bg-black/[0.04]',
              ]"
            >
              <span class="text-base leading-none w-4 text-center flex-shrink-0">{{ item.icon }}</span>
              <span v-if="!sidebarCollapsed" class="truncate">{{ item.name }}</span>
            </RouterLink>
          </div>
        </nav>

        <!-- 底部 -->
        <div class="px-3 pb-5 space-y-0.5">
          <button
            :class="[
              'w-full flex items-center gap-3 rounded-xl text-[13.5px] text-[#4b5563] hover:bg-black/[0.04] transition-colors',
              sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5',
            ]"
            @click="backToApp"
          >
            <span class="text-base leading-none w-4 text-center">↩</span>
            <span v-if="!sidebarCollapsed">返回学习端</span>
          </button>
          <div
            :class="[
              'flex items-center gap-2.5 pt-3 mt-2 border-t border-black/[0.06]',
              sidebarCollapsed ? 'justify-center' : 'px-3',
            ]"
          >
            <div
              class="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
            >
              {{ userStore.username.slice(0, 1) }}
            </div>
            <div v-if="!sidebarCollapsed" class="min-w-0">
              <p class="text-[13px] font-medium truncate">{{ userStore.username }}</p>
              <p class="text-[11px] text-[#9ca3af]">管理员</p>
            </div>
          </div>
        </div>
      </aside>

      <!-- ===================== 主区 ===================== -->
      <div class="flex-1 min-w-0 flex flex-col">
        <!-- 顶栏 -->
        <header class="h-16 flex items-center gap-4 px-6 flex-shrink-0">
          <h1 class="text-[19px] font-semibold tracking-tight">{{ pageTitle }}</h1>

          <div class="ml-auto flex items-center gap-2">
            <!-- 搜索 -->
            <div class="relative hidden md:block">
              <input
                type="text"
                placeholder="搜索"
                class="w-[220px] h-9 pl-3 pr-14 rounded-lg bg-white border border-black/[0.07] text-[13px] placeholder:text-[#9ca3af] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
              />
              <kbd
                class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[#9ca3af] border border-black/[0.08] rounded px-1.5 py-0.5"
              >
                ⌘K
              </kbd>
            </div>

            <!-- 图标按钮 -->
            <button
              class="w-9 h-9 rounded-lg bg-white border border-black/[0.07] text-[#6b7280] hover:bg-black/[0.02] transition-colors hidden sm:flex items-center justify-center"
              title="消息"
            >
              <span class="text-sm">◔</span>
            </button>
            <button
              class="w-9 h-9 rounded-lg bg-white border border-black/[0.07] text-[#6b7280] hover:bg-black/[0.02] transition-colors hidden sm:flex items-center justify-center"
              title="通知"
            >
              <span class="text-sm">◑</span>
            </button>

            <!-- 主操作：深色胶囊 -->
            <button
              class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px] font-medium hover:bg-[#1f2937] transition-colors flex items-center gap-1.5"
              @click="router.push(newTarget)"
            >
              <span class="text-sm leading-none">＋</span>
              <span>新建</span>
            </button>
          </div>
        </header>

        <!-- 内容 -->
        <main class="flex-1 px-6 pb-8 min-w-0">
          <RouterView />
        </main>
      </div>
    </div>
  </div>
</template>
