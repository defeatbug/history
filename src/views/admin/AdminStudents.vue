<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useUserStore } from '@/stores/user'
import {
  fetchStudents,
  fetchStudentOverview,
  fetchDailyActivity,
  type StudentSummary,
  type StudentOverview,
  type DailyActivity,
} from '@/services/admin'
import { formatRelativeTime, formatDateTime } from '@/utils/format'

const userStore = useUserStore()

const students = ref<StudentSummary[]>([])
const overview = ref<StudentOverview>({
  totalStudents: 0,
  activeStudents: 0,
  progressingStudents: 0,
  avgCompleted: 0,
  avgStudyMinutes: 0,
  avgCorrectRate: 0,
  correctRateSampleSize: 0,
  totalAnswers: 0,
  totalWrong: 0,
})
const activity = ref<DailyActivity[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const search = ref('')

// ---------------------------------------------------------------------------
// 统计带
// ---------------------------------------------------------------------------
/** 正确率是否有意义：只有学生答过题才算，否则显示占位符 */
const hasCorrectRate = computed(() => overview.value.correctRateSampleSize > 0)

const statSegments = computed(() => [
  {
    label: '学生总数',
    value: String(overview.value.totalStudents),
    unit: '人',
    hint: '',
    icon: '◔',
    tone: 'neutral' as const,
  },
  {
    label: '有学习记录',
    value: String(overview.value.activeStudents),
    unit: '人',
    hint: '',
    icon: '◑',
    tone: 'ok' as const,
  },
  {
    label: '平均完成',
    value: overview.value.avgCompleted.toFixed(1),
    unit: '门课程',
    hint: '',
    icon: '▤',
    tone: 'neutral' as const,
  },
  {
    label: '平均正确率',
    // 没人答过题时不显示 0%，而是显示占位符
    value: hasCorrectRate.value ? `${Math.round(overview.value.avgCorrectRate * 100)}` : '—',
    unit: hasCorrectRate.value ? '%' : '',
    // 明确标出样本量，避免把 1 人的正确率误读为全体水平
    hint: hasCorrectRate.value ? `基于 ${overview.value.correctRateSampleSize} 人` : '暂无答题数据',
    icon: '◈',
    tone: !hasCorrectRate.value
      ? ('neutral' as const)
      : overview.value.avgCorrectRate >= 0.8
        ? ('ok' as const)
        : overview.value.avgCorrectRate >= 0.5
          ? ('neutral' as const)
          : ('warn' as const),
  },
])

// ---------------------------------------------------------------------------
// 图 1：近 14 天答题活跃度
// ---------------------------------------------------------------------------
const CHART_HEIGHT = 132

const activityMax = computed(() =>
  Math.max(1, ...activity.value.map((d) => d.answerCount)),
)

/** 总答题数（用于判断图表是否为空） */
const activityTotal = computed(() => activity.value.reduce((n, d) => n + d.answerCount, 0))

function barHeight(count: number): string {
  if (count === 0) return '2px'
  return `${Math.max(6, Math.round((count / activityMax.value) * CHART_HEIGHT))}px`
}

/**
 * 只显示部分日期标签，避免拥挤。
 * 末尾两天一定同时显示会挤在一起，因此倒数第二天只在间隔恰好合适时才显示。
 */
function showLabel(index: number): boolean {
  const n = activity.value.length
  if (index === n - 1) return true
  if (index === 0) return true
  // 与末尾保持至少 2 个柱的距离
  if (n - 1 - index < 2) return false
  return index % 3 === 0
}

function shortDay(day: string): string {
  const [, m, d] = day.split('-')
  return `${Number(m)}/${Number(d)}`
}

// ---------------------------------------------------------------------------
// 图 2：完成课程数分布（从已加载的学生列表本地聚合，无需额外查询）
// ---------------------------------------------------------------------------
const completionBuckets = computed(() => {
  const buckets = [
    { label: '0 门', min: 0, max: 0, count: 0 },
    { label: '1 门', min: 1, max: 1, count: 0 },
    { label: '2-3 门', min: 2, max: 3, count: 0 },
    { label: '4-6 门', min: 4, max: 6, count: 0 },
    { label: '7 门以上', min: 7, max: Infinity, count: 0 },
  ]
  for (const s of students.value) {
    const b = buckets.find((x) => s.completedCount >= x.min && s.completedCount <= x.max)
    if (b) b.count++
  }
  return buckets
})

const bucketMax = computed(() => Math.max(1, ...completionBuckets.value.map((b) => b.count)))

// ---------------------------------------------------------------------------
// 学生表
// ---------------------------------------------------------------------------
type SortKey = 'username' | 'completedCount' | 'totalStudyTime' | 'correctRate' | 'answeredCount' | 'lastStudiedAt'
const sortKey = ref<SortKey>('completedCount')
const sortAsc = ref(false)

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value
  } else {
    sortKey.value = key
    sortAsc.value = key === 'username'
  }
}

const visibleStudents = computed(() => {
  const q = search.value.trim().toLowerCase()
  let list = students.value
  if (q) list = list.filter((s) => s.username.toLowerCase().includes(q))

  const dir = sortAsc.value ? 1 : -1
  return [...list].sort((a, b) => {
    switch (sortKey.value) {
      case 'username':
        return a.username.localeCompare(b.username, 'zh-CN') * dir
      case 'lastStudiedAt': {
        const av = a.lastStudiedAt ? new Date(a.lastStudiedAt).getTime() : 0
        const bv = b.lastStudiedAt ? new Date(b.lastStudiedAt).getTime() : 0
        return (av - bv) * dir
      }
      default:
        return ((a[sortKey.value] as number) - (b[sortKey.value] as number)) * dir
    }
  })
})

const studyHours = (minutes: number) => {
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
}

const rateTone = (rate: number) =>
  rate >= 0.8 ? 'text-emerald-600' : rate >= 0.5 ? 'text-amber-600' : 'text-rose-600'

// ---------------------------------------------------------------------------
async function load() {
  loading.value = true
  error.value = null

  const [studentsRes, overviewRes, activityRes] = await Promise.all([
    fetchStudents(userStore.userId),
    fetchStudentOverview(userStore.userId),
    fetchDailyActivity(userStore.userId, 14),
  ])

  students.value = studentsRes.data
  overview.value = overviewRes.data
  activity.value = activityRes.data
  error.value = studentsRes.error ?? activityRes.error ?? null
  loading.value = false
}

onMounted(load)
</script>

<template>
  <div class="space-y-5">
    <!-- ===================== 统计带 ===================== -->
    <div class="bg-white rounded-2xl border border-black/[0.06] flex divide-x divide-black/[0.06]">
      <div
        v-for="seg in statSegments"
        :key="seg.label"
        class="flex-1 min-w-0 px-5 py-4 flex items-center gap-3.5"
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
          <p v-if="seg.hint" class="text-[10.5px] text-[#9ca3af] mt-0.5 truncate">
            {{ seg.hint }}
          </p>
        </div>
      </div>
    </div>

    <!-- ===================== 加载 / 错误 ===================== -->
    <div v-if="loading" class="flex items-center justify-center py-24 gap-3 text-[#9ca3af]">
      <div class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
      <span class="text-[13px]">正在加载统计数据…</span>
    </div>

    <div
      v-else-if="error"
      class="bg-white rounded-2xl border border-black/[0.06] p-10 text-center space-y-3"
    >
      <p class="text-[13px] text-rose-600">加载失败：{{ error }}</p>
      <button class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px]" @click="load">重试</button>
    </div>

    <template v-else>
      <!-- ===================== 图表 ===================== -->
      <div class="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
        <!-- 图 1：活跃度 -->
        <section class="bg-white rounded-2xl border border-black/[0.06] p-5">
          <div class="flex items-baseline gap-2 mb-1">
            <h2 class="text-[13.5px] font-semibold">近 14 天答题活跃度</h2>
            <span class="text-[11.5px] text-[#9ca3af] ml-auto">
              合计 {{ activityTotal }} 次 · 峰值 {{ activityMax }}
            </span>
          </div>

          <div v-if="activityTotal === 0" class="h-[168px] flex flex-col items-center justify-center gap-2">
            <p class="text-[13px] text-[#9ca3af]">近 14 天还没有答题记录</p>
          </div>

          <div v-else class="mt-4">
            <div class="flex items-end gap-1.5" :style="{ height: `${CHART_HEIGHT}px` }">
              <div
                v-for="d in activity"
                :key="d.day"
                class="flex-1 flex flex-col justify-end items-center group relative"
                :title="`${d.day}：${d.answerCount} 次答题，${d.activeStudents} 名学生`"
              >
                <div
                  class="w-full rounded-t transition-all duration-300 group-hover:opacity-80"
                  :class="d.answerCount > 0 ? 'bg-amber-400' : 'bg-[#f3f4f6]'"
                  :style="{ height: barHeight(d.answerCount) }"
                ></div>
                <!-- 悬停数值 -->
                <span
                  v-if="d.answerCount > 0"
                  class="absolute -top-1 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-[#6b7280] opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {{ d.answerCount }}
                </span>
              </div>
            </div>
            <div class="flex gap-1.5 mt-1.5">
              <span
                v-for="(d, i) in activity"
                :key="d.day"
                class="flex-1 text-center text-[10px] text-[#9ca3af]"
              >
                {{ showLabel(i) ? shortDay(d.day) : '' }}
              </span>
            </div>
          </div>
        </section>

        <!-- 图 2：完成课程数分布 -->
        <section class="bg-white rounded-2xl border border-black/[0.06] p-5">
          <div class="flex items-baseline gap-2 mb-4">
            <h2 class="text-[13.5px] font-semibold">完成课程数分布</h2>
            <span class="text-[11.5px] text-[#9ca3af] ml-auto">{{ students.length }} 名学生</span>
          </div>

          <div class="space-y-3">
            <div v-for="b in completionBuckets" :key="b.label" class="space-y-1">
              <div class="flex justify-between text-[11.5px]">
                <span class="text-[#6b7280]">{{ b.label }}</span>
                <span class="text-[#111827] font-medium tabular-nums">{{ b.count }} 人</span>
              </div>
              <div class="w-full h-2 bg-[#f3f4f6] rounded-full overflow-hidden">
                <div
                  class="h-2 rounded-full transition-all duration-500"
                  :class="b.count > 0 ? 'bg-amber-400' : 'bg-transparent'"
                  :style="{ width: `${Math.round((b.count / bucketMax) * 100)}%` }"
                ></div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- ===================== 学生表 ===================== -->
      <section class="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
        <div class="flex items-center gap-3 px-4 py-3 border-b border-black/[0.06]">
          <h2 class="text-[13.5px] font-semibold">学生明细</h2>
          <span class="text-[11.5px] text-[#9ca3af]">
            仅显示用户名，不展示邮箱等个人身份信息
          </span>
          <input
            v-model="search"
            type="text"
            placeholder="搜索用户名"
            class="ml-auto w-[180px] h-8 px-3 rounded-lg bg-[#f9fafb] border border-black/[0.07] text-[12.5px] placeholder:text-[#9ca3af] outline-none focus:border-amber-400 focus:bg-white transition-all"
          />
        </div>

        <div v-if="students.length === 0" class="py-14 text-center space-y-2">
          <p class="text-4xl">👥</p>
          <p class="text-[13px] text-[#6b7280]">还没有学生账号</p>
        </div>

        <div v-else>
          <!-- 表头（可排序） -->
          <div
            class="grid grid-cols-[1.4fr_88px_108px_88px_100px_64px_120px] gap-3 px-4 py-2.5 border-b border-black/[0.06] text-[11.5px] font-medium text-[#9ca3af]"
          >
            <button class="text-left hover:text-[#6b7280]" @click="toggleSort('username')">
              用户名 <span v-if="sortKey === 'username'">{{ sortAsc ? '↑' : '↓' }}</span>
            </button>
            <button class="text-center hover:text-[#6b7280]" @click="toggleSort('completedCount')">
              完成课程 <span v-if="sortKey === 'completedCount'">{{ sortAsc ? '↑' : '↓' }}</span>
            </button>
            <button class="text-center hover:text-[#6b7280]" @click="toggleSort('totalStudyTime')">
              学习时长 <span v-if="sortKey === 'totalStudyTime'">{{ sortAsc ? '↑' : '↓' }}</span>
            </button>
            <button class="text-center hover:text-[#6b7280]" @click="toggleSort('correctRate')">
              正确率 <span v-if="sortKey === 'correctRate'">{{ sortAsc ? '↑' : '↓' }}</span>
            </button>
            <button class="text-center hover:text-[#6b7280]" @click="toggleSort('answeredCount')">
              答题 <span v-if="sortKey === 'answeredCount'">{{ sortAsc ? '↑' : '↓' }}</span>
            </button>
            <span class="text-center">勋章</span>
            <button class="text-right hover:text-[#6b7280]" @click="toggleSort('lastStudiedAt')">
              最后活跃 <span v-if="sortKey === 'lastStudiedAt'">{{ sortAsc ? '↑' : '↓' }}</span>
            </button>
          </div>

          <!-- 行 -->
          <div
            v-for="s in visibleStudents"
            :key="s.userId"
            class="grid grid-cols-[1.4fr_88px_108px_88px_100px_64px_120px] gap-3 px-4 py-3 items-center border-b border-black/[0.04] last:border-b-0 hover:bg-black/[0.015] transition-colors"
          >
            <!-- 用户名 -->
            <div class="flex items-center gap-2.5 min-w-0">
              <div
                class="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white text-[11px] font-semibold flex items-center justify-center flex-shrink-0"
              >
                {{ s.username.slice(0, 1) }}
              </div>
              <span class="text-[13px] truncate">{{ s.username }}</span>
              <span
                v-if="s.currentStreak >= 3"
                class="text-[10.5px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-600 font-medium flex-shrink-0"
                :title="`连续学习 ${s.currentStreak} 天`"
              >
                🔥{{ s.currentStreak }}
              </span>
            </div>

            <!-- 完成课程 + 进度条 -->
            <div class="text-center">
              <span class="text-[13px] tabular-nums">{{ s.completedCount }}</span>
              <div class="w-full h-1 bg-[#f3f4f6] rounded-full mt-1 overflow-hidden">
                <div
                  class="h-1 bg-amber-400 rounded-full"
                  :style="{ width: `${Math.min(100, s.completedCount * 7)}%` }"
                ></div>
              </div>
            </div>

            <!-- 学习时长 -->
            <span class="text-center text-[12.5px] text-[#4b5563] tabular-nums">
              {{ studyHours(s.totalStudyTime) }}
            </span>

            <!-- 正确率 -->
            <span
              :class="['text-center text-[13px] font-medium tabular-nums', rateTone(s.correctRate)]"
            >
              {{ s.answeredCount > 0 ? `${Math.round(s.correctRate * 100)}%` : '—' }}
            </span>

            <!-- 答题数 -->
            <span class="text-center text-[12.5px] text-[#4b5563] tabular-nums">
              {{ s.answeredCount }}
              <span v-if="s.wrongCount > 0" class="text-rose-500 text-[11px]">
                / 错 {{ s.wrongCount }}
              </span>
            </span>

            <!-- 勋章 -->
            <span class="text-center text-[13px] tabular-nums">{{ s.badgeCount }}</span>

            <!-- 最后活跃 -->
            <span
              class="text-right text-[12px] text-[#6b7280]"
              :title="s.lastStudiedAt ? formatDateTime(s.lastStudiedAt) : '从未学习'"
            >
              {{ s.lastStudiedAt ? formatRelativeTime(s.lastStudiedAt) : '从未学习' }}
            </span>
          </div>

          <p
            v-if="visibleStudents.length === 0"
            class="py-8 text-center text-[12.5px] text-[#9ca3af]"
          >
            没有匹配「{{ search }}」的学生
          </p>
        </div>
      </section>

      <!-- 隐私说明 -->
      <p class="text-[11.5px] text-[#9ca3af] text-center leading-relaxed">
        本页数据仅供教学观察，遵循最小必要原则：不展示邮箱等个人身份信息，
        且不提供任何修改学生进度或角色的入口。
      </p>
    </template>
  </div>
</template>
