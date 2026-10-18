<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { fetchAdminOverview, type AdminOverview } from '@/services/admin'

const router = useRouter()
const userStore = useUserStore()

const overview = ref<AdminOverview>({
  totalCourses: 0,
  totalQuestions: 0,
  needsAttention: 0,
  activeStudents: 0,
  totalAnswers: 0,
})
const loading = ref(true)
const error = ref<string | null>(null)

const statSegments = computed(() => [
  { label: '课程', value: String(overview.value.totalCourses), unit: '门', icon: '▤', tone: 'neutral' },
  { label: '题目', value: String(overview.value.totalQuestions), unit: '道', icon: '◈', tone: 'neutral' },
  { label: '待处理', value: String(overview.value.needsAttention), unit: '项', icon: '◐', tone: 'warn' },
  { label: '学生在学', value: String(overview.value.activeStudents), unit: '人', icon: '◔', tone: 'ok' },
  { label: '答题记录', value: String(overview.value.totalAnswers), unit: '条', icon: '◍', tone: 'neutral' },
] as const)

/** 模块入口 */
const modules = [
  { name: '课程', desc: '课程增删改查，看板拖拽调难度与顺序', path: '/admin/courses', icon: '▤' },
  { name: '历史事件', desc: '事件库增删改查，拖动调整展示顺序', path: '/admin/events', icon: '◈' },
  { name: '博物馆', desc: '博物馆增删改查，封面支持上传图片', path: '/admin/museums', icon: '▣' },
  { name: '文物', desc: '按馆录入文物，支持图片与详细介绍', path: '/admin/artifacts', icon: '◐' },
  { name: '勋章', desc: '仅可修改名称与描述，规则在数据库内', path: '/admin/badges', icon: '◇' },
  { name: '学习统计', desc: '只读：学生进度、答题活跃度', path: '/admin/students', icon: '◔' },
]

async function load() {
  loading.value = true
  error.value = null

  const res = await fetchAdminOverview(userStore.userId)
  overview.value = res.data
  error.value = res.error ?? null
  loading.value = false
}

onMounted(load)
</script>

<template>
  <div class="space-y-5">
    <!-- ===================== 数据卡片 ===================== -->
    <div v-if="loading" class="flex items-center justify-center py-16 gap-3 text-[#9ca3af]">
      <div class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
      <span class="text-[13px]">正在加载概览…</span>
    </div>

    <div
      v-else-if="error"
      class="bg-white rounded-2xl border border-black/[0.06] p-10 text-center space-y-3"
    >
      <p class="text-[13px] text-rose-600">加载失败：{{ error }}</p>
      <button class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px]" @click="load">重试</button>
    </div>

    <div v-else class="bg-white rounded-2xl border border-black/[0.06] flex divide-x divide-black/[0.06] overflow-x-auto">
      <div
        v-for="seg in statSegments"
        :key="seg.label"
        class="flex-1 min-w-[140px] px-5 py-4 flex items-center gap-3.5"
      >
        <div
          :class="[
            'w-9 h-9 rounded-full flex items-center justify-center text-[15px] flex-shrink-0',
            seg.tone === 'warn'
              ? 'bg-rose-50 text-rose-500'
              : seg.tone === 'ok'
                ? 'bg-emerald-50 text-emerald-600'
                : 'bg-[#f3f4f6] text-[#6b7280]',
          ]"
        >
          {{ seg.icon }}
        </div>
        <div class="min-w-0">
          <p class="text-[11.5px] text-[#9ca3af] truncate">{{ seg.label }}</p>
          <p class="leading-tight">
            <span class="text-[22px] font-semibold tracking-tight">{{ seg.value }}</span>
            <span class="text-[12px] text-[#9ca3af] ml-1">{{ seg.unit }}</span>
          </p>
        </div>
      </div>
    </div>

    <!-- ===================== 模块入口 ===================== -->
    <div>
      <h2 class="text-[13px] font-semibold text-[#6b7280] mb-3 px-1">内容模块</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <button
          v-for="m in modules"
          :key="m.path"
          class="bg-white rounded-2xl border border-black/[0.06] p-5 text-left hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)] hover:-translate-y-0.5 transition-all group"
          @click="router.push(m.path)"
        >
          <div
            class="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center text-[18px] mb-3 group-hover:bg-amber-100 transition-colors"
          >
            {{ m.icon }}
          </div>
          <h3 class="text-[14.5px] font-semibold">{{ m.name }}</h3>
          <p class="text-[12.5px] text-[#6b7280] mt-1 leading-relaxed">{{ m.desc }}</p>
          <p class="text-[12.5px] text-amber-600 mt-2.5 font-medium">进入 →</p>
        </button>
      </div>
    </div>
  </div>
</template>
