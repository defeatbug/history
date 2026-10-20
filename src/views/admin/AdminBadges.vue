<script setup lang="ts">
/**
 * 勋章管理（只读列表 + 文案维护）。
 *
 * 刻意不开放的入口：
 *   新建 / 删除 / 排序 / 解锁规则配置 ——
 *   解锁逻辑维护在数据库函数 evaluate_badges 内，
 *   PRODUCT.md 已否决「勋章解锁规则的图形化配置」。
 * 这里只允许修改 name / description 这两个纯文案字段。
 */
import { ref, onMounted } from 'vue'
import { toast } from 'vue3-toastify'
import { useUserStore } from '@/stores/user'
import { fetchAdminBadges, updateBadgeText, type AdminBadge } from '@/services/admin'

const userStore = useUserStore()

const badges = ref<AdminBadge[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const saving = ref(false)

/** 正在行内编辑的勋章 id（一次只编一个） */
const editingId = ref<string | null>(null)
const editName = ref('')
const editDescription = ref('')

function startEdit(b: AdminBadge) {
  editingId.value = b.id
  editName.value = b.name
  editDescription.value = b.description ?? ''
}

function cancelEdit() {
  editingId.value = null
  editName.value = ''
  editDescription.value = ''
}

async function saveEdit(b: AdminBadge) {
  const name = editName.value.trim()
  if (!name) {
    toast.error('勋章名称不能为空', { theme: 'auto' })
    return
  }
  saving.value = true
  try {
    const res = await updateBadgeText(b.id, { name, description: editDescription.value })
    if (!res.ok) throw new Error(res.error)
    b.name = name
    b.description = editDescription.value.trim() || null
    toast.success('已保存', { theme: 'auto', transition: 'slide' })
    cancelEdit()
  } catch (e) {
    toast.error(`保存失败：${e instanceof Error ? e.message : '未知错误'}`, { theme: 'auto' })
  } finally {
    saving.value = false
  }
}

async function load() {
  loading.value = true
  error.value = null

  const res = await fetchAdminBadges(userStore.userId)
  badges.value = res.data
  error.value = res.error ?? null
  loading.value = false
}

onMounted(load)
</script>

<template>
  <div class="space-y-5">
    <!-- ===================== 顶部 ===================== -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="min-w-0">
        <h1 class="text-[17px] font-semibold tracking-tight">勋章</h1>
        <p class="text-[12px] text-[#9ca3af] mt-0.5">
          {{ badges.length }} 枚勋章 · 仅可修改名称与描述，解锁规则维护在数据库函数内
        </p>
      </div>
    </div>

    <!-- ===================== 加载 / 错误 ===================== -->
    <div v-if="loading" class="flex items-center justify-center py-24 gap-3 text-[#9ca3af]">
      <div class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
      <span class="text-[13px]">正在加载勋章…</span>
    </div>

    <div
      v-else-if="error"
      class="bg-white rounded-2xl border border-black/[0.06] p-10 text-center space-y-3"
    >
      <p class="text-[13px] text-rose-600">加载失败：{{ error }}</p>
      <button class="h-9 px-4 rounded-lg bg-[#111827] text-white text-[13px]" @click="load">重试</button>
    </div>

    <!-- ===================== 勋章列表 ===================== -->
    <div v-else class="bg-white rounded-2xl border border-black/[0.06] overflow-hidden">
      <div
        v-for="b in badges"
        :key="b.id"
        class="flex items-start gap-4 px-5 py-4 border-b border-black/[0.04] last:border-b-0"
      >
        <!-- 图标（只读） -->
        <div
          class="w-12 h-12 rounded-xl bg-[#f9fafb] border border-black/[0.05] flex items-center justify-center text-[24px] flex-shrink-0"
        >
          {{ b.icon || '🏅' }}
        </div>

        <div class="min-w-0 flex-1">
          <!-- 行内编辑态 -->
          <template v-if="editingId === b.id">
            <div class="space-y-2.5">
              <input
                v-model="editName"
                type="text"
                placeholder="勋章名称"
                class="w-full h-9 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
              />
              <textarea
                v-model="editDescription"
                rows="2"
                placeholder="勋章描述"
                class="w-full px-3 py-2 rounded-lg border border-black/[0.08] text-[13px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-y"
              ></textarea>
              <div class="flex gap-2">
                <button
                  :disabled="saving"
                  class="h-8 px-3.5 rounded-lg bg-[#111827] text-white text-[12.5px] font-medium hover:bg-[#1f2937] transition-colors disabled:opacity-40"
                  @click="saveEdit(b)"
                >
                  {{ saving ? '保存中…' : '保存' }}
                </button>
                <button
                  class="h-8 px-3.5 rounded-lg bg-white border border-black/[0.07] text-[12.5px] text-[#4b5563] hover:bg-black/[0.02]"
                  @click="cancelEdit"
                >
                  取消
                </button>
              </div>
            </div>
          </template>

          <!-- 展示态 -->
          <template v-else>
            <div class="flex items-center gap-2">
              <h3 class="text-[14px] font-semibold truncate">{{ b.name }}</h3>
              <span class="text-[10.5px] text-[#9ca3af] font-mono flex-shrink-0">{{ b.id }}</span>
            </div>
            <p class="text-[12.5px] text-[#6b7280] mt-1 leading-relaxed">
              {{ b.description || '（无描述）' }}
            </p>
            <p class="text-[11.5px] text-[#9ca3af] mt-1.5 leading-relaxed">
              解锁条件：{{ b.requirement || '（见数据库函数）' }}
            </p>
          </template>
        </div>

        <!-- 操作 -->
        <div class="flex-shrink-0">
          <button
            v-if="editingId !== b.id"
            class="h-7 px-2.5 rounded-md text-[12px] text-[#4b5563] hover:bg-black/[0.05] transition-colors"
            @click="startEdit(b)"
          >
            改文案
          </button>
        </div>
      </div>
    </div>

    <!-- ===================== 说明 ===================== -->
    <div class="bg-white rounded-2xl border border-black/[0.06] p-5">
      <p class="text-[12.5px] text-[#6b7280] leading-relaxed">
        勋章的<strong class="text-[#4b5563]">图标、解锁条件与展示顺序</strong>由数据库维护：
        解锁规则在 <span class="font-mono text-[11.5px]">evaluate_badges</span> 函数内，
        顺序由 <span class="font-mono text-[11.5px]">sort_order</span> 决定。
        如需调整，请直接改数据库 —— 后台刻意不开放这些入口，
        避免配出「前端渲染不了」的规则。
      </p>
    </div>
  </div>
</template>
