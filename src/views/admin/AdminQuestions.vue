<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { toast } from 'vue3-toastify'
import { useUserStore } from '@/stores/user'
import {
  fetchAdminCourse,
  fetchAdminQuestions,
  fetchQuestionImpact,
  updateQuestionOrder,
  deleteQuestion,
  DIFFICULTY_META,
  type AdminCourse,
  type AdminQuestion,
} from '@/services/admin'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const courseId = computed(() => String(route.params.id))

const course = ref<AdminCourse | null>(null)
const questions = ref<AdminQuestion[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const saving = ref(false)
const search = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return questions.value
  return questions.value.filter(
    (item) =>
      item.content.toLowerCase().includes(q) ||
      item.options.some((o) => o.toLowerCase().includes(q)),
  )
})

/** 搜索状态下禁止拖拽，避免打乱未显示项的顺序 */
const dragDisabled = computed(() => search.value.trim().length > 0)

const OPTION_LETTERS = 'ABCDEF'

// ---------------------------------------------------------------------------
// 拖拽排序
// ---------------------------------------------------------------------------
async function onDragEnd() {
  if (saving.value) return
  saving.value = true

  const before = new Map(questions.value.map((q) => [q.id, q.sortOrder]))
  const changes = questions.value
    .map((q, index) => ({ id: q.id, sortOrder: index }))
    .filter((c) => before.get(c.id) !== c.sortOrder)

  if (changes.length === 0) {
    saving.value = false
    return
  }

  // 乐观更新
  changes.forEach((c) => {
    const q = questions.value.find((x) => x.id === c.id)
    if (q) q.sortOrder = c.sortOrder
  })

  try {
    const res = await updateQuestionOrder(changes)
    if (!res.ok) throw new Error(res.error)
  } catch (e) {
    toast.error(`排序保存失败：${e instanceof Error ? e.message : '未知错误'}`, { theme: 'auto' })
    await load()
  } finally {
    saving.value = false
  }
}

// ---------------------------------------------------------------------------
// 删除（影响面预览）
// ---------------------------------------------------------------------------
const deleteTarget = ref<AdminQuestion | null>(null)
const deleteImpact = ref<{ answered: number; wrong: number } | null>(null)
const deleteConfirmText = ref('')

const canConfirmDelete = computed(
  () => !!deleteTarget.value && deleteConfirmText.value.trim() === deleteTarget.value.id,
)

async function openDelete(q: AdminQuestion) {
  deleteTarget.value = q
  deleteConfirmText.value = ''
  deleteImpact.value = null
  const impact = await fetchQuestionImpact(q.id)
  deleteImpact.value = { answered: impact.answered, wrong: impact.wrong }
}

async function confirmDelete() {
  if (!canConfirmDelete.value || !deleteTarget.value) return
  saving.value = true
  try {
    const res = await deleteQuestion(deleteTarget.value.id)
    if (!res.ok) throw new Error(res.error)
    toast.success('题目已删除', { theme: 'auto', transition: 'slide' })
    deleteTarget.value = null
    await load()
    await reloadCourse()
  } catch (e) {
    toast.error(`删除失败：${e instanceof Error ? e.message : '未知错误'}`, { theme: 'auto' })
  } finally {
    saving.value = false
  }
}

// ---------------------------------------------------------------------------
const reloadCourse = async () => {
  const res = await fetchAdminCourse(userStore.userId, courseId.value)
  course.value = res.data
}

async function load() {
  loading.value = true
  error.value = null

  const [courseRes, questionRes] = await Promise.all([
    fetchAdminCourse(userStore.userId, courseId.value),
    fetchAdminQuestions(userStore.userId, courseId.value),
  ])

  course.value = courseRes.data
  questions.value = questionRes.data
  error.value = questionRes.error ?? courseRes.error ?? null
  loading.value = false
}

const editQuestion = (id: string) =>
  router.push(`/admin/courses/${courseId.value}/questions/${id}`)
const newQuestion = () => router.push(`/admin/courses/${courseId.value}/questions/new`)

onMounted(load)
</script>

<template>
  <div class="space-y-5">
    <!-- ===================== 顶部 ===================== -->
    <div class="flex flex-wrap items-center gap-3">
      <button
        class="h-9 px-3 rounded-lg bg-white border border-black/[0.07] text-[13px] text-[#4b5563] hover:bg-black/[0.02] transition-colors flex items-center gap-1.5"
        @click="router.push(`/admin/courses/${courseId}`)"
      >
        <span>←</span><span>返回课程</span>
      </button>

      <div class="min-w-0">
        <h1 class="text-[17px] font-semibold tracking-tight truncate">
          {{ course?.title || '课程' }} · 题目
        </h1>
        <p v-if="course" class="text-[12px] text-[#9ca3af] mt-0.5">
          {{ DIFFICULTY_META[course.difficulty].label }} ·
          {{ questions.length }} 道题 ·
          {{ course.studentCompletedCount }} 名学生学过
        </p>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <div class="relative">
          <input
            v-model="search"
            type="text"
            placeholder="搜索题干或选项"
            class="w-[200px] h-9 px-3 rounded-lg bg-white border border-black/[0.07] text-[13px] placeholder:text-[#9ca3af] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
          />
        </div>
        <button
          class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px] font-medium hover:bg-[#1f2937] transition-colors flex items-center gap-1.5"
          @click="newQuestion"
        >
          <span class="text-sm leading-none">＋</span><span>新增题目</span>
        </button>
      </div>
    </div>

    <!-- ===================== 加载 / 错误 ===================== -->
    <div v-if="loading" class="flex items-center justify-center py-24 gap-3 text-[#9ca3af]">
      <div class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
      <span class="text-[13px]">正在加载题目…</span>
    </div>

    <div
      v-else-if="error"
      class="bg-white rounded-2xl border border-black/[0.06] p-10 text-center space-y-3"
    >
      <p class="text-[13px] text-rose-600">加载失败：{{ error }}</p>
      <button class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px]" @click="load">重试</button>
    </div>

    <!-- ===================== 空态 ===================== -->
    <div
      v-else-if="questions.length === 0"
      class="bg-white rounded-2xl border border-black/[0.06] p-14 text-center space-y-4"
    >
      <p class="text-4xl">📝</p>
      <h2 class="text-[15px] font-semibold">这门课还没有题目</h2>
      <p class="text-[13px] text-[#6b7280]">没有题目的课程，学生在学习端会看到空白。</p>
      <button
        class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px] font-medium"
        @click="newQuestion"
      >
        添加第一道题
      </button>
    </div>

    <!-- ===================== 题目表格 ===================== -->
    <div v-else class="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
      <!-- 表头 -->
      <div
        class="grid grid-cols-[36px_52px_1fr_74px_84px_60px_96px] gap-3 px-4 py-2.5 border-b border-black/[0.06] text-[11.5px] font-medium text-[#9ca3af]"
      >
        <span></span>
        <span>序号</span>
        <span>题干</span>
        <span class="text-center">选项</span>
        <span class="text-center">正确答案</span>
        <span class="text-center">解析</span>
        <span class="text-right">操作</span>
      </div>

      <VueDraggable
        v-model="questions"
        handle=".drag-handle"
        :animation="160"
        :disabled="dragDisabled"
        ghost-class="drag-ghost"
        @end="onDragEnd"
      >
        <div
          v-for="(q, index) in questions"
          :key="q.id"
          :class="[
            'grid grid-cols-[36px_52px_1fr_74px_84px_60px_96px] gap-3 px-4 py-3 items-center border-b border-black/[0.04] last:border-b-0 hover:bg-black/[0.015] transition-colors',
            search && !filtered.includes(q) ? 'opacity-30' : '',
          ]"
        >
          <!-- 拖拽手柄 -->
          <span
            v-if="!dragDisabled"
            class="drag-handle text-[13px] text-[#d1d5db] hover:text-[#9ca3af] cursor-grab active:cursor-grabbing text-center"
            title="拖动调整顺序"
          >
            ⠿
          </span>
          <span v-else class="text-center text-[#e5e7eb]">—</span>

          <!-- 序号 -->
          <span class="text-[12px] text-[#9ca3af] tabular-nums">{{ index + 1 }}</span>

          <!-- 题干 -->
          <div class="min-w-0">
            <p class="text-[13px] truncate">{{ q.content }}</p>
            <p class="text-[11px] text-[#9ca3af] mt-0.5 font-mono">{{ q.id }}</p>
          </div>

          <!-- 选项数 -->
          <span
            :class="[
              'justify-self-center h-[22px] px-2 rounded-md text-[11px] font-medium flex items-center',
              q.options.length < 2 ? 'bg-rose-50 text-rose-600' : 'bg-[#f3f4f6] text-[#6b7280]',
            ]"
          >
            {{ q.options.length }}
          </span>

          <!-- 正确答案 -->
          <span
            class="justify-self-center h-[22px] px-2 rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-semibold flex items-center gap-1"
          >
            {{ OPTION_LETTERS[q.answer] ?? '?' }}
          </span>

          <!-- 解析 -->
          <span class="justify-self-center text-[13px]">
            <span v-if="q.explanation" title="有解析">✅</span>
            <span v-else class="text-rose-400" title="缺解析">⚠️</span>
          </span>

          <!-- 操作 -->
          <div class="flex justify-end gap-1">
            <button
              class="h-7 px-2.5 rounded-md text-[12px] text-[#4b5563] hover:bg-black/[0.05] transition-colors"
              @click="editQuestion(q.id)"
            >
              编辑
            </button>
            <button
              class="h-7 px-2.5 rounded-md text-[12px] text-rose-600 hover:bg-rose-50 transition-colors"
              @click="openDelete(q)"
            >
              删除
            </button>
          </div>
        </div>
      </VueDraggable>
    </div>

    <p v-if="!loading && questions.length > 0" class="text-[12px] text-[#9ca3af] text-center">
      <template v-if="dragDisabled">搜索状态下已停用拖拽</template>
      <template v-else>拖动左侧手柄可调整题目顺序，顺序会影响学生端的出题先后</template>
    </p>

    <!-- ===================== 删除确认 ===================== -->
    <Teleport to="body">
      <div
        v-if="deleteTarget"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-[2px]"
        @click.self="deleteTarget = null"
      >
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
          <h3 class="text-[15px] font-semibold">删除这道题？</h3>

          <div class="rounded-lg bg-[#f9fafb] border border-black/[0.05] px-3 py-2.5">
            <p class="text-[12.5px] text-[#4b5563] leading-relaxed line-clamp-3">
              {{ deleteTarget.content }}
            </p>
            <p class="text-[11px] text-[#9ca3af] mt-1 font-mono">{{ deleteTarget.id }}</p>
          </div>

          <!-- 影响面 -->
          <div
            v-if="deleteImpact && deleteImpact.answered > 0"
            class="rounded-xl bg-rose-50 border border-rose-100 p-4 space-y-1.5"
          >
            <p class="text-[12.5px] text-rose-800 font-medium">这次删除会一并移除：</p>
            <ul class="text-[12.5px] text-rose-700 space-y-1">
              <li>· {{ deleteImpact.answered }} 条学生答题记录</li>
              <li v-if="deleteImpact.wrong > 0">
                · 其中 {{ deleteImpact.wrong }} 名学生的错题本条目与复习计划
              </li>
            </ul>
            <p class="text-[12px] text-rose-600 pt-1">此操作不可恢复。</p>
          </div>
          <div
            v-else-if="deleteImpact"
            class="rounded-lg bg-[#f9fafb] border border-black/[0.05] px-3 py-2.5"
          >
            <p class="text-[12px] text-[#6b7280]">还没有学生作答过这道题，删除不会影响任何学习记录。</p>
          </div>
          <div v-else class="text-[12px] text-[#9ca3af]">正在检查影响面…</div>

          <div>
            <label class="block text-[12.5px] text-[#4b5563] mb-1.5">
              请输入题目 ID 以确认：<span class="font-mono font-medium">{{ deleteTarget.id }}</span>
            </label>
            <input
              v-model="deleteConfirmText"
              type="text"
              class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] font-mono outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition-all"
              :placeholder="deleteTarget.id"
            />
          </div>

          <div class="flex gap-2 justify-end pt-1">
            <button
              class="h-9 px-4 rounded-lg bg-white border border-black/[0.07] text-[13px] text-[#4b5563] hover:bg-black/[0.02]"
              @click="deleteTarget = null"
            >
              取消
            </button>
            <button
              :disabled="!canConfirmDelete || saving"
              class="h-9 px-4 rounded-lg bg-rose-600 text-white text-[13px] font-medium hover:bg-rose-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              @click="confirmDelete"
            >
              {{ saving ? '删除中…' : '确认删除' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.drag-ghost {
  opacity: 0.35;
  background: #fef3c7 !important;
}
</style>
