/**
 * SM-2 间隔重复算法
 * ============================================================================
 * 出处：Piotr Wozniak, "Optimization of learning" (1990)，SuperMemo 2 算法。
 *
 * 核心思想：
 *   把每道题看成一个独立的记忆项，根据作答质量动态调整「下次复习时间」。
 *   答得好的题间隔越来越长，答得差的题间隔缩短并重新开始。
 *
 * 状态量（与 user_answers 表字段一一对应）：
 *   easeFactor   难度系数 EF，越大表示越容易，初始 2.5，下限 1.3
 *   intervalDays 当前复习间隔（天）
 *   repetitions  连续答对次数 n
 *
 * 递推公式（q 为作答质量 0~5）：
 *
 *   若 q >= 3（答对）：
 *       n = 0  →  I = 1
 *       n = 1  →  I = 6
 *       n >= 2 →  I = round(I_prev × EF)
 *       n ← n + 1
 *   若 q < 3（答错）：
 *       n ← 0
 *       I = 1
 *
 *   无论对错，EF 都按下式更新：
 *       EF' = EF + (0.1 − (5 − q) × (0.08 + (5 − q) × 0.02))
 *       EF' = max(1.3, EF')
 *
 * ============================================================================
 */

/** 初始难度系数 */
export const DEFAULT_EASE_FACTOR = 2.5

/** 难度系数下限，防止间隔退化到过短 */
export const MIN_EASE_FACTOR = 1.3

/** 作答质量，取值 0~5（5 = 完全掌握，0 = 完全不会） */
export type Quality = 0 | 1 | 2 | 3 | 4 | 5

/**
 * 记忆项状态
 */
export interface ReviewState {
  /** 难度系数 EF */
  easeFactor: number
  /** 当前间隔（天） */
  intervalDays: number
  /** 连续答对次数 */
  repetitions: number
}

/** 计算后的新状态，并附带下次复习时间 */
export interface ReviewResult extends ReviewState {
  /** 下次复习时间 */
  nextReviewAt: Date
}

/** 全新记忆项的初始状态 */
export const INITIAL_REVIEW_STATE: ReviewState = {
  easeFactor: DEFAULT_EASE_FACTOR,
  intervalDays: 0,
  repetitions: 0,
}

/**
 * 作答质量映射
 * ---------------------------------------------------------------
 * 本项目只采集到「对 / 错」布尔值，因此把布尔值映射为一个固定的质量分。
 *
 * 选择 4 与 2 的理由：
 *   * 答对取 q=4（而非满分 5）——「正确但可能有犹豫」。
 *     代入公式：EF' = EF + (0.1 − 1 × 0.1) = EF，即难度系数保持不变。
 *     这意味着稳定答对的题间隔按 EF 稳定增长，不会因连续满分而过度膨胀。
 *   * 答错取 q=2 ——「答错了，但看到答案后能想起来」。
 *     代入公式：EF' = EF + (0.1 − 3 × 0.14) = EF − 0.32，
 *     难度系数显著下降，后续复习间隔被拉近。
 *
 * 这种映射可以直接从「答题结果」推导，无需额外让用户自评，
 * 降低使用摩擦；后续若要支持自评，只需传入不同的 Quality。
 */
export const QUALITY_CORRECT: Quality = 4
export const QUALITY_INCORRECT: Quality = 2

/** 由答题正误推导作答质量 */
export function gradeAnswer(isCorrect: boolean): Quality {
  return isCorrect ? QUALITY_CORRECT : QUALITY_INCORRECT
}

/**
 * 计算下一次复习状态。
 *
 * @param state   当前状态（首次学习请传 INITIAL_REVIEW_STATE）
 * @param quality 作答质量 0~5
 * @param now     基准时间，默认当前时刻（便于测试注入）
 * @returns       更新后的状态与下次复习时间
 *
 * @example
 * const s = calculateNextReview(INITIAL_REVIEW_STATE, 4)
 * // → { easeFactor: 2.5, intervalDays: 1, repetitions: 1, nextReviewAt: 明天 }
 */
export function calculateNextReview(
  state: ReviewState,
  quality: Quality,
  now: Date = new Date(),
): ReviewResult {
  const { easeFactor, intervalDays, repetitions } = normalizeState(state)

  const passed = quality >= 3

  let nextRepetitions: number
  let nextInterval: number

  if (passed) {
    nextRepetitions = repetitions + 1

    if (repetitions === 0) {
      // 第一次答对：1 天后复习
      nextInterval = 1
    } else if (repetitions === 1) {
      // 第二次答对：6 天后复习
      nextInterval = 6
    } else {
      // 之后：按难度系数放大
      nextInterval = Math.round(intervalDays * easeFactor)
      // 至少比上次长 1 天，避免因取整导致停滞
      if (nextInterval <= intervalDays) {
        nextInterval = intervalDays + 1
      }
    }
  } else {
    // 答错：重新开始
    nextRepetitions = 0
    nextInterval = 1
  }

  // 难度系数更新（无论对错都更新）
  const nextEaseFactor = clampEaseFactor(
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  )

  const nextReviewAt = new Date(now.getTime() + nextInterval * 24 * 60 * 60 * 1000)

  return {
    easeFactor: round2(nextEaseFactor),
    intervalDays: nextInterval,
    repetitions: nextRepetitions,
    nextReviewAt,
  }
}

/**
 * 仅更新难度系数（用于「未到复习时间但又被答错」等场景）
 */
export function applyQualityToEaseFactor(easeFactor: number, quality: Quality): number {
  return clampEaseFactor(easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))
}

/**
 * 判断某个记忆项是否到了复习时间。
 */
export function isDue(state: { nextReviewAt: Date | string | null }, now: Date = new Date()): boolean {
  if (!state.nextReviewAt) return true // 从未安排过 → 视为待复习
  const due = state.nextReviewAt instanceof Date ? state.nextReviewAt : new Date(state.nextReviewAt)
  if (Number.isNaN(due.getTime())) return true
  return due.getTime() <= now.getTime()
}

/**
 * 掌握程度预估（0~1），用于错题本的进度展示。
 *
 * 依据连续答对次数：0 次 = 0，达到 5 次视为完全掌握。
 */
export function masteryLevel(repetitions: number): number {
  return Math.min(1, Math.max(0, repetitions / 5))
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function clampEaseFactor(value: number): number {
  return Math.max(MIN_EASE_FACTOR, value)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 容错：把非法或缺失的值规整为合法状态 */
function normalizeState(state: Partial<ReviewState> | null | undefined): ReviewState {
  const easeFactor =
    typeof state?.easeFactor === 'number' && Number.isFinite(state.easeFactor)
      ? clampEaseFactor(state.easeFactor)
      : DEFAULT_EASE_FACTOR

  const intervalDays =
    typeof state?.intervalDays === 'number' && state.intervalDays >= 0
      ? Math.floor(state.intervalDays)
      : 0

  const repetitions =
    typeof state?.repetitions === 'number' && state.repetitions >= 0
      ? Math.floor(state.repetitions)
      : 0

  return { easeFactor, intervalDays, repetitions }
}
