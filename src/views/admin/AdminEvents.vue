<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { toast } from 'vue3-toastify'
import { useUserStore } from '@/stores/user'
import {
  fetchAdminEvents,
  fetchEventImpact,
  updateEventOrder,
  deleteHistoryEvent,
  type AdminHistoryEvent,
} from '@/services/admin'

const router = useRouter()
const userStore = useUserStore()

const events = ref<AdminHistoryEvent[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const saving = ref(false)
const search = ref('')
const dynastyFilter = ref('全部')
const categoryFilter = ref('全部')

/** 朝代 / 类别筛选选项：从数据里动态取，新增朝代自动出现 */
const dynasties = computed(() => [
  '全部',
  ...Array.from(new Set(events.value.map((e) => e.dynasty).filter(Boolean) as string[])),
])
const categories = computed(() => [
  '全部',
  ...Array.from(new Set(events.value.map((e) => e.category).filter(Boolean) as string[])),
])

const matches = (e: AdminHistoryEvent) => {
  if (dynastyFilter.value !== '全部' && e.dynasty !== dynastyFilter.value) return false
  if (categoryFilter.value !== '全部' && e.category !== categoryFilter.value) return false
  const q = search.value.trim().toLowerCase()
  if (!q) return true
  return (
    e.title.toLowerCase().includes(q) ||
    (e.description ?? '').toLowerCase().includes(q) ||
    e.keywords.some((k) => k.toLowerCase().includes(q))
  )
}

/**
 * 筛选状态下禁止拖拽：拖动会打乱未显示项的顺序。
 * 参考题目页的做法 —— 列表仍渲染全部，只把不匹配的变淡。
 */
const dragDisabled = computed(
  () => search.value.trim().length > 0 || dynastyFilter.value !== '全部' || categoryFilter.value !== '全部',
)

// ---------------------------------------------------------------------------
// 拖拽排序
// ---------------------------------------------------------------------------
async function onDragEnd() {
  if (saving.value) return
  saving.value = true

  const before = new Map(events.value.map((e) => [e.id, e.sortOrder]))
  const changes = events.value
    .map((e, index) => ({ id: e.id, sortOrder: index }))
    .filter((c) => before.get(c.id) !== c.sortOrder)

  if (changes.length === 0) {
    saving.value = false
    return
  }

  // 乐观更新
  changes.forEach((c) => {
    const e = events.value.find((x) => x.id === c.id)
    if (e) e.sortOrder = c.sortOrder
  })

  try {
    const res = await updateEventOrder(changes)
    if (!res.ok) throw new Error(res.error)
  } catch (e) {
    toast.error(`排序保存失败：${e instanceof Error ? e.message : '未知错误'}`, { theme: 'auto' })
    await load()
  } finally {
    saving.value = false
  }
}

// ---------------------------------------------------------------------------
// 删除（影响面预览 + 手输 id 确认，沿用题目页的确认模式）
// ---------------------------------------------------------------------------
const deleteTarget = ref<AdminHistoryEvent | null>(null)
const deleteImpact = ref<{ referencedBy: number } | null>(null)
const deleteConfirmText = ref('')

const canConfirmDelete = computed(
  () => !!deleteTarget.value && deleteConfirmText.value.trim() === deleteTarget.value.id,
)

async function openDelete(e: AdminHistoryEvent) {
  deleteTarget.value = e
  deleteConfirmText.value = ''
  deleteImpact.value = null
  const impact = await fetchEventImpact(e.id)
  deleteImpact.value = { referencedBy: impact.referencedBy }
}

async function confirmDelete() {
  if (!canConfirmDelete.value || !deleteTarget.value) return
  saving.value = true
  try {
    const res = await deleteHistoryEvent(deleteTarget.value.id)
    if (!res.ok) throw new Error(res.error)
    toast.success('事件已删除', { theme: 'auto', transition: 'slide' })
    deleteTarget.value = null
    await load()
  } catch (e) {
    toast.error(`删除失败：${e instanceof Error ? e.message : '未知错误'}`, { theme: 'auto' })
  } finally {
    saving.value = false
  }
}

// ---------------------------------------------------------------------------
async function load() {
  loading.value = true
  error.value = null

  const res = await fetchAdminEvents(userStore.userId)
  events.value = res.data
  error.value = res.error ?? null
  loading.value = false
}

const openEvent = (id: string) => router.push(`/admin/events/${id}`)
const newEvent = () => router.push('/admin/events/new')

onMounted(load)
</script>

<template>
  <div class="space-y-5">
    <!-- ===================== 顶部 ===================== -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="min-w-0">
        <h1 class="text-[17px] font-semibold tracking-tight">历史事件</h1>
        <p class="text-[12px] text-[#9ca3af] mt-0.5">
          {{ events.length }} 个事件 · 拖动可调整展示顺序（学生端事件库按此顺序排列）
        </p>
      </div>

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <div class="relative">
          <input
            v-model="search"
            type="text"
            placeholder="搜索标题、描述或关键词"
            class="w-[200px] h-9 px-3 rounded-lg bg-white border border-black/[0.07] text-[13px] placeholder:text-[#9ca3af] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
          />
        </div>
        <select
          v-model="dynastyFilter"
          class="h-9 px-2.5 rounded-lg bg-white border border-black/[0.07] text-[13px] text-[#4b5563] outline-none focus:border-amber-400 transition-all"
        >
          <option v-for="d in dynasties" :key="d" :value="d">{{ d === '全部' ? '全部朝代' : d }}</option>
        </select>
        <select
          v-model="categoryFilter"
          class="h-9 px-2.5 rounded-lg bg-white border border-black/[0.07] text-[13px] text-[#4b5563] outline-none focus:border-amber-400 transition-all"
        >
          <option v-for="c in categories" :key="c" :value="c">{{ c === '全部' ? '全部类别' : c }}</option>
        </select>
        <button
          class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px] font-medium hover:bg-[#1f2937] transition-colors flex items-center gap-1.5"
          @click="newEvent"
        >
          <span class="text-sm leading-none">＋</span><span>新增事件</span>
        </button>
      </div>
    </div>

    <p v-if="dragDisabled && !loading" class="text-[12px] text-amber-600 -mt-2">
      筛选状态下已停用拖拽，以免打乱未显示项的顺序
    </p>

    <!-- ===================== 加载 / 错误 ===================== -->
    <div v-if="loading" class="flex items-center justify-center py-24 gap-3 text-[#9ca3af]">
      <div class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
      <span class="text-[13px]">正在加载事件…</span>
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
      v-else-if="events.length === 0"
      class="bg-white rounded-2xl border border-black/[0.06] p-14 text-center space-y-4"
    >
      <p class="text-4xl">📜</p>
      <h2 class="text-[15px] font-semibold">还没有历史事件</h2>
      <p class="text-[13px] text-[#6b7280]">事件库为空时，学生在学习端会看到空白。</p>
      <button
        class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px] font-medium"
        @click="newEvent"
      >
        添加第一个事件
      </button>
    </div>

    <!-- ===================== 事件列表 ===================== -->
    <div v-else class="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
      <VueDraggable
        v-model="events"
        handle=".drag-handle"
        :animation="160"
        :disabled="dragDisabled"
        ghost-class="drag-ghost"
        @end="onDragEnd"
      >
        <div
          v-for="(e, index) in events"
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
          <span class="text-[12px] text-[#9ca3af] tabular-nums w-7 flex-shrink-0">{{ index + 1 }}</span>

          <!-- 主信息 -->
          <div class="min-w-0 flex-1 cursor-pointer" @click="openEvent(e.id)">
            <p class="text-[13.5px] font-medium truncate">{{ e.title }}</p>
            <p class="text-[11px] text-[#9ca3af] mt-0.5 truncate">
              <span class="font-mono">{{ e.id }}</span>
              <template v-if="e.year"> · {{ e.year }}</template>
              <template v-if="e.keywords.length"> · {{ e.keywords.length }} 个关键词</template>
            </p>
          </div>

          <!-- 标签 -->
          <div class="hidden sm:flex items-center gap-1.5 flex-shrink-0">
            <span
              v-if="e.dynasty"
              class="h-[22px] px-2 rounded-md bg-[#f3f4f6] text-[#6b7280] text-[11px] font-medium flex items-center"
            >
              {{ e.dynasty }}
            </span>
            <span
              v-if="e.category"
              class="h-[22px] px-2 rounded-md bg-amber-50 text-amber-700 text-[11px] font-medium flex items-center"
            >
              {{ e.category }}
            </span>
            <span v-if="e.image" class="text-[13px]" title="有配图">🖼️</span>
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
              @click="openDelete(e)"
            >
              删除
            </button>
          </div>
        </div>
      </VueDraggable>
    </div>

    <p v-if="!loading && events.length > 0" class="text-[12px] text-[#9ca3af] text-center">
      <template v-if="dragDisabled">筛选状态下已停用拖拽</template>
      <template v-else>拖动左侧手柄可调整事件顺序，顺序会影响学生端的展示先后</template>
    </p>

    <!-- ===================== 删除确认 ===================== -->
    <Teleport to="body">
      <div
        v-if="deleteTarget"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-[2px]"
        @click.self="deleteTarget = null"
      >
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
          <h3 class="text-[15px] font-semibold">删除事件「{{ deleteTarget.title }}」？</h3>

          <div class="rounded-lg bg-[#f9fafb] border border-black/[0.05] px-3 py-2.5">
            <p class="text-[12.5px] text-[#4b5563] leading-relaxed line-clamp-2">
              {{ deleteTarget.description || '（无描述）' }}
            </p>
            <p class="text-[11px] text-[#9ca3af] mt-1 font-mono">{{ deleteTarget.id }}</p>
          </div>

          <!-- 影响面 -->
          <div
            v-if="deleteImpact && deleteImpact.referencedBy > 0"
            class="rounded-xl bg-amber-50 border border-amber-100 p-4 space-y-1.5"
          >
            <p class="text-[12.5px] text-amber-800 font-medium">
              有 {{ deleteImpact.referencedBy }} 个事件的「相关事件」引用了它：
            </p>
            <p class="text-[12.5px] text-amber-700 leading-relaxed">
              删除后，这些事件的相关事件列表会出现悬空引用。
              事件本身不关联学生答题记录，删除不会影响学习数据。
            </p>
            <p class="text-[12px] text-amber-600 pt-1">此操作不可恢复。</p>
          </div>
          <div
            v-else-if="deleteImpact"
            class="rounded-lg bg-[#f9fafb] border border-black/[0.05] px-3 py-2.5"
          >
            <p class="text-[12px] text-[#6b7280]">
              没有其他事件引用它，且事件不关联学生答题记录，删除只移除内容本身。
            </p>
          </div>
          <div v-else class="text-[12px] text-[#9ca3af]">正在检查影响面…</div>

          <div>
            <label class="block text-[12.5px] text-[#4b5563] mb-1.5">
              请输入事件 ID 以确认：<span class="font-mono font-medium">{{ deleteTarget.id }}</span>
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
