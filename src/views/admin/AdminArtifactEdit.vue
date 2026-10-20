<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { toast } from 'vue3-toastify'
import { useUserStore } from '@/stores/user'
import MediaUploader from '@/components/admin/MediaUploader.vue'
import {
  fetchAdminArtifact,
  fetchAdminMuseums,
  createArtifact,
  updateArtifact,
  type AdminArtifact,
  type ArtifactFormData,
  type AdminMuseum,
} from '@/services/admin'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const isNew = computed(() => route.name === 'AdminArtifactNew' || route.params.id === 'new')
const artifactId = computed(() => (isNew.value ? null : String(route.params.id)))

const form = ref<ArtifactFormData>({
  museumId: '',
  name: '',
  nameEn: '',
  period: '',
  civilization: '',
  material: '',
  dimensions: '',
  description: '',
  detailedDescription: '',
  imageUrl: null,
  significance: '',
})

const artifact = ref<AdminArtifact | null>(null)
const museums = ref<AdminMuseum[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)

const dirty = ref(false)
let snapshot = ''
const snapshotOf = (d: ArtifactFormData) => JSON.stringify(d)
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
  if (!form.value.museumId) e.museumId = '必须选择所属博物馆'
  if (!form.value.name.trim()) e.name = '名称不能为空'
  else if (form.value.name.trim().length < 2) e.name = '名称至少 2 个字'
  return e
})

const canSave = computed(() => Object.keys(errors.value).length === 0)

// ---------------------------------------------------------------------------
async function load() {
  loading.value = true
  error.value = null

  const museumsRes = await fetchAdminMuseums(userStore.userId)
  museums.value = museumsRes.data
  if (museumsRes.error && museums.value.length === 0) {
    error.value = museumsRes.error
    loading.value = false
    return
  }

  // 从文物列表按馆筛选跳过来时，默认选中该馆
  const q = route.query.museum
  const defaultMuseum = typeof q === 'string' && museums.value.some((m) => m.id === q) ? q : ''

  if (isNew.value) {
    form.value = {
      museumId: defaultMuseum,
      name: '',
      nameEn: '',
      period: '',
      civilization: '',
      material: '',
      dimensions: '',
      description: '',
      detailedDescription: '',
      imageUrl: null,
      significance: '',
    }
    snapshot = snapshotOf(form.value)
    loading.value = false
    return
  }

  const res = await fetchAdminArtifact(userStore.userId, artifactId.value!)
  if (res.error) error.value = res.error
  if (!res.data) {
    error.value = res.error ?? '文物不存在'
    loading.value = false
    return
  }

  artifact.value = res.data
  form.value = {
    museumId: res.data.museumId,
    name: res.data.name,
    nameEn: res.data.nameEn ?? '',
    period: res.data.period ?? '',
    civilization: res.data.civilization ?? '',
    material: res.data.material ?? '',
    dimensions: res.data.dimensions ?? '',
    description: res.data.description ?? '',
    detailedDescription: res.data.detailedDescription ?? '',
    imageUrl: res.data.imageUrl,
    significance: res.data.significance ?? '',
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
      const res = await createArtifact(form.value)
      if (!res.ok) throw new Error(res.error)
      dirty.value = false
      toast.success('文物已创建', { theme: 'auto', transition: 'slide' })
      await router.replace(`/admin/artifacts/${res.id}`)
    } else {
      const res = await updateArtifact(artifactId.value!, form.value)
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
        @click="router.push('/admin/artifacts')"
      >
        <span>←</span><span>返回文物</span>
      </button>

      <h1 class="text-[17px] font-semibold tracking-tight truncate">
        {{ isNew ? '新增文物' : form.name || '未命名文物' }}
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
          {{ saving ? '保存中…' : isNew ? '创建文物' : '保存' }}
        </button>
      </div>
    </div>

    <!-- ===================== 加载 / 错误 ===================== -->
    <div v-if="loading" class="flex items-center justify-center py-24 gap-3 text-[#9ca3af]">
      <div class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
      <span class="text-[13px]">正在加载…</span>
    </div>

    <div v-else-if="error && !artifact" class="bg-white rounded-2xl border border-black/[0.06] p-10 text-center">
      <p class="text-[13px] text-rose-600">{{ error }}</p>
    </div>

    <!-- ===================== 表单 ===================== -->
    <div v-else class="max-w-3xl space-y-4">
      <!-- 基本信息 -->
      <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-4">
        <h2 class="text-[13px] font-semibold text-[#6b7280]">基本信息</h2>

        <div>
          <label class="block text-[12.5px] font-medium mb-1.5">
            所属博物馆 <span class="text-rose-500">*</span>
          </label>
          <select
            v-model="form.museumId"
            :class="[
              'w-full h-10 px-3 rounded-lg border text-[13.5px] outline-none transition-all bg-white',
              errors.museumId
                ? 'border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100'
                : 'border-black/[0.08] focus:border-amber-400 focus:ring-2 focus:ring-amber-100',
            ]"
          >
            <option value="" disabled>请选择博物馆</option>
            <option v-for="m in museums" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
          <p v-if="errors.museumId" class="mt-1 text-[11.5px] text-rose-600">{{ errors.museumId }}</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">
              文物名称 <span class="text-rose-500">*</span>
            </label>
            <input
              v-model="form.name"
              type="text"
              placeholder="例如：四羊方尊"
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
              placeholder="例如：Four-goat Square Zun"
              class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">时期</label>
            <input
              v-model="form.period"
              type="text"
              placeholder="例如：商代"
              class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
            />
          </div>
          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">文明</label>
            <input
              v-model="form.civilization"
              type="text"
              placeholder="例如：中华文明"
              class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">材质</label>
            <input
              v-model="form.material"
              type="text"
              placeholder="例如：青铜"
              class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
            />
          </div>
          <div>
            <label class="block text-[12.5px] font-medium mb-1.5">尺寸</label>
            <input
              v-model="form.dimensions"
              type="text"
              placeholder="例如：高 58.3cm"
              class="w-full h-10 px-3 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
            />
          </div>
        </div>
      </section>

      <!-- 描述 -->
      <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-4">
        <h2 class="text-[13px] font-semibold text-[#6b7280]">描述</h2>

        <div>
          <label class="block text-[12.5px] font-medium mb-1.5">简介</label>
          <textarea
            v-model="form.description"
            rows="3"
            placeholder="一两句话介绍这件文物"
            class="w-full px-3 py-2.5 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-y"
          ></textarea>
        </div>

        <div>
          <label class="block text-[12.5px] font-medium mb-1.5">详细介绍</label>
          <textarea
            v-model="form.detailedDescription"
            rows="5"
            placeholder="文物的来历、工艺、流转等详细信息"
            class="w-full px-3 py-2.5 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-y"
          ></textarea>
        </div>

        <div>
          <label class="block text-[12.5px] font-medium mb-1.5">历史意义</label>
          <textarea
            v-model="form.significance"
            rows="3"
            placeholder="这件文物为什么重要"
            class="w-full px-3 py-2.5 rounded-lg border border-black/[0.08] text-[13.5px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all resize-y"
          ></textarea>
        </div>
      </section>

      <!-- 图片 -->
      <section class="bg-white rounded-2xl border border-black/[0.06] p-5 space-y-4">
        <h2 class="text-[13px] font-semibold text-[#6b7280]">图片</h2>
        <MediaUploader
          v-model="form.imageUrl"
          folder="artifacts"
          emoji-fallback="🏺"
          preview-class="w-32 h-32"
        />
      </section>
    </div>
  </div>
</template>
