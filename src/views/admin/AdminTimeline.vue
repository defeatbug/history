<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { toast } from 'vue3-toastify'
import { useUserStore } from '@/stores/user'
import {
  fetchAdminTimelineEvents,
  fetchAdminCourses,
  updateTimelineOrder,
  deleteTimelineEvent,
  TIMELINE_TRACKS,
  type AdminTimelineEvent,
  type TimelineTrack,
} from '@/services/admin'

const router = useRouter()
const userStore = useUserStore()

/**
 * 两个分支分开存储：学生端按 track 分栏展示，栏内按 sort_order 排序，
 * 所以拖拽时只重排当前栏，两栏的序号互不影响。
 */
const chinaEvents = ref<AdminTimelineEvent[]>([])
const worldEvents = ref<AdminTimelineEvent[]>([])

/** lessonId → 课程标题，用于列表展示关联课程 */
const lessonTitles = ref<Record<string, string>>({})

const loading = ref(true)
const error = ref<string | null>(null)
const saving = ref(false)
const search = ref('')
const trackFilter = ref<'all' | TimelineTrack>('all')

const total = computed(() => chinaEvents.value.length + worldEvents.value.length)

/** 分组渲染配置：未选分支时两栏都显示，选了就只显示一栏 */
const groups = computed<
  Array<{ track: TimelineTrack; label: string; items: AdminTimelineEvent[]; visible: boolean }>
>(() => [
  {
    track: 'china',
    label: '中国史',
    items: chinaEvents.value,
    visible: trackFilter.value === 'all' || trackFilter.value === 'china',
  },
  {
    track: 'world',
    label: '世界史',
    items: worldEvents.value,
    visible: trackFilter.value === 'all' || trackFilter.value === 'world',
  },
])

/** 关键词过滤：命中的行正常显示，未命中的变淡（与历史事件页一致） */
const matches = (e: AdminTimelineEvent) => {
  const q = search.value.trim().toLowerCase()
  if (!q) return true
  return (
    e.title.toLowerCase().includes(q) ||
    e.id.toLowerCase().includes(q) ||
    (e.year ?? '').toLowerCase().includes(q) ||
    (e.description ?? '').toLowerCase().includes(q) ||
    (e.civilization ?? '').toLowerCase().includes(q) ||
    lessonTitle(e.lessonId).toLowerCase().includes(q)
  )
}

/** 搜索时停用拖拽：拖动会打乱未命中项的顺序 */
const dragDisabled = computed(() => search.value.trim().length > 0)

const lessonTitle = (lessonId: string | null) => {
  if (!lessonId) return '未关联课程'
  return lessonTitles.value[lessonId] ?? lessonId
}

// ---------------------------------------------------------------------------
// 拖拽排序（按栏内新顺序提交变化项）
// ---------------------------------------------------------------------------
async function onGroupUpdate(track: TimelineTrack, items: AdminTimelineEvent[]) {
  if (saving.value) return
  if (track === 'china') chinaEvents.value = items
  else worldEvents.value = items
  await persistOrder(items)
}

async function persistOrder(items: AdminTimelineEvent[]) {
  const changes = items
    .map((e, index) => ({ id: e.id, sortOrder: index, before: e.sortOrder }))
    .filter((c) => c.before !== c.sortOrder)

  if (changes.length === 0) return

  saving.value = true
  try {
    const res = await updateTimelineOrder(changes.map(({ id, sortOrder }) => ({ id, sortOrder })))
    if (!res.ok) throw new Error(res.error)
    // 排序已保存，同步本地序号，避免下次拖拽重复提交
    changes.forEach((c) => {
      const hit = items.find((e) => e.id === c.id)
      if (hit) hit.sortOrder = c.sortOrder
    })
  } catch (e) {
    toast.error(`排序保存失败：${e instanceof Error ? e.message : '未知错误'}`, { theme: 'auto' })
    await load()
  } finally {
    saving.value = false
  }
}

// ---------------------------------------------------------------------------
// 删除（二次确认；时间轴不关联学生数据，确认即可）
// ---------------------------------------------------------------------------
const deleteTarget = ref<AdminTimelineEvent | null>(null)
const deleting = ref(false)

async function confirmDelete() {
  if (!deleteTarget.value || deleting.value) return
  deleting.value = true
  try {
    const res = await deleteTimelineEvent(deleteTarget.value.id)
    if (!res.ok) throw new Error(res.error)
    toast.success('学习路径节点已删除', { theme: 'auto', transition: 'slide' })
    deleteTarget.value = null
    await load()
  } catch (e) {
    toast.error(`删除失败：${e instanceof Error ? e.message : '未知错误'}`, { theme: 'auto' })
  } finally {
    deleting.value = false
  }
}

// ---------------------------------------------------------------------------
async function load() {
  loading.value = true
  error.value = null

  const [timelineRes, courseRes] = await Promise.all([
    fetchAdminTimelineEvents(userStore.userId),
    fetchAdminCourses(userStore.userId),
  ])

  chinaEvents.value = timelineRes.data.filter((e) => e.track === 'china')
  worldEvents.value = timelineRes.data.filter((e) => e.track === 'world')
  error.value = timelineRes.error ?? null

  // 课程读取失败不影响列表，只是关联课程列显示 id 兜底
  lessonTitles.value = courseRes.error
    ? {}
    : Object.fromEntries(courseRes.data.map((c) => [c.id, c.title]))

  loading.value = false
}

const openEvent = (id: string) => router.push(`/admin/timeline/${id}`)
const newEvent = () => router.push('/admin/timeline/new')

onMounted(load)
</script>

<template>
  <div class="space-y-5">
    <!-- ===================== 顶部 ===================== -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="min-w-0">
        <h1 class="text-[17px] font-semibold tracking-tight">学习路径</h1>
        <p class="text-[12px] text-[#9ca3af] mt-0.5">
          {{ total }} 个节点 · 拖动可调整栏内顺序（学生端时间轴按此顺序展示）
        </p>
      </div>

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <div class="relative">
          <input
            v-model="search"
            type="text"
            placeholder="搜索标题、年份或文明"
            class="w-[200px] h-9 px-3 rounded-lg bg-white border border-black/[0.07] text-[13px] placeholder:text-[#9ca3af] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
          />
        </div>
        <select
          v-model="trackFilter"
          class="h-9 px-2.5 rounded-lg bg-white border border-black/[0.07] text-[13px] text-[#4b5563] outline-none focus:border-amber-400 transition-all"
        >
          <option value="all">全部分支</option>
          <option v-for="t in TIMELINE_TRACKS" :key="t.value" :value="t.value">
            {{ t.label }}
          </option>
        </select>
        <button
          class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px] font-medium hover:bg-[#1f2937] transition-colors flex items-center gap-1.5"
          @click="newEvent"
        >
          <span class="text-sm leading-none">＋</span><span>新增节点</span>
        </button>
      </div>
    </div>

    <p v-if="dragDisabled && !loading && total > 0" class="text-[12px] text-amber-600 -mt-2">
      搜索状态下已停用拖拽，以免打乱未命中项的顺序
    </p>

    <!-- ===================== 加载 / 错误 ===================== -->
    <div v-if="loading" class="flex items-center justify-center py-24 gap-3 text-[#9ca3af]">
      <div
        class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"
      ></div>
      <span class="text-[13px]">正在加载学习路径…</span>
    </div>

    <div
      v-else-if="error"
      class="bg-white rounded-2xl border border-black/[0.06] p-10 text-center space-y-3"
    >
      <p class="text-[13px] text-rose-600">加载失败：{{ error }}</p>
      <button class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px]" @click="load">
        重试
      </button>
    </div>

    <!-- ===================== 空态 ===================== -->
    <div
      v-else-if="total === 0"
      class="bg-white rounded-2xl border border-black/[0.06] p-14 text-center space-y-4"
    >
      <p class="text-4xl">🕰️</p>
      <h2 class="text-[15px] font-semibold">还没有学习路径节点</h2>
      <p class="text-[13px] text-[#6b7280]">时间轴为空时，学生在学习端会看到空白。</p>
      <button
        class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px] font-medium"
        @click="newEvent"
      >
        添加第一个节点
      </button>
    </div>

    <!-- ===================== 分支列表 ===================== -->
    <div v-else class="space-y-4">
      <section
        v-for="group in groups"
        v-show="group.visible"
        :key="group.track"
        class="bg-white rounded-2xl border border-black/[0.06] overflow-hidden"
      >
        <div
          class="flex items-center gap-2 px-4 py-3 border-b border-black/[0.04] bg-black/[0.015]"
        >
          <h2 class="text-[13px] font-semibold">{{ group.label }}</h2>
          <span class="text-[11.5px] text-[#9ca3af]">{{ group.items.length }} 个节点</span>
        </div>

        <p
          v-if="group.items.length === 0"
          class="px-4 py-8 text-center text-[12.5px] text-[#9ca3af]"
        >
          {{ group.label }}还没有节点
        </p>

        <VueDraggable
          v-else
          :model-value="group.items"
          handle=".drag-handle"
          :animation="160"
          :disabled="dragDisabled"
          ghost-class="drag-ghost"
          @update:model-value="onGroupUpdate(group.track, $event)"
        >
          <div
            v-for="(e, index) in group.items"
            :key="e.id"
            :class="[
              'flex items-center gap-3 px-4 py-3.5 border-b border-black/[0.04] last:border-b-0 hover:bg-black/[0.015] transition-colors',
              !matches(e) ? 'opacity-30' : '',
            ]"
          >
            <!-- 拖拽手柄 -->
            <span
              v-if="!dragDisabled"
              class="drag-handle text-[14px] text-[#d1d5db] hover:text-[#9ca3af] cursor-grab active:cursor-grabbing flex-shrink-0"
              title="拖动调整顺序"
            >
              ⠿
            </span>
            <span v-else class="text-[#e5e7eb] flex-shrink-0">—</span>

            <!-- 序号 -->
            <span class="text-[12px] text-[#9ca3af] tabular-nums w-7 flex-shrink-0">{{
              index + 1
            }}</span>

            <!-- 主信息 -->
            <div class="min-w-0 flex-1 cursor-pointer" @click="openEvent(e.id)">
              <p class="text-[13.5px] font-medium truncate">{{ e.title }}</p>
              <p class="text-[11px] text-[#9ca3af] mt-0.5 truncate">
                <span class="font-mono">{{ e.id }}</span>
                <template v-if="e.year"> · {{ e.year }}</template>
                <template v-if="e.civilization"> · {{ e.civilization }}</template>
              </p>
            </div>

            <!-- 关联课程 + 排序号 -->
            <div class="hidden sm:flex items-center gap-1.5 flex-shrink-0">
              <span
                class="h-[22px] px-2 rounded-md text-[11px] font-medium flex items-center max-w-[160px] truncate"
                :class="e.lessonId ? 'bg-[#f3f4f6] text-[#6b7280]' : 'bg-[#f9fafb] text-[#9ca3af]'"
                :title="lessonTitle(e.lessonId)"
              >
                {{ lessonTitle(e.lessonId) }}
              </span>
              <span
                class="h-[22px] px-2 rounded-md bg-amber-50 text-amber-700 text-[11px] font-medium flex items-center tabular-nums"
                title="栏内排序号"
              >
                排序 {{ e.sortOrder }}
              </span>
            </div>

            <!-- 操作 -->
            <div class="flex gap-1 flex-shrink-0">
              <button
                class="h-7 px-2.5 rounded-md text-[12px] text-[#4b5563] hover:bg-black/[0.05] transition-colors"
                @click="openEvent(e.id)"
              >
                编辑
              </button>
              <button
                class="h-7 px-2.5 rounded-md text-[12px] text-rose-600 hover:bg-rose-50 transition-colors"
                @click="deleteTarget = e"
              >
                删除
              </button>
            </div>
          </div>
        </VueDraggable>
      </section>
    </div>

    <p v-if="!loading && total > 0" class="text-[12px] text-[#9ca3af] text-center">
      <template v-if="dragDisabled">搜索状态下已停用拖拽</template>
      <template v-else>拖动左侧手柄可调整栏目内顺序，顺序会影响学生端的展示先后</template>
    </p>

    <!-- ===================== 删除确认 ===================== -->
    <Teleport to="body">
      <div
        v-if="deleteTarget"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-[2px]"
        @click.self="deleteTarget = null"
      >
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
          <h3 class="text-[15px] font-semibold">删除节点「{{ deleteTarget.title }}」？</h3>

          <div class="rounded-lg bg-[#f9fafb] border border-black/[0.05] px-3 py-2.5">
            <p class="text-[12.5px] text-[#4b5563] leading-relaxed line-clamp-2">
              {{ deleteTarget.description || '（无描述）' }}
            </p>
            <p class="text-[11px] text-[#9ca3af] mt-1 font-mono">
              {{ deleteTarget.id }} ·
              {{ deleteTarget.year || '无年份' }}
            </p>
          </div>

          <p class="text-[12.5px] text-[#6b7280] leading-relaxed">
            时间轴节点不关联学生答题与学习记录，删除只会移除内容本身。此操作不可恢复。
          </p>

          <div class="flex gap-2 justify-end pt-1">
            <button
              class="h-9 px-4 rounded-lg bg-white border border-black/[0.07] text-[13px] text-[#4b5563] hover:bg-black/[0.02]"
              @click="deleteTarget = null"
            >
              取消
            </button>
            <button
              :disabled="deleting"
              class="h-9 px-4 rounded-lg bg-rose-600 text-white text-[13px] font-medium hover:bg-rose-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              @click="confirmDelete"
            >
              {{ deleting ? '删除中…' : '确认删除' }}
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
