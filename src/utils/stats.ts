/**
 * 学习统计的纯函数聚合
 * ---------------------------------------------------------------
 * 前端拿到的答题记录是「逐题、跨课程、跨天」的原始行，图表需要的是
 * 按天 / 按课程聚合后的序列。把聚合放在这里而不是组件里，原因：
 *   1. 纯函数可以用 vitest 直接覆盖边界（时区、空数据、越界日期）
 *   2. 学生统计（近 7 天）和后台统计（近 14 天）复用同一套逻辑
 */

/** 一条答题记录（数据库行的最小投影） */
export interface AnswerRecord {
  questionId: string
  /** ISO 时间字符串（数据库 `answered_at`） */
  answeredAt: string
  isCorrect: boolean
  /** 由调用方按 question_id → course_id 映射补齐；缺失时不计入课程维度 */
  courseId?: string | null
}

/** 按天聚合后的一个数据点 */
export interface DailyPoint {
  /** 本地日期，YYYY-MM-DD */
  day: string
  /** 图表横轴短标签，M/D */
  label: string
  correct: number
  wrong: number
  total: number
  /** 当天正确率 0~1；当天无作答时为 0 */
  rate: number
}

/** 按课程聚合后的正确率 */
export interface CourseAccuracy {
  courseId: string
  title: string
  correct: number
  total: number
  /** 0~1 */
  rate: number
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 本地时区的日期键；不能用 toISOString（那是 UTC，会把晚上 8 点后算到第二天） */
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/**
 * 近 N 天答题趋势（含今天，升序）。
 *
 * @param answers 原始答题记录
 * @param days    窗口天数，至少 1
 * @param now     注入「今天」，便于测试；默认当前时间
 */
export function buildDailyTrend(
  answers: readonly AnswerRecord[],
  days = 7,
  now: Date = new Date(),
): DailyPoint[] {
  const span = Math.max(1, Math.floor(days))
  const end = startOfLocalDay(now)
  const start = new Date(end)
  start.setDate(end.getDate() - (span - 1))

  const buckets = new Map<string, { correct: number; wrong: number }>()

  for (const answer of answers) {
    const at = new Date(answer.answeredAt)
    if (Number.isNaN(at.getTime())) continue

    const day = startOfLocalDay(at)
    if (day < start || day > end) continue

    const key = localDayKey(day)
    const bucket = buckets.get(key) ?? { correct: 0, wrong: 0 }
    if (answer.isCorrect) bucket.correct += 1
    else bucket.wrong += 1
    buckets.set(key, bucket)
  }

  const points: DailyPoint[] = []
  for (let i = 0; i < span; i++) {
    const day = new Date(start)
    day.setDate(start.getDate() + i)
    const key = localDayKey(day)
    const bucket = buckets.get(key) ?? { correct: 0, wrong: 0 }
    const total = bucket.correct + bucket.wrong

    points.push({
      day: key,
      label: `${day.getMonth() + 1}/${day.getDate()}`,
      correct: bucket.correct,
      wrong: bucket.wrong,
      total,
      rate: total === 0 ? 0 : bucket.correct / total,
    })
  }

  return points
}

/**
 * 各课程正确率聚合。
 *
 * 只返回「有作答记录」的课程，并按作答量降序（作答少的课程正确率噪声大，
 * 放在后面避免图表第一眼被 1/1 = 100% 的课程误导）。
 *
 * @param titles 课程 id → 标题；课程可能已被删除，取不到时回退显示 id
 */
export function buildCourseAccuracy(
  answers: readonly AnswerRecord[],
  titles: ReadonlyMap<string, string> | Record<string, string>,
): CourseAccuracy[] {
  const buckets = new Map<string, { correct: number; total: number }>()

  for (const answer of answers) {
    const courseId = answer.courseId
    if (!courseId) continue

    const bucket = buckets.get(courseId) ?? { correct: 0, total: 0 }
    bucket.total += 1
    if (answer.isCorrect) bucket.correct += 1
    buckets.set(courseId, bucket)
  }

  const titleOf = (courseId: string): string | undefined =>
    titles instanceof Map
      ? titles.get(courseId)
      : (titles as Record<string, string>)[courseId]

  return [...buckets.entries()]
    .map(([courseId, bucket]) => ({
      courseId,
      title: titleOf(courseId) ?? courseId,
      correct: bucket.correct,
      total: bucket.total,
      rate: bucket.correct / bucket.total,
    }))
    .sort((a, b) => b.total - a.total || b.rate - a.rate)
}

/** 汇总一段时间的答题数与正确率，用于图表标题旁的小字 */
export function summarizeAnswers(answers: readonly AnswerRecord[]): {
  total: number
  correct: number
  rate: number
} {
  const total = answers.length
  const correct = answers.filter((a) => a.isCorrect).length
  return { total, correct, rate: total === 0 ? 0 : correct / total }
}