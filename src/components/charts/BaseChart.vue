<script setup lang="ts">
/**
 * ECharts 基础容器
 * ---------------------------------------------------------------
 * 职责：
 *   1. 动态加载 echarts（按需注册的 chunk），页面本身不直接依赖 echarts
 *   2. 容器尺寸变化时自动 resize（侧边栏收起、窗口缩放）
 *   3. 统一 loading / 空数据 / 加载失败三种占位状态
 *   4. 卸载时 dispose，避免路由切换后遗留实例
 *
 * 用法：
 *   <BaseChart :option="chartOption" height="280px" :empty="rows.length === 0" empty-text="还没有答题记录" />
 *
 * 注意：`option` 建议用 computed 构造；这里用 deep watch，
 * 选项对象较大时也不会造成频繁重绘（setOption 内部做了 diff）。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { EChartsCoreOption, EChartsType } from 'echarts/core'

const props = withDefaults(
  defineProps<{
    option: EChartsCoreOption
    /** CSS 高度，如 280px；宽度始终 100% */
    height?: string
    loading?: boolean
    empty?: boolean
    emptyText?: string
  }>(),
  {
    height: '260px',
    loading: false,
    empty: false,
    emptyText: '暂无数据',
  },
)

const container = ref<HTMLDivElement | null>(null)
const chart = shallowRef<EChartsType | null>(null)
const failed = ref(false)

let observer: ResizeObserver | null = null
let pending: Promise<EChartsType | null> | null = null
let disposed = false

const showPlaceholder = computed(() => props.loading || props.empty || failed.value)

async function initChart(): Promise<EChartsType | null> {
  if (chart.value) return chart.value
  if (!container.value) return null

  const mod = await import('@/lib/echarts')
  if (disposed || !container.value) return null

  const instance = mod.default.init(container.value)
  instance.setOption(props.option)
  chart.value = instance

  observer = new ResizeObserver(() => instance.resize())
  observer.observe(container.value)
  return instance
}

function ensureChart(): Promise<EChartsType | null> {
  if (chart.value) return Promise.resolve(chart.value)
  if (!pending) {
    pending = initChart()
      .catch((error) => {
        // chunk 加载失败（离线 / 代理阻断）时给出占位，而不是整页报错
        console.warn('[chart] ECharts 加载失败：', error)
        failed.value = true
        return null
      })
      .finally(() => {
        pending = null
      })
  }
  return pending
}

watch(
  () => props.option,
  async (option) => {
    const instance = await ensureChart()
    instance?.setOption(option, true)
  },
  { deep: true },
)

onMounted(() => {
  void ensureChart()
})

onBeforeUnmount(() => {
  disposed = true
  observer?.disconnect()
  observer = null
  chart.value?.dispose()
  chart.value = null
})
</script>

<template>
  <div class="relative w-full" :style="{ height }">
    <div ref="container" class="absolute inset-0" :class="{ invisible: showPlaceholder }"></div>

    <div
      v-if="loading"
      class="absolute inset-0 flex items-center justify-center text-[12.5px] text-[#9ca3af]"
    >
      正在加载图表…
    </div>
    <div
      v-else-if="failed"
      class="absolute inset-0 flex items-center justify-center px-6 text-center text-[12.5px] text-[#9ca3af]"
    >
      图表组件加载失败，请刷新重试
    </div>
    <div
      v-else-if="empty"
      class="absolute inset-0 flex items-center justify-center px-6 text-center text-[12.5px] text-[#9ca3af]"
    >
      {{ emptyText }}
    </div>
  </div>
</template>