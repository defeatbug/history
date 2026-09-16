<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { toast } from 'vue3-toastify'
import { useUserStore } from '@/stores/user'
import {
  fetchAdminQuestion,
  fetchAdminCourse,
  createQuestion,
  updateQuestion,
  fetchQuestionImpact,
  type AdminQuestion,
  type QuestionFormData,
} from '@/services/admin'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const courseId = computed(() => String(route.params.id))

/**
 * 是否新建模式。
 * 注意：路由表里 `.../questions/new` 是静态路径，匹配后 params.questionId 为 undefined，
 * 因此以路由名为准，不能只看参数。
 */
const isNew = computed(
  () => route.name === 'AdminQuestionNew' || route.params.questionId === 'new',
)
const questionId = computed(() => (isNew.value ? null : String(route.params.questionId)))

const OPTION_LETTERS = 'ABCDEF'
const MIN_OPTIONS = 2
const MAX_OPTIONS = 6

const form = ref<QuestionFormData>({
  content: '',
  options: ['', '', '', ''],
  answer: 0,
  explanation: '',
})

const question = ref<AdminQuestion | null>(null)
const courseTitle = ref('')
const impact = ref<{ answered: number; wrong: number } | null>(null)
const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)
const dirty = ref(false)
let snapshot = ''

const snapshotOf = (d: QuestionFormData) => JSON.stringify(d)
watch(
  form,
  (v) => {
    if (!loading.value) dirty.value = snapshotOf(v) !== snapshot
  },
  { deep: true },
)

// ---------------------------------------------------------------------------
// 选项操作
// ---------------------------------------------------------------------------
const canAddOption = computed(() => form.value.options.length < MAX_OPTIONS)
const canRemoveOption = computed(() => form.value.options.length > MIN_OPTIONS)

function addOption() {
  if (!canAddOption.value) return
  form.value.options.push('')
}

function removeOption(index: number) {
  if (!canRemoveOption.value) return
  form.value.options.splice(index, 1)
  // 修正正确答案指向
  if (form.value.answer === index) form.value.answer = 0
  else if (form.value.answer > index) form.value.answer -= 1
}

function setCorrect(index: number) {
  form.value.answer = index
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------
const errors = computed(() => {
  const e: Record<string, string> = {}
  const f = form.value

  if (!f.content.trim()) e.content = '题干不能为空'
  else if (f.content.trim().length < 4) e.content = '题干太短'

  const filled = f.options.map((o) => o.trim()).filter(Boolean)
  if (filled.length < MIN_OPTIONS) e.options = `至少需要 ${MIN_OPTIONS} 个非空选项`

  // 正确答案必须指向一个非空选项
  if (!f.options[f.answer]?.trim()) e.answer = '正确答案不能是空选项'

  // 重复选项（教学场景下会造成歧义）
  const normalized = f.options.map((o) => o.trim()).filter(Boolean)
  if (new Set(normalized).size !== normalized.length) e.options = '存在重复的选项'

  return e
})

const canSave = computed(() => Object.keys(errors.value).length === 0)

// ---------------------------------------------------------------------------
async function load() {
  loading.value = true
  error.value = null

  const courseRes = await fetchAdminCourse(userStore.userId, courseId.value)
  courseTitle.value = courseRes.data?.title ?? ''

  if (isNew.value) {
    form.value = { content: '', options: ['', '', '', ''], answer: 0, explanation: '' }
    snapshot = snapshotOf(form.value)
    loading.value = false
    return
  }

  const res = await fetchAdminQuestion(userStore.userId, questionId.value!)
  if (res.error) error.value = res.error
  if (!res.data) {
    error.value = res.error ?? '题目不存在'
    loading.value = false
    return
  }

  question.value = res.data
  form.value = {
    content: res.data.content,
    // 少于 2 个选项的历史数据补齐到 4 个，避免界面上无法操作
    options: res.data.options.length >= MIN_OPTIONS ? [...res.data.options] : ['', '', '', ''],
    answer: res.data.answer,
    explanation: res.data.explanation ?? '',
  }
  snapshot = snapshotOf(form.value)

  impact.value = await fetchQuestionImpact(res.data.id)
  loading.value = false
}

async function save() {
  if (!canSave.value || saving.value) return
  saving.value = true

  const payload: QuestionFormData = {
    ...form.value,
    options: form.value.options.map((o) => o.trim()).filter(Boolean),
  }
  // 过滤空选项后正确答案索引会平移，这里重新定位
  const originalAnswerText = form.value.options[form.value.answer]?.trim() ?? ''
  payload.answer = Math.max(0, payload.options.indexOf(originalAnswerText))

  try {
    if (isNew.value) {
      const res = await createQuestion(courseId.value, payload)
      if (!res.ok) throw new Error(res.error)
      dirty.value = false
      toast.success('题目已创建', { theme: 'auto', transition: 'slide' })
      await router.replace(`/admin/courses/${courseId.value}/questions`)
    } else {
      const res = await updateQuestion(questionId.value!, payload)
      if (!res.ok) throw new Error(res.error)
      snapshot = snapshotOf(form.value)
      dirty.value = false
      toast.success('已保存', { theme: 'auto', transition: 'slide' })
      await load()
    }
  } catch (e) {
    toast.error(`保存失败：${e instanceof Error ? e.message : '未知错误'}`, { theme: 'auto' })
  } finally {
    saving.value = false
  }
}

onBeforeRouteLeave(() => {
  if (!dirty.value) return true
  return window.confirm('有未保存的修改，确定离开吗？')
})

onMounted(load)
</script>

<template>
  <div class="space-y-5">
    <!-- ===================== 顶部 ===================== -->
    <div class="flex items-center gap-3">
      <button
        class="h-9 px-3 rounded-lg bg-white border border-black/[0.07] text-[13px] text-[#4b5563] hover:bg-black/[0.02] transition-colors flex items-center gap-1.5"
        @click="router.push(`/admin/courses/${courseId}/questions`)"
      >
        <span>←</span><span>返回题目列表</span>
      </button>

      <div class="min-w-0">
        <h1 class="text-[17px] font-semibold tracking-tight truncate">
          {{ isNew ? '新增题目' : '编辑题目' }}
        </h1>
        <p class="text-[12px] text-[#9ca3af] mt-0.5 truncate">
          {{ courseTitle }}
          <span v-if="!isNew" class="font-mono"> · {{ questionId }}</span>
        </p>
      </div>

      <span v-if="dirty" class="text-[12px] text-amber-600 flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>未保存
      </span>

      <div class="ml-auto">
        <button
          :disabled="!canSave || saving"
          class="h-9 px-5 rounded-lg bg-[#111827] text-white text-[13px] font-medium hover:bg-[#1f2937] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          @click="save"
        >
          {{ saving ? '保存中…' : isNew ? '创建题目' : '保存' }}
        </button>
      </div>
    </div>

    <!-- ===================== 加载 / 错误 ===================== -->
    <div v-if="loading" class="flex items-center justify-center py-24 gap-3 text-[#9ca3af]">
      <div class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
      <span class="text-[13px]">正在加载…</span>
    </div>

    <div
      v-else-if="error && !question"
      class="bg-white rounded-2xl border border-black/[0.06] p-10 text-center"
    >
      <p class="text-[13px] text-rose-600">{{ error }}</p>
    </div>

    <!-- ===================== 表单 ===================== -->
    <div v-else class="grid grid-cols-1 lg:grid-cols-[1fr_288px] gap-5 items-start">
      <div class="space-y-4">
        <!-- 题干 -->
        <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-3">
          <h2 class="text-[13px] font-semibold text-[#6b7280]">题干</h2>
          <textarea
            v-model="form.content"
            rows="3"
            placeholder="例如：美索不达米亚文明主要位于今天的哪个地区？"
            :class="[
              'w-full px-3 py-2.5 rounded-lg border text-[13.5px] outline-none transition-all resize-y',
              errors.content
                ? 'border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100'
                : 'border-black/[0.08] focus:border-amber-400 focus:ring-2 focus:ring-amber-100',
            ]"
          ></textarea>
          <p v-if="errors.content" class="text-[11.5px] text-rose-600">{{ errors.content }}</p>
        </section>

        <!-- 选项 -->
        <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-3">
          <div class="flex items-center gap-2">
            <h2 class="text-[13px] font-semibold text-[#6b7280]">选项与正确答案</h2>
            <span class="text-[11.5px] text-[#9ca3af]">
              点击左侧圆点设正确答案（{{ MIN_OPTIONS }}~{{ MAX_OPTIONS }} 个选项）
            </span>
          </div>

          <div class="space-y-2">
            <div
              v-for="(opt, index) in form.options"
              :key="index"
              class="flex items-center gap-2"
            >
              <!-- 正确答案选择 -->
              <button
                :class="[
                  'w-8 h-8 rounded-lg flex items-center justify-center text-[12px] font-bold flex-shrink-0 transition-colors',
                  form.answer === index
                    ? 'bg-emerald-500 text-white'
                    : 'bg-[#f3f4f6] text-[#6b7280] hover:bg-black/[0.06]',
                ]"
                :title="form.answer === index ? '当前正确答案' : '设为正确答案'"
                @click="setCorrect(index)"
              >
                {{ OPTION_LETTERS[index] }}
              </button>

              <input
                v-model="form.options[index]"
                type="text"
                :placeholder="`选项 ${OPTION_LETTERS[index]}`"
                class="flex-1 min-w-0 h-9 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
              />

              <button
                :disabled="!canRemoveOption"
                class="w-8 h-8 rounded-lg text-[15px] text-[#9ca3af] hover:bg-rose-50 hover:text-rose-600 transition-colors disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-[#9ca3af] disabled:cursor-not-allowed flex-shrink-0"
                title="删除此选项"
                @click="removeOption(index)"
              >
                ×
              </button>
            </div>
          </div>

          <button
            :disabled="!canAddOption"
            class="h-8 px-3 rounded-lg border border-dashed border-black/[0.12] text-[12.5px] text-[#6b7280] hover:bg-black/[0.02] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            @click="addOption"
          >
            ＋ 添加选项（最多 {{ MAX_OPTIONS }} 个）
          </button>

          <p v-if="errors.options" class="text-[11.5px] text-rose-600">{{ errors.options }}</p>
          <p v-if="errors.answer" class="text-[11.5px] text-rose-600">{{ errors.answer }}</p>
        </section>

        <!-- 解析 -->
        <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-3">
          <div class="flex items-center gap-2">
            <h2 class="text-[13px] font-semibold text-[#6b7280]">解析</h2>
            <span class="text-[11.5px] text-[#9ca3af]">选填，但建议填写</span>
          </div>
          <textarea
            v-model="form.explanation"
            rows="3"
            placeholder="说明为什么这个答案是对的，学生答完会看到"
            class="w-full px-3 py-2.5 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-y"
          ></textarea>
        </section>
      </div>

      <!-- ---------- 右栏 ---------- -->
      <aside class="lg:sticky lg:top-20 space-y-4">
        <!-- 学生端预览 -->
        <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-3">
          <h2 class="text-[13px] font-semibold text-[#6b7280]">学生端预览</h2>

          <div class="rounded-xl bg-[#f9fafb] border border-black/[0.05] p-3 space-y-2.5">
            <p class="text-[12.5px] leading-relaxed">
              {{ form.content || '（题干为空）' }}
            </p>
            <div class="space-y-1">
              <div
                v-for="(opt, index) in form.options.filter((o) => o.trim())"
                :key="index"
                :class="[
                  'px-2 py-1.5 rounded-md text-[11.5px] flex items-center gap-2 border',
                  form.options.indexOf(opt) === form.answer
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-white border-black/[0.06] text-[#4b5563]',
                ]"
              >
                <span class="font-semibold">{{ OPTION_LETTERS[form.options.indexOf(opt)] }}</span>
                <span class="truncate">{{ opt }}</span>
              </div>
            </div>
          </div>
          <p class="text-[11px] text-[#9ca3af] leading-relaxed">
            学生端目前把题目渲染为单选，与这里的设置一致。
          </p>
        </section>

        <!-- 影响面 -->
        <section v-if="!isNew && impact" class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-3">
          <h2 class="text-[13px] font-semibold text-[#6b7280]">影响面</h2>
          <div class="space-y-2">
            <div class="flex items-baseline gap-2">
              <span class="text-[20px] font-semibold">{{ impact.answered }}</span>
              <span class="text-[12px] text-[#6b7280]">名学生作答过</span>
            </div>
            <div v-if="impact.wrong > 0" class="flex items-baseline gap-2">
              <span class="text-[20px] font-semibold text-rose-600">{{ impact.wrong }}</span>
              <span class="text-[12px] text-[#6b7280]">名学生在错题本里</span>
            </div>
          </div>
          <p v-if="impact.answered > 0" class="text-[11.5px] text-amber-700 leading-relaxed">
            修改正确答案不会清除学生已有的答题记录，但会让「已完成」状态与新答案不一致。
          </p>
        </section>
      </aside>
    </div>
  </div>
</template>
