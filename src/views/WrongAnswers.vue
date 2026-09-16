<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useReviewStore } from '@/stores/review'
import { useUserStore } from '@/stores/user'
import { formatRelativeTime, masteryLabel } from '@/utils/format'
import type { WrongAnswerItem } from '@/services/review'

const router = useRouter()
const reviewStore = useReviewStore()
const userStore = useUserStore()

type FilterKey = 'all' | 'due' | 'mastered'

const activeFilter = ref<FilterKey>('all')

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部错题' },
  { key: 'due', label: '待复习' },
  { key: 'mastered', label: '已掌握' },
]

const filtered = computed<WrongAnswerItem[]>(() => {
  const list = reviewStore.wrongAnswers
  switch (activeFilter.value) {
    case 'due':
      return list.filter((i) => i.isDue)
    case 'mastered':
      return list.filter((i) => i.mastery >= 1)
    default:
      return list
  }
})

const startReview = (mode: 'due' | 'wrong' | 'all') => {
  router.push({ path: '/review', query: { mode } })
}

/** 用户选的错误项文本 */
const userAnswerText = (item: WrongAnswerItem): string => {
  if (item.userAnswer === null || item.userAnswer === undefined) return '未作答'
  return item.options[item.userAnswer] ?? `选项 ${item.userAnswer + 1}`
}

const correctAnswerText = (item: WrongAnswerItem): string => {
  return item.options[item.answer] ?? `选项 ${item.answer + 1}`
}

onMounted(() => {
  void reviewStore.refresh()
})
</script>

<template>
  <div class="space-y-8">
    <!-- 标题 -->
    <div class="text-center space-y-4">
      <h1
        class="text-4xl md:text-5xl font-bold bg-gradient-to-r from-amber-600 via-orange-500 to-red-500 bg-clip-text text-transparent"
      >
        错题本
      </h1>
      <p class="text-lg text-gray-600">
        基于
        <span class="font-semibold text-amber-600">SM-2 间隔重复算法</span>
        为你安排复习计划
      </p>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="bg-white rounded-2xl shadow-lg p-5 border border-gray-100">
        <p class="text-sm text-gray-500 mb-1">错题总数</p>
        <p class="text-3xl font-bold text-gray-800">{{ reviewStore.stats.totalWrong }}</p>
      </div>
      <div class="bg-white rounded-2xl shadow-lg p-5 border border-gray-100">
        <p class="text-sm text-gray-500 mb-1">待复习</p>
        <p class="text-3xl font-bold text-red-500">{{ reviewStore.stats.dueCount }}</p>
      </div>
      <div class="bg-white rounded-2xl shadow-lg p-5 border border-gray-100">
        <p class="text-sm text-gray-500 mb-1">已掌握</p>
        <p class="text-3xl font-bold text-green-500">{{ reviewStore.stats.masteredCount }}</p>
      </div>
      <div class="bg-white rounded-2xl shadow-lg p-5 border border-gray-100">
        <p class="text-sm text-gray-500 mb-1">平均难度系数</p>
        <p class="text-3xl font-bold text-amber-600">
          {{ reviewStore.stats.averageEaseFactor || '—' }}
        </p>
      </div>
    </div>

    <!-- 开始复习：有错题就显示（已到期的优先提示） -->
    <div
      v-if="reviewStore.wrongAnswers.length > 0"
      class="relative overflow-hidden bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl shadow-xl p-6 md:p-8"
    >
      <div class="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full"></div>
      <div class="relative flex flex-col md:flex-row md:items-center gap-5">
        <div class="text-5xl">{{ reviewStore.stats.dueCount > 0 ? '🔁' : '💪' }}</div>
        <div class="flex-1">
          <!-- 已到期：优先提示遗忘临界点 -->
          <template v-if="reviewStore.stats.dueCount > 0">
            <h3 class="text-xl md:text-2xl font-bold text-white">
              有 {{ reviewStore.stats.dueCount }} 道题该复习了
            </h3>
            <p class="text-amber-50 text-sm mt-1">
              按 SM-2 算法，这几道题的遗忘临界点已到，现在复习效果最好
            </p>
          </template>
          <!-- 未到期但存在错题：引导立即巩固 -->
          <template v-else>
            <h3 class="text-xl md:text-2xl font-bold text-white">
              有 {{ reviewStore.wrongAnswers.length }} 道错题待巩固
            </h3>
            <p class="text-amber-50 text-sm mt-1">
              按 SM-2 算法这些题还没到计划复习时间，但你可以随时提前巩固
            </p>
          </template>
        </div>
        <button
          @click="startReview(reviewStore.stats.dueCount > 0 ? 'due' : 'wrong')"
          class="px-8 py-4 bg-white text-amber-600 rounded-xl font-bold hover:bg-amber-50 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 whitespace-nowrap"
        >
          开始复习 →
        </button>
      </div>
    </div>

    <!-- 筛选 -->
    <div v-if="!reviewStore.isEmpty" class="flex justify-center">
      <div class="inline-flex bg-white rounded-lg p-1 shadow-lg">
        <button
          v-for="f in filters"
          :key="f.key"
          @click="activeFilter = f.key"
          :class="[
            'px-5 py-2 rounded-md font-semibold transition-all text-sm',
            activeFilter === f.key
              ? 'bg-amber-500 text-white shadow-md'
              : 'text-gray-600 hover:text-gray-800',
          ]"
        >
          {{ f.label }}
        </button>
      </div>
    </div>

    <!-- 加载中 -->
    <div v-if="reviewStore.loadingWrong" class="flex flex-col items-center py-16 space-y-3">
      <div class="w-10 h-10 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
      <p class="text-gray-500">正在加载错题…</p>
    </div>

    <!-- 加载失败 -->
    <div
      v-else-if="reviewStore.error && reviewStore.isEmpty"
      class="bg-white rounded-2xl shadow-lg p-12 text-center space-y-4 max-w-lg mx-auto"
    >
      <div class="text-6xl">⚠️</div>
      <h3 class="text-xl font-bold text-gray-800">无法加载错题本</h3>
      <p class="text-sm text-gray-600 break-all">{{ reviewStore.error }}</p>
      <p v-if="!userStore.canSync" class="text-xs text-amber-600">
        当前处于游客或离线模式，错题本需要登录后才能使用。
      </p>
      <button
        @click="reviewStore.refresh()"
        class="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg"
      >
        重试
      </button>
    </div>

    <!-- 空状态 -->
    <div
      v-else-if="reviewStore.isEmpty"
      class="bg-white rounded-2xl shadow-lg p-12 text-center space-y-4 max-w-lg mx-auto"
    >
      <div class="text-6xl">🎯</div>
      <h3 class="text-xl font-bold text-gray-800">错题本是空的</h3>
      <p class="text-gray-600 text-sm leading-relaxed">
        太好了，说明你还没有答错过题！<br />
        去学习课程，答错的题会自动进入这里。
      </p>
      <button
        @click="router.push('/lessons')"
        class="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg"
      >
        去学习课程
      </button>
    </div>

    <!-- 错题列表 -->
    <div v-else-if="filtered.length === 0" class="bg-white rounded-2xl shadow-lg p-12 text-center">
      <div class="text-5xl mb-3">📭</div>
      <p class="text-gray-600">该分类下暂无题目</p>
    </div>

    <div v-else class="space-y-4">
      <div
        v-for="item in filtered"
        :key="item.questionId"
        class="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden hover:shadow-xl transition-shadow"
      >
        <div class="p-6 space-y-4">
          <!-- 顶部：来源 + 状态 -->
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full font-medium">
              {{ item.courseTitle || '未知课程' }}
            </span>
            <span
              :class="['px-2.5 py-1 rounded-full font-semibold', masteryLabel(item.mastery).className]"
            >
              {{ masteryLabel(item.mastery).text }}
            </span>
            <span v-if="item.isDue" class="px-2.5 py-1 bg-red-100 text-red-700 rounded-full font-semibold">
              待复习
            </span>
            <span class="ml-auto text-gray-400">
              错过 {{ item.wrongCount }} 次 · EF {{ item.easeFactor.toFixed(2) }}
            </span>
          </div>

          <!-- 题目 -->
          <h3 class="text-lg font-bold text-gray-800 leading-relaxed">{{ item.content }}</h3>

          <!-- 答案对比 -->
          <div class="grid md:grid-cols-2 gap-3">
            <div class="bg-red-50 border border-red-200 rounded-xl p-4">
              <p class="text-xs font-semibold text-red-600 mb-1.5">你的答案</p>
              <p class="text-sm text-red-800">{{ userAnswerText(item) }}</p>
            </div>
            <div class="bg-green-50 border border-green-200 rounded-xl p-4">
              <p class="text-xs font-semibold text-green-600 mb-1.5">正确答案</p>
              <p class="text-sm text-green-800">{{ correctAnswerText(item) }}</p>
            </div>
          </div>

          <!-- 解析 -->
          <div v-if="item.explanation" class="bg-blue-50 border-l-4 border-blue-400 rounded-r-xl p-4">
            <p class="text-xs font-semibold text-blue-700 mb-1">解析</p>
            <p class="text-sm text-blue-900 leading-relaxed">{{ item.explanation }}</p>
          </div>

          <!-- 掌握进度条 -->
          <div class="space-y-1.5">
            <div class="flex justify-between text-xs text-gray-500">
              <span>掌握进度（连续答对 {{ item.correctStreak }} 次）</span>
              <span>下次复习：{{ formatRelativeTime(item.nextReviewAt) }}</span>
            </div>
            <div class="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
              <div
                class="h-2 rounded-full transition-all duration-500"
                :class="
                  item.mastery >= 1
                    ? 'bg-gradient-to-r from-green-400 to-emerald-500'
                    : 'bg-gradient-to-r from-amber-400 to-orange-500'
                "
                :style="{ width: `${Math.max(4, item.mastery * 100)}%` }"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部操作 -->
      <div class="text-center pt-4">
        <button
          @click="startReview('wrong')"
          class="px-8 py-3.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-bold hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
        >
          复习全部 {{ reviewStore.wrongAnswers.length }} 道错题
        </button>
      </div>
    </div>
  </div>
</template>
