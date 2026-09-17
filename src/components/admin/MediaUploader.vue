<script setup lang="ts">
/**
 * 图片上传组件
 * ----------------------------------------------------------------------------
 * 选择或拖入图片 → 前端压缩 → 上传到 Storage → 回填公开 URL。
 *
 * 压缩结果会显示出来（原始体积 → 压缩后体积），
 * 这样管理员能直观看到「为什么上传后图变小了」。
 */
import { ref, computed } from 'vue'
import { uploadImage, deleteImage, type MediaFolder } from '@/services/storage'
import { formatBytes, ALLOWED_IMAGE_TYPES, MAX_INPUT_BYTES } from '@/utils/image'

const props = defineProps<{
  /** 当前图片 URL；为 null 表示未设置 */
  modelValue: string | null
  /** 存储目录，决定路径前缀 */
  folder: MediaFolder
  /** 无图片时展示的 emoji（与学习端保持一致） */
  emojiFallback?: string
  /** 预览框的尺寸 */
  previewClass?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | null): void
}>()

const inputRef = ref<HTMLInputElement>()
const isDragging = ref(false)
const uploading = ref(false)
const error = ref('')
const lastResult = ref<{ originalBytes: number; compressedBytes: number } | null>(null)

const accept = ALLOWED_IMAGE_TYPES.join(',')
const maxLabel = formatBytes(MAX_INPUT_BYTES)

const hasImage = computed(() => Boolean(props.modelValue))

const previewSize = computed(() => props.previewClass ?? 'w-24 h-24')

function pick() {
  if (uploading.value) return
  inputRef.value?.click()
}

async function handleFiles(files: FileList | null | undefined) {
  const file = files?.[0]
  if (!file) return

  error.value = ''
  lastResult.value = null
  uploading.value = true

  // 覆盖旧图前先记下路径，上传成功后清理，避免留下孤儿文件
  const previous = props.modelValue

  try {
    const result = await uploadImage(file, props.folder)

    if (!result.ok || !result.url) {
      error.value = result.error ?? '上传失败'
      return
    }

    emit('update:modelValue', result.url)
    lastResult.value = {
      originalBytes: result.originalBytes ?? 0,
      compressedBytes: result.compressedBytes ?? 0,
    }

    // 旧文件清理是尽力而为，失败不影响本次上传
    if (previous && previous !== result.url) {
      void deleteImage(previous)
    }
  } finally {
    uploading.value = false
    // 清空 input，保证同一文件能再次选择
    if (inputRef.value) inputRef.value.value = ''
  }
}

function onDrop(event: DragEvent) {
  isDragging.value = false
  if (uploading.value) return
  void handleFiles(event.dataTransfer?.files)
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
  if (!uploading.value) isDragging.value = true
}

function remove() {
  if (uploading.value) return
  const current = props.modelValue
  error.value = ''
  lastResult.value = null
  emit('update:modelValue', null)
  // 只在删除自己上传的文件时才真正清理存储
  if (current) void deleteImage(current)
}

defineExpose({ pick })
</script>

<template>
  <div class="space-y-2.5">
    <div class="flex items-start gap-4">
      <!-- 预览 / 拖放区 -->
      <div
        :class="[
          previewSize,
          'relative rounded-xl border overflow-hidden flex-shrink-0 flex items-center justify-center text-[32px] transition-colors',
          isDragging
            ? 'border-amber-400 border-2 bg-amber-50'
            : 'border-black/[0.06] bg-[#f9fafb]',
        ]"
        @dragover="onDragOver"
        @dragleave="isDragging = false"
        @drop.prevent="onDrop"
      >
        <img
          v-if="hasImage"
          :src="modelValue!"
          alt="封面预览"
          class="w-full h-full object-cover"
        />
        <span v-else>{{ emojiFallback || '🖼️' }}</span>

        <!-- 上传中遮罩 -->
        <div
          v-if="uploading"
          class="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex flex-col items-center justify-center gap-1.5"
        >
          <div class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"></div>
          <span class="text-[10.5px] text-[#6b7280]">上传中</span>
        </div>
      </div>

      <!-- 操作区 -->
      <div class="flex-1 min-w-0 space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <button
            :disabled="uploading"
            class="h-8 px-3 rounded-lg bg-white border border-black/[0.08] text-[12.5px] text-[#4b5563] hover:bg-black/[0.02] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            @click="pick"
          >
            {{ hasImage ? '更换图片' : '选择图片' }}
          </button>

          <button
            v-if="hasImage"
            :disabled="uploading"
            class="h-8 px-3 rounded-lg text-[12.5px] text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-50"
            @click="remove"
          >
            移除
          </button>

          <span class="text-[11px] text-[#9ca3af]">或拖拽到左侧</span>
        </div>

        <p class="text-[11px] text-[#9ca3af] leading-relaxed">
          JPG / PNG / WebP，源文件不超过 {{ maxLabel }}。<br />
          上传前会自动压缩到长边 1600px 的 WebP，显著减少学生端的加载流量。
        </p>

        <!-- 压缩结果 -->
        <p v-if="lastResult" class="text-[11px] text-emerald-700">
          已压缩：{{ formatBytes(lastResult.originalBytes) }} →
          {{ formatBytes(lastResult.compressedBytes) }}
          <span v-if="lastResult.originalBytes > 0">
            （省 {{ Math.round((1 - lastResult.compressedBytes / lastResult.originalBytes) * 100) }}%）
          </span>
        </p>

        <!-- 错误 -->
        <p v-if="error" class="text-[11.5px] text-rose-600">{{ error }}</p>
      </div>
    </div>

    <!-- 隐藏的文件选择器 -->
    <input
      ref="inputRef"
      type="file"
      :accept="accept"
      class="hidden"
      @change="handleFiles(($event.target as HTMLInputElement).files)"
    />
  </div>
</template>
