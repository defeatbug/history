<script setup lang="ts">
/**
 * 好友页
 * ============================================================================
 * 页面只负责渲染与交互，数据与写操作全部走 useFriendStore：
 *
 *   * 待处理区：收到的好友请求（接受/拒绝）、收到的 PK 邀请（应战/拒绝）、
 *     我发出的好友请求（等待中/撤回）；
 *   * 好友列表：按用户名筛选、在线状态、双方战绩、继续对战 / 发起 PK / 删除；
 *   * 添加好友：用户名防抖搜索（300ms / 回车立即搜索），按 relation 渲染动作；
 *   * 最近对战：已完成对战的胜负与比分，点击进入 `/pk/:id` 复盘。
 *
 * 实时性：好友请求 / PK 邀请的社交订阅由常驻的 Layout 全局持有（红点用），
 * 本页只负责在线 Presence（进入绑定、离开解绑）与数据加载。
 * 离开页面**不** reset 好友数据，切页回来直接复用缓存，避免重复加载闪烁。
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue3-toastify'
import { useFriendStore } from '@/stores/friend'
import type { FriendListRow, FriendsSearchRow, PkMatchSummaryRow } from '@/types/database'
import type { FriendRequest } from '@/services/friends'
import { formatDate } from '@/utils/format'

const router = useRouter()
const friendStore = useFriendStore()

/** avatar 缺失或图片加载失败时的默认头像 */
const AVATAR_FALLBACK = '👤'

// ---------------------------------------------------------------------------
// 页面状态
// ---------------------------------------------------------------------------
/** 首次 loadAll 是否已有结果：用于区分「整页加载」与「后台静默刷新」 */
const hasLoaded = ref(false)
/** 好友列表筛选关键词 */
const filterQuery = ref('')
/** 添加好友搜索框 */
const addInput = ref('')
/** 搜索接口错误（与全局 error 分开，便于就近提示） */
const searchError = ref<string | null>(null)
/** 加载失败的图片头像：按用户 id 回退到 emoji */
const failedAvatars = ref<Set<string>>(new Set())
/** 当前正在执行的异步动作；同一时刻只允许一个写操作，key 见各 handler */
const actionKey = ref<string | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | undefined
/** 搜索串行化：上一个请求未返回时只保留最新关键词，避免结果乱序 */
let searchRunning = false
let queuedSearchKeyword: string | null = null

// ---------------------------------------------------------------------------
// 派生数据
// ---------------------------------------------------------------------------
const busy = computed(() => actionKey.value !== null)

/** 只有「首屏 + 尚无数据」才整页转圈；respond/remove 后的 loadAll 不打断页面 */
const initialLoading = computed(
  () => !friendStore.isGuest && friendStore.loading && !hasLoaded.value,
)

/** 在线好友 id 集合（以 store.onlineFriends 为准） */
const onlineFriendIds = computed(
  () => new Set(friendStore.onlineFriends.map((friend) => friend.user_id)),
)

/** 好友列表：用户名筛选 + 在线优先 + 稳定排序 */
const filteredFriends = computed<FriendListRow[]>(() => {
  const keyword = filterQuery.value.trim().toLowerCase()
  const rows = keyword
    ? friendStore.friends.filter((friend) => friend.username.toLowerCase().includes(keyword))
    : [...friendStore.friends]

  return rows.sort((a, b) => {
    const aRank = onlineFriendIds.value.has(a.user_id) ? 0 : 1
    const bRank = onlineFriendIds.value.has(b.user_id) ? 0 : 1
    return aRank - bRank || a.username.localeCompare(b.username, 'zh-CN')
  })
})

const pendingCount = computed(
  () =>
    friendStore.incomingRequests.length +
    friendStore.incomingInvites.length +
    friendStore.outgoingRequests.length,
)

interface RecentMatchItem {
  match: PkMatchSummaryRow
  label: string
  badgeClass: string
  date: string
  /** 是否是超时/掉线结算出来的结果（并非双方都答完） */
  timeout: boolean
}

const recentMatches = computed<RecentMatchItem[]>(() =>
  friendStore.finishedMatches.slice(0, 12).map((match) => {
    const meta = resultMeta(match.result)
    return {
      match,
      label: meta.label,
      badgeClass: meta.badgeClass,
      date: formatDate(match.finished_at ?? match.created_at),
      timeout: match.finished_reason === 'timeout',
    }
  }),
)

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
function resultMeta(result: PkMatchSummaryRow['result']): {
  label: string
  badgeClass: string
} {
  switch (result) {
    case 'win':
      return { label: '胜', badgeClass: 'bg-green-100 text-green-700' }
    case 'lose':
      return { label: '负', badgeClass: 'bg-red-100 text-red-600' }
    case 'draw':
      return { label: '平', badgeClass: 'bg-gray-100 text-gray-600' }
    default:
      return { label: '待定', badgeClass: 'bg-amber-100 text-amber-700' }
  }
}

/** avatar 既可能是 emoji，也可能是图片 URL；只有 URL 才用 <img> 渲染 */
function isImageAvatar(avatar: string | null): boolean {
  if (!avatar) return false
  return /^(https?:\/\/|data:image\/|blob:|\/)/i.test(avatar.trim())
}

function markAvatarFailed(userId: string): void {
  failedAvatars.value = new Set(failedAvatars.value).add(userId)
}

function winRate(friend: FriendListRow): number {
  return friend.total_matches > 0 ? Math.round((friend.wins / friend.total_matches) * 100) : 0
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后重试'
}

function isActing(key: string): boolean {
  return actionKey.value === key
}

/** 包一层统一的按钮级 loading + 错误 toast，避免每个 handler 重复 try/catch */
async function runAction(key: string, task: () => Promise<void>): Promise<void> {
  if (actionKey.value) return
  actionKey.value = key
  try {
    await task()
  } catch (error) {
    toast.error(errorMessage(error), { theme: 'auto' })
  } finally {
    actionKey.value = null
  }
}

function findIncomingRequest(userId: string): FriendRequest | undefined {
  return friendStore.incomingRequests.find((request) => request.userId === userId)
}

// ---------------------------------------------------------------------------
// 数据加载 / 实时订阅
// ---------------------------------------------------------------------------
async function refresh(): Promise<void> {
  if (friendStore.isGuest) return
  try {
    await friendStore.loadAll()
  } finally {
    hasLoaded.value = true
  }
}

async function initialize(): Promise<void> {
  if (friendStore.isGuest) {
    hasLoaded.value = true
    return
  }
  // 社交订阅（好友请求 / PK 邀请）由 Layout 全局持有，本页不再绑定/解绑
  void friendStore.startPresence()
  try {
    await friendStore.loadAll()
  } finally {
    hasLoaded.value = true
  }
}

// ---------------------------------------------------------------------------
// 添加好友：防抖搜索
// ---------------------------------------------------------------------------
async function runSearch(rawKeyword: string): Promise<void> {
  const keyword = rawKeyword.trim()
  if (!keyword) {
    searchError.value = null
    friendStore.clearSearch()
    return
  }

  if (searchRunning) {
    queuedSearchKeyword = keyword
    return
  }

  searchRunning = true
  try {
    // searchUsers 内部会捕获异常并写入 store.error，这里同步到就近提示
    await friendStore.searchUsers(keyword)
    searchError.value = friendStore.error
  } finally {
    searchRunning = false
    const next = queuedSearchKeyword
    queuedSearchKeyword = null
    if (next !== null) await runSearch(next)
  }
}

function scheduleSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchTimer = undefined
    void runSearch(addInput.value)
  }, 300)
}

function submitSearch(): void {
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = undefined
  }
  void runSearch(addInput.value)
}

function clearSearchInput(): void {
  addInput.value = ''
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = undefined
  }
  queuedSearchKeyword = null
  searchError.value = null
  friendStore.clearSearch()
}

watch(addInput, (value) => {
  if (!value.trim()) {
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = undefined
    }
    queuedSearchKeyword = null
    searchError.value = null
    friendStore.clearSearch()
    return
  }
  scheduleSearch()
})

// ---------------------------------------------------------------------------
// 待处理区动作
// ---------------------------------------------------------------------------
function respondToFriendRequest(request: FriendRequest, accept: boolean): void {
  const suffix = accept ? 'accept' : 'reject'
  void runAction(`friend-request:${request.friendshipId}:${suffix}`, async () => {
    await friendStore.respondRequest(request.friendshipId, accept)
    toast.success(accept ? `已添加 ${request.username} 为好友` : '已拒绝好友请求', {
      theme: 'auto',
    })
  })
}

function respondToInvite(match: PkMatchSummaryRow, accept: boolean): void {
  const suffix = accept ? 'accept' : 'reject'
  void runAction(`invite:${match.id}:${suffix}`, async () => {
    await friendStore.respondToMatch(match.id, accept)
    if (accept) {
      toast.success('已应战，进入 PK 房间', { theme: 'auto' })
      await router.push(`/pk/${match.id}`)
    } else {
      toast.success('已拒绝挑战', { theme: 'auto' })
    }
  })
}

function withdrawRequest(request: FriendRequest): void {
  if (!window.confirm(`撤回发给「${request.username}」的好友请求？`)) return
  void runAction(`withdraw:${request.friendshipId}`, async () => {
    await friendStore.removeFriend(request.friendshipId)
    toast.success('已撤回好友请求', { theme: 'auto' })
  })
}

// ---------------------------------------------------------------------------
// 好友列表动作
// ---------------------------------------------------------------------------
function challengeFriend(friend: FriendListRow): void {
  void runAction(`challenge:${friend.user_id}`, async () => {
    const matchId = await friendStore.challenge(friend.user_id)
    toast.success(`已向 ${friend.username} 发起挑战`, { theme: 'auto' })
    await router.push(`/pk/${matchId}`)
  })
}

function continueMatch(friend: FriendListRow): void {
  if (!friend.active_match_id) return
  void router.push(`/pk/${friend.active_match_id}`)
}

function removeFriend(friend: FriendListRow): void {
  if (!window.confirm(`确定删除好友「${friend.username}」吗？此操作不可撤销。`)) return

  void runAction(`remove:${friend.user_id}`, async () => {
    await friendStore.removeFriend(friend.friendship_id)
    toast.success(`已删除好友 ${friend.username}`, { theme: 'auto' })
  })
}

// ---------------------------------------------------------------------------
// 搜索结果动作
// ---------------------------------------------------------------------------
function addFriendFromSearch(row: FriendsSearchRow): void {
  void runAction(`search-add:${row.user_id}`, async () => {
    await friendStore.addFriend(row.user_id)
    toast.success(`已向 ${row.username} 发送好友请求`, { theme: 'auto' })
    // 重新搜索以刷新 relation（none → request_sent）
    await runSearch(addInput.value)
  })
}

function acceptFromSearch(row: FriendsSearchRow): void {
  void runAction(`search-accept:${row.user_id}`, async () => {
    let request = findIncomingRequest(row.user_id)
    if (!request) {
      // 搜索结果可能比待处理列表更新，补拉一次再按 userId 匹配
      await friendStore.loadAll()
      request = findIncomingRequest(row.user_id)
    }
    if (!request) {
      toast.info('该请求已不在待处理列表，请刷新后重试', { theme: 'auto' })
      return
    }
    await friendStore.respondRequest(request.friendshipId, true)
    toast.success(`已添加 ${row.username} 为好友`, { theme: 'auto' })
    await runSearch(addInput.value)
  })
}

// ---------------------------------------------------------------------------
// 导航
// ---------------------------------------------------------------------------
function openMatch(match: PkMatchSummaryRow): void {
  void router.push(`/pk/${match.id}`)
}

function goLogin(): void {
  void router.push('/login')
}

function goLessons(): void {
  void router.push('/lessons')
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
onMounted(() => {
  void initialize()
})

onUnmounted(() => {
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = undefined
  }
  queuedSearchKeyword = null
  // 只解绑本页拥有的在线状态；社交订阅属于 Layout，由 store.reset() 在退出登录时清理
  void friendStore.stopPresence()
  // 只清临时搜索结果，不 reset 好友/对战数据（切页回来仍在）
  friendStore.clearSearch()
})
</script>

<template>
  <div class="space-y-8">
    <!-- 标题 -->
    <div class="text-center space-y-3">
      <h1
        class="text-4xl md:text-5xl font-bold bg-gradient-to-r from-amber-600 via-orange-500 to-red-500 bg-clip-text text-transparent"
      >
        好友与 PK
      </h1>
      <p class="text-lg text-gray-600">添加好友、应战好友挑战，一起刷历史知识</p>
      <div
        v-if="!friendStore.isGuest"
        class="flex flex-wrap items-center justify-center gap-3 text-sm text-gray-500"
      >
        <span v-if="onlineFriendIds.size > 0" class="inline-flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-green-500"></span>
          {{ onlineFriendIds.size }} 位好友在线
        </span>
        <button
          type="button"
          :disabled="friendStore.loading"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          @click="refresh"
        >
          <span :class="friendStore.loading ? 'inline-block animate-spin' : ''">↻</span>
          刷新
        </button>
      </div>
    </div>

    <!-- 游客 / 离线：好友与 PK 依赖账号同步 -->
    <div
      v-if="friendStore.isGuest"
      class="bg-white rounded-2xl shadow-lg border border-gray-200 p-10 sm:p-12 text-center space-y-4 max-w-2xl mx-auto"
    >
      <div class="text-6xl">🔐</div>
      <h2 class="text-2xl font-bold text-gray-800">登录后使用好友与 PK</h2>
      <p class="text-gray-600 text-sm leading-relaxed">
        好友、好友请求和好友 PK 都依赖账号同步。<br />
        当前是游客或离线模式，好友数据不会保存，也无法接收挑战。
      </p>
      <div class="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          type="button"
          class="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg"
          @click="goLogin"
        >
          去登录 / 注册
        </button>
        <button
          type="button"
          class="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition-all"
          @click="goLessons"
        >
          先去课程逛逛
        </button>
      </div>
    </div>

    <template v-else>
      <!-- 全局错误 -->
      <div
        v-if="friendStore.error"
        class="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3"
      >
        <span class="text-xl leading-none">⚠️</span>
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-red-700">加载好友数据失败</p>
          <p class="text-sm text-red-600 break-all">{{ friendStore.error }}</p>
        </div>
        <button
          type="button"
          :disabled="friendStore.loading"
          class="shrink-0 px-3 py-1.5 rounded-lg bg-red-100 text-red-700 text-sm font-semibold hover:bg-red-200 disabled:opacity-60 transition-colors"
          @click="refresh"
        >
          重试
        </button>
      </div>

      <!-- 首屏加载 -->
      <div
        v-if="initialLoading"
        class="bg-white rounded-2xl shadow-lg border border-gray-200 p-12 text-center space-y-4"
      >
        <div
          class="w-10 h-10 mx-auto border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin"
        ></div>
        <p class="text-gray-500">正在加载好友数据…</p>
      </div>

      <template v-else>
        <!-- 待处理 -->
        <section v-if="pendingCount > 0" class="space-y-4">
          <div class="flex items-center gap-3">
            <h2 class="text-2xl font-bold text-gray-800">待处理</h2>
            <span
              class="px-2.5 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold leading-5"
            >
              {{ pendingCount }}
            </span>
          </div>

          <!-- 收到的好友请求 -->
          <div
            v-if="friendStore.incomingRequests.length > 0"
            class="bg-white rounded-2xl shadow-lg border border-amber-100 p-5"
          >
            <h3 class="font-bold text-gray-800 mb-2 flex items-center gap-2">
              <span>🤝</span>
              好友请求
              <span class="text-xs font-normal text-gray-500">
                {{ friendStore.incomingRequests.length }} 条
              </span>
            </h3>
            <ul class="divide-y divide-gray-100">
              <li
                v-for="request in friendStore.incomingRequests"
                :key="request.friendshipId"
                class="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div
                  class="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center overflow-hidden shrink-0 text-xl"
                >
                  <img
                    v-if="isImageAvatar(request.avatar) && !failedAvatars.has(request.userId)"
                    :src="request.avatar || ''"
                    :alt="request.username"
                    class="w-full h-full object-cover"
                    @error="markAvatarFailed(request.userId)"
                  />
                  <span v-else>
                    {{
                      isImageAvatar(request.avatar)
                        ? AVATAR_FALLBACK
                        : request.avatar || AVATAR_FALLBACK
                    }}
                  </span>
                </div>
                <div class="min-w-0 flex-1">
                  <p class="font-semibold text-gray-800 truncate">{{ request.username }}</p>
                  <p class="text-xs text-gray-500">
                    {{ formatDate(request.createdAt) }} 请求加你为好友
                  </p>
                </div>
                <div class="flex gap-2 shrink-0">
                  <button
                    type="button"
                    :disabled="busy"
                    class="px-4 py-2 rounded-xl bg-green-500 text-white text-sm font-bold hover:bg-green-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    @click="respondToFriendRequest(request, true)"
                  >
                    {{
                      isActing(`friend-request:${request.friendshipId}:accept`) ? '处理中…' : '接受'
                    }}
                  </button>
                  <button
                    type="button"
                    :disabled="busy"
                    class="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-bold hover:bg-gray-200 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    @click="respondToFriendRequest(request, false)"
                  >
                    {{
                      isActing(`friend-request:${request.friendshipId}:reject`) ? '处理中…' : '拒绝'
                    }}
                  </button>
                </div>
              </li>
            </ul>
          </div>

          <!-- 收到的 PK 邀请 -->
          <div
            v-if="friendStore.incomingInvites.length > 0"
            class="bg-white rounded-2xl shadow-lg border border-amber-100 p-5"
          >
            <h3 class="font-bold text-gray-800 mb-2 flex items-center gap-2">
              <span>⚔️</span>
              PK 邀请
              <span class="text-xs font-normal text-gray-500">
                {{ friendStore.incomingInvites.length }} 条
              </span>
            </h3>
            <ul class="divide-y divide-gray-100">
              <li
                v-for="invite in friendStore.incomingInvites"
                :key="invite.id"
                class="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div
                  class="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0 text-xl"
                >
                  ⚔️
                </div>
                <div class="min-w-0 flex-1">
                  <p class="font-semibold text-gray-800 truncate">
                    {{ invite.opponent_username }}
                  </p>
                  <p class="text-xs text-gray-500">
                    {{ formatDate(invite.created_at) }} 邀请你进行历史知识 PK（{{
                      invite.question_count
                    }}
                    题）
                  </p>
                </div>
                <div class="flex gap-2 shrink-0">
                  <button
                    type="button"
                    :disabled="busy"
                    class="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                    @click="respondToInvite(invite, true)"
                  >
                    {{ isActing(`invite:${invite.id}:accept`) ? '应战中…' : '应战' }}
                  </button>
                  <button
                    type="button"
                    :disabled="busy"
                    class="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-bold hover:bg-gray-200 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                    @click="respondToInvite(invite, false)"
                  >
                    {{ isActing(`invite:${invite.id}:reject`) ? '处理中…' : '拒绝' }}
                  </button>
                </div>
              </li>
            </ul>
          </div>

          <!-- 我发出的好友请求 -->
          <div
            v-if="friendStore.outgoingRequests.length > 0"
            class="bg-white rounded-2xl shadow-lg border border-gray-200 p-5"
          >
            <h3 class="font-bold text-gray-800 mb-2 flex items-center gap-2">
              <span>📤</span>
              我发出的好友请求
              <span class="text-xs font-normal text-gray-500">
                {{ friendStore.outgoingRequests.length }} 条
              </span>
            </h3>
            <ul class="divide-y divide-gray-100">
              <li
                v-for="request in friendStore.outgoingRequests"
                :key="request.friendshipId"
                class="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div
                  class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden shrink-0 text-xl"
                >
                  <img
                    v-if="isImageAvatar(request.avatar) && !failedAvatars.has(request.userId)"
                    :src="request.avatar || ''"
                    :alt="request.username"
                    class="w-full h-full object-cover"
                    @error="markAvatarFailed(request.userId)"
                  />
                  <span v-else>
                    {{
                      isImageAvatar(request.avatar)
                        ? AVATAR_FALLBACK
                        : request.avatar || AVATAR_FALLBACK
                    }}
                  </span>
                </div>
                <div class="min-w-0 flex-1">
                  <p class="font-semibold text-gray-800 truncate">{{ request.username }}</p>
                  <p class="text-xs text-gray-500">等待对方处理</p>
                </div>
                <button
                  type="button"
                  :disabled="busy"
                  class="shrink-0 px-4 py-2 rounded-xl bg-red-50 text-red-600 text-sm font-bold hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  @click="withdrawRequest(request)"
                >
                  {{ isActing(`withdraw:${request.friendshipId}`) ? '撤回中…' : '撤回' }}
                </button>
              </li>
            </ul>
          </div>
        </section>

        <!-- 好友列表 -->
        <section class="space-y-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 class="text-2xl font-bold text-gray-800">
              我的好友
              <span class="text-base font-normal text-gray-500">
                ({{ friendStore.friends.length }})
              </span>
            </h2>
            <div class="relative w-full sm:w-64">
              <input
                v-model="filterQuery"
                type="text"
                placeholder="按用户名筛选好友"
                class="w-full px-4 py-2.5 pr-9 rounded-xl border-2 border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none transition-all text-sm"
              />
              <button
                v-if="filterQuery"
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 leading-none"
                title="清空筛选"
                @click="filterQuery = ''"
              >
                ✕
              </button>
            </div>
          </div>

          <div
            v-if="filteredFriends.length > 0"
            class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
          >
            <div
              v-for="friend in filteredFriends"
              :key="friend.user_id"
              class="bg-white rounded-2xl shadow-lg border border-gray-200 p-5 hover:shadow-xl transition-all flex flex-col"
            >
              <div class="flex items-start gap-3">
                <div
                  class="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center overflow-hidden shrink-0 text-2xl"
                >
                  <img
                    v-if="isImageAvatar(friend.avatar) && !failedAvatars.has(friend.user_id)"
                    :src="friend.avatar || ''"
                    :alt="friend.username"
                    class="w-full h-full object-cover"
                    @error="markAvatarFailed(friend.user_id)"
                  />
                  <span v-else>
                    {{
                      isImageAvatar(friend.avatar)
                        ? AVATAR_FALLBACK
                        : friend.avatar || AVATAR_FALLBACK
                    }}
                  </span>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <h3 class="font-bold text-gray-800 truncate">{{ friend.username }}</h3>
                    <span
                      :class="[
                        'w-2.5 h-2.5 rounded-full shrink-0',
                        onlineFriendIds.has(friend.user_id) ? 'bg-green-500' : 'bg-gray-300',
                      ]"
                      :title="onlineFriendIds.has(friend.user_id) ? '在线' : '离线'"
                    ></span>
                  </div>
                  <p class="text-xs text-gray-500 mt-0.5">
                    {{ onlineFriendIds.has(friend.user_id) ? '在线' : '离线' }}
                  </p>
                </div>
              </div>

              <dl class="mt-4 grid grid-cols-2 gap-2 bg-amber-50/70 rounded-xl p-3 text-sm">
                <div>
                  <dt class="text-xs text-gray-500">战绩</dt>
                  <dd class="font-bold text-amber-700 mt-0.5">
                    {{ friend.wins
                    }}<span class="text-gray-400 font-normal">/{{ friend.total_matches }}</span>
                  </dd>
                </div>
                <div>
                  <dt class="text-xs text-gray-500">胜率</dt>
                  <dd class="font-bold text-amber-700 mt-0.5">{{ winRate(friend) }}%</dd>
                </div>
              </dl>

              <div class="mt-4 flex gap-2">
                <button
                  v-if="friend.active_match_id"
                  type="button"
                  class="flex-1 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold hover:from-amber-600 hover:to-orange-600 transition-all shadow-md hover:shadow-lg"
                  @click="continueMatch(friend)"
                >
                  继续对战
                </button>
                <button
                  v-else
                  type="button"
                  :disabled="busy"
                  class="flex-1 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
                  @click="challengeFriend(friend)"
                >
                  {{ isActing(`challenge:${friend.user_id}`) ? '发起中…' : '发起 PK' }}
                </button>
                <button
                  type="button"
                  :disabled="busy"
                  class="px-4 py-2 rounded-xl bg-red-50 text-red-600 text-sm font-bold hover:bg-red-100 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  title="删除好友"
                  @click="removeFriend(friend)"
                >
                  {{ isActing(`remove:${friend.user_id}`) ? '删除中…' : '删除' }}
                </button>
              </div>
            </div>
          </div>

          <!-- 空状态 -->
          <div
            v-else
            class="bg-white rounded-2xl shadow-lg border border-gray-200 p-10 text-center space-y-2"
          >
            <div class="text-5xl">👥</div>
            <p class="text-gray-600">
              {{
                filterQuery ? '没有匹配的好友，换个关键词试试' : '还没有好友，先在上方搜索并添加吧'
              }}
            </p>
          </div>
        </section>

        <!-- 添加好友 -->
        <section class="bg-white rounded-2xl shadow-lg border border-gray-200 p-6 space-y-4">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-xl font-bold text-gray-800">添加好友</h2>
            <span class="text-xs text-gray-500">按用户名模糊搜索</span>
          </div>

          <form class="flex flex-col sm:flex-row gap-3" @submit.prevent="submitSearch">
            <div class="relative flex-1">
              <input
                v-model="addInput"
                type="text"
                placeholder="输入用户名，例如「小明」"
                class="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none transition-all"
              />
              <button
                v-if="addInput"
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 leading-none"
                title="清空"
                @click="clearSearchInput"
              >
                ✕
              </button>
            </div>
            <button
              type="submit"
              :disabled="!addInput.trim() || friendStore.searching"
              class="px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-bold hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-lg"
            >
              {{ friendStore.searching ? '搜索中…' : '搜索' }}
            </button>
          </form>

          <!-- 搜索状态 -->
          <div
            v-if="friendStore.searching"
            class="flex items-center justify-center gap-3 py-6 text-sm text-gray-500"
          >
            <span
              class="w-5 h-5 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin"
            ></span>
            搜索中…
          </div>
          <p v-else-if="searchError" class="text-sm text-red-600">搜索失败：{{ searchError }}</p>
          <p
            v-else-if="addInput.trim() && friendStore.searchResults.length === 0"
            class="text-sm text-gray-500"
          >
            没有找到匹配的用户，换个用户名试试
          </p>
          <p v-else-if="!addInput.trim()" class="text-sm text-gray-400">
            输入用户名开始搜索（输入停止 300ms 自动搜索，回车立即搜索）
          </p>

          <ul v-if="friendStore.searchResults.length > 0" class="divide-y divide-gray-100">
            <li
              v-for="row in friendStore.searchResults"
              :key="row.user_id"
              class="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div
                class="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center overflow-hidden shrink-0 text-xl"
              >
                <img
                  v-if="isImageAvatar(row.avatar) && !failedAvatars.has(row.user_id)"
                  :src="row.avatar || ''"
                  :alt="row.username"
                  class="w-full h-full object-cover"
                  @error="markAvatarFailed(row.user_id)"
                />
                <span v-else>
                  {{ isImageAvatar(row.avatar) ? AVATAR_FALLBACK : row.avatar || AVATAR_FALLBACK }}
                </span>
              </div>
              <div class="min-w-0 flex-1">
                <p class="font-semibold text-gray-800 truncate">{{ row.username }}</p>
                <p class="text-xs text-gray-500">
                  {{ row.relation === 'friends' ? '已经是好友' : 'HistoriaQuest 学习者' }}
                </p>
              </div>
              <div class="shrink-0">
                <button
                  v-if="row.relation === 'none'"
                  type="button"
                  :disabled="busy"
                  class="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-bold hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                  @click="addFriendFromSearch(row)"
                >
                  {{ isActing(`search-add:${row.user_id}`) ? '发送中…' : '加好友' }}
                </button>
                <button
                  v-else-if="row.relation === 'request_received'"
                  type="button"
                  :disabled="busy"
                  class="px-4 py-2 rounded-xl bg-green-500 text-white text-sm font-bold hover:bg-green-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  @click="acceptFromSearch(row)"
                >
                  {{ isActing(`search-accept:${row.user_id}`) ? '处理中…' : '接受' }}
                </button>
                <span
                  v-else-if="row.relation === 'request_sent'"
                  class="px-4 py-2 rounded-xl bg-gray-100 text-gray-500 text-sm font-semibold inline-block"
                >
                  已发送
                </span>
                <span
                  v-else-if="row.relation === 'friends'"
                  class="px-4 py-2 rounded-xl bg-green-50 text-green-700 text-sm font-semibold inline-block"
                >
                  已是好友
                </span>
                <span
                  v-else
                  class="px-4 py-2 rounded-xl bg-red-50 text-red-500 text-sm font-semibold inline-block"
                >
                  不可添加
                </span>
              </div>
            </li>
          </ul>
        </section>

        <!-- 最近对战 -->
        <section class="space-y-3">
          <h2 class="text-2xl font-bold text-gray-800">最近对战</h2>

          <div
            v-if="recentMatches.length > 0"
            class="bg-white rounded-2xl shadow-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden"
          >
            <button
              v-for="item in recentMatches"
              :key="item.match.id"
              type="button"
              class="w-full flex items-center gap-3 p-4 text-left hover:bg-amber-50/60 transition-colors"
              @click="openMatch(item.match)"
            >
              <span
                :class="[
                  'w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0',
                  item.badgeClass,
                ]"
              >
                {{ item.label }}
              </span>
              <div class="min-w-0 flex-1">
                <p class="font-semibold text-gray-800 truncate">
                  vs {{ item.match.opponent_username }}
                </p>
                <p class="text-xs text-gray-500">
                  {{ item.date }} · {{ item.match.question_count }} 题 ·
                  {{ item.match.my_role === 'challenger' ? '我发起' : '对方发起' }}
                  <span v-if="item.timeout" class="ml-1 text-amber-600 font-semibold">
                    · 超时结算
                  </span>
                </p>
              </div>
              <div class="text-lg font-bold text-gray-800 shrink-0">
                {{ item.match.my_score }}
                <span class="text-gray-400 font-normal">:</span>
                {{ item.match.opponent_score }}
              </div>
              <span class="text-gray-400 shrink-0">›</span>
            </button>
          </div>

          <div
            v-else
            class="bg-white rounded-2xl shadow-lg border border-gray-200 p-10 text-center space-y-2"
          >
            <div class="text-5xl">⚔️</div>
            <p class="text-gray-600">还没有完成的对战，发起一场 PK 吧</p>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>
