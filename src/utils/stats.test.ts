import { describe, expect, it } from 'vitest'
import {
  buildCourseAccuracy,
  buildDailyTrend,
  localDayKey,
  summarizeAnswers,
  type AnswerRecord,
} from './stats'

/** 用本地时间构造 ISO 字符串，避免测试受运行机器时区影响 */
function at(year: number, month: number, day: number, hour = 12, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString()
}

function answer(
  answeredAt: string,
  isCorrect: boolean,
  courseId?: string | null,
): AnswerRecord {
  return { questionId: 'q1', answeredAt, isCorrect, courseId }
}

describe('localDayKey', () => {
  it('使用本地日期而不是 UTC 日期', () => {
    // 晚上 23:30 在 UTC+8 仍是当天，toISOString 会跨到第二天
    const date = new Date(2026, 9, 25, 23, 30)
    expect(localDayKey(date)).toBe('2026-10-25')
  })

  it('月份和日期补零', () => {
    expect(localDayKey(new Date(2026, 0, 5, 8))).toBe('2026-01-05')
  })
})

describe('buildDailyTrend', () => {
  const now = new Date(2026, 9, 25, 12) // 2026-10-25 12:00 本地

  it('生成完整的 N 天序列，缺失的日期补 0', () => {
    const points = buildDailyTrend([], 7, now)

    expect(points).toHaveLength(7)
    expect(points[0]!.day).toBe('2026-10-19')
    expect(points[6]!.day).toBe('2026-10-25')
    expect(points[6]!.label).toBe('10/25')
    expect(points.every((p) => p.total === 0 && p.rate === 0)).toBe(true)
  })

  it('按本地日期分桶并统计正确 / 错误', () => {
    const points = buildDailyTrend(
      [
        answer(at(2026, 10, 19, 9), true),
        answer(at(2026, 10, 19, 10), false),
        answer(at(2026, 10, 25, 8), true),
      ],
      7,
      now,
    )

    expect(points[0]!).toMatchObject({ day: '2026-10-19', correct: 1, wrong: 1, total: 2 })
    expect(points[0]!.rate).toBeCloseTo(0.5)
    expect(points[6]!).toMatchObject({ day: '2026-10-25', correct: 1, wrong: 0, total: 1 })
    expect(points[1]!.total).toBe(0)
  })

  it('窗口外的记录与非法时间被忽略', () => {
    const points = buildDailyTrend(
      [
        answer(at(2026, 10, 18, 23), true), // 前一天，窗口外
        answer('not-a-date', true),
        answer(at(2026, 10, 25, 23), true), // 今天稍晚，属于今天
      ],
      7,
      now,
    )

    expect(points.reduce((n, p) => n + p.total, 0)).toBe(1)
    expect(points[6]!.total).toBe(1)
  })

  it('days 小于 1 时按 1 天处理', () => {
    const points = buildDailyTrend([answer(at(2026, 10, 25, 9), true)], 0, now)
    expect(points).toHaveLength(1)
    expect(points[0]!.day).toBe('2026-10-25')
  })
})

describe('buildCourseAccuracy', () => {
  const titles = new Map([
    ['lesson-1', '古代文明的起源'],
    ['lesson-2', '文艺复兴'],
  ])

  it('按课程聚合正确率并按作答量降序', () => {
    const rows = buildCourseAccuracy(
      [
        answer(at(2026, 10, 20), true, 'lesson-1'),
        answer(at(2026, 10, 21), true, 'lesson-1'),
        answer(at(2026, 10, 22), false, 'lesson-1'),
        answer(at(2026, 10, 22), true, 'lesson-2'),
      ],
      titles,
    )

    expect(rows).toHaveLength(2)
    expect(rows[0]!).toMatchObject({
      courseId: 'lesson-1',
      title: '古代文明的起源',
      correct: 2,
      total: 3,
    })
    expect(rows[0]!.rate).toBeCloseTo(2 / 3)
    expect(rows[1]).toMatchObject({ courseId: 'lesson-2', correct: 1, total: 1, rate: 1 })
  })

  it('课程被删除时回退显示 id，缺少课程映射的记录被忽略', () => {
    const rows = buildCourseAccuracy(
      [
        answer(at(2026, 10, 20), true, 'lesson-deleted'),
        answer(at(2026, 10, 20), true),
        answer(at(2026, 10, 20), true, null),
      ],
      titles,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!).toMatchObject({ courseId: 'lesson-deleted', title: 'lesson-deleted' })
  })

  it('没有作答记录时返回空数组', () => {
    expect(buildCourseAccuracy([], titles)).toEqual([])
  })

  it('支持普通对象形式的标题映射', () => {
    const rows = buildCourseAccuracy(
      [answer(at(2026, 10, 20), true, 'lesson-1')],
      { 'lesson-1': '古代文明的起源' },
    )
    expect(rows[0]!.title).toBe('古代文明的起源')
  })
})

describe('summarizeAnswers', () => {
  it('空记录返回 0，避免除零', () => {
    expect(summarizeAnswers([])).toEqual({ total: 0, correct: 0, rate: 0 })
  })

  it('统计总数与正确率', () => {
    const rows = [
      answer(at(2026, 10, 20), true),
      answer(at(2026, 10, 20), false),
      answer(at(2026, 10, 21), true),
    ]
    expect(summarizeAnswers(rows)).toEqual({ total: 3, correct: 2, rate: 2 / 3 })
  })
})