<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useReviewStore } from '@/stores/review'
import { useUserStore } from '@/stores/user'
import { formatRelativeTime } from '@/utils/format'
import type { ReviewItem } from '@/services/review'

const route = useRoute()
const router = useRouter()
const reviewStore = useReviewStore()
const userStore = useUserStore()

const currentIndex = ref(0)
const selectedAnswer = ref<number | null>(null)
const showResult = ref(false)
const finished = ref(false)
const startedAt = ref(Date.now())

/** 本次复习的统计 */
const correctCount = ref(0)
const answeredCount = ref(0)
/** 答题后服务端返回的下次复习间隔（用于即时反馈） */
const nextReviewHint = ref<string>('')

const mode = computed<'due' | 'wrong' | 'all'>(() => {
  const m = route.query.mode
  return m === 'wrong' || m === 'all' ? m : 'due'
})

const queue = computed<ReviewItem[]>(() => reviewStore.reviewQueue)
const current = computed<ReviewItem | null>(() => queue.value[currentIndex.value] ?? null)

const progress = computed(() => {
  if (queue.value.length === 0) return 0
  return ((currentIndex.value + (showResult.value ? 1 : 0)) / queue.value.length) * 100
})

const isCorrect = computed(() => {
  if (!current.value || selectedAnswer.value === null) return false
  return selectedAnswer.value === current.value.answer
})

const modeTitle = computed(() => {
  switch (mode.value) {
    case 'wrong':
      return '复习错题'
    case 'all':
      return '全部复习'
    default:
      return '到期复习'
  }
})

const handleAnswer = async (index: number) => {
  if (!current.value || showResult.value) return

  selectedAnswer.value = index
  showResult.value = true
  answeredCount.value++

  const correct = index === current.value.answer
  if (correct) correctCount.value++

  // 写入数据库并按 SM-2 更新复习计划
  const result = await userStore.recordQuestionAnswer(current.value.questionId, index, correct)

  if (result.ok && result.next) {
    nextReviewHint.value = formatRelativeTime(result.next.nextReviewAt)
  } else {
    nextReviewHint.value = '（未能保存，进度可能不会保留）'
  }
}

const handleNext = () => {
  if (currentIndex.value < queue.value.length - 1) {
    currentIndex.value++
    selectedAnswer.value = null
    showResult.value = false
    nextReviewHint.value = ''
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } else {
    void finish()
  }
}

const finish = async () => {
  finished.value = true
  // 记录学习时长（分钟，至少 1 分钟）
  const minutes = Math.max(1, Math.round((Date.now() - startedAt.value) / 1000 / 60))
  await userStore.addStudyTime(minutes)
}

const restart = async () => {
  currentIndex.value = 0
  selectedAnswer.value = null
  showResult.value = false
  finished.value = false
  correctCount.value = 0
  answeredCount.value = 0
  nextReviewHint.value = ''
  startedAt.value = Date.now()
  await reviewStore.loadReviewQueue(mode.value)
}

onMounted(async () => {
  await reviewStore.loadReviewQueue(mode.value)
})
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <!-- 加载中 -->
    <div
      v-if="reviewStore.loadingQueue"
      class="flex flex-col items-center justify-center py-24 space-y-4"
    >
      <div class="w-12 h-12 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
      <p class="text-gray-600">正在准备复习内容…</p>
    </div>

    <!-- 队列为空 -->
    <div
      v-else-if="queue.length === 0 && !finished"
      class="bg-white rounded-2xl shadow-xl p-12 text-center space-y-5"
    >
      <div class="text-6xl">🎉</div>
      <h2 class="text-2xl font-bold text-gray-800">暂时没有需要复习的题目</h2>
      <p class="text-gray-600 text-sm leading-relaxed">
        说明你当前的复习计划都还没到期。<br />
        SM-2 算法会在合适的时间提醒你回来的。
      </p>
      <div class="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          @click="router.push('/wrong-answers')"
          class="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg"
        >
          查看错题本
        </button>
        <button
          @click="router.push('/lessons')"
          class="px-6 py-3 bg-white text-amber-600 border-2 border-amber-500 rounded-xl font-semibold hover:bg-amber-50 transition-all"
        >
          去学习课程
        </button>
      </div>
    </div>

    <!-- 完成总结 -->
    <div
      v-else-if="finished"
      class="relative bg-gradient-to-br from-amber-50 via-orange-50 to-red-50 rounded-3xl shadow-2xl p-10 text-center space-y-7 overflow-hidden"
    >
      <div class="absolute inset-0 opacity-20">
        <div class="absolute top-10 left-10 w-32 h-32 bg-amber-400 rounded-full blur-2xl"></div>
        <div class="absolute bottom-10 right-10 w-32 h-32 bg-orange-400 rounded-full blur-2xl"></div>
      </div>

      <div class="relative z-10 space-y-6">
        <div class="text-7xl animate-bounce">📚</div>
        <h2
          class="text-3xl md:text-4xl font-bold bg-gradient-to-r from-amber-600 to-orange-500 bg-clip-text text-transparent"
        >
          本轮复习完成！
        </h2>

        <div class="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-xl border border-white/50">
          <div class="grid grid-cols-2 gap-4">
            <div class="bg-gradient-to-br from-amber-100 to-orange-100 rounded-xl p-5">
              <p class="text-gray-600 text-sm mb-1 font-medium">本轮正确率</p>
              <p
                class="text-4xl font-bold bg-gradient-to-r from-amber-600 to-orange-500 bg-clip-text text-transparent"
              >
                {{ answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0 }}%
              </p>
            </div>
            <div class="bg-gradient-to-br from-green-100 to-emerald-100 rounded-xl p-5">
              <p class="text-gray-600 text-sm mb-1 font-medium">答对 / 总数</p>
              <p
                class="text-4xl font-bold bg-gradient-to-r from-green-600 to-emerald-500 bg-clip-text text-transparent"
              >
                {{ correctCount }} / {{ answeredCount }}
              </p>
            </div>
          </div>
        </div>

        <p class="text-sm text-gray-600">
          答对的题复习间隔已按 SM-2 算法延长，答错的题会更快再次出现。
        </p>

        <div class="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            @click="restart"
            class="px-6 py-3 bg-white text-amber-600 border-2 border-amber-500 rounded-xl font-semibold hover:bg-amber-50 transition-all"
          >
            再来一轮
          </button>
          <button
            @click="router.push('/wrong-answers')"
            class="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-bold hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg"
          >
            返回错题本
          </button>
        </div>
      </div>
    </div>

    <!-- 答题界面 -->
    <template v-else-if="current">
      <!-- 进度 -->
      <div class="bg-white rounded-2xl shadow-lg p-5 border border-gray-100">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-gray-800">{{ modeTitle }}</span>
            <span class="text-sm text-gray-500">{{ currentIndex + 1 }} / {{ queue.length }}</span>
          </div>
          <span class="text-sm font-bold text-amber-600">{{ Math.round(progress) }}%</span>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
          <div
            class="bg-gradient-to-r from-amber-500 to-orange-500 h-3 rounded-full transition-all duration-500"
            :style="{ width: `${progress}%` }"
          ></div>
        </div>
      </div>

      <!-- 题目卡片 -->
      <div class="bg-white rounded-2xl shadow-xl p-7 space-y-6 border border-gray-100">
        <!-- 元信息 -->
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full">
            {{ current.courseTitle || '未知课程' }}
          </span>
          <span class="px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full font-medium">
            EF {{ current.easeFactor.toFixed(2) }}
          </span>
          <span v-if="current.wrongCount > 0" class="px-2.5 py-1 bg-red-100 text-red-700 rounded-full">
            错过 {{ current.wrongCount }} 次
          </span>
        </div>

        <h2 class="text-xl md:text-2xl font-bold text-gray-800 leading-relaxed">
          {{ current.content }}
        </h2>

        <!-- 选项 -->
        <div class="space-y-3">
          <button
            v-for="(option, index) in current.options"
            :key="index"
            @click="handleAnswer(index)"
            :disabled="showResult"
            :class="[
              'w-full text-left p-4 rounded-xl border-2 transition-all',
              !showResult
                ? 'border-gray-200 hover:border-amber-400 hover:bg-amber-50 cursor-pointer'
                : index === current.answer
                  ? 'border-green-500 bg-green-50'
                  : index === selectedAnswer
                    ? 'border-red-500 bg-red-50'
                    : 'border-gray-200 opacity-60',
              showResult ? 'cursor-not-allowed' : '',
            ]"
          >
            <div class="flex items-center gap-3">
              <span
                :class="[
                  'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold',
                  showResult && index === current.answer
                    ? 'bg-green-500 text-white'
                    : showResult && index === selectedAnswer
                      ? 'bg-red-500 text-white'
                      : 'bg-gray-100 text-gray-600',
                ]"
              >
                {{ String.fromCharCode(65 + index) }}
              </span>
              <span class="text-gray-800 flex-1">{{ option }}</span>
              <span v-if="showResult && index === current.answer" class="text-green-600">✓</span>
              <span
                v-else-if="showResult && index === selectedAnswer"
                class="text-red-500"
              >
                ✗
              </span>
            </div>
          </button>
        </div>

        <!-- 结果反馈 -->
        <div v-if="showResult" class="space-y-4 pt-2">
          <div
            :class="[
              'rounded-xl p-4 border-l-4',
              isCorrect ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500',
            ]"
          >
            <p :class="['font-bold mb-1', isCorrect ? 'text-green-700' : 'text-red-700']">
              {{ isCorrect ? '✅ 回答正确' : '❌ 回答错误' }}
            </p>
            <p class="text-sm" :class="isCorrect ? 'text-green-800' : 'text-red-800'">
              <template v-if="isCorrect">
                SM-2 已延长本题复习间隔，下次复习：<span class="font-semibold">{{ nextReviewHint }}</span>
              </template>
              <template v-else>
                SM-2 已缩短本题复习间隔，下次复习：<span class="font-semibold">{{ nextReviewHint }}</span>
              </template>
            </p>
          </div>

          <div v-if="current.explanation" class="bg-blue-50 border-l-4 border-blue-400 rounded-r-xl p-4">
            <p class="text-xs font-semibold text-blue-700 mb-1">解析</p>
            <p class="text-sm text-blue-900 leading-relaxed">{{ current.explanation }}</p>
          </div>

          <button
            @click="handleNext"
            class="w-full py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-bold text-lg hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg hover:shadow-xl"
          >
            {{ currentIndex < queue.length - 1 ? '下一题 →' : '完成复习' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
