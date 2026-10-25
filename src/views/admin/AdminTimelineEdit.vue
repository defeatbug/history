<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { toast } from 'vue3-toastify'
import { useUserStore } from '@/stores/user'
import {
  fetchAdminTimelineEvent,
  fetchAdminTimelineEvents,
  fetchAdminCourses,
  createTimelineEvent,
  updateTimelineEvent,
  TIMELINE_TRACKS,
  type AdminCourse,
  type AdminTimelineEvent,
  type TimelineEventFormData,
} from '@/services/admin'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/**
 * 新建 / 编辑判定：不能只看 params.id ——
 * 路由表里 `timeline/new` 是静态路径，匹配后 params.id 是 undefined，
 * 会被误判成编辑模式去查一个叫 “new” 的节点，因此以路由名为准。
 */
const isNew = computed(() => route.name === 'AdminTimelineNew' || route.params.id === 'new')
const eventId = computed(() => (isNew.value ? null : String(route.params.id)))

const form = ref<TimelineEventFormData>({
  track: 'china',
  year: '',
  title: '',
  description: '',
  civilization: '',
  lessonId: '',
  sortOrder: 0,
})

/** 已加载的节点（编辑模式） */
const event = ref<AdminTimelineEvent | null>(null)
/** 课程下拉数据：复用后台课程读取函数，避免引入学生端 mock */
const courses = ref<AdminCourse[]>([])
const courseError = ref<string | null>(null)

const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)

/** 脏标记：用来拦截未保存就离开 */
const dirty = ref(false)
let snapshot = ''
const snapshotOf = (d: TimelineEventFormData) => JSON.stringify(d)

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
  // year 在数据库里允许为空（部分节点只标朝代/时期），所以不强制填写
  if (!Number.isInteger(form.value.sortOrder) || form.value.sortOrder < 0) {
    e.sortOrder = '排序号需为不小于 0 的整数'
  }
  return e
})

const canSave = computed(() => Object.keys(errors.value).length === 0)

// ---------------------------------------------------------------------------
// 加载
// ---------------------------------------------------------------------------
async function load() {
  loading.value = true
  error.value = null
  courseError.value = null

  const courseRes = await fetchAdminCourses(userStore.userId)
  courses.value = courseRes.data
  courseError.value = courseRes.error ?? null

  if (isNew.value) {
    // 新建默认排到当前最大序号之后；sort_order 是栏内序号，
    // 用全局最大值+1 可保证落在所属分支的末尾。
    const listRes = await fetchAdminTimelineEvents(userStore.userId)
    const maxOrder = listRes.data.reduce((max, e) => Math.max(max, e.sortOrder), -1)

    form.value = {
      track: 'china',
      year: '',
      title: '',
      description: '',
      civilization: '',
      lessonId: '',
      sortOrder: maxOrder + 1,
    }
    snapshot = snapshotOf(form.value)
    dirty.value = false
    loading.value = false
    return
  }

  const res = await fetchAdminTimelineEvent(userStore.userId, eventId.value!)
  if (res.error) error.value = res.error
  if (!res.data) {
    error.value = res.error ?? '学习路径节点不存在'
    loading.value = false
    return
  }

  event.value = res.data
  form.value = {
    track: res.data.track,
    year: res.data.year ?? '',
    title: res.data.title,
    description: res.data.description ?? '',
    civilization: res.data.civilization ?? '',
    lessonId: res.data.lessonId ?? '',
    sortOrder: res.data.sortOrder,
  }
  snapshot = snapshotOf(form.value)
  dirty.value = false
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
      const res = await createTimelineEvent(form.value)
      if (!res.ok) throw new Error(res.error)
      dirty.value = false
      toast.success('学习路径节点已创建', { theme: 'auto', transition: 'slide' })
      await router.replace(`/admin/timeline/${res.id}`)
    } else {
      const res = await updateTimelineEvent(eventId.value!, form.value)
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
        @click="router.push('/admin/timeline')"
      >
        <span>←</span><span>返回学习路径</span>
      </button>

      <h1 class="text-[17px] font-semibold tracking-tight truncate">
        {{ isNew ? '新建学习路径节点' : form.title || '未命名节点' }}
      </h1>

      <span v-if="dirty" class="text-[12px] text-amber-600 flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>未保存
      </span>

      <div class="ml-auto flex items-center gap-2">
        <button
          class="h-9 px-4 rounded-lg bg-white border border-black/[0.07] text-[13px] text-[#4b5563] hover:bg-black/[0.02] transition-colors"
          @click="router.push('/admin/timeline')"
        >
          取消
        </button>
        <button
          :disabled="!canSave || saving"
          class="h-9 px-5 rounded-lg bg-[#111827] text-white text-[13px] font-medium hover:bg-[#1f2937] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          @click="save"
        >
          {{ saving ? '保存中…' : isNew ? '创建节点' : '保存' }}
        </button>
      </div>
    </div>

    <!-- ===================== 加载 / 错误 ===================== -->
    <div v-if="loading" class="flex items-center justify-center py-24 gap-3 text-[#9ca3af]">
      <div
        class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"
      ></div>
      <span class="text-[13px]">正在加载…</span>
    </div>

    <div
      v-else-if="error && !event"
      class="bg-white rounded-2xl border border-black/[0.06] p-10 text-center"
    >
      <p class="text-[13px] text-rose-600">{{ error }}</p>
    </div>

    <!-- ===================== 表单 ===================== -->
    <div v-else class="max-w-3xl space-y-4">
      <!-- 基本信息 -->
      <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-4">
        <h2 class="text-[13px] font-semibold text-[#6b7280]">基本信息</h2>

        <div>
          <label class="block text-[12.5px] font-medium mb-1.5">
            节点标题 <span class="text-rose-500">*</span>
          </label>
          <input
            v-model="form.title"
            type="text"
            placeholder="例如：唐朝建立"
            :class="[
              'w-full h-10 px-3 rounded-lg border text-[13.5px] outline-none transition-all',
              errors.title
                ? 'border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100'
                : 'border-black/[0.08] focus:border-amber-400 focus:ring-2 focus:ring-amber-100',
            ]"
          />
          <p v-if="errors.title" class="mt-1 text-[11.5px] text-rose-600">{{ errors.title }}</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">
              所属分支 <span class="text-rose-500">*</span>
            </label>
            <select
              v-model="form.track"
              class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all bg-white"
            >
              <option v-for="t in TIMELINE_TRACKS" :key="t.value" :value="t.value">
                {{ t.label }}
              </option>
            </select>
            <p class="mt-1 text-[11px] text-[#9ca3af]">决定节点展示在学生端的哪条时间轴上</p>
          </div>
          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">年份</label>
            <input
              v-model="form.year"
              type="text"
              placeholder="例如：公元前2070年 / 公元618年"
              class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
            />
            <p class="mt-1 text-[11px] text-[#9ca3af]">可留空（如只标明朝代 / 时期）</p>
          </div>
        </div>

        <div>
          <label class="block text-[12.5px] font-medium mb-1.5">文明</label>
          <input
            v-model="form.civilization"
            type="text"
            placeholder="例如：中华文明 / 古代文明"
            class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
          />
        </div>
      </section>

      <!-- 内容 -->
      <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-4">
        <h2 class="text-[13px] font-semibold text-[#6b7280]">内容</h2>
        <div>
          <label class="block text-[12.5px] font-medium mb-1.5">节点描述</label>
          <textarea
            v-model="form.description"
            rows="4"
            placeholder="一两句话说明这个时间点发生了什么"
            class="w-full px-3 py-2.5 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-y"
          ></textarea>
        </div>
      </section>

      <!-- 关联与排序 -->
      <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-4">
        <h2 class="text-[13px] font-semibold text-[#6b7280]">关联与排序</h2>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">关联课程</label>
            <select
              v-model="form.lessonId"
              class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all bg-white"
            >
              <option value="">不关联课程</option>
              <option v-for="c in courses" :key="c.id" :value="c.id">
                {{ c.title }}（{{ c.id }}）
              </option>
            </select>
            <p v-if="courseError" class="mt-1 text-[11.5px] text-amber-600">
              课程列表加载失败：{{ courseError }}
            </p>
            <p v-else class="mt-1 text-[11px] text-[#9ca3af]">关联后学生可在时间轴跳转到对应课程</p>
          </div>
          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">
              排序号 <span class="text-rose-500">*</span>
            </label>
            <input
              v-model.number="form.sortOrder"
              type="number"
              min="0"
              step="1"
              :class="[
                'w-full h-10 px-3 rounded-lg border text-[13.5px] outline-none transition-all',
                errors.sortOrder
                  ? 'border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100'
                  : 'border-black/[0.08] focus:border-amber-400 focus:ring-2 focus:ring-amber-100',
              ]"
            />
            <p v-if="errors.sortOrder" class="mt-1 text-[11.5px] text-rose-600">
              {{ errors.sortOrder }}
            </p>
            <p v-else class="mt-1 text-[11px] text-[#9ca3af]">
              数字越小越靠前；新建时已默认排到当前末尾
            </p>
          </div>
        </div>
      </section>

      <p class="text-[12px] text-[#9ca3af] px-1">
        节点 id 由系统自动生成（形如 timeline-1），无需手动填写。
      </p>
    </div>
  </div>
</template>
