<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueDraggable } from 'vue-draggable-plus'
import { toast } from 'vue3-toastify'
import { useUserStore } from '@/stores/user'
import {
  fetchAdminArtifacts,
  fetchAdminMuseums,
  updateArtifactOrder,
  deleteArtifact,
  type AdminArtifact,
  type AdminMuseum,
} from '@/services/admin'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const artifacts = ref<AdminArtifact[]>([])
const museums = ref<AdminMuseum[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const saving = ref(false)
const search = ref('')

/** 博物馆筛选：支持从博物馆编辑页带 ?museum=xxx 跳过来 */
const museumFilter = ref<string>('全部')

const matches = (a: AdminArtifact) => {
  if (museumFilter.value !== '全部' && a.museumId !== museumFilter.value) return false
  const q = search.value.trim().toLowerCase()
  if (!q) return true
  return (
    a.name.toLowerCase().includes(q) ||
    (a.nameEn ?? '').toLowerCase().includes(q) ||
    (a.civilization ?? '').toLowerCase().includes(q)
  )
}

/**
 * 筛选状态下禁止拖拽：拖动会打乱未显示项的顺序。
 * 列表仍渲染全部，只把不匹配的变淡（题目页的同款做法）。
 */
const dragDisabled = computed(
  () => search.value.trim().length > 0 || museumFilter.value !== '全部',
)

// ---------------------------------------------------------------------------
// 拖拽排序
// ---------------------------------------------------------------------------
async function onDragEnd() {
  if (saving.value) return
  saving.value = true

  const before = new Map(artifacts.value.map((a) => [a.id, a.sortOrder]))
  const changes = artifacts.value
    .map((a, index) => ({ id: a.id, sortOrder: index }))
    .filter((c) => before.get(c.id) !== c.sortOrder)

  if (changes.length === 0) {
    saving.value = false
    return
  }

  // 乐观更新
  changes.forEach((c) => {
    const a = artifacts.value.find((x) => x.id === c.id)
    if (a) a.sortOrder = c.sortOrder
  })

  try {
    const res = await updateArtifactOrder(changes)
    if (!res.ok) throw new Error(res.error)
  } catch (e) {
    toast.error(`排序保存失败：${e instanceof Error ? e.message : '未知错误'}`, { theme: 'auto' })
    await load()
  } finally {
    saving.value = false
  }
}

// ---------------------------------------------------------------------------
// 删除（无学生数据引用，二次确认即可）
// ---------------------------------------------------------------------------
const deleteTarget = ref<AdminArtifact | null>(null)
const deleteConfirmText = ref('')

const canConfirmDelete = computed(
  () => !!deleteTarget.value && deleteConfirmText.value.trim() === deleteTarget.value.id,
)

function openDelete(a: AdminArtifact) {
  deleteTarget.value = a
  deleteConfirmText.value = ''
}

async function confirmDelete() {
  if (!canConfirmDelete.value || !deleteTarget.value) return
  saving.value = true
  try {
    const res = await deleteArtifact(deleteTarget.value.id)
    if (!res.ok) throw new Error(res.error)
    toast.success('文物已删除', { theme: 'auto', transition: 'slide' })
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

  const [artifactsRes, museumsRes] = await Promise.all([
    fetchAdminArtifacts(userStore.userId),
    fetchAdminMuseums(userStore.userId),
  ])
  artifacts.value = artifactsRes.data
  museums.value = museumsRes.data
  error.value = artifactsRes.error ?? museumsRes.error ?? null
  loading.value = false
}

const openArtifact = (id: string) => router.push(`/admin/artifacts/${id}`)
const newArtifact = () =>
  router.push(
    museumFilter.value !== '全部' ? `/admin/artifacts/new?museum=${museumFilter.value}` : '/admin/artifacts/new',
  )

onMounted(() => {
  // 从博物馆编辑页「管理这座馆的文物」跳过来时，默认按馆筛选
  const q = route.query.museum
  if (typeof q === 'string' && q) museumFilter.value = q
  void load()
})
</script>

<template>
  <div class="space-y-5">
    <!-- ===================== 顶部 ===================== -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="min-w-0">
        <h1 class="text-[17px] font-semibold tracking-tight">文物</h1>
        <p class="text-[12px] text-[#9ca3af] mt-0.5">
          {{ artifacts.length }} 件文物 · 按博物馆筛选后新增会自动归属该馆
        </p>
      </div>

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <div class="relative">
          <input
            v-model="search"
            type="text"
            placeholder="搜索文物名称或文明"
            class="w-[200px] h-9 px-3 rounded-lg bg-white border border-black/[0.07] text-[13px] placeholder:text-[#9ca3af] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
          />
        </div>
        <select
          v-model="museumFilter"
          class="h-9 px-2.5 rounded-lg bg-white border border-black/[0.07] text-[13px] text-[#4b5563] outline-none focus:border-amber-400 transition-all max-w-[220px]"
        >
          <option value="全部">全部博物馆</option>
          <option v-for="m in museums" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
        <button
          class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px] font-medium hover:bg-[#1f2937] transition-colors flex items-center gap-1.5"
          @click="newArtifact"
        >
          <span class="text-sm leading-none">＋</span><span>新增文物</span>
        </button>
      </div>
    </div>

    <p v-if="dragDisabled && !loading" class="text-[12px] text-amber-600 -mt-2">
      筛选状态下已停用拖拽，以免打乱未显示项的顺序
    </p>

    <!-- ===================== 加载 / 错误 ===================== -->
    <div v-if="loading" class="flex items-center justify-center py-24 gap-3 text-[#9ca3af]">
      <div class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
      <span class="text-[13px]">正在加载文物…</span>
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
      v-else-if="artifacts.length === 0"
      class="bg-white rounded-2xl border border-black/[0.06] p-14 text-center space-y-4"
    >
      <p class="text-4xl">🏺</p>
      <h2 class="text-[15px] font-semibold">还没有文物</h2>
      <p class="text-[13px] text-[#6b7280]">先录入博物馆，再为它添加馆藏文物。</p>
      <button
        class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px] font-medium"
        @click="newArtifact"
      >
        添加第一件文物
      </button>
    </div>

    <!-- ===================== 文物列表 ===================== -->
    <div v-else class="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
      <VueDraggable
        v-model="artifacts"
        handle=".drag-handle"
        :animation="160"
        :disabled="dragDisabled"
        ghost-class="drag-ghost"
        @end="onDragEnd"
      >
        <div
          v-for="(a, index) in artifacts"
          :key="a.id"
          :class="[
            'flex items-center gap-3 px-4 py-3.5 border-b border-black/[0.04] last:border-b-0 hover:bg-black/[0.015] transition-colors',
            !matches(a) ? 'opacity-30' : '',
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

          <!-- 缩略图 -->
          <div
            class="w-11 h-11 rounded-lg flex-shrink-0 overflow-hidden bg-[#f9fafb] border border-black/[0.05] flex items-center justify-center text-[20px] cursor-pointer"
            @click="openArtifact(a.id)"
          >
            <img v-if="a.imageUrl" :src="a.imageUrl" :alt="a.name" class="w-full h-full object-cover" />
            <span v-else>🏺</span>
          </div>

          <!-- 序号 -->
          <span class="text-[12px] text-[#9ca3af] tabular-nums w-7 flex-shrink-0">{{ index + 1 }}</span>

          <!-- 主信息 -->
          <div class="min-w-0 flex-1 cursor-pointer" @click="openArtifact(a.id)">
            <p class="text-[13.5px] font-medium truncate">{{ a.name }}</p>
            <p class="text-[11px] text-[#9ca3af] mt-0.5 truncate">
              <span class="font-mono">{{ a.id }}</span>
              <template v-if="a.period"> · {{ a.period }}</template>
              <template v-if="a.material"> · {{ a.material }}</template>
            </p>
          </div>

          <!-- 所属馆 -->
          <span
            class="hidden sm:flex h-[22px] px-2 rounded-md bg-[#f3f4f6] text-[#6b7280] text-[11px] font-medium items-center flex-shrink-0 max-w-[180px] truncate"
            :title="a.museumName"
          >
            {{ a.museumName }}
          </span>

          <!-- 操作 -->
          <div class="flex gap-1 flex-shrink-0">
            <button
              class="h-7 px-2.5 rounded-md text-[12px] text-[#4b5563] hover:bg-black/[0.05] transition-colors"
              @click="openArtifact(a.id)"
            >
              编辑
            </button>
            <button
              class="h-7 px-2.5 rounded-md text-[12px] text-rose-600 hover:bg-rose-50 transition-colors"
              @click="openDelete(a)"
            >
              删除
            </button>
          </div>
        </div>
      </VueDraggable>
    </div>

    <p v-if="!loading && artifacts.length > 0" class="text-[12px] text-[#9ca3af] text-center">
      <template v-if="dragDisabled">筛选状态下已停用拖拽</template>
      <template v-else>拖动左侧手柄可调整文物顺序，顺序会影响学生端的展示先后</template>
    </p>

    <!-- ===================== 删除确认 ===================== -->
    <Teleport to="body">
      <div
        v-if="deleteTarget"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-[2px]"
        @click.self="deleteTarget = null"
      >
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
          <h3 class="text-[15px] font-semibold">删除文物「{{ deleteTarget.name }}」？</h3>

          <div class="rounded-lg bg-[#f9fafb] border border-black/[0.05] px-3 py-2.5">
            <p class="text-[12.5px] text-[#4b5563] leading-relaxed line-clamp-2">
              {{ deleteTarget.description || '（无描述）' }}
            </p>
            <p class="text-[11px] text-[#9ca3af] mt-1 font-mono">{{ deleteTarget.id }}</p>
          </div>

          <div class="rounded-lg bg-[#f9fafb] border border-black/[0.05] px-3 py-2.5">
            <p class="text-[12px] text-[#6b7280] leading-relaxed">
              文物不关联任何学生答题记录，删除只移除内容本身，但不可恢复。
            </p>
          </div>

          <div>
            <label class="block text-[12.5px] text-[#4b5563] mb-1.5">
              请输入文物 ID 以确认：<span class="font-mono font-medium">{{ deleteTarget.id }}</span>
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
