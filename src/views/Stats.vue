<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useUserStore } from '../stores/user'
import { useLessonStore } from '../stores/lesson'

const userStore = useUserStore()
const lessonStore = useLessonStore()

onMounted(() => {
  void lessonStore.loadLessons()
  void userStore.loadFromDatabase()
})

const totalLessons = computed(() => lessonStore.getAllLessons().length)
const completionRate = computed(() => {
  if (totalLessons.value === 0) return 0
  return (userStore.progress.completedLessons.length / totalLessons.value) * 100
})

const studyHours = computed(() => {
  return Math.floor(userStore.progress.totalStudyTime / 60)
})

const studyMinutes = computed(() => {
  return userStore.progress.totalStudyTime % 60
})
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

    <!-- 详细统计 -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- 正确率 -->
      <div class="bg-white rounded-xl shadow-lg p-6">
        <h2 class="text-2xl font-bold text-gray-800 mb-4">答题正确率</h2>
        <div class="space-y-4">
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm text-gray-600">总体正确率</span>
              <span class="text-lg font-bold text-gray-800">
                {{ Math.round(userStore.progress.correctRate * 100) }}%
              </span>
            </div>
            <div class="w-full bg-gray-200 rounded-full h-4">
              <div
                class="bg-green-500 h-4 rounded-full transition-all duration-500"
                :style="{ width: `${userStore.progress.correctRate * 100}%` }"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 课程完成情况 -->
      <div class="bg-white rounded-xl shadow-lg p-6">
        <h2 class="text-2xl font-bold text-gray-800 mb-4">课程完成情况</h2>
        <div class="space-y-3">
          <div
            v-for="lesson in lessonStore.getAllLessons()"
            :key="lesson.id"
            class="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
          >
            <div class="flex items-center space-x-3">
              <span class="text-2xl">{{ lesson.coverImage || '📖' }}</span>
              <div>
                <p class="font-medium text-gray-800">{{ lesson.title }}</p>
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
