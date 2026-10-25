/**
 * 学习统计读取服务
 * ---------------------------------------------------------------
 * 统计图表需要逐题答题记录（`user_answers`），但现有 progress / review
 * 服务面向写入与错题，不提供「近 N 天全量记录」。这里补一个只读入口。
 *
 * 数据量控制：
 *   * 只取最近 `days` 天（默认 90 天），避免老账号一次拉全表
 *   * 加 `limit` 上限，超出时宁可少算也不阻塞页面
 *
 * RLS：`user_answers_owner_select` 只允许本人读取，前端无需再过滤 user_id，
 * 但这里仍显式 `.eq('user_id', userId)`，让查询走索引也更直观。
 */

import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { AnswerRecord } from '@/utils/stats'
import { canPersist } from './progress'

export interface AnswerHistoryResult {
  data: AnswerRecord[]
  error?: string
}

export async function fetchAnswerHistory(
  userId: string,
  days = 90,
  limit = 2000,
): Promise<AnswerHistoryResult> {
  if (!isSupabaseConfigured || !canPersist(userId)) {
    return { data: [] }
  }

  try {
    const since = new Date()
    since.setDate(since.getDate() - Math.max(1, Math.floor(days)))
    since.setHours(0, 0, 0, 0)

    const { data, error } = await supabase
      .from('user_answers')
      .select('question_id, answered_at, is_correct')
      .eq('user_id', userId)
      .gte('answered_at', since.toISOString())
      .order('answered_at', { ascending: true })
      .limit(Math.max(1, Math.floor(limit)))

    if (error) throw error

    return {
      data: (data ?? []).map((row) => ({
        questionId: row.question_id,
        answeredAt: row.answered_at,
        isCorrect: row.is_correct,
      })),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[stats] 读取答题记录失败：', message)
    return { data: [], error: message }
  }
}