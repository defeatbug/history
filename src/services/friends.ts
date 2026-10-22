/**
 * 好友服务
 * ============================================================================
 * 职责：好友搜索、请求发送/接受/拒绝、删除，以及好友列表读取。
 *
 * 设计取舍：
 *   * 写操作全部走数据库 RPC（friends_*），而不是前端直接 insert/update。
 *     好友关系涉及「双方」的规则（不能加自己、不能重复、反向 pending 自动
 *     接受、blocked 拒绝），这些不变量只有放进数据库才能在并发和直接调用
 *     PostgREST 时都成立。
 *   * 读操作（列表、请求）直接查表：RLS 已经限制为「仅相关方可见」，
 *     少一层 RPC 也便于复用 friendships 表的实时订阅。
 */

import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { FriendListRow, FriendsSearchRow } from '@/types/database'

/** 一条待处理的好友请求（含对方资料，便于直接渲染） */
export interface FriendRequest {
  friendshipId: string
  userId: string
  username: string
  avatar: string | null
  createdAt: string
}

/** 好友功能是否可用（需要配置 Supabase 且已登录，登录态由调用方保证） */
export function isFriendsReady(): boolean {
  return isSupabaseConfigured
}

function ensureReady() {
  if (!isSupabaseConfigured) {
    throw new Error('未配置 Supabase，好友功能暂不可用')
  }
}

/** 按用户名模糊搜索用户，并返回与我的关系 */
export async function searchUsers(query: string): Promise<FriendsSearchRow[]> {
  ensureReady()
  const keyword = query.trim()
  if (!keyword) return []

  const { data, error } = await supabase.rpc('friends_search', { p_query: keyword })
  if (error) throw new Error(error.message)
  return data ?? []
}

/** 发送好友请求，返回 friendship id（重复请求/反向请求自动接受时返回已有 id） */
export async function sendFriendRequest(userId: string): Promise<string> {
  ensureReady()
  const { data, error } = await supabase.rpc('friends_send_request', { p_user_id: userId })
  if (error) throw new Error(error.message)
  return data
}

/** 接受或拒绝好友请求，返回 'accepted' | 'deleted' */
export async function respondFriendRequest(
  friendshipId: string,
  accept: boolean,
): Promise<'accepted' | 'deleted'> {
  ensureReady()
  const { data, error } = await supabase.rpc('friends_respond_request', {
    p_friendship_id: friendshipId,
    p_accept: accept,
  })
  if (error) throw new Error(error.message)
  return data as 'accepted' | 'deleted'
}

/** 删除好友（或撤回自己发出的待处理请求） */
export async function removeFriend(friendshipId: string): Promise<void> {
  ensureReady()
  const { error } = await supabase.rpc('friends_remove', { p_friendship_id: friendshipId })
  if (error) throw new Error(error.message)
}

/** 好友列表 + 双方战绩 + 进行中的对战 */
export async function fetchFriends(): Promise<FriendListRow[]> {
  ensureReady()
  const { data, error } = await supabase.rpc('friends_list')
  if (error) throw new Error(error.message)
  return data ?? []
}

/** 别人发给我的、还没处理的好友请求 */
export async function fetchIncomingRequests(userId: string): Promise<FriendRequest[]> {
  ensureReady()
  const { data: rows, error } = await supabase
    .from('friendships')
    .select('id, requester_id, created_at')
    .eq('addressee_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  if (!rows?.length) return []

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, avatar')
    .in(
      'id',
      rows.map((r) => r.requester_id),
    )
  if (profileError) throw new Error(profileError.message)

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]))
  return rows.map((r) => ({
    friendshipId: r.id,
    userId: r.requester_id,
    username: byId.get(r.requester_id)?.username ?? '未知用户',
    avatar: byId.get(r.requester_id)?.avatar ?? null,
    createdAt: r.created_at,
  }))
}

/** 我发出的、对方还没处理的好友请求 */
export async function fetchOutgoingRequests(userId: string): Promise<FriendRequest[]> {
  ensureReady()
  const { data: rows, error } = await supabase
    .from('friendships')
    .select('id, addressee_id, created_at')
    .eq('requester_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  if (!rows?.length) return []

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, avatar')
    .in(
      'id',
      rows.map((r) => r.addressee_id),
    )
  if (profileError) throw new Error(profileError.message)

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]))
  return rows.map((r) => ({
    friendshipId: r.id,
    userId: r.addressee_id,
    username: byId.get(r.addressee_id)?.username ?? '未知用户',
    avatar: byId.get(r.addressee_id)?.avatar ?? null,
    createdAt: r.created_at,
  }))
}
