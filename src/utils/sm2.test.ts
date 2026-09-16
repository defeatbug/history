import { describe, it, expect } from 'vitest'
import {
  calculateNextReview,
  gradeAnswer,
  isDue,
  masteryLevel,
  applyQualityToEaseFactor,
  INITIAL_REVIEW_STATE,
  DEFAULT_EASE_FACTOR,
  MIN_EASE_FACTOR,
  QUALITY_CORRECT,
  QUALITY_INCORRECT,
  type Quality,
  type ReviewState,
} from './sm2'

/** 固定基准时间，保证测试可复现 */
const NOW = new Date('2026-01-01T00:00:00.000Z')

/** 便捷构造状态 */
const state = (over: Partial<ReviewState> = {}): ReviewState => ({
  ...INITIAL_REVIEW_STATE,
  ...over,
})

describe('gradeAnswer —— 正误 → 质量分映射', () => {
  it('答对映射为 4', () => {
    expect(gradeAnswer(true)).toBe(QUALITY_CORRECT)
    expect(gradeAnswer(true)).toBe(4)
  })

  it('答错映射为 2', () => {
    expect(gradeAnswer(false)).toBe(QUALITY_INCORRECT)
    expect(gradeAnswer(false)).toBe(2)
  })
})

describe('calculateNextReview —— 答对时的间隔递推', () => {
  it('首次答对：间隔 1 天，重复次数 1', () => {
    const r = calculateNextReview(INITIAL_REVIEW_STATE, QUALITY_CORRECT, NOW)
    expect(r.intervalDays).toBe(1)
    expect(r.repetitions).toBe(1)
    expect(r.nextReviewAt.getTime()).toBe(NOW.getTime() + 1 * 86400_000)
  })

  it('第二次答对：间隔 6 天，重复次数 2', () => {
    const prev = state({ intervalDays: 1, repetitions: 1 })
    const r = calculateNextReview(prev, QUALITY_CORRECT, NOW)
    expect(r.intervalDays).toBe(6)
    expect(r.repetitions).toBe(2)
  })

  it('第三次及以后：间隔 = 上次间隔 × EF', () => {
    const prev = state({ easeFactor: 2.5, intervalDays: 6, repetitions: 2 })
    const r = calculateNextReview(prev, QUALITY_CORRECT, NOW)
    expect(r.intervalDays).toBe(15) // round(6 * 2.5)
    expect(r.repetitions).toBe(3)
  })

  it('间隔递增序列符合 SM-2 预期（EF=2.5）', () => {
    let s: ReviewState = INITIAL_REVIEW_STATE
    const intervals: number[] = []
    for (let i = 0; i < 5; i++) {
      const r = calculateNextReview(s, QUALITY_CORRECT, NOW)
      intervals.push(r.intervalDays)
      s = { easeFactor: r.easeFactor, intervalDays: r.intervalDays, repetitions: r.repetitions }
    }
    // 1 → 6 → 15 → 38 → 95（每次 ×2.5 取整）
    expect(intervals).toEqual([1, 6, 15, 38, 95])
  })
})

describe('calculateNextReview —— 答错时重置', () => {
  it('答错后重复次数归零、间隔重置为 1 天', () => {
    const prev = state({ easeFactor: 2.5, intervalDays: 38, repetitions: 4 })
    const r = calculateNextReview(prev, QUALITY_INCORRECT, NOW)
    expect(r.repetitions).toBe(0)
    expect(r.intervalDays).toBe(1)
  })

  it('答错会降低难度系数（q=2 时下降 0.32）', () => {
    const prev = state({ easeFactor: 2.5 })
    const r = calculateNextReview(prev, QUALITY_INCORRECT, NOW)
    expect(r.easeFactor).toBeCloseTo(2.18, 2)
  })

  it('难度系数不会低于下限 1.3', () => {
    let s = state({ easeFactor: MIN_EASE_FACTOR })
    for (let i = 0; i < 10; i++) {
      const r = calculateNextReview(s, 0, NOW)
      s = { easeFactor: r.easeFactor, intervalDays: r.intervalDays, repetitions: r.repetitions }
    }
    expect(s.easeFactor).toBe(MIN_EASE_FACTOR)
  })
})

describe('难度系数更新规则', () => {
  it('q=4 时 EF 保持不变（答对不应让题目变简单）', () => {
    const r = calculateNextReview(state({ easeFactor: 2.5 }), 4, NOW)
    expect(r.easeFactor).toBe(2.5)
  })

  it('q=5 时 EF 微增 0.1', () => {
    const r = calculateNextReview(state({ easeFactor: 2.5 }), 5, NOW)
    expect(r.easeFactor).toBeCloseTo(2.6, 2)
  })

  it('q=3 时 EF 下降 0.14', () => {
    const r = calculateNextReview(state({ easeFactor: 2.5 }), 3, NOW)
    expect(r.easeFactor).toBeCloseTo(2.36, 2)
  })

  it('q 越高质量分提升越多（单调性）', () => {
    const ef = 2.5
    const results = ([0, 1, 2, 3, 4, 5] as Quality[]).map((q) =>
      applyQualityToEaseFactor(ef, q),
    )
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!).toBeGreaterThanOrEqual(results[i - 1]!)
    }
  })
})

describe('isDue —— 复习到期判定', () => {
  it('无 nextReviewAt 视为待复习', () => {
    expect(isDue({ nextReviewAt: null })).toBe(true)
  })

  it('过去时间视为待复习', () => {
    expect(isDue({ nextReviewAt: new Date(NOW.getTime() - 1000) }, NOW)).toBe(true)
  })

  it('未来时间视为未到期', () => {
    expect(isDue({ nextReviewAt: new Date(NOW.getTime() + 86400_000) }, NOW)).toBe(false)
  })

  it('恰好等于当前时间视为到期', () => {
    expect(isDue({ nextReviewAt: new Date(NOW.getTime()) }, NOW)).toBe(true)
  })

  it('接受 ISO 字符串', () => {
    expect(isDue({ nextReviewAt: '2025-12-31T00:00:00.000Z' }, NOW)).toBe(true)
  })

  it('非法日期视为待复习（容错）', () => {
    expect(isDue({ nextReviewAt: 'not-a-date' }, NOW)).toBe(true)
  })
})

describe('masteryLevel —— 掌握程度', () => {
  it('0 次连续答对为 0', () => expect(masteryLevel(0)).toBe(0))
  it('5 次连续答对为 1', () => expect(masteryLevel(5)).toBe(1))
  it('超过 5 次仍封顶为 1', () => expect(masteryLevel(99)).toBe(1))
  it('2 次为 0.4', () => expect(masteryLevel(2)).toBeCloseTo(0.4, 5))
  it('负数容错为 0', () => expect(masteryLevel(-3)).toBe(0))
})

describe('健壮性 —— 非法输入不应崩溃', () => {
  it('缺失状态回退到默认值', () => {
    const r = calculateNextReview({} as ReviewState, QUALITY_CORRECT, NOW)
    expect(r.easeFactor).toBe(DEFAULT_EASE_FACTOR)
    expect(r.intervalDays).toBe(1)
  })

  it('NaN 难度系数被修正为默认值', () => {
    const r = calculateNextReview(state({ easeFactor: NaN }), QUALITY_CORRECT, NOW)
    expect(Number.isFinite(r.easeFactor)).toBe(true)
    expect(r.easeFactor).toBe(DEFAULT_EASE_FACTOR)
  })

  it('负数间隔被修正为 0', () => {
    const r = calculateNextReview(state({ intervalDays: -5, repetitions: 0 }), QUALITY_CORRECT, NOW)
    expect(r.intervalDays).toBe(1)
  })
})

describe('完整学习周期 —— 综合场景', () => {
  it('答错 → 答对 → 答对 的间隔变化符合预期', () => {
    // 第一次答错
    const r1 = calculateNextReview(INITIAL_REVIEW_STATE, QUALITY_INCORRECT, NOW)
    expect(r1.repetitions).toBe(0)
    expect(r1.intervalDays).toBe(1)
    expect(r1.easeFactor).toBeCloseTo(2.18, 2)

    // 再答对
    const r2 = calculateNextReview(r1, QUALITY_CORRECT, NOW)
    expect(r2.repetitions).toBe(1)
    expect(r2.intervalDays).toBe(1)

    // 再答对
    const r3 = calculateNextReview(r2, QUALITY_CORRECT, NOW)
    expect(r3.repetitions).toBe(2)
    expect(r3.intervalDays).toBe(6)

    // 再答对：间隔 = 6 × 2.18 ≈ 13
    const r4 = calculateNextReview(r3, QUALITY_CORRECT, NOW)
    expect(r4.intervalDays).toBe(13)
  })

  it('反复答错会让间隔始终停留在 1 天', () => {
    let s: ReviewState = INITIAL_REVIEW_STATE
    for (let i = 0; i < 5; i++) {
      const r = calculateNextReview(s, QUALITY_INCORRECT, NOW)
      expect(r.intervalDays).toBe(1)
      expect(r.repetitions).toBe(0)
      s = { easeFactor: r.easeFactor, intervalDays: r.intervalDays, repetitions: r.repetitions }
    }
  })
})
