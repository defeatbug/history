<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { museums } from '@/data/museumData'

const router = useRouter()
const selectedCountry = ref<string>('all')

const countries = computed(() => {
  const countrySet = new Set(museums.map((m) => m.country))
  return ['all', ...Array.from(countrySet)]
})

const filteredMuseums = computed(() => {
  if (selectedCountry.value === 'all') {
    return museums
  }
  return museums.filter((m) => m.country === selectedCountry.value)
})

const goToMuseum = (museumId: string) => {
  router.push(`/museums/${museumId}`)
}
</script>

<template>
  <div class="space-y-10">
    <!-- 标题 -->
    <div class="text-center space-y-4">
      <h1
        class="text-5xl md:text-6xl font-bold bg-gradient-to-r from-amber-600 via-orange-500 to-red-500 bg-clip-text text-transparent"
      >
        世界博物馆
      </h1>
      <p class="text-xl text-gray-600">探索世界著名博物馆的珍贵历史文物</p>
    </div>

    <!-- 国家筛选 -->
    <div class="flex flex-wrap justify-center gap-3">
      <button
        v-for="country in countries"
        :key="country"
        @click="selectedCountry = country"
        :class="[
          'px-6 py-2 rounded-xl font-semibold transition-all',
          selectedCountry === country
            ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg scale-105'
            : 'bg-white text-gray-700 hover:bg-amber-50 border border-gray-200',
        ]"
      >
        {{ country === 'all' ? '全部' : country }}
      </button>
    </div>

    <!-- 博物馆列表 -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
      <div
        v-for="museum in filteredMuseums"
        :key="museum.id"
        class="group relative flex flex-col bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-2xl transition-all cursor-pointer transform hover:-translate-y-2 border border-gray-100"
        @click="goToMuseum(museum.id)"
      >
        <!-- 渐变背景 -->
        <div
          class="absolute inset-0 bg-gradient-to-br from-amber-50/50 to-orange-50/50 opacity-0 group-hover:opacity-100 transition-opacity"
        ></div>

        <div class="relative p-6 flex-1 flex flex-col">
          <div class="flex items-start justify-between mb-4">
            <div class="text-7xl transform group-hover:scale-110 transition-transform">
              {{ museum.coverImage }}
            </div>
            <div class="text-right">
              <div class="text-xs text-gray-500 mb-1">建立于</div>
              <div class="text-sm font-bold text-amber-600">{{ museum.established }}</div>
            </div>
          </div>

          <h3
            class="text-2xl font-bold text-gray-800 mb-1 group-hover:text-amber-600 transition-colors"
          >
            {{ museum.name }}
          </h3>
          <p class="text-sm text-gray-500 mb-3 italic">{{ museum.nameEn }}</p>
          <p class="text-gray-600 text-sm mb-4 line-clamp-2 leading-relaxed">
            {{ museum.description }}
          </p>

          <!-- mt-auto：元信息 + 分隔线 + 按钮一起推到底部，卡片底部对齐 -->
          <div class="space-y-2 mt-auto mb-5 pb-5 border-b border-gray-100">
            <div class="flex items-center text-sm text-gray-600">
              <span class="mr-2 text-base">📍</span>
              <span class="font-medium">{{ museum.location }}</span>
            </div>
            <div class="flex items-center text-sm text-gray-600">
              <span class="mr-2 text-base">🏛️</span>
              <span class="font-medium">{{ museum.artifacts.length }} 件精选文物</span>
            </div>
          </div>

          <button
            class="w-full px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl text-sm font-bold hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg hover:shadow-xl transform hover:scale-105"
            @click.stop="goToMuseum(museum.id)"
          >
            查看文物 →
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
