import { describe, it, expect } from 'vitest'
import type { PkMatchDetail, PkQuestionView } from '@/types/database'
import {
  matchOutcome,
  myScore,
  opponentScore,
  me,
  opponent,
  answeredQuestionIds,
  answerProgress,
  nextQuestion,
  canContinue,
  opponentFinished,
} from './pk'

/** 构造一道最小 PK 题目 */
const question = (id: string): PkQuestionView => ({
  id,
  content: `题目-${id}`,
  options: ['A', 'B', 'C', 'D'],
  course_title: '课程',
  explanation: null,
  correct_index: null,
})

/**
 * 构造一份最小对战详情。
 * 默认：我是 challenger，2 题，尚未作答。
 */
const match = (patch: Partial<PkMatchDetail> = {}): PkMatchDetail => ({
  id: 'm-1',
  status: 'in_progress',
  question_ids: ['q-1', 'q-2'],
  challenger: { id: 'u-1', username: '我', score: 0, finished_at: null },
  opponent: { id: 'u-2', username: '对手', score: 0, finished_at: null },
  created_at: '2026-10-22T10:00:00Z',
  started_at: '2026-10-22T10:01:00Z',
  finished_at: null,
  questions: [question('q-1'), question('q-2')],
  my_answers: [],
  opponent_answered: 0,
  my_role: 'challenger',
  ...patch,
})

describe('matchOutcome —— 胜负判定', () => {
  it('未结束一律 pending，即使比分悬殊', () => {
    expect(matchOutcome(5, 0, 'waiting')).toBe('pending')
    expect(matchOutcome(5, 0, 'in_progress')).toBe('pending')
    expect(matchOutcome(5, 0, 'cancelled')).toBe('pending')
  })

  it('结束时按比分给 win / lose / draw', () => {
    expect(matchOutcome(5, 3, 'finished')).toBe('win')
    expect(matchOutcome(2, 4, 'finished')).toBe('lose')
    expect(matchOutcome(4, 4, 'finished')).toBe('draw')
  })
})

describe('按角色取比分与玩家', () => {
  it('我是 challenger 时取 challenger 侧', () => {
    const m = match({
      challenger: { id: 'u-1', username: '我', score: 3, finished_at: null },
      opponent: { id: 'u-2', username: '对手', score: 5, finished_at: null },
    })
    expect(myScore(m)).toBe(3)
    expect(opponentScore(m)).toBe(5)
    expect(me(m).username).toBe('我')
    expect(opponent(m).username).toBe('对手')
  })

  it('我是 opponent 时自动交换两侧', () => {
    const m = match({
      my_role: 'opponent',
      challenger: { id: 'u-1', username: '对手', score: 3, finished_at: null },
      opponent: { id: 'u-2', username: '我', score: 5, finished_at: null },
    })
    expect(myScore(m)).toBe(5)
    expect(opponentScore(m)).toBe(3)
    expect(me(m).username).toBe('我')
    expect(opponent(m).username).toBe('对手')
  })
})

describe('答题进度与下一题', () => {
  it('未作答时进度为 0 / 2，0%', () => {
    expect(answerProgress(match())).toEqual({ answered: 0, total: 2, percent: 0 })
  })

  it('按已答数量算百分比并四舍五入', () => {
    const m = match({
      questions: [question('q-1'), question('q-2'), question('q-3')],
      question_ids: ['q-1', 'q-2', 'q-3'],
      my_answers: [{ question_id: 'q-1', selected_index: 0, is_correct: true }],
    })
    expect(answerProgress(m)).toEqual({ answered: 1, total: 3, percent: 33 })
  })

  it('下一题跳过已答题目，保持题目原始顺序', () => {
    const m = match({
      my_answers: [{ question_id: 'q-1', selected_index: 1, is_correct: false }],
    })
    expect(nextQuestion(m)?.id).toBe('q-2')
  })

  it('全部答完时没有下一题，也不能继续', () => {
    const m = match({
      my_answers: [
        { question_id: 'q-1', selected_index: 0, is_correct: true },
        { question_id: 'q-2', selected_index: 0, is_correct: true },
      ],
    })
    expect(nextQuestion(m)).toBeNull()
    expect(canContinue(m)).toBe(false)
    expect(answeredQuestionIds(m).size).toBe(2)
  })

  it('对战已结束时即使还有未答题也不能继续', () => {
    const m = match({ status: 'finished' })
    expect(nextQuestion(m)?.id).toBe('q-1')
    expect(canContinue(m)).toBe(false)
  })
})

describe('对手完成状态', () => {
  it('对手 finished_at 非空即视为完成', () => {
    expect(opponentFinished(match())).toBe(false)
    expect(
      opponentFinished(
        match({
          opponent: { id: 'u-2', username: '对手', score: 2, finished_at: '2026-10-22T10:05:00Z' },
        }),
      ),
    ).toBe(true)
  })
})
