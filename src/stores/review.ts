import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  fetchWrongAnswers,
  fetchReviewQueue,
  summarizeWrongAnswers,
  type WrongAnswerItem,
  type ReviewItem,
} from '@/services/review'
import { useUserStore } from './user'

export const useReviewStore = defineStore('review', () => {
  const wrongAnswers = ref<WrongAnswerItem[]>([])
  const reviewQueue = ref<ReviewItem[]>([])

  const loadingWrong = ref(false)
  const loadingQueue = ref(false)
  const error = ref<string | null>(null)
  /** 数据来源标识，便于 UI 提示「无数据」的原因 */
  const source = ref<'remote' | 'mock'>('mock')

  /** 错题本统计 */
  const stats = computed(() => summarizeWrongAnswers(wrongAnswers.value))

  /** 待复习数量（错题本中已到期的） */
  const dueCount = computed(() => wrongAnswers.value.filter((i) => i.isDue).length)

  /** 是否为空（用于空状态提示） */
  const isEmpty = computed(() => wrongAnswers.value.length === 0)

  // -------------------------------------------------------------------------
  // 读取
  // -------------------------------------------------------------------------

  /** 加载错题本 */
  const loadWrongAnswers = async () => {
    const userStore = useUserStore()
    loadingWrong.value = true
    error.value = null

    try {
      const result = await fetchWrongAnswers(userStore.userId)
      wrongAnswers.value = result.data
      source.value = result.source
      if (result.error) error.value = result.error
    } finally {
      loadingWrong.value = false
    }
  }

  /** 加载复习队列 */
  const loadReviewQueue = async (mode: 'due' | 'wrong' | 'all' = 'due', limit = 20) => {
    const userStore = useUserStore()
    loadingQueue.value = true
    error.value = null

    try {
      const result = await fetchReviewQueue(userStore.userId, mode, limit)
      reviewQueue.value = result.data
      if (result.error) error.value = result.error
    } finally {
      loadingQueue.value = false
    }
  }

  /** 同时刷新两者 */
  const refresh = async () => {
    await Promise.all([loadWrongAnswers(), loadReviewQueue('due')])
  }

  const reset = () => {
    wrongAnswers.value = []
    reviewQueue.value = []
    error.value = null
  }

  return {
    wrongAnswers,
    reviewQueue,
    loadingWrong,
    loadingQueue,
    error,
    source,
    stats,
    dueCount,
    isEmpty,
    loadWrongAnswers,
    loadReviewQueue,
    refresh,
    reset,
  }
})
