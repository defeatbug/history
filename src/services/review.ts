/**
 * 错题本与间隔重复服务
 * ============================================================================
 * 职责：
 *   1. 记录答题并同步更新 SM-2 复习状态
 *   2. 读取错题本（错过至少一次的题）
 *   3. 读取待复习队列（next_review_at 已到期的题）
 *
 * 算法实现在 src/utils/sm2.ts（纯函数 + 单元测试），本文件只负责读写往返。
 *
 * 设计取舍：算法放在前端而非数据库函数
 *   * 优点：纯函数易于单元测试（已有 29 条用例）、便于论文中展示与讲解、
 *     后续换算法（如 FSRS）无需改数据库
 *   * 代价：客户端理论上可篡改自身复习状态 —— 但复习状态只影响自己的学习节奏，
 *     不涉及排行榜或勋章等可获利数据，风险可接受
 *   * 对比：勋章判定（evaluate_badges）放在服务端，因为它直接影响成就展示
 */

import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { Question } from '@/data/mockData'
import {
  calculateNextReview,
  gradeAnswer,
  INITIAL_REVIEW_STATE,
  masteryLevel,
  type ReviewState,
} from '@/utils/sm2'
import { canPersist } from './progress'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 错题本条目 */
export interface WrongAnswerItem {
  questionId: string
  userAnswer: number | null
  /** 最近一次是否答对 */
  isCorrect: boolean
  /** 累计答错次数 */
  wrongCount: number
  /** 连续答对次数 */
  correctStreak: number
  easeFactor: number
  intervalDays: number
  repetitions: number
  nextReviewAt: string | null
  answeredAt: string
  /** 掌握程度 0~1 */
  mastery: number
  /** 是否已到复习时间 */
  isDue: boolean
  // --- 题目内容 ---
  content: string
  type: Question['type']
  options: string[]
  answer: number
  explanation: string | null
  courseId: string
  /** 课程标题；题目所属课程可能已被删除，故可为 null */
  courseTitle: string | null
}

/** 复习队列条目（不含错误次数语义） */
export interface ReviewItem {
  questionId: string
  content: string
  type: Question['type']
  options: string[]
  answer: number
  explanation: string | null
  courseId: string
  courseTitle: string | null
  easeFactor: number
  intervalDays: number
  repetitions: number
  nextReviewAt: string | null
  wrongCount: number
}

// ---------------------------------------------------------------------------
// 行 → 模型
// ---------------------------------------------------------------------------

interface WrongAnswerRow {
  question_id: string
  user_answer: unknown
  is_correct: boolean
  wrong_count: number | null
  correct_streak: number | null
  ease_factor: number | string | null
  interval_days: number | null
  repetitions: number | null
  next_review_at: string | null
  answered_at: string
  question_content: string
  question_type: string
  question_options: unknown
  question_answer: unknown
  question_explanation: string | null
  course_id: string
  course_title: string | null
}

function mapWrongAnswerRow(row: WrongAnswerRow): WrongAnswerItem {
  const repetitions = row.repetitions ?? 0
  const due = !row.next_review_at || new Date(row.next_review_at).getTime() <= Date.now()

  return {
    questionId: row.question_id,
    userAnswer: typeof row.user_answer === 'number' ? row.user_answer : null,
    isCorrect: row.is_correct,
    wrongCount: row.wrong_count ?? 0,
    correctStreak: row.correct_streak ?? 0,
    easeFactor: Number(row.ease_factor ?? 2.5),
    intervalDays: row.interval_days ?? 0,
    repetitions,
    nextReviewAt: row.next_review_at,
    answeredAt: row.answered_at,
    mastery: masteryLevel(repetitions),
    isDue: due,
    content: row.question_content,
    type: row.question_type as Question['type'],
    options: Array.isArray(row.question_options) ? (row.question_options as string[]) : [],
    answer: typeof row.question_answer === 'number' ? row.question_answer : 0,
    explanation: row.question_explanation,
    courseId: row.course_id,
    courseTitle: row.course_title ?? null,
  }
}

// ---------------------------------------------------------------------------
// 写入：记录答题 + 更新 SM-2
// ---------------------------------------------------------------------------

export interface RecordAnswerResult {
  ok: boolean
  /** 更新后的复习状态（便于 UI 提示「下次复习时间」） */
  next?: {
    intervalDays: number
    easeFactor: number
    nextReviewAt: Date
  }
  error?: string
}

/**
 * 记录一次答题，并按 SM-2 更新该题的复习计划。
 *
 * 流程：
 *   1. 读取该题现有复习状态（首次则用初始状态）
 *   2. 由正误推导质量分，计算新的 EF / 间隔 / 连续次数
 *   3. upsert 回 user_answers
 */
export async function recordAnswerWithSm2(
  userId: string,
  questionId: string,
  userAnswer: number | null,
  isCorrect: boolean,
): Promise<RecordAnswerResult> {
  if (!canPersist(userId)) {
    return { ok: false, error: 'not_persistable' }
  }

  try {
    // --- 1. 读取现有状态 ---
    const { data: existing, error: readError } = await supabase
      .from('user_answers')
      .select('ease_factor, interval_days, repetitions, wrong_count, correct_streak')
      .eq('user_id', userId)
      .eq('question_id', questionId)
      .maybeSingle()

    if (readError) throw readError

    const prevState: ReviewState = existing
      ? {
          easeFactor: Number(existing.ease_factor ?? 2.5),
          intervalDays: existing.interval_days ?? 0,
          repetitions: existing.repetitions ?? 0,
        }
      : INITIAL_REVIEW_STATE

    // --- 2. SM-2 计算 ---
    const next = calculateNextReview(prevState, gradeAnswer(isCorrect))

    const wrongCount = (existing?.wrong_count ?? 0) + (isCorrect ? 0 : 1)
    const correctStreak = isCorrect ? (existing?.correct_streak ?? 0) + 1 : 0

    // --- 3. 写回 ---
    const { error: writeError } = await supabase.from('user_answers').upsert(
      {
        user_id: userId,
        question_id: questionId,
        user_answer: userAnswer,
        is_correct: isCorrect,
        answered_at: new Date().toISOString(),
        ease_factor: next.easeFactor,
        interval_days: next.intervalDays,
        repetitions: next.repetitions,
        next_review_at: next.nextReviewAt.toISOString(),
        wrong_count: wrongCount,
        correct_streak: correctStreak,
      },
      { onConflict: 'user_id,question_id' },
    )

    if (writeError) throw writeError

    return {
      ok: true,
      next: {
        intervalDays: next.intervalDays,
        easeFactor: next.easeFactor,
        nextReviewAt: next.nextReviewAt,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[review] 记录答题失败：', message)
    return { ok: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// 读取：错题本
// ---------------------------------------------------------------------------

export interface WrongAnswersResult {
  data: WrongAnswerItem[]
  source: 'remote' | 'mock'
  error?: string
}

/**
 * 读取错题本（错过至少一次的题）。
 * 未配置 Supabase 时返回空列表（错题本依赖真实学习记录，无 mock 数据）。
 */
export async function fetchWrongAnswers(userId: string): Promise<WrongAnswersResult> {
  if (!isSupabaseConfigured || !canPersist(userId)) {
    return { data: [], source: 'mock' }
  }

  try {
    const { data, error } = await supabase
      .from('wrong_answers_view')
      .select('*')
      .order('wrong_count', { ascending: false })
      .order('answered_at', { ascending: false })

    if (error) throw error

    return {
      data: (data ?? []).map((r) => mapWrongAnswerRow(r as unknown as WrongAnswerRow)),
      source: 'remote',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[review] 读取错题本失败：', message)
    return { data: [], source: 'remote', error: message }
  }
}

// ---------------------------------------------------------------------------
// 读取：待复习队列
// ---------------------------------------------------------------------------

/**
 * 读取待复习队列。
 *
 * @param mode
 *   'due'   —— 只取按 SM-2 已到期的题
 *   'wrong' —— 只取当前答错的题（错题本进入复习时用）
 *   'all'   —— 两者合并
 * @param limit 最多返回多少题
 */
export async function fetchReviewQueue(
  userId: string,
  mode: 'due' | 'wrong' | 'all' = 'due',
  limit = 20,
): Promise<{ data: ReviewItem[]; error?: string }> {
  if (!isSupabaseConfigured || !canPersist(userId)) {
    return { data: [] }
  }

  try {
    let query = supabase
      .from('user_answers')
      .select(
        'question_id, ease_factor, interval_days, repetitions, next_review_at, wrong_count, is_correct',
      )
      .eq('user_id', userId)

    const nowIso = new Date().toISOString()

    if (mode === 'due') {
      query = query.lte('next_review_at', nowIso)
    } else if (mode === 'wrong') {
      query = query.eq('is_correct', false)
    } else {
      // all：到期 或 当前答错
      query = query.or(`next_review_at.lte.${nowIso},is_correct.eq.false`)
    }

    const { data: rows, error } = await query
      .order('next_review_at', { ascending: true, nullsFirst: true })
      .limit(limit)

    if (error) throw error
    if (!rows || rows.length === 0) return { data: [] }

    // 取出题目内容
    const questionIds = rows.map((r) => r.question_id)
    const { data: questions, error: qError } = await supabase
      .from('questions')
      .select('id, content, type, options, answer, explanation, course_id')
      .in('id', questionIds)

    if (qError) throw qError

    const courseIds = [...new Set((questions ?? []).map((q) => q.course_id))]
    const { data: courses } = await supabase
      .from('courses')
      .select('id, title')
      .in('id', courseIds)

    const questionMap = new Map((questions ?? []).map((q) => [q.id, q]))
    const courseMap = new Map((courses ?? []).map((c) => [c.id, c.title]))

    const items: ReviewItem[] = []
    for (const row of rows) {
      const q = questionMap.get(row.question_id)
      if (!q) continue // 题目可能已被删除

      items.push({
        questionId: q.id,
        content: q.content,
        type: q.type as Question['type'],
        options: Array.isArray(q.options) ? (q.options as string[]) : [],
        answer: typeof q.answer === 'number' ? q.answer : 0,
        explanation: q.explanation,
        courseId: q.course_id,
        courseTitle: courseMap.get(q.course_id) ?? null,
        easeFactor: Number(row.ease_factor ?? 2.5),
        intervalDays: row.interval_days ?? 0,
        repetitions: row.repetitions ?? 0,
        nextReviewAt: row.next_review_at,
        wrongCount: row.wrong_count ?? 0,
      })
    }

    return { data: items }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[review] 读取复习队列失败：', message)
    return { data: [], error: message }
  }
}

// ---------------------------------------------------------------------------
// 统计
// ---------------------------------------------------------------------------

export interface ReviewStats {
  /** 错题总数 */
  totalWrong: number
  /** 其中已到复习时间的 */
  dueCount: number
  /** 已掌握（连续答对 >= 5 次）*/
  masteredCount: number
  /** 平均难度系数 */
  averageEaseFactor: number
}

export function summarizeWrongAnswers(items: WrongAnswerItem[]): ReviewStats {
  if (items.length === 0) {
    return { totalWrong: 0, dueCount: 0, masteredCount: 0, averageEaseFactor: 0 }
  }

  const dueCount = items.filter((i) => i.isDue).length
  const masteredCount = items.filter((i) => i.mastery >= 1).length
  const averageEaseFactor =
    items.reduce((sum, i) => sum + i.easeFactor, 0) / items.length

  return {
    totalWrong: items.length,
    dueCount,
    masteredCount,
    averageEaseFactor: Math.round(averageEaseFactor * 100) / 100,
  }
}
