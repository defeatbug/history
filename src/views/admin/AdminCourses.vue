<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { toast } from 'vue3-toastify'
import { useUserStore } from '@/stores/user'
import {
  fetchAdminCourses,
  fetchAdminOverview,
  updateCourseDifficulty,
  updateCourseOrder,
  DIFFICULTY_META,
  type AdminCourse,
  type AdminOverview,
  type Difficulty,
} from '@/services/admin'

const router = useRouter()
const userStore = useUserStore()

const courses = ref<AdminCourse[]>([])
const overview = ref<AdminOverview>({
  totalCourses: 0,
  totalQuestions: 0,
  needsAttention: 0,
  activeStudents: 0,
  totalAnswers: 0,
})
const loading = ref(true)
const error = ref<string | null>(null)
const saving = ref(false)

const DIFFICULTY_ORDER: Difficulty[] = ['beginner', 'intermediate', 'advanced']

/** 筛选状态 */
const activeFilter = ref<'all' | Difficulty>('all')
const onlyNeedsWork = ref(false)

/**
 * 看板数据。
 * 用可变的 three-array 结构而不是 computed，
 * 因为拖拽需要就地修改数组（computed 只读）。
 */
const board = reactive<Record<Difficulty, AdminCourse[]>>({
  beginner: [],
  intermediate: [],
  advanced: [],
})

/** 从 courses 重建看板（应用筛选） */
function rebuildBoard() {
  for (const d of DIFFICULTY_ORDER) {
    board[d] = courses.value
      .filter((c) => c.difficulty === d)
      .filter((c) => (onlyNeedsWork.value ? needsWork(c) : true))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }
}

const columns = computed(() =>
  DIFFICULTY_ORDER.map((d) => {
    const items = board[d]
    return {
      difficulty: d,
      meta: DIFFICULTY_META[d],
      avgQuestions: items.length
        ? Math.round(items.reduce((n, c) => n + c.questionCount, 0) / items.length)
        : 0,
    }
  }),
)

function needsWork(c: AdminCourse): boolean {
  return c.questionCount === 0 || c.questionsWithoutExplanation > 0 || !c.coverUrl
}

function hasStudentImpact(c: AdminCourse): boolean {
  return c.studentCompletedCount > 0 || c.answerRecordCount > 0
}

const alerts = computed(() => {
  const noQuestions = courses.value.filter((c) => c.questionCount === 0).length
  const noCover = courses.value.filter((c) => !c.coverUrl).length
  const noExplanation = courses.value.filter((c) => c.questionsWithoutExplanation > 0).length
  return [
    { key: 'noQuestions', label: '无题目', count: noQuestions },
    { key: 'noCover', label: '缺封面图', count: noCover },
    { key: 'noExplanation', label: '题目缺解析', count: noExplanation },
  ].filter((a) => a.count > 0)
})

/** 拖拽禁用条件：筛选状态下移动会打乱未显示项的顺序 */
const dragDisabled = computed(() => onlyNeedsWork.value || activeFilter.value !== 'all')

// ---------------------------------------------------------------------------
// 拖拽落点处理：把看板的新顺序 diff 回数据库
// ---------------------------------------------------------------------------
async function onDragEnd() {
  if (saving.value) return
  saving.value = true

  // 建立原状态索引，便于 diff
  const before = new Map(courses.value.map((c) => [c.id, c]))

  const difficultyChanges: Array<{ id: string; difficulty: Difficulty }> = []
  const orderChanges: Array<{ id: string; sortOrder: number }> = []

  for (const d of DIFFICULTY_ORDER) {
    board[d].forEach((course, index) => {
      const prev = before.get(course.id)
      if (!prev) return
      if (prev.difficulty !== d) {
        difficultyChanges.push({ id: course.id, difficulty: d })
      }
      if (prev.sortOrder !== index) {
        orderChanges.push({ id: course.id, sortOrder: index })
      }
    })
  }

  if (difficultyChanges.length === 0 && orderChanges.length === 0) {
    saving.value = false
    return
  }

  // 乐观更新本地状态，避免拖拽后回弹
  for (const ch of difficultyChanges) {
    const c = courses.value.find((x) => x.id === ch.id)
    if (c) c.difficulty = ch.difficulty
  }
  for (const ch of orderChanges) {
    const c = courses.value.find((x) => x.id === ch.id)
    if (c) c.sortOrder = ch.sortOrder
  }

  try {
    for (const ch of difficultyChanges) {
      const res = await updateCourseDifficulty(ch.id, ch.difficulty)
      if (!res.ok) throw new Error(res.error)
    }
    if (orderChanges.length > 0) {
      const res = await updateCourseOrder(orderChanges)
      if (!res.ok) throw new Error(res.error)
    }

    if (difficultyChanges.length > 0) {
      const moved = difficultyChanges
        .map((ch) => `${before.get(ch.id)?.title} → ${DIFFICULTY_META[ch.difficulty].label}`)
        .join('、')
      toast.success(`已调整：${moved}`, { theme: 'auto', transition: 'slide' })
    }
  } catch (e) {
    toast.error(`保存失败：${e instanceof Error ? e.message : '未知错误'}`, { theme: 'auto' })
    await load() // 回滚到服务端真实状态
  } finally {
    saving.value = false
  }
}

// ---------------------------------------------------------------------------

const statSegments = computed(() => [
  { label: '内容总数', value: String(overview.value.totalCourses), unit: '门课程', icon: '▤', tone: 'neutral' },
  { label: '待处理', value: String(overview.value.needsAttention), unit: '项', icon: '◐', tone: 'warn' },
  { label: '学生在学', value: String(overview.value.activeStudents), unit: '人', icon: '◔', tone: 'ok' },
  { label: '答题记录', value: String(overview.value.totalAnswers), unit: '条', icon: '◈', tone: 'neutral' },
])

const load = async () => {
  loading.value = true
  error.value = null
  const [courseRes, overviewRes] = await Promise.all([
    fetchAdminCourses(userStore.userId),
    fetchAdminOverview(userStore.userId),
  ])
  courses.value = courseRes.data
  overview.value = overviewRes.data
  error.value = courseRes.error ?? overviewRes.error ?? null
  rebuildBoard()
  loading.value = false
}

function setFilter(f: 'all' | Difficulty) {
  activeFilter.value = f
  rebuildBoard()
}

function toggleNeedsWork() {
  onlyNeedsWork.value = !onlyNeedsWork.value
  rebuildBoard()
}

const openCourse = (id: string) => router.push(`/admin/courses/${id}`)

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
        </div>
      </div>
    </div>

    <!-- ===================== 筛选与警示 ===================== -->
    <div class="flex flex-wrap items-center gap-2">
      <button
        v-for="f in [
          { key: 'all' as const, label: '全部' },
          ...DIFFICULTY_ORDER.map((d) => ({ key: d, label: DIFFICULTY_META[d].label })),
        ]"
        :key="f.key"
        :class="[
          'h-8 px-3.5 rounded-full text-[12.5px] font-medium transition-colors border',
          activeFilter === f.key
            ? 'bg-[#111827] text-white border-[#111827]'
            : 'bg-white text-[#4b5563] border-black/[0.07] hover:bg-black/[0.02]',
        ]"
        @click="setFilter(f.key)"
      >
        {{ f.label }}
      </button>

      <span class="w-px h-5 bg-black/[0.08] mx-1"></span>

      <button
        v-for="a in alerts"
        :key="a.key"
        :class="[
          'h-8 pl-3.5 pr-1.5 rounded-full border text-[12.5px] transition-colors flex items-center gap-2',
          onlyNeedsWork
            ? 'bg-[#111827] text-white border-[#111827]'
            : 'bg-white text-[#4b5563] border-black/[0.07] hover:bg-black/[0.02]',
        ]"
        @click="toggleNeedsWork"
      >
        <span>{{ a.label }}</span>
        <span
          :class="[
            'w-[18px] h-[18px] rounded-full text-[10.5px] font-semibold flex items-center justify-center',
            onlyNeedsWork ? 'bg-white/20 text-white' : 'bg-[#111827] text-white',
          ]"
        >
          {{ a.count }}
        </span>
      </button>

      <div class="ml-auto flex items-center gap-3">
        <p v-if="dragDisabled" class="text-[12px] text-amber-600">
          筛选状态下已停用拖拽，以免打乱未显示项的顺序
        </p>
        <p class="text-[12.5px] text-[#9ca3af]">显示 {{ courses.length }} 门课程</p>
      </div>
    </div>

    <!-- ===================== 加载 / 错误 ===================== -->
    <div v-if="loading" class="flex items-center justify-center py-24 gap-3 text-[#9ca3af]">
      <div class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
      <span class="text-[13px]">正在加载课程…</span>
    </div>

    <div
      v-else-if="error"
      class="bg-white rounded-2xl border border-black/[0.06] p-10 text-center space-y-3"
    >
      <p class="text-[13px] text-rose-600">加载失败：{{ error }}</p>
      <button class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px] font-medium" @click="load">
        重试
      </button>
    </div>

    <!-- ===================== 难度看板 ===================== -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
      <section
        v-for="col in columns"
        :key="col.difficulty"
        class="rounded-2xl bg-black/[0.025] p-3 min-h-[220px]"
      >
        <!-- 列头 -->
        <header class="flex items-center gap-2 px-1.5 pb-3">
          <span :class="['w-1.5 h-1.5 rounded-full', col.meta.dot]"></span>
          <h2 class="text-[13.5px] font-semibold">{{ col.meta.label }}</h2>
          <span
            :class="[
              'w-[20px] h-[20px] rounded-full text-[11px] font-semibold flex items-center justify-center',
              col.meta.chip,
            ]"
          >
            {{ board[col.difficulty].length }}
          </span>
          <span class="ml-auto text-[11.5px] text-[#9ca3af]">平均 {{ col.avgQuestions }} 题</span>
        </header>

        <!-- 可拖拽的卡片列表 -->
        <VueDraggable
          v-model="board[col.difficulty]"
          :group="{ name: 'admin-courses' }"
          :animation="160"
          :disabled="dragDisabled"
          ghost-class="drag-ghost"
          chosen-class="drag-chosen"
          class="space-y-2.5 min-h-[60px]"
          @end="onDragEnd"
        >
          <article
            v-for="course in board[col.difficulty]"
            :key="course.id"
            :class="[
              'bg-white rounded-xl border border-black/[0.06] p-3.5 transition-shadow group',
              dragDisabled ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
              'hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)]',
            ]"
            @click="openCourse(course.id)"
          >
            <div class="flex items-start gap-3">
              <div
                class="w-9 h-9 rounded-full flex items-center justify-center text-[17px] flex-shrink-0 overflow-hidden bg-[#f9fafb] border border-black/[0.05]"
              >
                <img
                  v-if="course.coverUrl"
                  :src="course.coverUrl"
                  :alt="course.title"
                  class="w-full h-full object-cover"
                />
                <span v-else>{{ course.coverImage || '📖' }}</span>
              </div>
              <div class="min-w-0 flex-1">
                <h3 class="text-[13.5px] font-semibold leading-snug truncate">{{ course.title }}</h3>
                <p class="text-[11.5px] text-[#9ca3af] truncate mt-0.5">
                  {{ course.period || '未设时期' }} · {{ course.civilization || '未设文明' }}
                </p>
              </div>
              <!-- 拖拽手柄提示 -->
              <span
                v-if="!dragDisabled"
                class="text-[13px] text-[#d1d5db] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                title="拖动可切换难度"
              >
                ⠿
              </span>
            </div>

            <div class="flex flex-wrap gap-1.5 mt-3">
              <span
                :class="[
                  'h-[22px] px-2 rounded-md text-[11px] font-medium flex items-center gap-1',
                  course.questionCount === 0 ? 'bg-rose-50 text-rose-600' : 'bg-[#f3f4f6] text-[#6b7280]',
                ]"
              >
                ◈ {{ course.questionCount }} 题
              </span>
              <span
                class="h-[22px] px-2 rounded-md bg-[#f3f4f6] text-[#6b7280] text-[11px] font-medium flex items-center gap-1"
              >
                ◔ {{ course.estimatedTime }} 分钟
              </span>
            </div>

            <!-- ★ 影响面常驻：本界面的核心想法 -->
            <div
              v-if="hasStudentImpact(course)"
              class="mt-3 rounded-lg bg-amber-50 border border-amber-100 px-2.5 py-2"
            >
              <p class="text-[11.5px] text-amber-800 leading-relaxed">
                <span class="font-semibold">{{ course.studentCompletedCount }} 名学生</span>
                学过这门课<template v-if="course.answerRecordCount > 0"
                  >，已有 <span class="font-semibold">{{ course.answerRecordCount }} 条</span> 答题记录</template
                ><template v-else>，但还没产生答题记录</template>
              </p>
            </div>

            <div
              v-else-if="needsWork(course)"
              class="mt-3 rounded-lg bg-[#f9fafb] border border-black/[0.05] px-2.5 py-2"
            >
              <p class="text-[11.5px] text-[#6b7280] leading-relaxed">
                <template v-if="course.questionCount === 0">尚无题目</template>
                <template v-else-if="course.questionsWithoutExplanation > 0">
                  {{ course.questionsWithoutExplanation }} 道题缺解析
                </template>
                <template v-else>未上传封面图</template>
              </p>
            </div>
          </article>
        </VueDraggable>

        <!-- 列内空态 -->
        <div
          v-if="board[col.difficulty].length === 0"
          class="rounded-xl border border-dashed border-black/[0.1] py-8 text-center -mt-2.5"
        >
          <p class="text-[12.5px] text-[#9ca3af]">
            {{ dragDisabled ? '这一档暂无课程' : '拖一张卡片到这里' }}
          </p>
        </div>

        <button
          class="w-full h-9 mt-2.5 rounded-xl text-[12.5px] text-[#6b7280] hover:bg-black/[0.03] transition-colors flex items-center justify-center gap-1.5"
          @click="router.push(`/admin/courses/new?difficulty=${col.difficulty}`)"
        >
          <span>＋</span><span>新增{{ col.meta.label }}课程</span>
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* 拖拽反馈 */
.drag-ghost {
  opacity: 0.35;
  background: #fef3c7 !important;
  border-style: dashed !important;
}
.drag-chosen {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  transform: rotate(1.5deg);
}
</style>
