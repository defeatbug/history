<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { toast } from 'vue3-toastify'
import { useUserStore } from '@/stores/user'
import MediaUploader from '@/components/admin/MediaUploader.vue'
import {
  fetchAdminMuseum,
  createMuseum,
  updateMuseum,
  type AdminMuseum,
  type MuseumFormData,
} from '@/services/admin'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const isNew = computed(() => route.name === 'AdminMuseumNew' || route.params.id === 'new')
const museumId = computed(() => (isNew.value ? null : String(route.params.id)))

/** 常用 emoji —— 与现有博物馆数据保持同一套视觉语言 */
const EMOJI_CHOICES = [
  '🏛️', '🏺', '🗿', '⚔️', '👑', '🐉', '🎨', '📜',
  '🕌', '⛩️', '🏰', '🖼️', '⚱️', '🔱', '🌍', '🏮',
]

const form = ref<MuseumFormData>({
  name: '',
  nameEn: '',
  location: '',
  country: '',
  established: '',
  description: '',
  coverImage: '🏛️',
  coverUrl: null,
})

const museum = ref<AdminMuseum | null>(null)
const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)

const dirty = ref(false)
let snapshot = ''
const snapshotOf = (d: MuseumFormData) => JSON.stringify(d)
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
  if (!form.value.name.trim()) e.name = '名称不能为空'
  else if (form.value.name.trim().length < 2) e.name = '名称至少 2 个字'
  return e
})

const canSave = computed(() => Object.keys(errors.value).length === 0)

// ---------------------------------------------------------------------------
async function load() {
  loading.value = true
  error.value = null

  if (isNew.value) {
    form.value = {
      name: '',
      nameEn: '',
      location: '',
      country: '',
      established: '',
      description: '',
      coverImage: '🏛️',
      coverUrl: null,
    }
    snapshot = snapshotOf(form.value)
    loading.value = false
    return
  }

  const res = await fetchAdminMuseum(userStore.userId, museumId.value!)
  if (res.error) error.value = res.error
  if (!res.data) {
    error.value = res.error ?? '博物馆不存在'
    loading.value = false
    return
  }

  museum.value = res.data
  form.value = {
    name: res.data.name,
    nameEn: res.data.nameEn ?? '',
    location: res.data.location ?? '',
    country: res.data.country ?? '',
    established: res.data.established ?? '',
    description: res.data.description ?? '',
    coverImage: res.data.coverImage ?? '🏛️',
    coverUrl: res.data.coverUrl,
  }
  snapshot = snapshotOf(form.value)
  loading.value = false
}

// ---------------------------------------------------------------------------
async function save() {
  if (!canSave.value || saving.value) return
  saving.value = true

  try {
    if (isNew.value) {
      const res = await createMuseum(form.value)
      if (!res.ok) throw new Error(res.error)
      dirty.value = false
      toast.success('博物馆已创建', { theme: 'auto', transition: 'slide' })
      await router.replace(`/admin/museums/${res.id}`)
    } else {
      const res = await updateMuseum(museumId.value!, form.value)
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
        @click="router.push('/admin/museums')"
      >
        <span>←</span><span>返回博物馆</span>
      </button>

      <h1 class="text-[17px] font-semibold tracking-tight truncate">
        {{ isNew ? '新增博物馆' : form.name || '未命名博物馆' }}
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
          {{ saving ? '保存中…' : isNew ? '创建博物馆' : '保存' }}
        </button>
      </div>
    </div>

    <!-- ===================== 加载 / 错误 ===================== -->
    <div v-if="loading" class="flex items-center justify-center py-24 gap-3 text-[#9ca3af]">
      <div class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
      <span class="text-[13px]">正在加载…</span>
    </div>

    <div v-else-if="error && !museum" class="bg-white rounded-2xl border border-black/[0.06] p-10 text-center">
      <p class="text-[13px] text-rose-600">{{ error }}</p>
    </div>

    <!-- ===================== 表单 + 影响面 ===================== -->
    <div v-else class="grid grid-cols-1 lg:grid-cols-[1fr_308px] gap-5 items-start">
      <!-- ---------- 左：表单 ---------- -->
      <div class="space-y-4">
        <!-- 基本信息 -->
        <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-4">
          <h2 class="text-[13px] font-semibold text-[#6b7280]">基本信息</h2>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-[12.5px] font-medium mb-1.5">
                博物馆名称 <span class="text-rose-500">*</span>
              </label>
              <input
                v-model="form.name"
                type="text"
                placeholder="例如：故宫博物院"
                :class="[
                  'w-full h-10 px-3 rounded-lg border text-[13.5px] outline-none transition-all',
                  errors.name
                    ? 'border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100'
                    : 'border-black/[0.08] focus:border-amber-400 focus:ring-2 focus:ring-amber-100',
                ]"
              />
              <p v-if="errors.name" class="mt-1 text-[11.5px] text-rose-600">{{ errors.name }}</p>
            </div>
            <div>
              <label class="block text-[12.5px] font-medium mb-1.5">英文名称</label>
              <input
                v-model="form.nameEn"
                type="text"
                placeholder="例如：The Palace Museum"
                class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
              />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label class="block text-[12.5px] font-medium mb-1.5">所在地</label>
              <input
                v-model="form.location"
                type="text"
                placeholder="例如：北京"
                class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
              />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium mb-1.5">国家</label>
              <input
                v-model="form.country"
                type="text"
                placeholder="例如：中国"
                class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
              />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium mb-1.5">建立时间</label>
              <input
                v-model="form.established"
                type="text"
                placeholder="例如：1925"
                class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
              />
            </div>
          </div>

          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">简介</label>
            <textarea
              v-model="form.description"
              rows="3"
              placeholder="一两句话介绍这座博物馆"
              class="w-full px-3 py-2.5 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-y"
            ></textarea>
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
            folder="covers/museums"
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
          </div>
        </section>
      </div>

      <!-- ---------- 右：影响面 ---------- -->
      <aside class="lg:sticky lg:top-20 space-y-4">
        <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-4">
          <h2 class="text-[13px] font-semibold text-[#6b7280]">影响面</h2>

          <template v-if="isNew">
            <p class="text-[12.5px] text-[#9ca3af] leading-relaxed">
              新建的博物馆还没有文物。创建后可以在文物模块为它添加馆藏。
            </p>
          </template>

          <template v-else-if="museum">
            <div class="flex items-baseline gap-2">
              <span class="text-[24px] font-semibold tracking-tight">
                {{ museum.artifactCount }}
              </span>
              <span class="text-[12.5px] text-[#6b7280]">件馆藏文物</span>
            </div>

            <div class="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5">
              <p class="text-[11.5px] text-amber-800 leading-relaxed">
                删除这座博物馆会**连带删除**它的全部 {{ museum.artifactCount }} 件文物（外键级联），
                且不可恢复。文物不关联学生答题记录。
              </p>
            </div>

            <button
              class="w-full h-9 rounded-lg bg-white border border-black/[0.07] text-[12.5px] text-[#4b5563] hover:bg-black/[0.02] transition-colors"
              @click="router.push(`/admin/artifacts?museum=${museumId}`)"
            >
              管理这座馆的文物 →
            </button>

            <p class="text-[11.5px] text-[#9ca3af] leading-relaxed">
              如需删除，请回到博物馆列表操作（删除前会要求手输 ID 确认）。
            </p>
          </template>
        </section>
      </aside>
    </div>
  </div>
</template>
