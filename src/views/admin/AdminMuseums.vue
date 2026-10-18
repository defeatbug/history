<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { toast } from 'vue3-toastify'
import { useUserStore } from '@/stores/user'
import {
  fetchAdminMuseums,
  fetchMuseumImpact,
  updateMuseumOrder,
  deleteMuseum,
  type AdminMuseum,
} from '@/services/admin'

const router = useRouter()
const userStore = useUserStore()

const museums = ref<AdminMuseum[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const saving = ref(false)
const search = ref('')

const matches = (m: AdminMuseum) => {
  const q = search.value.trim().toLowerCase()
  if (!q) return true
  return (
    m.name.toLowerCase().includes(q) ||
    (m.nameEn ?? '').toLowerCase().includes(q) ||
    (m.location ?? '').toLowerCase().includes(q)
  )
}

/** 搜索状态下禁止拖拽，避免打乱未显示项的顺序 */
const dragDisabled = computed(() => search.value.trim().length > 0)

// ---------------------------------------------------------------------------
// 拖拽排序
// ---------------------------------------------------------------------------
async function onDragEnd() {
  if (saving.value) return
  saving.value = true

  const before = new Map(museums.value.map((m) => [m.id, m.sortOrder]))
  const changes = museums.value
    .map((m, index) => ({ id: m.id, sortOrder: index }))
    .filter((c) => before.get(c.id) !== c.sortOrder)

  if (changes.length === 0) {
    saving.value = false
    return
  }

  // 乐观更新
  changes.forEach((c) => {
    const m = museums.value.find((x) => x.id === c.id)
    if (m) m.sortOrder = c.sortOrder
  })

  try {
    const res = await updateMuseumOrder(changes)
    if (!res.ok) throw new Error(res.error)
  } catch (e) {
    toast.error(`排序保存失败：${e instanceof Error ? e.message : '未知错误'}`, { theme: 'auto' })
    await load()
  } finally {
    saving.value = false
  }
}

// ---------------------------------------------------------------------------
// 删除（级联影响面 + 手输 id 确认）
// ---------------------------------------------------------------------------
const deleteTarget = ref<AdminMuseum | null>(null)
const deleteImpact = ref<{ artifactCount: number } | null>(null)
const deleteConfirmText = ref('')

const canConfirmDelete = computed(
  () => !!deleteTarget.value && deleteConfirmText.value.trim() === deleteTarget.value.id,
)

async function openDelete(m: AdminMuseum) {
  deleteTarget.value = m
  deleteConfirmText.value = ''
  deleteImpact.value = null
  const impact = await fetchMuseumImpact(m.id)
  deleteImpact.value = { artifactCount: impact.artifactCount }
}

async function confirmDelete() {
  if (!canConfirmDelete.value || !deleteTarget.value) return
  saving.value = true
  try {
    const res = await deleteMuseum(deleteTarget.value.id)
    if (!res.ok) throw new Error(res.error)
    toast.success('博物馆已删除', { theme: 'auto', transition: 'slide' })
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

  const res = await fetchAdminMuseums(userStore.userId)
  museums.value = res.data
  error.value = res.error ?? null
  loading.value = false
}

const openMuseum = (id: string) => router.push(`/admin/museums/${id}`)
const newMuseum = () => router.push('/admin/museums/new')

onMounted(load)
</script>

<template>
  <div class="space-y-5">
    <!-- ===================== 顶部 ===================== -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="min-w-0">
        <h1 class="text-[17px] font-semibold tracking-tight">博物馆</h1>
        <p class="text-[12px] text-[#9ca3af] mt-0.5">
          {{ museums.length }} 座博物馆 · 拖动卡片可调整展示顺序
        </p>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <div class="relative">
          <input
            v-model="search"
            type="text"
            placeholder="搜索名称或地点"
            class="w-[200px] h-9 px-3 rounded-lg bg-white border border-black/[0.07] text-[13px] placeholder:text-[#9ca3af] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
          />
        </div>
        <button
          class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px] font-medium hover:bg-[#1f2937] transition-colors flex items-center gap-1.5"
          @click="newMuseum"
        >
          <span class="text-sm leading-none">＋</span><span>新增博物馆</span>
        </button>
      </div>
    </div>

    <p v-if="dragDisabled && !loading" class="text-[12px] text-amber-600 -mt-2">
      搜索状态下已停用拖拽，以免打乱未显示项的顺序
    </p>

    <!-- ===================== 加载 / 错误 ===================== -->
    <div v-if="loading" class="flex items-center justify-center py-24 gap-3 text-[#9ca3af]">
      <div class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
      <span class="text-[13px]">正在加载博物馆…</span>
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
      v-else-if="museums.length === 0"
      class="bg-white rounded-2xl border border-black/[0.06] p-14 text-center space-y-4"
    >
      <p class="text-4xl">🏛️</p>
      <h2 class="text-[15px] font-semibold">还没有博物馆</h2>
      <p class="text-[13px] text-[#6b7280]">博物馆为空时，学生在学习端会看到空白。</p>
      <button
        class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px] font-medium"
        @click="newMuseum"
      >
        添加第一座博物馆
      </button>
    </div>

    <!-- ===================== 博物馆卡片 ===================== -->
    <div v-else>
      <VueDraggable
        v-model="museums"
        handle=".drag-handle"
        :animation="160"
        :disabled="dragDisabled"
        ghost-class="drag-ghost"
        class="grid grid-cols-1 md:grid-cols-2 gap-4"
        @end="onDragEnd"
      >
        <article
          v-for="m in museums"
          :key="m.id"
          :class="[
            'bg-white rounded-2xl border border-black/[0.06] p-4 flex gap-4 transition-shadow group',
            !matches(m) ? 'opacity-30' : '',
            dragDisabled ? '' : 'hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)]',
          ]"
        >
          <!-- 拖拽手柄 -->
          <span
            v-if="!dragDisabled"
            class="drag-handle text-[14px] text-[#d1d5db] hover:text-[#9ca3af] cursor-grab active:cursor-grabbing self-center flex-shrink-0"
            title="拖动调整顺序"
          >
            ⠿
          </span>

          <!-- 封面 -->
          <div
            class="w-16 h-16 rounded-xl flex items-center justify-center text-[30px] flex-shrink-0 overflow-hidden bg-[#f9fafb] border border-black/[0.05] cursor-pointer"
            @click="openMuseum(m.id)"
          >
            <img
              v-if="m.coverUrl"
              :src="m.coverUrl"
              :alt="m.name"
              class="w-full h-full object-cover"
            />
            <span v-else>{{ m.coverImage || '🏛️' }}</span>
          </div>

          <!-- 信息 -->
          <div class="min-w-0 flex-1 cursor-pointer" @click="openMuseum(m.id)">
            <h3 class="text-[14px] font-semibold truncate">{{ m.name }}</h3>
            <p v-if="m.nameEn" class="text-[11.5px] text-[#9ca3af] italic truncate mt-0.5">
              {{ m.nameEn }}
            </p>
            <p class="text-[11.5px] text-[#9ca3af] truncate mt-0.5">
              {{ [m.location, m.country].filter(Boolean).join(' · ') || '未设地点' }}
              <template v-if="m.established"> · {{ m.established }}建馆</template>
            </p>
            <p class="text-[11px] text-[#9ca3af] mt-0.5 font-mono">{{ m.id }}</p>
            <div class="flex flex-wrap gap-1.5 mt-2">
              <span
                class="h-[22px] px-2 rounded-md bg-[#f3f4f6] text-[#6b7280] text-[11px] font-medium flex items-center"
              >
                🏺 {{ m.artifactCount }} 件文物
              </span>
            </div>
          </div>

          <!-- 操作 -->
          <div class="flex flex-col gap-1 flex-shrink-0 self-start">
            <button
              class="h-7 px-2.5 rounded-md text-[12px] text-[#4b5563] hover:bg-black/[0.05] transition-colors"
              @click="openMuseum(m.id)"
            >
              编辑
            </button>
            <button
              class="h-7 px-2.5 rounded-md text-[12px] text-rose-600 hover:bg-rose-50 transition-colors"
              @click="openDelete(m)"
            >
              删除
            </button>
          </div>
        </article>
      </VueDraggable>
    </div>

    <p v-if="!loading && museums.length > 0" class="text-[12px] text-[#9ca3af] text-center">
      <template v-if="dragDisabled">搜索状态下已停用拖拽</template>
      <template v-else>拖动左侧手柄可调整博物馆顺序，顺序会影响学生端的展示先后</template>
    </p>

    <!-- ===================== 删除确认 ===================== -->
    <Teleport to="body">
      <div
        v-if="deleteTarget"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-[2px]"
        @click.self="deleteTarget = null"
      >
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
          <h3 class="text-[15px] font-semibold">删除博物馆「{{ deleteTarget.name }}」？</h3>

          <div class="rounded-lg bg-[#f9fafb] border border-black/[0.05] px-3 py-2.5">
            <p class="text-[12.5px] text-[#4b5563] leading-relaxed line-clamp-2">
              {{ deleteTarget.description || '（无描述）' }}
            </p>
            <p class="text-[11px] text-[#9ca3af] mt-1 font-mono">{{ deleteTarget.id }}</p>
          </div>

          <!-- 影响面 -->
          <div class="rounded-xl bg-rose-50 border border-rose-100 p-4 space-y-1.5">
            <p class="text-[12.5px] text-rose-800 font-medium">这次删除会一并移除：</p>
            <ul class="text-[12.5px] text-rose-700 space-y-1">
              <li>
                · 馆内
                <span class="font-semibold">{{ deleteImpact?.artifactCount ?? '…' }} 件</span>
                文物（外键级联删除）
              </li>
            </ul>
            <p class="text-[12.5px] text-rose-700 leading-relaxed">
              文物不关联学生答题记录，删除不会影响学习数据，但内容不可恢复。
            </p>
            <p class="text-[12px] text-rose-600 pt-1">此操作不可恢复。</p>
          </div>

          <div>
            <label class="block text-[12.5px] text-[#4b5563] mb-1.5">
              请输入博物馆 ID 以确认：<span class="font-mono font-medium">{{ deleteTarget.id }}</span>
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
