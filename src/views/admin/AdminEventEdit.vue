<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { toast } from 'vue3-toastify'
import { useUserStore } from '@/stores/user'
import MediaUploader from '@/components/admin/MediaUploader.vue'
import {
  fetchAdminEvent,
  fetchAdminEvents,
  fetchEventImpact,
  createHistoryEvent,
  updateHistoryEvent,
  EVENT_CATEGORIES,
  type AdminHistoryEvent,
  type HistoryEventFormData,
} from '@/services/admin'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/** 新建 / 编辑判定：路由表里 `events/new` 是静态路径，以路由名为准 */
const isNew = computed(() => route.name === 'AdminEventNew' || route.params.id === 'new')
const eventId = computed(() => (isNew.value ? null : String(route.params.id)))

const form = ref<HistoryEventFormData>({
  title: '',
  period: '',
  year: '',
  dynasty: '',
  category: '政治',
  description: '',
  content: '',
  significance: '',
  keywords: [],
  image: null,
  relatedEvents: [],
})

/** 关键词的逗号分隔输入框（界面层字符串，保存时转数组） */
const keywordsInput = ref('')

const event = ref<AdminHistoryEvent | null>(null)
const allEvents = ref<AdminHistoryEvent[]>([])
const impact = ref<{ referencedBy: number } | null>(null)
const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)

const dirty = ref(false)
let snapshot = ''
const snapshotOf = (d: HistoryEventFormData) => JSON.stringify(d)
watch(
  form,
  (v) => {
    if (!loading.value) dirty.value = snapshotOf(v) !== snapshot
  },
  { deep: true },
)
// 关键词输入框不属于 form ref，单独监听
watch(keywordsInput, () => {
  if (!loading.value) dirty.value = true
})

/** 可选的相关事件：排除自己 */
const relatedCandidates = computed(() =>
  allEvents.value.filter((e) => e.id !== eventId.value),
)

/** 已有朝代的提示（datalist），新增朝代直接手输即可 */
const dynastyHints = computed(() =>
  Array.from(new Set(allEvents.value.map((e) => e.dynasty).filter(Boolean) as string[])),
)

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------
const errors = computed(() => {
  const e: Record<string, string> = {}
  if (!form.value.title.trim()) e.title = '标题不能为空'
  else if (form.value.title.trim().length < 2) e.title = '标题至少 2 个字'
  return e
})

const canSave = computed(() => Object.keys(errors.value).length === 0)

// ---------------------------------------------------------------------------
async function load() {
  loading.value = true
  error.value = null

  const listRes = await fetchAdminEvents(userStore.userId)
  allEvents.value = listRes.data

  if (isNew.value) {
    form.value = {
      title: '',
      period: '',
      year: '',
      dynasty: '',
      category: '政治',
      description: '',
      content: '',
      significance: '',
      keywords: [],
      image: null,
      relatedEvents: [],
    }
    keywordsInput.value = ''
    snapshot = snapshotOf(form.value)
    loading.value = false
    return
  }

  const res = await fetchAdminEvent(userStore.userId, eventId.value!)
  if (res.error) error.value = res.error
  if (!res.data) {
    error.value = res.error ?? '事件不存在'
    loading.value = false
    return
  }

  event.value = res.data
  form.value = {
    title: res.data.title,
    period: res.data.period ?? '',
    year: res.data.year ?? '',
    dynasty: res.data.dynasty ?? '',
    category: res.data.category ?? '政治',
    description: res.data.description ?? '',
    content: res.data.content ?? '',
    significance: res.data.significance ?? '',
    keywords: [...res.data.keywords],
    image: res.data.image,
    relatedEvents: [...res.data.relatedEvents],
  }
  keywordsInput.value = res.data.keywords.join('，')
  snapshot = snapshotOf(form.value)

  const impactRes = await fetchEventImpact(eventId.value!)
  impact.value = { referencedBy: impactRes.referencedBy }

  loading.value = false
}

// ---------------------------------------------------------------------------
function toggleRelated(id: string) {
  const list = form.value.relatedEvents
  const i = list.indexOf(id)
  if (i >= 0) list.splice(i, 1)
  else list.push(id)
}

async function save() {
  if (!canSave.value || saving.value) return
  saving.value = true

  // 逗号分隔（含中英文逗号、顿号）转数组
  const payload: HistoryEventFormData = {
    ...form.value,
    keywords: keywordsInput.value
      .split(/[,，、]/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0),
  }

  try {
    if (isNew.value) {
      const res = await createHistoryEvent(payload)
      if (!res.ok) throw new Error(res.error)
      dirty.value = false
      toast.success('事件已创建', { theme: 'auto', transition: 'slide' })
      await router.replace(`/admin/events/${res.id}`)
    } else {
      const res = await updateHistoryEvent(eventId.value!, payload)
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
        @click="router.push('/admin/events')"
      >
        <span>←</span><span>返回事件</span>
      </button>

      <h1 class="text-[17px] font-semibold tracking-tight truncate">
        {{ isNew ? '新建事件' : form.title || '未命名事件' }}
      </h1>

      <span v-if="dirty" class="text-[12px] text-amber-600 flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>未保存
      </span>

      <div class="ml-auto">
        <button
          :disabled="!canSave || saving"
          class="h-9 px-5 rounded-lg bg-[#111827] text-white text-[13px] font-medium hover:bg-[#1f2937] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          @click="save"
        >
          {{ saving ? '保存中…' : isNew ? '创建事件' : '保存' }}
        </button>
      </div>
    </div>

    <!-- ===================== 加载 / 错误 ===================== -->
    <div v-if="loading" class="flex items-center justify-center py-24 gap-3 text-[#9ca3af]">
      <div class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
      <span class="text-[13px]">正在加载…</span>
    </div>

    <div v-else-if="error && !event" class="bg-white rounded-2xl border border-black/[0.06] p-10 text-center">
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
              事件标题 <span class="text-rose-500">*</span>
            </label>
            <input
              v-model="form.title"
              type="text"
              placeholder="例如：郑和下西洋"
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
              <label class="block text-[12.5px] font-medium mb-1.5">年份</label>
              <input
                v-model="form.year"
                type="text"
                placeholder="例如：前2070 / 618-907"
                class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
              />
              <p class="mt-1 text-[11px] text-[#9ca3af]">公元前年份以「前」开头，如「前2070」</p>
            </div>
            <div>
              <label class="block text-[12.5px] font-medium mb-1.5">时期描述</label>
              <input
                v-model="form.period"
                type="text"
                placeholder="例如：公元618年-907年"
                class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
              />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-[12.5px] font-medium mb-1.5">朝代</label>
              <input
                v-model="form.dynasty"
                type="text"
                list="dynasty-hints"
                placeholder="例如：唐朝"
                class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
              />
              <datalist id="dynasty-hints">
                <option v-for="d in dynastyHints" :key="d" :value="d" />
              </datalist>
            </div>
            <div>
              <label class="block text-[12.5px] font-medium mb-1.5">类别</label>
              <select
                v-model="form.category"
                class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all bg-white"
              >
                <option v-for="c in EVENT_CATEGORIES" :key="c" :value="c">{{ c }}</option>
              </select>
              <p class="mt-1 text-[11px] text-[#9ca3af]">类别固定六选一，学生端只认识这六个</p>
            </div>
          </div>
        </section>

        <!-- 内容 -->
        <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-4">
          <h2 class="text-[13px] font-semibold text-[#6b7280]">内容</h2>

          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">事件概览</label>
            <textarea
              v-model="form.description"
              rows="2"
              placeholder="一两句话说明这个事件是什么"
              class="w-full px-3 py-2.5 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-y"
            ></textarea>
          </div>

          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">详细讲解</label>
            <textarea
              v-model="form.content"
              rows="5"
              placeholder="事件的来龙去脉，可以分段"
              class="w-full px-3 py-2.5 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-y"
            ></textarea>
          </div>

          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">历史意义</label>
            <textarea
              v-model="form.significance"
              rows="3"
              placeholder="这个事件为什么重要"
              class="w-full px-3 py-2.5 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-y"
            ></textarea>
          </div>

          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">关键词</label>
            <input
              v-model="keywordsInput"
              type="text"
              placeholder="用逗号分隔，例如：大禹，治水，夏朝"
              class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
            />
            <p class="mt-1 text-[11px] text-[#9ca3af]">支持中英文逗号与顿号，学生端搜索会用到</p>
          </div>
        </section>

        <!-- 配图 -->
        <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-4">
          <h2 class="text-[13px] font-semibold text-[#6b7280]">配图</h2>
          <MediaUploader
            v-model="form.image"
            folder="events"
            emoji-fallback="📜"
            preview-class="w-32 h-24"
          />
        </section>

        <!-- 相关事件 -->
        <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-3">
          <div class="flex items-center gap-2">
            <h2 class="text-[13px] font-semibold text-[#6b7280]">相关事件</h2>
            <span class="text-[11.5px] text-[#9ca3af]">勾选后在学生端详情页展示关联推荐</span>
          </div>

          <div v-if="relatedCandidates.length === 0" class="text-[12.5px] text-[#9ca3af]">
            还没有其他事件可关联。
          </div>
          <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto">
            <label
              v-for="cand in relatedCandidates"
              :key="cand.id"
              class="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-black/[0.06] text-[12.5px] cursor-pointer hover:bg-black/[0.02] transition-colors"
            >
              <input
                type="checkbox"
                :checked="form.relatedEvents.includes(cand.id)"
                class="w-4 h-4 accent-amber-500"
                @change="toggleRelated(cand.id)"
              />
              <span class="truncate">{{ cand.title }}</span>
              <span class="ml-auto text-[11px] text-[#9ca3af] font-mono flex-shrink-0">{{ cand.id }}</span>
            </label>
          </div>
        </section>
      </div>

      <!-- ---------- 右：影响面 ---------- -->
      <aside class="lg:sticky lg:top-20 space-y-4">
        <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-4">
          <h2 class="text-[13px] font-semibold text-[#6b7280]">影响面</h2>

          <template v-if="isNew">
            <p class="text-[12.5px] text-[#9ca3af] leading-relaxed">
              新建的事件还没有任何引用。创建后这里会显示它被多少事件的「相关事件」引用。
            </p>
          </template>

          <template v-else-if="impact">
            <div class="flex items-baseline gap-2">
              <span class="text-[24px] font-semibold tracking-tight">
                {{ impact.referencedBy }}
              </span>
              <span class="text-[12.5px] text-[#6b7280]">个事件引用了它</span>
            </div>
            <div
              v-if="impact.referencedBy > 0"
              class="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5"
            >
              <p class="text-[11.5px] text-amber-800 leading-relaxed">
                删除这个事件后，引用方的「相关事件」会出现悬空引用。
                事件不关联学生答题记录，删除不影响学习数据。
              </p>
            </div>
            <div v-else class="rounded-lg bg-[#f9fafb] border border-black/[0.05] px-3 py-2.5">
              <p class="text-[11.5px] text-[#6b7280] leading-relaxed">
                没有其他事件引用它，删除只移除内容本身。
              </p>
            </div>
            <p class="text-[11.5px] text-[#9ca3af] leading-relaxed">
              如需删除，请回到事件列表操作（删除前会要求手输 ID 确认）。
            </p>
          </template>
        </section>
      </aside>
    </div>
  </div>
</template>
