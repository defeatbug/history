<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { useLessonStore } from '../stores/lesson'

const router = useRouter()
const userStore = useUserStore()
const lessonStore = useLessonStore()

// 课程数据改为异步加载（优先数据库，失败回退本地），因此用 computed 保持响应式
const recentLessons = computed(() => lessonStore.allLessons.slice(0, 3))

// 断点续学：上次未完成的课程
const resumeLesson = computed(() => {
  const target = userStore.resumeTarget
  if (!target) return null
  return lessonStore.getLessonById(target.lessonId) ?? null
})

const resumePositionText = computed(() => {
  const lesson = resumeLesson.value
  const target = userStore.resumeTarget
  if (!lesson || !target) return ''
  return `第 ${target.position + 1} / ${lesson.questions.length} 题`
})

const continueLearning = () => {
  const target = userStore.resumeTarget
  if (target) router.push(`/lessons/${target.lessonId}`)
}

const startLearning = (lessonId: string) => {
  router.push(`/lessons/${lessonId}`)
}

onMounted(() => {
  void lessonStore.loadLessons()
})
</script>

<template>
  <div class="space-y-12">
    <!-- 英雄区域 -->
    <div class="relative text-center space-y-6 py-16 overflow-hidden">
      <!-- 背景装饰 -->
      <div class="absolute inset-0 opacity-10">
        <div class="absolute top-0 left-1/4 w-64 h-64 bg-amber-400 rounded-full blur-3xl"></div>
        <div
          class="absolute bottom-0 right-1/4 w-64 h-64 bg-orange-400 rounded-full blur-3xl"
        ></div>
      </div>

      <div class="relative z-10">
        <div class="inline-block mb-4">
          <image class="animate-bounce w-64 h-64" src="../../public/images/history_logo.png" />
        </div>
        <h1
          class="text-5xl md:text-7xl font-bold bg-gradient-to-r from-amber-600 via-orange-500 to-red-500 bg-clip-text text-transparent mb-4"
        >
          HistoriaQuest
        </h1>
        <p class="text-xl md:text-2xl text-gray-700 max-w-3xl mx-auto font-medium">
          通过游戏化的方式探索历史的奥秘<br />
          <span class="text-lg text-gray-600">在任务、提问与知识点探索中学习历史脉络</span>
        </p>
        <div class="flex flex-col sm:flex-row justify-center items-center gap-4 mt-8">
          <router-link
            to="/lessons"
            class="group px-10 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-bold text-lg hover:from-amber-600 hover:to-orange-600 transition-all shadow-xl hover:shadow-2xl transform hover:-translate-y-1"
          >
            <span class="flex items-center gap-2">
              开始学习
              <span class="group-hover:translate-x-1 transition-transform">→</span>
            </span>
          </router-link>
          <router-link
            to="/timeline"
            class="px-10 py-4 bg-white text-amber-600 border-2 border-amber-500 rounded-xl font-bold text-lg hover:bg-amber-50 transition-all shadow-lg hover:shadow-xl"
          >
            查看学习路径
          </router-link>
        </div>
      </div>
    </div>

    <!-- 断点续学卡片 -->
    <div
      v-if="resumeLesson"
      class="relative overflow-hidden bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl shadow-xl p-6 md:p-8"
    >
      <div class="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full"></div>
      <div class="absolute -bottom-12 right-24 w-32 h-32 bg-white/10 rounded-full"></div>

      <div class="relative flex flex-col md:flex-row md:items-center gap-6">
        <div class="text-6xl">{{ resumeLesson.coverImage || '📖' }}</div>

        <div class="flex-1 space-y-1">
          <p class="text-amber-50 text-sm font-medium">继续上次的学习</p>
          <h3 class="text-2xl md:text-3xl font-bold text-white">{{ resumeLesson.title }}</h3>
          <p class="text-amber-50 text-sm">
            已完成 {{ resumePositionText }} · 上次学习
            {{ new Date(userStore.progress.lastStudiedAt || '').toLocaleDateString('zh-CN') }}
          </p>
        </div>

        <button
          @click="continueLearning"
          class="px-8 py-4 bg-white text-amber-600 rounded-xl font-bold hover:bg-amber-50 transition-all shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 whitespace-nowrap"
        >
          继续学习 →
        </button>
      </div>
    </div>

    <!-- 用户统计卡片 -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
      <div
        class="group relative bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-6 shadow-lg hover:shadow-2xl transition-all transform hover:-translate-y-2 border border-blue-200"
      >
        <div
          class="absolute top-2 right-2 w-20 h-20 bg-blue-200 rounded-full opacity-20 blur-xl"
        ></div>
        <div class="relative flex items-center justify-between">
          <div>
            <p class="text-blue-700 text-sm font-medium mb-1">已完成课程</p>
            <p class="text-4xl font-bold text-blue-900">
              {{ userStore.progress.completedLessons.length }}
            </p>
          </div>
          <div class="text-5xl transform group-hover:scale-110 transition-transform">📚</div>
        </div>
      </div>

      <div
        class="group relative bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-2xl p-6 shadow-lg hover:shadow-2xl transition-all transform hover:-translate-y-2 border border-yellow-200"
      >
        <div
          class="absolute top-2 right-2 w-20 h-20 bg-yellow-200 rounded-full opacity-20 blur-xl"
        ></div>
        <div class="relative flex items-center justify-between">
          <div>
            <p class="text-yellow-700 text-sm font-medium mb-1">获得勋章</p>
            <p class="text-4xl font-bold text-yellow-900">
              {{ userStore.unlockedBadges.length }}
            </p>
          </div>
          <div class="text-5xl transform group-hover:scale-110 transition-transform">🏆</div>
        </div>
      </div>

      <div
        class="group relative bg-gradient-to-br from-purple-50 to-purple-100 rounded-2xl p-6 shadow-lg hover:shadow-2xl transition-all transform hover:-translate-y-2 border border-purple-200"
      >
        <div
          class="absolute top-2 right-2 w-20 h-20 bg-purple-200 rounded-full opacity-20 blur-xl"
        ></div>
        <div class="relative flex items-center justify-between">
          <div>
            <p class="text-purple-700 text-sm font-medium mb-1">学习时长</p>
            <p class="text-4xl font-bold text-purple-900">
              {{ Math.floor(userStore.progress.totalStudyTime / 60) }}h
            </p>
          </div>
          <div class="text-5xl transform group-hover:scale-110 transition-transform">⏰</div>
        </div>
      </div>

      <div
        class="group relative bg-gradient-to-br from-red-50 to-red-100 rounded-2xl p-6 shadow-lg hover:shadow-2xl transition-all transform hover:-translate-y-2 border border-red-200"
      >
        <div
          class="absolute top-2 right-2 w-20 h-20 bg-red-200 rounded-full opacity-20 blur-xl"
        ></div>
        <div class="relative flex items-center justify-between">
          <div>
            <p class="text-red-700 text-sm font-medium mb-1">连续学习</p>
            <p class="text-4xl font-bold text-red-900">{{ userStore.progress.currentStreak }} 天</p>
          </div>
          <div class="text-5xl transform group-hover:scale-110 transition-transform">🔥</div>
        </div>
      </div>
    </div>

    <!-- 推荐课程 -->
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h2
          class="text-4xl font-bold bg-gradient-to-r from-amber-600 to-orange-500 bg-clip-text text-transparent"
        >
          推荐课程
        </h2>
        <router-link
          to="/lessons"
          class="text-amber-600 hover:text-amber-700 font-semibold text-sm flex items-center gap-1 group"
        >
          查看全部
          <span class="group-hover:translate-x-1 transition-transform">→</span>
        </router-link>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div
          v-for="lesson in recentLessons"
          :key="lesson.id"
          class="group relative bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-2xl transition-all cursor-pointer transform hover:-translate-y-2 border border-gray-100"
          @click="startLearning(lesson.id)"
        >
          <!-- 渐变背景 -->
          <div
            class="absolute inset-0 bg-gradient-to-br from-amber-50/50 to-orange-50/50 opacity-0 group-hover:opacity-100 transition-opacity"
          ></div>

          <div class="relative p-6">
            <div class="flex items-start justify-between mb-4">
              <div class="text-6xl transform group-hover:scale-110 transition-transform">
                {{ lesson.coverImage || '📖' }}
              </div>
              <span
                :class="[
                  'px-3 py-1 rounded-full text-xs font-bold shadow-sm',
                  lesson.difficulty === 'beginner'
                    ? 'bg-gradient-to-r from-green-400 to-green-500 text-white'
                    : lesson.difficulty === 'intermediate'
                      ? 'bg-gradient-to-r from-yellow-400 to-yellow-500 text-white'
                      : 'bg-gradient-to-r from-red-400 to-red-500 text-white',
                ]"
              >
                {{
                  lesson.difficulty === 'beginner'
                    ? '初级'
                    : lesson.difficulty === 'intermediate'
                      ? '中级'
                      : '高级'
                }}
              </span>
            </div>
            <h3
              class="text-xl font-bold text-gray-800 mb-2 group-hover:text-amber-600 transition-colors"
            >
              {{ lesson.title }}
            </h3>
            <p class="text-gray-600 text-sm mb-4 line-clamp-2">{{ lesson.description }}</p>
            <div class="space-y-2 pt-4 border-t border-gray-100">
              <div class="flex items-center justify-between text-sm">
                <span class="text-gray-500 flex items-center gap-1">📅</span>
                <span class="text-gray-700 font-medium">{{ lesson.period }}</span>
              </div>
              <div class="flex items-center justify-between text-sm">
                <span class="text-gray-500 flex items-center gap-1">⏱️</span>
                <span class="text-gray-700 font-medium">{{ lesson.estimatedTime }} 分钟</span>
              </div>
              <div class="flex items-center justify-between text-sm">
                <span class="text-gray-500 flex items-center gap-1">❓</span>
                <span class="text-gray-700 font-medium">{{ lesson.questions.length }} 道题目</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 最近成就 -->
    <div v-if="userStore.unlockedBadges.length > 0" class="space-y-6">
      <h2 class="text-3xl font-bold text-gray-800">最近成就</h2>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div
          v-for="badge in userStore.unlockedBadges.slice(0, 5)"
          :key="badge.id"
          class="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 text-center hover:shadow-lg transition-shadow"
        >
          <div class="text-4xl mb-2">{{ badge.icon }}</div>
          <p class="text-sm font-semibold text-gray-800">{{ badge.name }}</p>
        </div>
      </div>
    </div>

    <!-- 学习建议 -->
    <div class="bg-blue-50 border-l-4 border-blue-500 rounded-xl p-6">
      <div class="flex items-start space-x-4">
        <div class="text-4xl">💡</div>
        <div>
          <h3 class="text-xl font-bold text-gray-800 mb-2">学习建议</h3>
          <ul class="space-y-2 text-gray-700">
            <li class="flex items-start">
              <span class="mr-2">✓</span>
              <span>建议按照时间顺序学习，从古代文明开始，逐步了解历史发展脉络</span>
            </li>
            <li class="flex items-start">
              <span class="mr-2">✓</span>
              <span>每完成一门课程后，可以在学习路径页面查看相关历史事件</span>
            </li>
            <li class="flex items-start">
              <span class="mr-2">✓</span>
              <span>保持连续学习可以获得额外奖励</span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 特色功能 -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <div
        class="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-all transform hover:-translate-y-1"
      >
        <div class="text-4xl mb-4">📊</div>
        <h3 class="text-xl font-bold text-gray-800 mb-2">学习统计</h3>
        <p class="text-gray-600 text-sm mb-4">查看详细的学习数据，包括正确率、学习时长和进度分析</p>
        <router-link
          to="/stats"
          class="text-amber-600 hover:text-amber-700 font-semibold text-sm flex items-center gap-1 group"
        >
          查看统计
          <span class="group-hover:translate-x-1 transition-transform">→</span>
        </router-link>
      </div>

      <div
        class="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-all transform hover:-translate-y-1"
      >
        <div class="text-4xl mb-4">🗺️</div>
        <h3 class="text-xl font-bold text-gray-800 mb-2">时间轴探索</h3>
        <p class="text-gray-600 text-sm mb-4">沿着历史时间轴，探索从古代到现代的重大历史事件</p>
        <router-link
          to="/timeline"
          class="text-amber-600 hover:text-amber-700 font-semibold text-sm flex items-center gap-1 group"
        >
          探索时间轴
          <span class="group-hover:translate-x-1 transition-transform">→</span>
        </router-link>
      </div>

      <div
        class="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-all transform hover:-translate-y-1"
      >
        <div class="text-4xl mb-4">🏛️</div>
        <h3 class="text-xl font-bold text-gray-800 mb-2">世界博物馆</h3>
        <p class="text-gray-600 text-sm mb-4">
          浏览世界著名博物馆的珍贵文物，了解历史文化的实物见证
        </p>
        <router-link
          to="/museums"
          class="text-amber-600 hover:text-amber-700 font-semibold text-sm flex items-center gap-1 group"
        >
          浏览博物馆
          <span class="group-hover:translate-x-1 transition-transform">→</span>
        </router-link>
      </div>

      <div
        class="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-all transform hover:-translate-y-1"
      >
        <div class="text-4xl mb-4">🏆</div>
        <h3 class="text-xl font-bold text-gray-800 mb-2">勋章收集</h3>
        <p class="text-gray-600 text-sm mb-4">完成学习任务，解锁各种成就勋章，展示你的学习成果</p>
        <router-link
          to="/badges"
          class="text-amber-600 hover:text-amber-700 font-semibold text-sm flex items-center gap-1 group"
        >
          查看勋章
          <span class="group-hover:translate-x-1 transition-transform">→</span>
        </router-link>
      </div>
    </div>

    <!-- 快速开始 -->
    <div class="bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl p-8 text-white">
      <div class="max-w-2xl mx-auto text-center space-y-4">
        <h2 class="text-3xl font-bold">准备好开始你的历史之旅了吗？</h2>
        <p class="text-lg opacity-90">选择一门课程，开始探索人类文明的伟大历程</p>
        <router-link
          to="/lessons"
          class="inline-block px-8 py-3 bg-white text-amber-600 rounded-lg font-semibold hover:bg-gray-100 transition-colors shadow-lg"
        >
          浏览所有课程
        </router-link>
      </div>
    </div>
  </div>
</template>
