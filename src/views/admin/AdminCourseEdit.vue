<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { toast } from 'vue3-toastify'
import { useUserStore } from '@/stores/user'
import MediaUploader from '@/components/admin/MediaUploader.vue'
import {
  fetchAdminCourse,
  createCourse,
  updateCourse,
  deleteCourse,
  DIFFICULTY_META,
  type AdminCourse,
  type CourseFormData,
  type Difficulty,
} from '@/services/admin'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/**
 * 是否新建模式。
 *
 * 注意：不能只看 route.params.id === 'new'。
 * 路由表里 `courses/new` 是静态路径，匹配后 params.id 是 **undefined**，
 * 会被误判为编辑模式，进而去查一个叫 “new” 的课程。
 * 因此以路由名为准，参数判断作为兼容。
 */
const isNew = computed(
  () => route.name === 'AdminCourseNew' || route.params.id === 'new',
)
const courseId = computed(() => (isNew.value ? null : String(route.params.id)))

const DIFFICULTY_ORDER: Difficulty[] = ['beginner', 'intermediate', 'advanced']

/** 常用 emoji —— 与现有内容数据保持同一套视觉语言 */
const EMOJI_CHOICES = [
  '🏛️', '🏺', '⚔️', '🏮', '🇨🇳', '📜', '🔱', '🗿',
  '🎨', '⚙️', '🕊️', '🌍', '👑', '🐉', '⛩️', '📖',
]

const form = ref<CourseFormData>({
  title: '',
  description: '',
  period: '',
  civilization: '',
  difficulty: 'beginner',
  estimatedTime: 30,
  coverImage: '📖',
  coverUrl: null,
})

/** 已加载的课程（编辑模式），用于影响面展示 */
const course = ref<AdminCourse | null>(null)
const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)

/** 脏标记：用来拦截未保存就离开 */
const dirty = ref(false)
let snapshot = ''

const snapshotOf = (d: CourseFormData) => JSON.stringify(d)

watch(
  form,
  (v) => {
    if (!loading.value) dirty.value = snapshotOf(v) !== snapshot
  },
  { deep: true },
)

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------
const errors = computed(() => {
  const e: Record<string, string> = {}
  if (!form.value.title.trim()) e.title = '标题不能为空'
  else if (form.value.title.trim().length < 2) e.title = '标题至少 2 个字'
  if (form.value.estimatedTime < 0) e.estimatedTime = '预计时长不能为负'
  return e
})

const canSave = computed(() => Object.keys(errors.value).length === 0)

// ---------------------------------------------------------------------------
// 加载
// ---------------------------------------------------------------------------
async function load() {
  loading.value = true
  error.value = null

  if (isNew.value) {
    // 从看板列内的「新增X课程」进入时，带上该列的难度作为默认值
    const q = route.query.difficulty
    const defaultDifficulty: Difficulty =
      q === 'beginner' || q === 'intermediate' || q === 'advanced' ? q : 'beginner'

    form.value = {
      title: '',
      description: '',
      period: '',
      civilization: '',
      difficulty: defaultDifficulty,
      estimatedTime: 30,
      coverImage: '📖',
      coverUrl: null,
    }
    snapshot = snapshotOf(form.value)
    loading.value = false
    return
  }

  const res = await fetchAdminCourse(userStore.userId, courseId.value!)
  if (res.error) error.value = res.error
  if (!res.data) {
    error.value = res.error ?? '课程不存在'
    loading.value = false
    return
  }

  course.value = res.data
  form.value = {
    title: res.data.title,
    description: res.data.description ?? '',
    period: res.data.period ?? '',
    civilization: res.data.civilization ?? '',
    difficulty: res.data.difficulty,
    estimatedTime: res.data.estimatedTime,
    coverImage: res.data.coverImage ?? '📖',
    coverUrl: res.data.coverUrl,
  }
  snapshot = snapshotOf(form.value)
  loading.value = false
}

// ---------------------------------------------------------------------------
// 保存
// ---------------------------------------------------------------------------
async function save() {
  if (!canSave.value || saving.value) return
  saving.value = true

  try {
    if (isNew.value) {
      const res = await createCourse(form.value)
      if (!res.ok) throw new Error(res.error)
      dirty.value = false
      toast.success('课程已创建', { theme: 'auto', transition: 'slide' })
      await router.replace(`/admin/courses/${res.id}`)
    } else {
      const res = await updateCourse(courseId.value!, form.value)
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

// ---------------------------------------------------------------------------
// 删除（影响面预览 + 强制二次确认）
// ---------------------------------------------------------------------------
const showDelete = ref(false)
const deleteConfirmText = ref('')

const canConfirmDelete = computed(
  () => deleteConfirmText.value.trim() === form.value.title.trim(),
)

async function confirmDelete() {
  if (!canConfirmDelete.value || !courseId.value) return
  saving.value = true
  try {
    const res = await deleteCourse(courseId.value)
    if (!res.ok) throw new Error(res.error)
    dirty.value = false
    toast.success('课程已删除', { theme: 'auto', transition: 'slide' })
    await router.replace('/admin/courses')
  } catch (e) {
    toast.error(`删除失败：${e instanceof Error ? e.message : '未知错误'}`, { theme: 'auto' })
  } finally {
    saving.value = false
    showDelete.value = false
  }
}

// ---------------------------------------------------------------------------
// 离开拦截
// ---------------------------------------------------------------------------
onBeforeRouteLeave(() => {
  if (!dirty.value) return true
  return window.confirm('有未保存的修改，确定离开吗？')
})

onMounted(load)
</script>

<template>
  <div class="space-y-5">
    <!-- ===================== 顶部操作条 ===================== -->
    <div class="flex items-center gap-3">
      <button
        class="h-9 px-3 rounded-lg bg-white border border-black/[0.07] text-[13px] text-[#4b5563] hover:bg-black/[0.02] transition-colors flex items-center gap-1.5"
        @click="router.push('/admin/courses')"
      >
        <span>←</span><span>返回课程</span>
      </button>

      <h1 class="text-[17px] font-semibold tracking-tight truncate">
        {{ isNew ? '新建课程' : form.title || '未命名课程' }}
      </h1>

      <span v-if="dirty" class="text-[12px] text-amber-600 flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>未保存
      </span>

      <div class="ml-auto flex items-center gap-2">
        <button
          v-if="!isNew"
          class="h-9 px-4 rounded-lg bg-white border border-rose-200 text-rose-600 text-[13px] font-medium hover:bg-rose-50 transition-colors"
          @click="showDelete = true"
        >
          删除
        </button>
        <button
          :disabled="!canSave || saving"
          class="h-9 px-5 rounded-lg bg-[#111827] text-white text-[13px] font-medium hover:bg-[#1f2937] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          @click="save"
        >
          {{ saving ? '保存中…' : isNew ? '创建课程' : '保存' }}
        </button>
      </div>
    </div>

    <!-- ===================== 加载 / 错误 ===================== -->
    <div v-if="loading" class="flex items-center justify-center py-24 gap-3 text-[#9ca3af]">
      <div class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
      <span class="text-[13px]">正在加载…</span>
    </div>

    <div v-else-if="error && !course" class="bg-white rounded-2xl border border-black/[0.06] p-10 text-center">
      <p class="text-[13px] text-rose-600">{{ error }}</p>
    </div>

    <!-- ===================== 表单 + 影响面 ===================== -->
    <div v-else class="grid grid-cols-1 lg:grid-cols-[1fr_308px] gap-5 items-start">
      <!-- ---------- 左：表单 ---------- -->
      <div class="space-y-4">
        <!-- 基本信息 -->
        <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-4">
          <h2 class="text-[13px] font-semibold text-[#6b7280]">基本信息</h2>

          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">
              课程标题 <span class="text-rose-500">*</span>
            </label>
            <input
              v-model="form.title"
              type="text"
              placeholder="例如：古代文明的起源"
              :class="[
                'w-full h-10 px-3 rounded-lg border text-[13.5px] outline-none transition-all',
                errors.title
                  ? 'border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100'
                  : 'border-black/[0.08] focus:border-amber-400 focus:ring-2 focus:ring-amber-100',
              ]"
            />
            <p v-if="errors.title" class="mt-1 text-[11.5px] text-rose-600">{{ errors.title }}</p>
          </div>

          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">课程描述</label>
            <textarea
              v-model="form.description"
              rows="3"
              placeholder="一两句话说明这门课讲什么"
              class="w-full px-3 py-2.5 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-y"
            ></textarea>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-[12.5px] font-medium mb-1.5">历史时期</label>
              <input
                v-model="form.period"
                type="text"
                placeholder="例如：公元前3500年 - 公元前500年"
                class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
              />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium mb-1.5">所属文明</label>
              <input
                v-model="form.civilization"
                type="text"
                placeholder="例如：古代文明"
                class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
              />
            </div>
          </div>
        </section>

        <!-- 难度与时长 -->
        <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-4">
          <h2 class="text-[13px] font-semibold text-[#6b7280]">难度与时长</h2>

          <div>
            <label class="block text-[12.5px] font-medium mb-2">难度</label>
            <div class="flex gap-2">
              <button
                v-for="d in DIFFICULTY_ORDER"
                :key="d"
                :class="[
                  'flex-1 h-10 rounded-lg border text-[13px] font-medium transition-colors flex items-center justify-center gap-2',
                  form.difficulty === d
                    ? 'bg-[#111827] text-white border-[#111827]'
                    : 'bg-white text-[#4b5563] border-black/[0.08] hover:bg-black/[0.02]',
                ]"
                @click="form.difficulty = d"
              >
                <span
                  :class="[
                    'w-1.5 h-1.5 rounded-full',
                    form.difficulty === d ? 'bg-white' : DIFFICULTY_META[d].dot,
                  ]"
                ></span>
                {{ DIFFICULTY_META[d].label }}
              </button>
            </div>
            <p class="mt-1.5 text-[11.5px] text-[#9ca3af]">
              也可以直接在课程看板上拖动卡片来改难度
            </p>
          </div>

          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">预计学习时长（分钟）</label>
            <input
              v-model.number="form.estimatedTime"
              type="number"
              min="0"
              class="w-full sm:w-40 h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
            />
            <p v-if="errors.estimatedTime" class="mt-1 text-[11.5px] text-rose-600">
              {{ errors.estimatedTime }}
            </p>
          </div>
        </section>

        <!-- 封面 -->
        <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-4">
          <div class="flex items-center gap-2">
            <h2 class="text-[13px] font-semibold text-[#6b7280]">封面</h2>
            <span class="text-[11.5px] text-[#9ca3af]">
              上传图片后优先显示图片；未上传时回退到下面的图标
            </span>
          </div>

          <MediaUploader
            v-model="form.coverUrl"
            folder="covers/courses"
            :emoji-fallback="form.coverImage"
            preview-class="w-24 h-24"
          />

          <div class="pt-4 border-t border-black/[0.05]">
            <label class="block text-[12px] font-medium mb-1.5 text-[#6b7280]">
              图标（emoji）—— 降级显示
            </label>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="e in EMOJI_CHOICES"
                :key="e"
                :class="[
                  'w-8 h-8 rounded-lg text-[16px] flex items-center justify-center transition-colors',
                  form.coverImage === e
                    ? 'bg-amber-100 ring-2 ring-amber-400'
                    : 'bg-[#f9fafb] hover:bg-black/[0.04]',
                ]"
                @click="form.coverImage = e"
              >
                {{ e }}
              </button>
            </div>
            <p class="mt-2 text-[11px] text-[#9ca3af] leading-relaxed">
              学习端在图片加载失败或未设置时显示这个图标，
              因此即使上传了图片，也建议选一个语义接近的 emoji。
            </p>
          </div>
        </section>
      </div>

      <!-- ---------- 右：影响面（常驻） ---------- -->
      <aside class="lg:sticky lg:top-20 space-y-4">
        <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-4">
          <h2 class="text-[13px] font-semibold text-[#6b7280]">影响面</h2>

          <template v-if="isNew">
            <p class="text-[12.5px] text-[#9ca3af] leading-relaxed">
              新建的课程还没有任何数据。创建后这里会显示它影响多少学生的学习记录。
            </p>
          </template>

          <template v-else-if="course">
            <div class="space-y-3">
              <div class="flex items-baseline gap-2">
                <span class="text-[24px] font-semibold tracking-tight">
                  {{ course.studentCompletedCount }}
                </span>
                <span class="text-[12.5px] text-[#6b7280]">名学生学过</span>
              </div>
              <div class="flex items-baseline gap-2">
                <span class="text-[24px] font-semibold tracking-tight">
                  {{ course.answerRecordCount }}
                </span>
                <span class="text-[12.5px] text-[#6b7280]">条答题记录</span>
              </div>
              <div class="flex items-baseline gap-2">
                <span class="text-[24px] font-semibold tracking-tight">
                  {{ course.questionCount }}
                </span>
                <span class="text-[12.5px] text-[#6b7280]">道题目</span>
              </div>
            </div>

            <!-- 有学生数据时给出明确后果说明 -->
            <div
              v-if="course.studentCompletedCount > 0 || course.answerRecordCount > 0"
              class="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5"
            >
              <p class="text-[11.5px] text-amber-800 leading-relaxed">
                删除这门课会**连带删除**它的全部题目，以及上述学生的答题记录、
                错题本条目与复习计划，且不可恢复。
              </p>
            </div>

            <div
              v-if="course.questionsWithoutExplanation > 0"
              class="rounded-lg bg-[#f9fafb] border border-black/[0.05] px-3 py-2.5"
            >
              <p class="text-[11.5px] text-[#6b7280] leading-relaxed">
                有 {{ course.questionsWithoutExplanation }} 道题缺解析，建议补充。
              </p>
            </div>

            <button
              class="w-full h-9 rounded-lg bg-white border border-black/[0.07] text-[12.5px] text-[#4b5563] hover:bg-black/[0.02] transition-colors"
              @click="router.push(`/admin/courses/${courseId}/questions`)"
            >
              管理这门课的 {{ course.questionCount }} 道题目 →
            </button>
          </template>
        </section>
      </aside>
    </div>

    <!-- ===================== 删除确认弹窗 ===================== -->
    <Teleport to="body">
      <div
        v-if="showDelete"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-[2px]"
        @click.self="showDelete = false"
      >
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
          <h3 class="text-[15px] font-semibold">删除课程「{{ form.title }}」？</h3>

          <div class="rounded-xl bg-rose-50 border border-rose-100 p-4 space-y-2">
            <p class="text-[12.5px] text-rose-800 leading-relaxed font-medium">
              这次删除会一并移除：
            </p>
            <ul class="text-[12.5px] text-rose-700 space-y-1 leading-relaxed">
              <li>· 该课程的 {{ course?.questionCount ?? 0 }} 道题目</li>
              <li>· {{ course?.answerRecordCount ?? 0 }} 条学生答题记录</li>
              <li>· {{ course?.studentCompletedCount ?? 0 }} 名学生的完成状态</li>
            </ul>
            <p class="text-[12px] text-rose-600 pt-1">此操作不可恢复。</p>
          </div>

          <div>
            <label class="block text-[12.5px] text-[#4b5563] mb-1.5">
              请输入课程标题以确认：<span class="font-medium">{{ form.title }}</span>
            </label>
            <input
              v-model="deleteConfirmText"
              type="text"
              class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition-all"
              placeholder="输入课程标题"
            />
          </div>

          <div class="flex gap-2 justify-end pt-1">
            <button
              class="h-9 px-4 rounded-lg bg-white border border-black/[0.07] text-[13px] text-[#4b5563] hover:bg-black/[0.02]"
              @click="showDelete = false; deleteConfirmText = ''"
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
