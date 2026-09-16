/**
 * 学习进度持久化服务
 * ---------------------------------------------------------------
 * 负责把 Pinia 中的学习进度同步到 Supabase 的：
 *   * user_progress  —— 课程完成情况、学习时长、正确率、断点位置
 *   * user_answers   —— 逐题答题记录（错题本 / 间隔重复的数据来源）
 *   * user_badges    —— 已解锁勋章
 *
 * 设计原则：
 *   1. **离线可用** —— 未配置 Supabase、游客模式、或网络失败时，
 *      所有写操作静默降级为「仅本地内存」，不影响使用。
 *   2. **以本地为准，异步回写** —— 先立即更新 UI 状态，再后台同步，
 *      避免网络延迟阻塞交互。
 */

import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { UserProgressRow } from '@/types/database'
import type { UserProgress } from '@/data/mockData'

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 是否具备持久化条件。
 * 游客（userId === 'guest'）和未登录状态不写库，避免污染真实数据。
 */
export function canPersist(userId: string | null | undefined): boolean {
  return Boolean(isSupabaseConfigured && userId && UUID_RE.test(userId))
}

/** 构造一个空的进度对象 */
export function emptyProgress(userId: string): UserProgress {
  return {
    userId,
    completedLessons: [],
    badges: [],
    totalStudyTime: 0,
    correctRate: 0,
    currentStreak: 0,
    lastLessonId: null,
    lastPosition: 0,
    lastStudiedAt: null,
  }
}

/** 数据库行 → 应用层模型 */
export function mapProgressRow(row: UserProgressRow, badges: string[] = []): UserProgress {
  return {
    userId: row.user_id,
    completedLessons: row.completed_lessons ?? [],
    badges,
    totalStudyTime: row.total_study_time ?? 0,
    correctRate: Number(row.correct_rate ?? 0),
    currentStreak: row.current_streak ?? 0,
    lastLessonId: row.last_lesson_id,
    lastPosition: row.last_position ?? 0,
    lastStudiedAt: row.last_studied_at,
  }
}

// ---------------------------------------------------------------------------
// 读取
// ---------------------------------------------------------------------------

export interface LoadedProgress {
  progress: UserProgress
  badges: string[]
}

/**
 * 从数据库加载用户进度与已解锁勋章。
 * 若用户还没有 user_progress 行（例如老账号），返回空进度而非报错。
 */
export async function loadProgress(userId: string): Promise<LoadedProgress | null> {
  if (!canPersist(userId)) return null

  try {
    const [progressRes, badgesRes] = await Promise.all([
      supabase.from('user_progress').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('user_badges').select('badge_id').eq('user_id', userId),
    ])

    if (progressRes.error) throw progressRes.error
    if (badgesRes.error) throw badgesRes.error

    const badges = (badgesRes.data ?? []).map((b) => b.badge_id)

    if (!progressRes.data) {
      return { progress: { ...emptyProgress(userId), badges }, badges }
    }

    return { progress: mapProgressRow(progressRes.data, badges), badges }
  } catch (error) {
    console.warn('[progress] 加载进度失败，使用本地状态：', error)
    return null
  }
}

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

/**
 * 保存学习进度（upsert）。
 * 返回是否成功写入数据库。
 */
export async function saveProgress(
  userId: string,
  progress: UserProgress,
): Promise<boolean> {
  if (!canPersist(userId)) return false

  try {
    const { error } = await supabase.from('user_progress').upsert(
      {
        user_id: userId,
        completed_lessons: progress.completedLessons,
        total_study_time: progress.totalStudyTime,
        correct_rate: progress.correctRate,
        current_streak: progress.currentStreak,
        last_lesson_id: progress.lastLessonId ?? null,
        last_position: progress.lastPosition ?? 0,
        last_studied_at: progress.lastStudiedAt ?? null,
      },
      { onConflict: 'user_id' },
    )

    if (error) throw error
    return true
  } catch (error) {
    console.warn('[progress] 保存进度失败：', error)
    return false
  }
}

/** 只更新断点位置（高频操作，单独抽出来减少 payload） */
export async function saveResumePoint(
  userId: string,
  lessonId: string,
  position: number,
): Promise<boolean> {
  if (!canPersist(userId)) return false

  try {
    const { error } = await supabase.from('user_progress').upsert(
      {
        user_id: userId,
        last_lesson_id: lessonId,
        last_position: position,
        last_studied_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )

    if (error) throw error
    return true
  } catch (error) {
    console.warn('[progress] 保存断点失败：', error)
    return false
  }
}

// 答题记录与间隔重复见 src/services/review.ts

/**
 * 调用服务端的勋章判定函数，返回本次新解锁的勋章 id 列表。
 * 服务端判定是权威结果，防止客户端篡改进度刷勋章。
 */
export async function requestBadgeEvaluation(userId: string): Promise<string[]> {
  if (!canPersist(userId)) return []

  try {
    const { data, error } = await supabase.rpc('evaluate_badges', { p_user_id: userId })
    if (error) throw error
    return data ?? []
  } catch (error) {
    console.warn('[progress] 勋章判定失败：', error)
    return []
  }
}
