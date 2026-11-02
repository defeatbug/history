/**
 * 好友与 PK Store
 * ============================================================================
 * 把「好友关系 + 对战」的读写集中到一个 store，页面只负责渲染与交互：
 *
 *   * 数据来源全部是数据库（friends_list / pk_list_matches / pk_get_match RPC），
 *     不再有任何本地假数据或 Math.random() 对手；
 *   * 实时性靠 Supabase Realtime：好友请求、收到挑战、对战比分变化都会自动刷新；
 *   * 在线状态用 Realtime Presence（同一频道内 track 自己的 user_id），
 *     没有额外建表，也不会把"离线"误判成"删除"。
 *
 * 重要：PK 的规则计算在数据库里（迁移 13），store 只保存服务端返回的结果，
 * 不做「答对 +1」之类的本地推断，避免前后端两套逻辑漂移。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type {
  FriendListRow,
  FriendsSearchRow,
  PkAnswerResult,
  PkMatchDetail,
  PkMatchSummaryRow,
} from '@/types/database'
import {
  fetchFriends,
  fetchIncomingRequests,
  fetchOutgoingRequests,
  removeFriend as removeFriendApi,
  respondFriendRequest,
  searchUsers as searchUsersApi,
  sendFriendRequest,
  type FriendRequest,
} from '@/services/friends'
import {
  cancelMatch,
  createMatch,
  fetchMatch,
  fetchMatches,
  respondMatch,
  submitAnswer as submitAnswerApi,
  subscribeIncomingMatches,
  subscribeIncomingRequests,
  subscribeMatch,
  subscribeMyMatchUpdates,
  unsubscribe,
} from '@/services/pk'
import { useUserStore } from './user'

export const useFriendStore = defineStore('friend', () => {
  const userStore = useUserStore()

  // -------------------------------------------------------------------------
  // 状态
  // -------------------------------------------------------------------------
  const friends = ref<FriendListRow[]>([])
  const incomingRequests = ref<FriendRequest[]>([])
  const outgoingRequests = ref<FriendRequest[]>([])
  const searchResults = ref<FriendsSearchRow[]>([])
  const matches = ref<PkMatchSummaryRow[]>([])
  const currentMatch = ref<PkMatchDetail | null>(null)
  /** 在线用户 id（Realtime Presence 同步） */
  const onlineUserIds = ref<string[]>([])

  const loading = ref(false)
  const loadingMatch = ref(false)
  const searching = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)

  // Realtime 频道句柄（非响应式，避免被 Vue 代理）
  let matchChannel: RealtimeChannel | null = null
  let requestChannel: RealtimeChannel | null = null
  let inviteChannel: RealtimeChannel | null = null
  let matchUpdateChannel: RealtimeChannel | null = null
  let presenceChannel: RealtimeChannel | null = null

  // -------------------------------------------------------------------------
  // 派生数据
  // -------------------------------------------------------------------------
  const onlineFriendIds = computed(() => new Set(onlineUserIds.value))

  /** 在线好友 */
  const onlineFriends = computed(() =>
    friends.value.filter((f) => onlineFriendIds.value.has(f.user_id)),
  )

  /** 进行中的对战（含等待应战） */
  const activeMatches = computed(() =>
    matches.value.filter((m) => m.status === 'waiting' || m.status === 'in_progress'),
  )

  /** 别人发给我的待应战邀请 */
  const incomingInvites = computed(() =>
    matches.value.filter((m) => m.status === 'waiting' && m.my_role === 'opponent'),
  )

  /** 我已完成的对战 */
  const finishedMatches = computed(() => matches.value.filter((m) => m.status === 'finished'))

  const hasPendingRequests = computed(
    () => incomingRequests.value.length > 0 || incomingInvites.value.length > 0,
  )

  const isGuest = computed(() => !userStore.canSync)

  // -------------------------------------------------------------------------
  // 好友：读取 / 搜索 / 请求 / 删除
  // -------------------------------------------------------------------------

  /** 一次性拉取好友、待处理请求、对战列表 */
  async function loadAll(): Promise<void> {
    if (isGuest.value || !isSupabaseConfigured || !userStore.userId) return

    loading.value = true
    error.value = null
    try {
      const [friendRows, incoming, outgoing, matchRows] = await Promise.all([
        fetchFriends(),
        fetchIncomingRequests(userStore.userId),
        fetchOutgoingRequests(userStore.userId),
        fetchMatches(),
      ])
      friends.value = friendRows
      incomingRequests.value = incoming
      outgoingRequests.value = outgoing
      matches.value = matchRows
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载好友数据失败'
    } finally {
      loading.value = false
    }
  }

  /** 只刷新对战列表（比分/状态变化后调用） */
  async function loadMatches(): Promise<void> {
    if (isGuest.value || !isSupabaseConfigured) return
    try {
      matches.value = await fetchMatches()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载对战列表失败'
    }
  }

  /** 按用户名搜索用户（空字符串直接清空结果，不打请求） */
  async function searchUsers(query: string): Promise<void> {
    if (isGuest.value || !isSupabaseConfigured) return

    const keyword = query.trim()
    if (!keyword) {
      searchResults.value = []
      return
    }

    searching.value = true
    error.value = null
    try {
      searchResults.value = await searchUsersApi(keyword)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '搜索失败'
    } finally {
      searching.value = false
    }
  }

  function clearSearch(): void {
    searchResults.value = []
  }

  /** 发送好友请求 */
  async function addFriend(userId: string): Promise<void> {
    await sendFriendRequest(userId)
    await loadAll()
  }

  /** 接受 / 拒绝好友请求 */
  async function respondRequest(friendshipId: string, accept: boolean): Promise<void> {
    await respondFriendRequest(friendshipId, accept)
    await loadAll()
  }

  /** 删除好友 / 撤回请求 */
  async function removeFriend(friendshipId: string): Promise<void> {
    await removeFriendApi(friendshipId)
    await loadAll()
  }

  // -------------------------------------------------------------------------
  // 对战
  // -------------------------------------------------------------------------

  /** 向好友发起挑战，返回对战 id（已有未结束的对战会复用） */
  async function challenge(opponentId: string): Promise<string> {
    const matchId = await createMatch(opponentId)
    await loadMatches()
    return matchId
  }

  /** 接受 / 拒绝挑战 */
  async function respondToMatch(matchId: string, accept: boolean): Promise<void> {
    await respondMatch(matchId, accept)
    // 接受/拒绝都会改变 currentMatch（in_progress / cancelled），静默重拉一次，
    // 让任何调用方（好友页或 PK 房间）拿到的状态都一致
    await Promise.all([loadMatches(), loadMatch(matchId, true)])
  }

  /** 取消自己发出的挑战 */
  async function cancelMatchById(matchId: string): Promise<void> {
    await cancelMatch(matchId)
    await Promise.all([loadMatches(), loadMatch(matchId, true)])
  }

  /** 读取对战详情；silent=true 时用于 Realtime 刷新，不显示整页 loading */
  async function loadMatch(matchId: string, silent = false): Promise<void> {
    if (isGuest.value || !isSupabaseConfigured) return

    if (!silent) loadingMatch.value = true
    error.value = null
    try {
      currentMatch.value = await fetchMatch(matchId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载对战失败'
    } finally {
      if (!silent) loadingMatch.value = false
    }
  }

  /** 提交一道题的答案：服务端判定后重新拉取详情与列表 */
  async function submitAnswer(
    matchId: string,
    questionId: string,
    selectedIndex: number,
  ): Promise<PkAnswerResult> {
    submitting.value = true
    error.value = null
    try {
      const result = await submitAnswerApi(matchId, questionId, selectedIndex)
      await loadMatch(matchId, true)
      if (result.finished) await loadMatches()
      return result
    } finally {
      submitting.value = false
    }
  }

  // -------------------------------------------------------------------------
  // Realtime
  // -------------------------------------------------------------------------

  /** 关闭并清空某个频道 */
  function closeChannel(channel: RealtimeChannel | null): void {
    void unsubscribe(channel)
  }

  /**
   * 订阅好友请求 / 收到新挑战（全局通知：由常驻的 Layout 持有，幂等）。
   * 好友页不再调用，避免离开页面时把全局红点订阅一起关掉。
   */
  function bindSocialRealtime(): void {
    if (isGuest.value || !isSupabaseConfigured || requestChannel) return

    requestChannel = subscribeIncomingRequests(userStore.userId, () => {
      void loadAll()
    })
    inviteChannel = subscribeIncomingMatches(userStore.userId, () => {
      void loadAll()
    })
    // 我发起的挑战被接受/拒绝时，等待态也要实时回流到好友页
    matchUpdateChannel = subscribeMyMatchUpdates(userStore.userId, () => {
      void loadAll()
    })
  }

  /** 解绑社交订阅（仅 reset() 在退出登录时调用；Layout 卸载时不解绑） */
  function unbindSocialRealtime(): void {
    closeChannel(requestChannel)
    closeChannel(inviteChannel)
    closeChannel(matchUpdateChannel)
    requestChannel = null
    inviteChannel = null
    matchUpdateChannel = null
  }

  /** 订阅某场对战的变化（PK 房间使用；重复调用会先解绑旧的） */
  function bindMatchRealtime(matchId: string): void {
    if (isGuest.value || !isSupabaseConfigured) return
    closeChannel(matchChannel)
    matchChannel = subscribeMatch(matchId, () => {
      void loadMatch(matchId, true)
    })
  }

  function unbindMatchRealtime(): void {
    closeChannel(matchChannel)
    matchChannel = null
  }

  /** 进入在线状态频道（好友页使用） */
  async function startPresence(): Promise<void> {
    if (isGuest.value || !isSupabaseConfigured || presenceChannel) return

    const channel = supabase.channel('hq-online', {
      config: { presence: { key: userStore.userId } },
    })
    presenceChannel = channel

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, Array<{ user_id?: string }>>
        const ids = Object.values(state)
          .flat()
          .map((entry) => entry.user_id)
          .filter((id): id is string => Boolean(id))
        onlineUserIds.value = [...new Set(ids)]
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ user_id: userStore.userId, username: userStore.username })
        }
      })
  }

  /** 离开在线频道 */
  async function stopPresence(): Promise<void> {
    if (!presenceChannel) return
    const channel = presenceChannel
    presenceChannel = null
    onlineUserIds.value = []
    await channel.untrack()
    await unsubscribe(channel)
  }

  // -------------------------------------------------------------------------
  // 清理（退出登录 / 切换账号时调用）
  // -------------------------------------------------------------------------
  function reset(): void {
    unbindSocialRealtime()
    unbindMatchRealtime()
    void stopPresence()
    friends.value = []
    incomingRequests.value = []
    outgoingRequests.value = []
    searchResults.value = []
    matches.value = []
    currentMatch.value = null
    onlineUserIds.value = []
    error.value = null
  }

  return {
    // 状态
    friends,
    incomingRequests,
    outgoingRequests,
    searchResults,
    matches,
    currentMatch,
    onlineUserIds,
    loading,
    loadingMatch,
    searching,
    submitting,
    error,
    // 派生
    onlineFriends,
    activeMatches,
    incomingInvites,
    finishedMatches,
    hasPendingRequests,
    isGuest,
    // 好友
    loadAll,
    loadMatches,
    searchUsers,
    clearSearch,
    addFriend,
    respondRequest,
    removeFriend,
    // 对战
    challenge,
    respondToMatch,
    cancelMatchById,
    loadMatch,
    submitAnswer,
    // Realtime / presence
    bindSocialRealtime,
    unbindSocialRealtime,
    bindMatchRealtime,
    unbindMatchRealtime,
    startPresence,
    stopPresence,
    reset,
  }
})
