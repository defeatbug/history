import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Lesson, Question } from '../data/mockData'
import { mockLessons } from '../data/mockData'
import { fetchLessons } from '../services/content'

export const useLessonStore = defineStore('lesson', () => {
  const lessons = ref<Lesson[]>(mockLessons)
  const currentLesson = ref<Lesson | null>(null)
  const currentQuestionIndex = ref<number>(0)
  const userAnswers = ref<Record<string, number>>({})
  const isQuizCompleted = ref<boolean>(false)

  const loading = ref<boolean>(false)
  const loaded = ref<boolean>(false)
  /** 数据来源：remote = Supabase，mock = 本地回退 */
  const source = ref<'remote' | 'mock'>('mock')

  // -------------------------------------------------------------------------
  // 加载
  // -------------------------------------------------------------------------

  /**
   * 加载课程列表（默认只加载一次，force=true 可强制刷新）。
   * 若 Supabase 不可用会回退到本地 mock 数据。
   */
  const loadLessons = async (force = false): Promise<Lesson[]> => {
    if (loaded.value && !force) return lessons.value

    loading.value = true
    try {
      const result = await fetchLessons(mockLessons)
      lessons.value = result.data
      source.value = result.source
      loaded.value = true
    } catch (error) {
      console.warn('[lesson] 加载课程失败，保留现有数据：', error)
      loaded.value = true
    } finally {
      loading.value = false
    }

    return lessons.value
  }

  // -------------------------------------------------------------------------
  // 查询
  // -------------------------------------------------------------------------

  const allLessons = computed(() => lessons.value)

  /** 获取所有课程（保留以兼容既有调用） */
  const getAllLessons = () => lessons.value

  /** 根据 ID 获取课程 */
  const getLessonById = (id: string): Lesson | undefined => {
    return lessons.value.find((lesson) => lesson.id === id)
  }

  // -------------------------------------------------------------------------
  // 答题流程
  // -------------------------------------------------------------------------

  /**
   * 设置当前课程，并定位到指定题号（断点续学）。
   * 会先确保课程数据已加载。
   */
  const setCurrentLesson = async (lessonId: string, position = 0): Promise<boolean> => {
    await loadLessons()

    const lesson = getLessonById(lessonId)
    if (!lesson) return false

    currentLesson.value = lesson
    const maxIndex = Math.max(0, lesson.questions.length - 1)
    currentQuestionIndex.value = Math.min(Math.max(0, position), maxIndex)
    userAnswers.value = {}
    isQuizCompleted.value = false
    return true
  }

  const getCurrentQuestion = (): Question | null => {
    if (!currentLesson.value) return null
    return currentLesson.value.questions[currentQuestionIndex.value] || null
  }

  const submitAnswer = (questionId: string, answer: number) => {
    userAnswers.value[questionId] = answer
  }

  const nextQuestion = () => {
    if (!currentLesson.value) return
    if (currentQuestionIndex.value < currentLesson.value.questions.length - 1) {
      currentQuestionIndex.value++
    } else {
      isQuizCompleted.value = true
    }
  }

  const previousQuestion = () => {
    if (currentQuestionIndex.value > 0) {
      currentQuestionIndex.value--
    }
  }

  /** 当前题目的答案（用于回显） */
  const getAnswer = (questionId: string): number | null => {
    const answer = userAnswers.value[questionId]
    return answer === undefined ? null : answer
  }

  /** 计算答题结果 */
  const calculateResult = () => {
    if (!currentLesson.value) return { correct: 0, total: 0, rate: 0 }

    const total = currentLesson.value.questions.length
    let correct = 0

    currentLesson.value.questions.forEach((question) => {
      if (userAnswers.value[question.id] === question.answer) {
        correct++
      }
    })

    const rate = total > 0 ? correct / total : 0
    return { correct, total, rate }
  }

  const setQuizCompleted = (completed: boolean) => {
    isQuizCompleted.value = completed
  }

  const resetLesson = () => {
    currentLesson.value = null
    currentQuestionIndex.value = 0
    userAnswers.value = {}
    isQuizCompleted.value = false
  }

  return {
    lessons,
    currentLesson,
    currentQuestionIndex,
    userAnswers,
    isQuizCompleted,
    loading,
    loaded,
    source,
    allLessons,
    loadLessons,
    getAllLessons,
    getLessonById,
    setCurrentLesson,
    getCurrentQuestion,
    submitAnswer,
    nextQuestion,
    previousQuestion,
    getAnswer,
    calculateResult,
    setQuizCompleted,
    resetLesson,
  }
})
