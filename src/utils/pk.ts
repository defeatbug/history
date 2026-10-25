/**
 * PK 展示层纯函数
 * ============================================================================
 * 对战规则的可信计算都在数据库（迁移 13），这里只做**展示需要的派生数据**：
 * 我的比分/对手比分、答题进度、下一题是哪道、最终胜负。
 *
 * 抽成纯函数是为了能单测——这些逻辑直接决定界面上「赢/输/下一题」是否正确，
 * 一旦写错用户会看到明显错误的结算。
 */

import type {
  PkMatchDetail,
  PkMatchSummaryRow,
  PkPlayerView,
  PkQuestionView,
} from '@/types/database'

export type MatchOutcome = 'win' | 'lose' | 'draw' | 'pending'

/** 根据双方比分与状态得到结果；未结束一律 pending */
export function matchOutcome(
  myScore: number,
  opponentScore: number,
  status: PkMatchDetail['status'] | PkMatchSummaryRow['status'],
): MatchOutcome {
  if (status !== 'finished') return 'pending'
  if (myScore > opponentScore) return 'win'
  if (myScore < opponentScore) return 'lose'
  return 'draw'
}

/**
 * 对战详情视角的胜负：优先识别「超时判负」。
 *
 * 服务端结算超时后 finished_reason='timeout'、forfeited_by=被判负方。
 * 普通完成仍按比分判定；双方都超时（forfeited_by=null）也按比分。
 */
export function detailOutcome(match: PkMatchDetail): MatchOutcome {
  if (match.status !== 'finished') return 'pending'
  if (match.finished_reason === 'timeout' && match.forfeited_by) {
    return match.forfeited_by === me(match).id ? 'lose' : 'win'
  }
  return matchOutcome(myScore(match), opponentScore(match), match.status)
}

/** 我在对战中的比分（按 my_role 取对应字段） */
export function myScore(match: PkMatchDetail): number {
  return match.my_role === 'challenger' ? match.challenger.score : match.opponent.score
}

/** 对手的比分 */
export function opponentScore(match: PkMatchDetail): number {
  return match.my_role === 'challenger' ? match.opponent.score : match.challenger.score
}

/** 我这一侧的玩家信息 */
export function me(match: PkMatchDetail): PkPlayerView {
  return match.my_role === 'challenger' ? match.challenger : match.opponent
}

/** 对手那一侧的玩家信息 */
export function opponent(match: PkMatchDetail): PkPlayerView {
  return match.my_role === 'challenger' ? match.opponent : match.challenger
}

/** 我已经作答过的题目 id */
export function answeredQuestionIds(match: PkMatchDetail): Set<string> {
  return new Set(match.my_answers.map((a) => a.question_id))
}

/** 我的答题进度：已答 / 总数 / 百分比（0~100，总数 0 时返回 0） */
export function answerProgress(match: PkMatchDetail): {
  answered: number
  total: number
  percent: number
} {
  const total = match.questions.length
  const answered = match.my_answers.length
  return {
    answered,
    total,
    percent: total > 0 ? Math.round((answered / total) * 100) : 0,
  }
}

/**
 * 我下一道要答的题：按 question_ids 的原始顺序，找第一道还没答的题。
 *
 * 不直接按 questions 数组下标走，是因为用户可能中途退出、下次继续；
 * 已经答过的题永远跳过，保证「继续对战」不会重复出题。
 */
export function nextQuestion(match: PkMatchDetail): PkQuestionView | null {
  const answered = answeredQuestionIds(match)
  return match.questions.find((q) => !answered.has(q.id)) ?? null
}

/** 我是否还能继续答题（对战中且还有未答题目） */
export function canContinue(match: PkMatchDetail): boolean {
  return match.status === 'in_progress' && nextQuestion(match) !== null
}

/** 对手是否已经全部答完 */
export function opponentFinished(match: PkMatchDetail): boolean {
  return opponent(match).finished_at !== null
}
