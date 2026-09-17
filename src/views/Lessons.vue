<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useLessonStore } from '../stores/lesson'
import { useUserStore } from '../stores/user'

const router = useRouter()
const lessonStore = useLessonStore()
const userStore = useUserStore()

// 异步数据源 → 使用 computed 保持响应式
const lessons = computed(() => lessonStore.allLessons)

const isCompleted = (lessonId: string) => {
  return userStore.progress.completedLessons.includes(lessonId)
}

/** 是否有未完成的断点 */
const isInProgress = (lessonId: string) => {
  return userStore.resumeTarget?.lessonId === lessonId
}

const startLesson = (lessonId: string) => {
  router.push(`/lessons/${lessonId}`)
}

const difficultyLabels = {
  beginner: '初级',
  intermediate: '中级',
  advanced: '高级',
}

onMounted(() => {
  void lessonStore.loadLessons()
})
</script>

<template>
  <div class="space-y-10">
    <div class="text-center space-y-4">
      <h1
        class="text-5xl md:text-6xl font-bold bg-gradient-to-r from-amber-600 via-orange-500 to-red-500 bg-clip-text text-transparent"
      >
        历史课程
      </h1>
      <p class="text-xl text-gray-600">选择一门课程，开启你的历史探索之旅</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
      <div
        v-for="lesson in lessons"
        :key="lesson.id"
        class="group relative flex flex-col bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-2xl transition-all cursor-pointer transform hover:-translate-y-2 border border-gray-100"
        @click="startLesson(lesson.id)"
      >
        <!-- 完成标记 -->
        <div v-if="isCompleted(lesson.id)" class="absolute top-4 right-4 z-20">
          <div
            class="bg-gradient-to-r from-green-400 to-emerald-500 text-white rounded-full p-2 shadow-lg"
          >
            <span class="text-xl">✓</span>
          </div>
        </div>

        <!-- 进行中标记 -->
        <div
          v-else-if="isInProgress(lesson.id)"
          class="absolute top-4 right-4 z-20 px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-full text-xs font-bold shadow-lg"
        >
          继续学习
        </div>

        <!-- 渐变背景 -->
        <div
          class="absolute inset-0 bg-gradient-to-br from-amber-50/50 to-orange-50/50 opacity-0 group-hover:opacity-100 transition-opacity"
        ></div>

        <!-- flex-1 让内容区撑满卡片剩余高度，使底部区块能对齐 -->
        <div class="relative p-6 flex-1 flex flex-col">
          <div class="flex items-start justify-between mb-4">
            <div class="text-7xl transform group-hover:scale-110 transition-transform">
              {{ lesson.coverImage || '📖' }}
            </div>
          </div>

          <h3
            class="text-2xl font-bold text-gray-800 mb-3 group-hover:text-amber-600 transition-colors"
          >
            {{ lesson.title }}
          </h3>
          <p class="text-gray-600 text-sm mb-5 line-clamp-3 leading-relaxed">
            {{ lesson.description }}
          </p>

          <!-- mt-auto：把「元信息 + 分隔线 + 难度·按钮」推到底部，
               这样描述只有一行时也不会让底部上浮，各卡片底部对齐 -->
          <div class="space-y-2 mt-auto mb-5 pb-5 border-b border-gray-100">
            <div class="flex items-center text-sm text-gray-600">
              <span class="mr-2 text-base">📅</span>
              <span class="font-medium">{{ lesson.period }}</span>
            </div>
            <div class="flex items-center text-sm text-gray-600">
              <span class="mr-2 text-base">🌍</span>
              <span class="font-medium">{{ lesson.civilization }}</span>
            </div>
            <div class="flex items-center text-sm text-gray-600">
              <span class="mr-2 text-base">⏱️</span>
              <span class="font-medium">{{ lesson.estimatedTime }} 分钟</span>
            </div>
            <div class="flex items-center text-sm text-gray-600">
              <span class="mr-2 text-base">❓</span>
              <span class="font-medium">{{ lesson.questions.length }} 道题目</span>
            </div>
          </div>

          <div class="flex items-center justify-between">
            <span
              :class="[
                'px-4 py-2 rounded-full text-xs font-bold shadow-sm',
                lesson.difficulty === 'beginner'
                  ? 'bg-gradient-to-r from-green-400 to-green-500 text-white'
                  : lesson.difficulty === 'intermediate'
                    ? 'bg-gradient-to-r from-yellow-400 to-yellow-500 text-white'
                    : 'bg-gradient-to-r from-red-400 to-red-500 text-white',
              ]"
            >
              {{ difficultyLabels[lesson.difficulty] }}
            </span>
            <button
              class="px-6 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl text-sm font-bold hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg hover:shadow-xl transform hover:scale-105"
              @click.stop="startLesson(lesson.id)"
            >
              {{ isCompleted(lesson.id) ? '重新学习' : '开始学习' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
