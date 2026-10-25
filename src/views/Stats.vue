<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { EChartsCoreOption } from 'echarts/core'
import BaseChart from '@/components/charts/BaseChart.vue'
import { useUserStore } from '../stores/user'
import { useLessonStore } from '../stores/lesson'
import { fetchAnswerHistory } from '../services/stats'
import { buildCourseAccuracy, buildDailyTrend, type AnswerRecord } from '../utils/stats'

const userStore = useUserStore()
const lessonStore = useLessonStore()

const answers = ref<AnswerRecord[]>([])
const answersLoading = ref(true)

onMounted(async () => {
  void lessonStore.loadLessons()
  void userStore.loadFromDatabase()
  await loadAnswerHistory()
})

async function loadAnswerHistory(): Promise<void> {
  answersLoading.value = true

  if (!userStore.canSync) {
    answers.value = []
    answersLoading.value = false
    return
  }

  const result = await fetchAnswerHistory(userStore.userId, 90)
  answers.value = result.data
  answersLoading.value = false
}

// ---------------------------------------------------------------------------
// 基础统计
// ---------------------------------------------------------------------------
const lessons = computed(() => lessonStore.getAllLessons())
const totalLessons = computed(() => lessons.value.length)

const completionRate = computed(() => {
  if (totalLessons.value === 0) return 0
  return (userStore.progress.completedLessons.length / totalLessons.value) * 100
})

const studyHours = computed(() => Math.floor(userStore.progress.totalStudyTime / 60))
const studyMinutes = computed(() => userStore.progress.totalStudyTime % 60)

/** question_id → course_id：用于把逐题记录归到课程维度 */
const questionCourseMap = computed(() => {
  const map = new Map<string, string>()
  for (const lesson of lessons.value) {
    for (const question of lesson.questions) {
      map.set(question.id, lesson.id)
    }
  }
  return map
})

const courseTitleMap = computed(
  () => new Map(lessons.value.map((lesson) => [lesson.id, lesson.title] as const)),
)

/** 给每条答题记录补上所属课程；题目可能已被后台删除，因此允许为空 */
const answersWithCourse = computed<AnswerRecord[]>(() =>
  answers.value.map((answer) => ({
    ...answer,
    courseId: questionCourseMap.value.get(answer.questionId) ?? null,
  })),
)

// ---------------------------------------------------------------------------
// 图 1：近 7 天答题趋势（正确 / 错误堆叠柱 + 正确率折线）
// ---------------------------------------------------------------------------
const trend = computed(() => buildDailyTrend(answersWithCourse.value, 7))
const trendSummary = computed(() => {
  const { total, correct } = trend.value.reduce(
    (acc, point) => ({ total: acc.total + point.total, correct: acc.correct + point.correct }),
    { total: 0, correct: 0 },
  )
  return { total, correct, rate: total === 0 ? 0 : correct / total }
})
const trendEmpty = computed(() => trend.value.every((point) => point.total === 0))

const trendOption = computed<EChartsCoreOption>(() => ({
  color: ['#10b981', '#f43f5e', '#f59e0b'],
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  legend: {
    bottom: 0,
    itemWidth: 10,
    itemHeight: 10,
    textStyle: { color: '#6b7280', fontSize: 11 },
  },
  grid: {
    left: 8,
    right: 8,
    top: 18,
    bottom: 34,
    outerBoundsMode: 'same',
    outerBoundsContain: 'axisLabel',
  },
  xAxis: {
    type: 'category',
    data: trend.value.map((point) => point.label),
    axisTick: { show: false },
    axisLine: { lineStyle: { color: '#e5e7eb' } },
    axisLabel: { color: '#9ca3af', fontSize: 11 },
  },
  yAxis: [
    {
      type: 'value',
      name: '题数',
      nameTextStyle: { color: '#9ca3af', fontSize: 11 },
      splitLine: { lineStyle: { color: '#f3f4f6' } },
      axisLabel: { color: '#9ca3af', fontSize: 11 },
    },
    {
      type: 'value',
      name: '正确率',
      min: 0,
      max: 100,
      splitLine: { show: false },
      axisLabel: { color: '#9ca3af', fontSize: 11, formatter: '{value}%' },
    },
  ],
  series: [
    {
      name: '正确',
      type: 'bar',
      stack: 'answers',
      barMaxWidth: 18,
      itemStyle: { color: '#10b981' },
      data: trend.value.map((point) => point.correct),
    },
    {
      name: '错误',
      type: 'bar',
      stack: 'answers',
      barMaxWidth: 18,
      itemStyle: { color: '#f43f5e' },
      data: trend.value.map((point) => point.wrong),
    },
    {
      name: '正确率',
      type: 'line',
      yAxisIndex: 1,
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { width: 2, color: '#f59e0b' },
      itemStyle: { color: '#f59e0b' },
      // 当天没作答时断开，避免把「无数据」画成 0%
      data: trend.value.map((point) =>
        point.total === 0 ? null : Math.round(point.rate * 100),
      ),
    },
  ],
}))

// ---------------------------------------------------------------------------
// 图 2：各课程正确率（横向柱状图，按作答量降序）
// ---------------------------------------------------------------------------
const courseRows = computed(() =>
  buildCourseAccuracy(answersWithCourse.value, courseTitleMap.value),
)
const courseEmpty = computed(() => courseRows.value.length === 0)
const courseHeight = computed(() => `${Math.max(200, courseRows.value.length * 28 + 48)}px`)

const courseOption = computed<EChartsCoreOption>(() => ({
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  grid: {
    left: 8,
    right: 56,
    top: 8,
    bottom: 8,
    outerBoundsMode: 'same',
    outerBoundsContain: 'axisLabel',
  },
  xAxis: {
    type: 'value',
    min: 0,
    max: 100,
    splitLine: { lineStyle: { color: '#f3f4f6' } },
    axisLabel: { color: '#9ca3af', fontSize: 11, formatter: '{value}%' },
  },
  yAxis: {
    type: 'category',
    inverse: true,
    data: courseRows.value.map((row) => row.title),
    axisTick: { show: false },
    axisLine: { lineStyle: { color: '#e5e7eb' } },
    axisLabel: { color: '#6b7280', fontSize: 11, width: 132, overflow: 'truncate' },
  },
  series: [
    {
      name: '正确率',
      type: 'bar',
      barMaxWidth: 14,
      itemStyle: { color: '#f59e0b', borderRadius: [0, 4, 4, 0] },
      label: {
        show: true,
        position: 'right',
        formatter: '{c}%',
        color: '#6b7280',
        fontSize: 10.5,
      },
      data: courseRows.value.map((row) => Math.round(row.rate * 100)),
    },
  ],
}))
</script>

<template>
  <div class="space-y-8">
    <div class="text-center space-y-4">
      <h1 class="text-4xl font-bold text-gray-800">学习统计</h1>
      <p class="text-gray-600">查看你的学习进度和成就</p>
    </div>

    <!-- 主要统计卡片 -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <div class="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-6 text-white">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-blue-100 text-sm mb-1">已完成课程</p>
            <p class="text-4xl font-bold">
              {{ userStore.progress.completedLessons.length }} / {{ totalLessons }}
            </p>
            <p class="text-blue-100 text-sm mt-2">{{ Math.round(completionRate) }}% 完成度</p>
          </div>
          <div class="text-5xl opacity-80">📚</div>
        </div>
      </div>

      <div
        class="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-6 text-white"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-green-100 text-sm mb-1">获得勋章</p>
            <p class="text-4xl font-bold">{{ userStore.unlockedBadges.length }}</p>
            <p class="text-green-100 text-sm mt-2">继续努力！</p>
          </div>
          <div class="text-5xl opacity-80">🏆</div>
        </div>
      </div>

      <div
        class="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-6 text-white"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-purple-100 text-sm mb-1">学习时长</p>
            <p class="text-4xl font-bold">{{ studyHours }}h {{ studyMinutes }}m</p>
            <p class="text-purple-100 text-sm mt-2">累计学习时间</p>
          </div>
          <div class="text-5xl opacity-80">⏰</div>
        </div>
      </div>

      <div class="bg-gradient-to-br from-orange-500 to-red-500 rounded-xl shadow-lg p-6 text-white">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-orange-100 text-sm mb-1">连续学习</p>
            <p class="text-4xl font-bold">{{ userStore.progress.currentStreak }}</p>
            <p class="text-orange-100 text-sm mt-2">天连续学习</p>
          </div>
          <div class="text-5xl opacity-80">🔥</div>
        </div>
      </div>
    </div>

    <!-- 图表 -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="bg-white rounded-xl shadow-lg p-6">
        <div class="flex items-baseline gap-2 mb-1">
          <h2 class="text-2xl font-bold text-gray-800">近 7 天答题趋势</h2>
          <span class="text-xs text-gray-500 ml-auto">
            合计 {{ trendSummary.total }} 题 · 正确率
            {{ Math.round(trendSummary.rate * 100) }}%
          </span>
        </div>
        <BaseChart
          :option="trendOption"
          height="280px"
          :loading="answersLoading"
          :empty="!answersLoading && trendEmpty"
          :empty-text="userStore.canSync ? '近 7 天还没有答题记录，去完成一节课吧' : '登录后查看答题趋势'"
        />
      </div>

      <div class="bg-white rounded-xl shadow-lg p-6">
        <div class="flex items-baseline gap-2 mb-1">
          <h2 class="text-2xl font-bold text-gray-800">各课程正确率</h2>
          <span class="text-xs text-gray-500 ml-auto">
            近 90 天 · {{ courseRows.length }} 门课程有作答
          </span>
        </div>
        <BaseChart
          :option="courseOption"
          :height="courseHeight"
          :loading="answersLoading"
          :empty="!answersLoading && courseEmpty"
          :empty-text="userStore.canSync ? '还没有答题记录，完成课程后这里会显示各课程正确率' : '登录后查看各课程正确率'"
        />
        <p class="text-xs text-gray-500 mt-2 leading-relaxed">
          按作答量从多到少排列；作答太少的课程正确率波动较大，参考时请留意题量。
          最近一次完成课程的正确率为
          <span class="font-semibold text-gray-700">
            {{ Math.round(userStore.progress.correctRate * 100) }}%
          </span>
          。
        </p>
      </div>
    </div>

    <!-- 课程完成情况 -->
    <div class="bg-white rounded-xl shadow-lg p-6">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">课程完成情况</h2>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div
          v-for="lesson in lessons"
          :key="lesson.id"
          class="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
        >
          <div class="flex items-center space-x-3 min-w-0">
            <span class="text-2xl flex-shrink-0">{{ lesson.coverImage || '📖' }}</span>
            <div class="min-w-0">
              <p class="font-medium text-gray-800 truncate">{{ lesson.title }}</p>
              <p class="text-xs text-gray-500">{{ lesson.period }}</p>
            </div>
          </div>
          <div v-if="userStore.progress.completedLessons.includes(lesson.id)">
            <span class="text-green-500 text-xl">✅</span>
          </div>
          <div v-else>
            <span class="text-gray-300 text-xl">⭕</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 成就展示 -->
    <div class="bg-white rounded-xl shadow-lg p-6">
      <h2 class="text-2xl font-bold text-gray-800 mb-4">已获得勋章</h2>
      <div
        v-if="userStore.unlockedBadges.length > 0"
        class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4"
      >
        <div
          v-for="badge in userStore.unlockedBadges"
          :key="badge.id"
          class="text-center p-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg"
        >
          <div class="text-4xl mb-2">{{ badge.icon }}</div>
          <p class="text-sm font-semibold text-gray-800">{{ badge.name }}</p>
        </div>
      </div>
      <div v-else class="text-center py-8 text-gray-500">
        <p>还没有获得勋章，快去学习吧！</p>
      </div>
    </div>
  </div>
</template>