/**
 * 好友 PK 服务
 * ============================================================================
 * 职责：创建/接受/取消对战、读取对战详情、提交答案、读取历史，以及 Realtime
 * 订阅（对战状态变化、好友请求变化）。
 *
 * 设计取舍：PK 的核心规则全部放在数据库 RPC 里（迁移 13）：
 *   * 题目由服务端随机抽取并落库，客户端不能自选题目；
 *   * 分数由服务端按 questions.answer 判定后累加，客户端只提交「选了第几项」；
 *   * 结算（双方都答完）由数据库在同一事务里完成，避免两个客户端各算各的。
 * 因此前端这里只做「调用 + 订阅 + 展示」，不承担任何可信计算。
 */

import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { PkAnswerResult, PkMatchDetail, PkMatchSummaryRow } from '@/types/database'

/** PK 功能是否可用 */
export function isPkReady(): boolean {
  return isSupabaseConfigured
}

function ensureReady() {
  if (!isSupabaseConfigured) {
    throw new Error('未配置 Supabase，PK 功能暂不可用')
  }
}

/** 创建对战（双方必须已是好友）。若已有未结束的对战则直接返回该场 id。 */
export async function createMatch(opponentId: string, questionCount = 7): Promise<string> {
  ensureReady()
  const { data, error } = await supabase.rpc('pk_create_match', {
    p_opponent_id: opponentId,
    p_question_count: questionCount,
  })
  if (error) throw new Error(error.message)
  return data
}

/** 接受 / 拒绝别人的挑战，返回新状态 */
export async function respondMatch(matchId: string, accept: boolean): Promise<string> {
  ensureReady()
  const { data, error } = await supabase.rpc('pk_respond_match', {
    p_match_id: matchId,
    p_accept: accept,
  })
  if (error) throw new Error(error.message)
  return data
}

/** 取消自己发起、对方还没接受的对战 */
export async function cancelMatch(matchId: string): Promise<string> {
  ensureReady()
  const { data, error } = await supabase.rpc('pk_cancel_match', { p_match_id: matchId })
  if (error) throw new Error(error.message)
  return data
}

/** 读取对战详情（题目、我的答案、对手进度、比分） */
export async function fetchMatch(matchId: string): Promise<PkMatchDetail> {
  ensureReady()
  const { data, error } = await supabase.rpc('pk_get_match', { p_match_id: matchId })
  if (error) throw new Error(error.message)
  if (!data) throw new Error('对战不存在或你没有访问权限')
  return data
}

/** 提交一道题的答案，返回判定结果与最新比分 */
export async function submitAnswer(
  matchId: string,
  questionId: string,
  selectedIndex: number,
): Promise<PkAnswerResult> {
  ensureReady()
  const { data, error } = await supabase.rpc('pk_submit_answer', {
    p_match_id: matchId,
    p_question_id: questionId,
    p_selected_index: selectedIndex,
  })
  if (error) throw new Error(error.message)
  return data
}

/** 我的对战历史（含进行中/待接受），按创建时间倒序 */
export async function fetchMatches(limit = 20): Promise<PkMatchSummaryRow[]> {
  ensureReady()
  const { data, error } = await supabase.rpc('pk_list_matches', { p_limit: limit })
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * 订阅某场对战的状态变化（比分、结束）。
 *
 * Supabase Realtime 的 postgres_changes 会强制走 RLS，只有对战双方能收到，
 * 因此不需要额外的鉴权逻辑。
 */
export function subscribeMatch(
  matchId: string,
  onChange: (payload: { new: Record<string, unknown> }) => void,
): RealtimeChannel | null {
  if (!isSupabaseConfigured) return null

  return supabase
    .channel(`pk-match-${matchId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'pk_matches',
        filter: `id=eq.${matchId}`,
      },
      (payload) => onChange(payload as { new: Record<string, unknown> }),
    )
    .subscribe()
}

/**
 * 订阅「发给我」的好友请求变化，用于好友页实时提示。
 */
export function subscribeIncomingRequests(
  userId: string,
  onChange: () => void,
): RealtimeChannel | null {
  if (!isSupabaseConfigured) return null

  return supabase
    .channel(`friend-requests-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'friendships',
        filter: `addressee_id=eq.${userId}`,
      },
      () => onChange(),
    )
    .subscribe()
}

/**
 * 订阅「别人向我发起」的新对战，用于好友页实时提示应战。
 */
export function subscribeIncomingMatches(
  userId: string,
  onChange: () => void,
): RealtimeChannel | null {
  if (!isSupabaseConfigured) return null

  return supabase
    .channel(`pk-invites-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'pk_matches',
        filter: `opponent_id=eq.${userId}`,
      },
      () => onChange(),
    )
    .subscribe()
}

/** 取消订阅并释放连接 */
export async function unsubscribe(channel: RealtimeChannel | null): Promise<void> {
  if (!channel) return
  await supabase.removeChannel(channel)
}
/**
 * 订阅「我发起的对战」被对方接受/拒绝（好友页显示等待应战时使用）。
 *
 * 只监听 challenger_id = 我 的 UPDATE：对手页面的邀请由 subscribeIncomingMatches
 * 的 INSERT 覆盖，这里补齐「等待中 → 已应战」的状态回流。
 */
export function subscribeMyMatchUpdates(
  userId: string,
  onChange: () => void,
): RealtimeChannel | null {
  if (!isSupabaseConfigured) return null

  return supabase
    .channel(`pk-my-matches-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'pk_matches',
        filter: `challenger_id=eq.${userId}`,
      },
      () => onChange(),
    )
    .subscribe()
}
