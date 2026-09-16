<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLessonStore } from '../stores/lesson'
import { useUserStore } from '../stores/user'

const route = useRoute()
const router = useRouter()
const lessonStore = useLessonStore()
const userStore = useUserStore()

const selectedAnswer = ref<number | null>(null)
const showExplanation = ref(false)
const startTime = ref<number>(Date.now())
const notFound = ref(false)

onMounted(async () => {
  const lessonId = route.params.id as string

  // 断点续学：若正是上次未完成的课程，则定位到断点位置
  const resume = userStore.resumeTarget
  const position = resume && resume.lessonId === lessonId ? resume.position : 0

  const ok = await lessonStore.setCurrentLesson(lessonId, position)
  if (!ok) {
    notFound.value = true
    return
  }

  // 记录本次进入课程的断点
  await userStore.setResumePoint(lessonId, position)
  startTime.value = Date.now()
})

const currentQuestion = computed(() => lessonStore.getCurrentQuestion())
const progress = computed(() => {
  if (!lessonStore.currentLesson) return 0
  return ((lessonStore.currentQuestionIndex + 1) / lessonStore.currentLesson.questions.length) * 100
})

const handleAnswer = (index: number) => {
  if (!currentQuestion.value || showExplanation.value) return

  selectedAnswer.value = index
  lessonStore.submitAnswer(currentQuestion.value.id, index)
  showExplanation.value = true

  // 异步写入答题记录（错题本 / 间隔重复的数据来源）；失败静默，不阻塞交互
  void userStore.recordQuestionAnswer(
    currentQuestion.value.id,
    index,
    index === currentQuestion.value.answer,
  )
}

const handleNext = () => {
  if (!lessonStore.currentLesson) return

  if (lessonStore.currentQuestionIndex < lessonStore.currentLesson.questions.length - 1) {
    lessonStore.nextQuestion()
    selectedAnswer.value = null
    showExplanation.value = false
    // 保存断点，刷新后可继续
    void userStore.setResumePoint(
      lessonStore.currentLesson.id,
      lessonStore.currentQuestionIndex,
    )
  } else {
    // 完成课程
    void finishLesson()
  }
}

const handlePrevious = () => {
  lessonStore.previousQuestion()
  const question = currentQuestion.value
  if (question) {
    selectedAnswer.value = lessonStore.getAnswer(question.id)
  }
  showExplanation.value = false
}

const finishLesson = async () => {
  if (!lessonStore.currentLesson) return

  const result = lessonStore.calculateResult()
  const studyTime = Math.floor((Date.now() - startTime.value) / 1000 / 60)

  // 一次性写入学习时长 / 正确率 / 完成状态，并触发服务端勋章判定
  await userStore.finishLesson(
    lessonStore.currentLesson.id,
    result.correct,
    result.total,
    studyTime,
  )

  lessonStore.setQuizCompleted(true)
}

const goToLessons = () => {
  lessonStore.resetLesson()
  router.push('/lessons')
}

const isCorrect = computed(() => {
  if (!currentQuestion.value || selectedAnswer.value === null) return false
  return selectedAnswer.value === currentQuestion.value.answer
})
</script>

<template>
  <!-- 加载中 -->
  <div
    v-if="lessonStore.loading && !lessonStore.currentLesson"
    class="flex flex-col items-center justify-center py-24 space-y-4"
  >
    <div
      class="w-12 h-12 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin"
    ></div>
    <p class="text-gray-600">正在加载课程…</p>
  </div>

  <!-- 课程不存在 -->
  <div
    v-else-if="notFound"
    class="bg-white rounded-2xl shadow-xl p-12 text-center space-y-6 max-w-lg mx-auto"
  >
    <div class="text-6xl">🔍</div>
    <h2 class="text-2xl font-bold text-gray-800">未找到该课程</h2>
    <p class="text-gray-600">课程可能已被删除，或链接有误。</p>
    <button
      @click="goToLessons"
      class="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg"
    >
      返回课程列表
    </button>
  </div>

  <div v-else-if="lessonStore.currentLesson" class="space-y-6">
    <!-- 课程信息 -->
    <div
      class="bg-gradient-to-r from-white to-amber-50 rounded-2xl shadow-xl p-6 border border-amber-100"
    >
      <div class="flex items-center justify-between mb-4">
        <div>
          <h1 class="text-3xl font-bold text-gray-800">{{ lessonStore.currentLesson.title }}</h1>
          <p class="text-gray-600 mt-2">{{ lessonStore.currentLesson.description }}</p>
        </div>
        <div class="text-5xl">{{ lessonStore.currentLesson.coverImage || '📖' }}</div>
      </div>

      <div class="flex items-center space-x-4 text-sm text-gray-500">
        <span>📅 {{ lessonStore.currentLesson.period }}</span>
        <span>🌍 {{ lessonStore.currentLesson.civilization }}</span>
        <span>⏱️ {{ lessonStore.currentLesson.estimatedTime }} 分钟</span>
      </div>
    </div>

    <!-- 完成界面 -->
    <div
      v-if="lessonStore.isQuizCompleted"
      class="relative bg-gradient-to-br from-amber-50 via-orange-50 to-red-50 rounded-3xl shadow-2xl p-12 text-center space-y-8 overflow-hidden"
    >
      <!-- 背景装饰 -->
      <div class="absolute inset-0 opacity-20">
        <div class="absolute top-10 left-10 w-32 h-32 bg-amber-400 rounded-full blur-2xl"></div>
        <div
          class="absolute bottom-10 right-10 w-32 h-32 bg-orange-400 rounded-full blur-2xl"
        ></div>
      </div>

      <div class="relative z-10">
        <div class="text-8xl mb-4 animate-bounce">🎉</div>
        <h2
          class="text-4xl md:text-5xl font-bold bg-gradient-to-r from-amber-600 to-orange-500 bg-clip-text text-transparent mb-2"
        >
          恭喜完成课程！
        </h2>
        <p class="text-gray-600 text-lg">你做得太棒了！</p>

        <div class="bg-white/80 backdrop-blur-sm rounded-2xl p-8 shadow-xl border border-white/50">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="bg-gradient-to-br from-amber-100 to-orange-100 rounded-xl p-6">
              <p class="text-gray-600 text-sm mb-2 font-medium">正确率</p>
              <p
                class="text-5xl font-bold bg-gradient-to-r from-amber-600 to-orange-500 bg-clip-text text-transparent"
              >
                {{ Math.round(lessonStore.calculateResult().rate * 100) }}%
              </p>
            </div>
            <div class="bg-gradient-to-br from-green-100 to-emerald-100 rounded-xl p-6">
              <p class="text-gray-600 text-sm mb-2 font-medium">答对题数</p>
              <p
                class="text-5xl font-bold bg-gradient-to-r from-green-600 to-emerald-500 bg-clip-text text-transparent"
              >
                {{ lessonStore.calculateResult().correct }} /
                {{ lessonStore.calculateResult().total }}
              </p>
            </div>
          </div>
        </div>

        <div class="flex justify-center">
          <button
            @click="goToLessons"
            class="px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-bold text-lg hover:from-amber-600 hover:to-orange-600 transition-all shadow-xl hover:shadow-2xl transform hover:-translate-y-1"
          >
            返回课程列表
          </button>
        </div>
      </div>
    </div>

    <!-- 答题界面 -->
    <div v-else class="space-y-6">
      <!-- 进度条 -->
      <div
        class="bg-gradient-to-r from-white to-amber-50 rounded-2xl shadow-xl p-6 border border-amber-100"
      >
        <div class="flex items-center justify-between mb-3">
          <span class="text-base font-bold text-gray-800">
            题目 {{ lessonStore.currentQuestionIndex + 1 }} /
            {{ lessonStore.currentLesson.questions.length }}
          </span>
          <span class="text-lg font-bold text-amber-600">{{ Math.round(progress) }}%</span>
        </div>
        <div class="w-full bg-gray-200 rounded-full h-4 overflow-hidden shadow-inner">
          <div
            class="bg-gradient-to-r from-amber-500 to-orange-500 h-4 rounded-full transition-all duration-500 shadow-lg relative overflow-hidden"
            :style="{ width: `${progress}%` }"
          >
            <div class="absolute inset-0 bg-white/30 animate-pulse"></div>
          </div>
        </div>
      </div>

      <!-- 题目 -->
      <div
        v-if="currentQuestion"
        class="relative bg-white rounded-2xl shadow-xl p-8 space-y-6 border border-gray-100 overflow-hidden"
      >
        <!-- 装饰背景 -->
        <div
          class="absolute top-0 right-0 w-40 h-40 bg-amber-100 rounded-full -mr-20 -mt-20 opacity-30"
        ></div>
        <div
          class="absolute bottom-0 left-0 w-32 h-32 bg-orange-100 rounded-full -ml-16 -mb-16 opacity-30"
        ></div>

        <div class="relative z-10">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-2 h-8 bg-gradient-to-b from-amber-500 to-orange-500 rounded-full"></div>
            <h2 class="text-2xl md:text-3xl font-bold text-gray-800 leading-relaxed">
              {{ currentQuestion.content }}
            </h2>
          </div>

          <!-- 选项 -->
          <div class="space-y-4">
            <button
              v-for="(option, index) in currentQuestion.options"
              :key="index"
              @click="handleAnswer(index)"
              :disabled="showExplanation"
              :class="[
                'group w-full text-left p-5 rounded-xl border-2 transition-all transform',
                selectedAnswer === index
                  ? isCorrect
                    ? 'border-green-500 bg-gradient-to-r from-green-50 to-emerald-50 shadow-lg scale-105'
                    : 'border-red-500 bg-gradient-to-r from-red-50 to-pink-50 shadow-lg scale-105'
                  : showExplanation && index === currentQuestion.answer
                    ? 'border-green-500 bg-gradient-to-r from-green-50 to-emerald-50 shadow-lg'
                    : 'border-gray-200 hover:border-amber-400 hover:bg-gradient-to-r hover:from-amber-50 hover:to-orange-50 hover:shadow-md hover:scale-[1.02]',
                showExplanation ? 'cursor-not-allowed' : 'cursor-pointer',
              ]"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div
                    :class="[
                      'w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm',
                      selectedAnswer === index
                        ? isCorrect
                          ? 'bg-green-500 text-white'
                          : 'bg-red-500 text-white'
                        : showExplanation && index === currentQuestion.answer
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-100 text-gray-600 group-hover:bg-amber-100 group-hover:text-amber-700',
                    ]"
                  >
                    {{ String.fromCharCode(65 + index) }}
                  </div>
                  <span class="font-medium text-gray-800 text-lg">{{ option }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <span v-if="selectedAnswer === index && isCorrect" class="text-3xl animate-bounce"
                    >✓</span
                  >
                  <span
                    v-else-if="selectedAnswer === index && !isCorrect"
                    class="text-3xl animate-bounce"
                    >✗</span
                  >
                  <span
                    v-else-if="showExplanation && index === currentQuestion.answer"
                    class="text-3xl animate-bounce"
                    >✓</span
                  >
                </div>
              </div>
            </button>
          </div>

          <!-- 解释 -->
          <div
            v-if="showExplanation && currentQuestion.explanation"
            class="bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 p-5 rounded-xl shadow-sm"
          >
            <p class="text-sm text-gray-700 flex items-start gap-2">
              <span class="text-xl">💡</span>
              <span>
                <span class="font-bold text-blue-700">解释：</span>{{ currentQuestion.explanation }}
              </span>
            </p>
          </div>

          <!-- 导航按钮 -->
          <div class="flex justify-between pt-6 gap-4">
            <button
              @click="handlePrevious"
              :disabled="lessonStore.currentQuestionIndex === 0"
              :class="[
                'px-6 py-3 rounded-xl font-bold transition-all flex-1',
                lessonStore.currentQuestionIndex === 0
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300 hover:shadow-md',
              ]"
            >
              上一题
            </button>
            <button
              @click="handleNext"
              :disabled="!showExplanation"
              :class="[
                'px-6 py-3 rounded-xl font-bold transition-all flex-1 shadow-lg',
                showExplanation
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 hover:shadow-xl transform hover:scale-105'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed',
              ]"
            >
              {{
                lessonStore.currentQuestionIndex === lessonStore.currentLesson.questions.length - 1
                  ? '完成'
                  : '下一题'
              }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div v-else class="text-center py-12">
    <div class="inline-block">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500 mb-4"></div>
      <p class="text-gray-600 text-lg">加载中...</p>
    </div>
  </div>
</template>
