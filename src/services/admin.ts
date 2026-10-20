/**
 * 后台管理数据服务
 * ----------------------------------------------------------------------------
 * 与面向学生的 src/services/content.ts 分开：
 *   content.ts  只读、走公开内容表、无需权限
 *   admin.ts    读写、依赖 is_admin() 策略、含影响面统计
 *
 * 影响面（某门课影响多少学生数据）由 course_admin_view 一次查出，
 * 避免前端多次查询后自行聚合。
 */

import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { canPersist } from './progress'
import { nextNumberedId, nextArtifactId } from '@/utils/idSequence'

export type Difficulty = 'beginner' | 'intermediate' | 'advanced'

/** 后台课程卡片所需的全部字段（含影响面） */
export interface AdminCourse {
  id: string
  title: string
  description: string | null
  period: string | null
  civilization: string | null
  difficulty: Difficulty
  estimatedTime: number
  /** emoji 图标（未上传图片时的降级显示） */
  coverImage: string | null
  /** 真实封面图片 URL */
  coverUrl: string | null
  sortOrder: number
  questionCount: number
  questionsWithoutExplanation: number
  /** 影响面：有多少学生完成了这门课 */
  studentCompletedCount: number
  /** 影响面：这门课下产生多少条答题记录 */
  answerRecordCount: number
}

export const DIFFICULTY_META: Record<
  Difficulty,
  { label: string; accent: string; chip: string; dot: string }
> = {
  beginner: {
    label: '初级',
    accent: 'text-emerald-700',
    chip: 'bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
  },
  intermediate: {
    label: '中级',
    accent: 'text-amber-700',
    chip: 'bg-amber-50 text-amber-700',
    dot: 'bg-amber-500',
  },
  advanced: {
    label: '高级',
    accent: 'text-rose-700',
    chip: 'bg-rose-50 text-rose-700',
    dot: 'bg-rose-500',
  },
}

interface CourseAdminRow {
  id: string
  title: string
  description: string | null
  period: string | null
  civilization: string | null
  difficulty: string
  estimated_time: number | null
  cover_image: string | null
  cover_url: string | null
  sort_order: number | null
  question_count: number | null
  questions_without_explanation: number | null
  student_completed_count: number | null
  answer_record_count: number | null
}

function mapCourse(row: CourseAdminRow): AdminCourse {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    period: row.period,
    civilization: row.civilization,
    difficulty: (row.difficulty as Difficulty) ?? 'beginner',
    estimatedTime: row.estimated_time ?? 0,
    coverImage: row.cover_image,
    coverUrl: row.cover_url,
    sortOrder: row.sort_order ?? 0,
    questionCount: row.question_count ?? 0,
    questionsWithoutExplanation: row.questions_without_explanation ?? 0,
    studentCompletedCount: row.student_completed_count ?? 0,
    answerRecordCount: row.answer_record_count ?? 0,
  }
}

export interface AdminFetchResult<T> {
  data: T
  error?: string
}

/** 读取全部课程（含影响面统计），按难度与排序号排列 */
export async function fetchAdminCourses(userId: string): Promise<AdminFetchResult<AdminCourse[]>> {
  if (!isSupabaseConfigured || !canPersist(userId)) {
    return { data: [], error: '尚未登录或未配置 Supabase' }
  }

  try {
    const { data, error } = await supabase
      .from('course_admin_view')
      .select('*')
      .order('difficulty', { ascending: true })
      .order('sort_order', { ascending: true })

    if (error) throw error

    return { data: (data ?? []).map((r) => mapCourse(r as unknown as CourseAdminRow)) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取课程失败：', message)
    return { data: [], error: message }
  }
}

/**
 * 更新课程难度（看板拖拽的落地动作）。
 * 拖拽是直接操作，因此这里只改一个字段，不动其他内容。
 */
export async function updateCourseDifficulty(
  courseId: string,
  difficulty: Difficulty,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('courses')
      .update({ difficulty })
      .eq('id', courseId)

    if (error) throw error
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 更新难度失败：', message)
    return { ok: false, error: message }
  }
}

/** 更新课程排序号（同列内拖拽排序） */
export async function updateCourseOrder(
  orders: Array<{ id: string; sortOrder: number }>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // 逐条更新；课程数量在十位数级别，无需批量 RPC
    for (const { id, sortOrder } of orders) {
      const { error } = await supabase.from('courses').update({ sort_order: sortOrder }).eq('id', id)
      if (error) throw error
    }
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 更新排序失败：', message)
    return { ok: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// 概览统计（统计带用）
// ---------------------------------------------------------------------------

export interface AdminOverview {
  totalCourses: number
  totalQuestions: number
  /** 需要处理：缺解析的题 + 缺封面的课程 */
  needsAttention: number
  /** 有学习记录的学生数 */
  activeStudents: number
  /** 总答题记录数 */
  totalAnswers: number
}

export async function fetchAdminOverview(
  userId: string,
): Promise<AdminFetchResult<AdminOverview>> {
  const empty: AdminOverview = {
    totalCourses: 0,
    totalQuestions: 0,
    needsAttention: 0,
    activeStudents: 0,
    totalAnswers: 0,
  }

  if (!isSupabaseConfigured || !canPersist(userId)) {
    return { data: empty, error: '尚未登录' }
  }

  try {
    const [coursesRes, questionsRes, studentsRes] = await Promise.all([
      supabase.from('course_admin_view').select('id, question_count, questions_without_explanation, cover_url, cover_image'),
      supabase.from('questions').select('id', { count: 'exact', head: true }),
      supabase.from('student_progress_view').select('user_id, answered_count'),
    ])

    if (coursesRes.error) throw coursesRes.error

    const courses = coursesRes.data ?? []
    const totalCourses = courses.length
    const totalQuestions = questionsRes.count ?? 0

    const missingExplanation = courses.reduce(
      (n, c) => n + (c.questions_without_explanation ?? 0),
      0,
    )
    const missingCover = courses.filter((c) => !c.cover_url && !c.cover_image).length
    const noQuestions = courses.filter((c) => (c.question_count ?? 0) === 0).length

    const students = studentsRes.data ?? []
    const activeStudents = students.filter((s) => (s.answered_count ?? 0) > 0).length
    const totalAnswers = students.reduce((n, s) => n + (s.answered_count ?? 0), 0)

    return {
      data: {
        totalCourses,
        totalQuestions,
        needsAttention: missingExplanation + missingCover + noQuestions,
        activeStudents,
        totalAnswers,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取概览失败：', message)
    return { data: empty, error: message }
  }
}

// ---------------------------------------------------------------------------
// 课程 CRUD
// ---------------------------------------------------------------------------

/** 课程表单数据（与界面字段一一对应） */
export interface CourseFormData {
  title: string
  description: string
  period: string
  civilization: string
  difficulty: Difficulty
  estimatedTime: number
  /** emoji 图标，未上传图片时的降级显示 */
  coverImage: string
  /** 真实封面图片 URL */
  coverUrl: string | null
}

/** 把表单数据转成数据库行 */
function toCourseRow(data: CourseFormData) {
  return {
    title: data.title.trim(),
    description: data.description.trim() || null,
    period: data.period.trim() || null,
    civilization: data.civilization.trim() || null,
    difficulty: data.difficulty,
    estimated_time: Number.isFinite(data.estimatedTime) ? Math.max(0, data.estimatedTime) : 0,
    cover_image: data.coverImage.trim() || null,
    cover_url: data.coverUrl?.trim() || null,
  }
}

/** 读取单门课程（含影响面统计） */
export async function fetchAdminCourse(
  userId: string,
  id: string,
): Promise<AdminFetchResult<AdminCourse | null>> {
  if (!isSupabaseConfigured || !canPersist(userId)) {
    return { data: null, error: '尚未登录或未配置 Supabase' }
  }

  try {
    const { data, error } = await supabase
      .from('course_admin_view')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) throw error
    return { data: data ? mapCourse(data as unknown as CourseAdminRow) : null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取课程失败：', message)
    return { data: null, error: message }
  }
}

/**
 * 生成下一个可用的课程 id。
 *
 * 内容表用业务可读主键（lesson-1、lesson-2…），因此新建时取现有最大值 +1，
 * 而不是用 UUID —— 保持主键可读，便于在数据库里直接看懂。
 */
export async function generateCourseId(): Promise<string> {
  try {
    const { data } = await supabase.from('courses').select('id')
    const maxN = (data ?? []).reduce((max, row) => {
      const m = /^lesson-(\d+)$/.exec(row.id)
      return m ? Math.max(max, Number(m[1])) : max
    }, 0)
    return `lesson-${maxN + 1}`
  } catch {
    // 兜底：用时间戳后缀，避免与现有 id 冲突
    return `lesson-${Date.now().toString(36)}`
  }
}

/** 新建课程 */
export async function createCourse(
  data: CourseFormData,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const id = await generateCourseId()

    // 放在该难度档的末尾
    const { data: sameLevel } = await supabase
      .from('courses')
      .select('sort_order')
      .eq('difficulty', data.difficulty)
    const nextOrder =
      (sameLevel ?? []).reduce((max, r) => Math.max(max, r.sort_order ?? 0), -1) + 1

    const { error } = await supabase
      .from('courses')
      .insert({ id, ...toCourseRow(data), sort_order: nextOrder })

    if (error) throw error
    return { ok: true, id }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 新建课程失败：', message)
    return { ok: false, error: message }
  }
}

/** 更新课程（不修改 sort_order —— 顺序由看板拖拽负责） */
export async function updateCourse(
  id: string,
  data: CourseFormData,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('courses').update(toCourseRow(data)).eq('id', id)
    if (error) throw error
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 更新课程失败：', message)
    return { ok: false, error: message }
  }
}

/**
 * 删除课程。
 *
 * ⚠️ 外键链是 CASCADE 串联的：courses → questions → user_answers。
 * 删除一门课会连带删除它的全部题目，以及所有学生在这门课上的答题记录
 * （错题本与 SM-2 复习计划一并消失）。
 *
 * 因此调用方**必须先展示影响面并要求二次确认**，不可直接调用。
 */
export async function deleteCourse(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('courses').delete().eq('id', id)
    if (error) throw error
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 删除课程失败：', message)
    return { ok: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// 题目 CRUD
//
// 题型策略：后台固定为单选题（multiple_choice）。
// 原因：前端 LessonDetail 目前只会把题目渲染成单选，
// 若后台允许配「填空 / 情境 / 连线」，管理员配了也显示不出来 ——
// 这与 badges 只读是同一个判断：不做前端支撑不了的能力。
// ---------------------------------------------------------------------------

export interface AdminQuestion {
  id: string
  courseId: string
  content: string
  options: string[]
  /** 正确答案索引（单选） */
  answer: number
  explanation: string | null
  sortOrder: number
}

export interface QuestionFormData {
  content: string
  options: string[]
  answer: number
  explanation: string
}

interface QuestionRow {
  id: string
  course_id: string
  content: string
  type: string
  options: unknown
  answer: unknown
  explanation: string | null
  sort_order: number | null
}

function mapQuestion(row: QuestionRow): AdminQuestion {
  return {
    id: row.id,
    courseId: row.course_id,
    content: row.content,
    options: Array.isArray(row.options) ? (row.options as string[]) : [],
    answer: typeof row.answer === 'number' ? row.answer : Number(row.answer ?? 0),
    explanation: row.explanation,
    sortOrder: row.sort_order ?? 0,
  }
}

/** 读取某门课的全部题目，按 sort_order 排列 */
export async function fetchAdminQuestions(
  userId: string,
  courseId: string,
): Promise<AdminFetchResult<AdminQuestion[]>> {
  if (!isSupabaseConfigured || !canPersist(userId)) {
    return { data: [], error: '尚未登录或未配置 Supabase' }
  }

  try {
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('course_id', courseId)
      .order('sort_order', { ascending: true })

    if (error) throw error
    return { data: (data ?? []).map((r) => mapQuestion(r as unknown as QuestionRow)) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取题目失败：', message)
    return { data: [], error: message }
  }
}

/** 读取单道题目 */
export async function fetchAdminQuestion(
  userId: string,
  id: string,
): Promise<AdminFetchResult<AdminQuestion | null>> {
  if (!isSupabaseConfigured || !canPersist(userId)) {
    return { data: null, error: '尚未登录或未配置 Supabase' }
  }

  try {
    const { data, error } = await supabase.from('questions').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    return { data: data ? mapQuestion(data as unknown as QuestionRow) : null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取题目失败：', message)
    return { data: null, error: message }
  }
}

/**
 * 生成下一道题的 id。
 *
 * 现有数据用 `q<课程号>-<题号>` 的形式（如 q1-3），这里沿用同一约定，
 * 保持主键可读，便于在数据库里直接看懂某题属于哪门课。
 */
export async function generateQuestionId(courseId: string): Promise<string> {
  const courseNum = /^lesson-(\d+)$/.exec(courseId)?.[1] ?? courseId

  try {
    const { data } = await supabase.from('questions').select('id').eq('course_id', courseId)
    const maxN = (data ?? []).reduce((max, row) => {
      const m = /^q\d+-(\d+)$/.exec(row.id)
      return m ? Math.max(max, Number(m[1])) : max
    }, 0)
    return `q${courseNum}-${maxN + 1}`
  } catch {
    return `q${courseNum}-${Date.now().toString(36)}`
  }
}

function toQuestionRow(data: QuestionFormData) {
  return {
    content: data.content.trim(),
    // 固定单选；题型字段保留以兼容既有数据
    type: 'multiple_choice' as const,
    options: data.options.map((o) => o.trim()).filter((o) => o.length > 0),
    answer: data.answer,
    explanation: data.explanation.trim() || null,
  }
}

/** 新建题目 */
export async function createQuestion(
  courseId: string,
  data: QuestionFormData,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const id = await generateQuestionId(courseId)

    const { data: existing } = await supabase
      .from('questions')
      .select('sort_order')
      .eq('course_id', courseId)
    const nextOrder = (existing ?? []).reduce((max, r) => Math.max(max, r.sort_order ?? 0), -1) + 1

    const { error } = await supabase
      .from('questions')
      .insert({ id, course_id: courseId, ...toQuestionRow(data), sort_order: nextOrder })

    if (error) throw error
    return { ok: true, id }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 新建题目失败：', message)
    return { ok: false, error: message }
  }
}

/** 更新题目（不改 sort_order，顺序由列表拖拽负责） */
export async function updateQuestion(
  id: string,
  data: QuestionFormData,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('questions').update(toQuestionRow(data)).eq('id', id)
    if (error) throw error
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 更新题目失败：', message)
    return { ok: false, error: message }
  }
}

/** 更新题目排序 */
export async function updateQuestionOrder(
  orders: Array<{ id: string; sortOrder: number }>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    for (const { id, sortOrder } of orders) {
      const { error } = await supabase.from('questions').update({ sort_order: sortOrder }).eq('id', id)
      if (error) throw error
    }
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 更新题目排序失败：', message)
    return { ok: false, error: message }
  }
}

/**
 * 删除题目。
 *
 * 与删除课程一样，外键 CASCADE 会连带删除学生在这道题上的答题记录
 * （含错题本条目与 SM-2 复习状态），因此调用方必须先展示影响面。
 */
export async function deleteQuestion(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('questions').delete().eq('id', id)
    if (error) throw error
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 删除题目失败：', message)
    return { ok: false, error: message }
  }
}

/** 统计某道题的作答影响面（多少学生答过、答错几次） */
export async function fetchQuestionImpact(
  questionId: string,
): Promise<{ answered: number; wrong: number; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('user_answers')
      .select('is_correct, wrong_count')
      .eq('question_id', questionId)

    if (error) throw error

    const rows = data ?? []
    return {
      answered: rows.length,
      wrong: rows.filter((r) => (r.wrong_count ?? 0) > 0).length,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取题目影响面失败：', message)
    return { answered: 0, wrong: 0, error: message }
  }
}

// ---------------------------------------------------------------------------
// 学习统计
//
// 隐私边界（PRODUCT.md 已确认）：后台只展示用户名，不展示邮箱等 PII；
// 且这一块**只读**，不提供任何修改学生数据或角色的入口。
// ---------------------------------------------------------------------------

export interface StudentSummary {
  userId: string
  username: string
  completedCount: number
  totalStudyTime: number
  correctRate: number
  currentStreak: number
  lastStudiedAt: string | null
  answeredCount: number
  wrongCount: number
  correctCount: number
  badgeCount: number
}

export interface StudentOverview {
  totalStudents: number
  activeStudents: number
  progressingStudents: number
  avgCompleted: number
  avgStudyMinutes: number
  avgCorrectRate: number
  /** 参与正确率平均的人数；为 0 时正确率无意义，UI 应显示占位符 */
  correctRateSampleSize: number
  totalAnswers: number
  totalWrong: number
}

export interface DailyActivity {
  day: string
  answerCount: number
  activeStudents: number
  correctCount: number
  wrongCount: number
}

interface StudentProgressRow {
  user_id: string
  username: string
  completed_count: number | null
  total_study_time: number | null
  correct_rate: number | string | null
  current_streak: number | null
  last_studied_at: string | null
  answered_count: number | null
  wrong_count: number | null
  correct_count: number | null
  badge_count: number | null
}

/** 读取学生列表（一行一个学生），按用户名排序 */
export async function fetchStudents(
  userId: string,
): Promise<AdminFetchResult<StudentSummary[]>> {
  if (!isSupabaseConfigured || !canPersist(userId)) {
    return { data: [], error: '尚未登录或未配置 Supabase' }
  }

  try {
    const { data, error } = await supabase
      .from('student_progress_view')
      .select('*')
      .order('username', { ascending: true })

    if (error) throw error

    return {
      data: (data ?? []).map((r) => {
        const row = r as unknown as StudentProgressRow
        return {
          userId: row.user_id,
          username: row.username,
          completedCount: row.completed_count ?? 0,
          totalStudyTime: row.total_study_time ?? 0,
          correctRate: Number(row.correct_rate ?? 0),
          currentStreak: row.current_streak ?? 0,
          lastStudiedAt: row.last_studied_at,
          answeredCount: row.answered_count ?? 0,
          wrongCount: row.wrong_count ?? 0,
          correctCount: row.correct_count ?? 0,
          badgeCount: row.badge_count ?? 0,
        }
      }),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取学生列表失败：', message)
    return { data: [], error: message }
  }
}

/** 读取学生整体概览 */
export async function fetchStudentOverview(
  userId: string,
): Promise<AdminFetchResult<StudentOverview>> {
  const empty: StudentOverview = {
    totalStudents: 0,
    activeStudents: 0,
    progressingStudents: 0,
    avgCompleted: 0,
    avgStudyMinutes: 0,
    avgCorrectRate: 0,
    correctRateSampleSize: 0,
    totalAnswers: 0,
    totalWrong: 0,
  }

  if (!isSupabaseConfigured || !canPersist(userId)) return { data: empty }

  try {
    const { data, error } = await supabase.from('student_overview_view').select('*').maybeSingle()
    if (error) throw error
    if (!data) return { data: empty }

    const row = data as unknown as Record<string, number | string | null>
    return {
      data: {
        totalStudents: Number(row.total_students ?? 0),
        activeStudents: Number(row.active_students ?? 0),
        progressingStudents: Number(row.progressing_students ?? 0),
        avgCompleted: Number(row.avg_completed ?? 0),
        avgStudyMinutes: Number(row.avg_study_minutes ?? 0),
        avgCorrectRate: Number(row.avg_correct_rate ?? 0),
        correctRateSampleSize: Number(row.correct_rate_sample_size ?? 0),
        totalAnswers: Number(row.total_answers ?? 0),
        totalWrong: Number(row.total_wrong ?? 0),
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取学生概览失败：', message)
    return { data: empty, error: message }
  }
}

/**
 * 读取近 N 天的答题活跃度。
 * 数据库已按天聚合，因此无论总答题量多少，这里最多只拉 N 行。
 */
export async function fetchDailyActivity(
  userId: string,
  days = 14,
): Promise<AdminFetchResult<DailyActivity[]>> {
  if (!isSupabaseConfigured || !canPersist(userId)) return { data: [] }

  try {
    const since = new Date()
    since.setDate(since.getDate() - (days - 1))
    const sinceIso = since.toISOString().slice(0, 10)

    const { data, error } = await supabase
      .from('daily_answer_stats')
      .select('*')
      .gte('day', sinceIso)
      .order('day', { ascending: true })

    if (error) throw error

    const byDay = new Map(
      (data ?? []).map((r) => {
        const row = r as unknown as Record<string, number | string>
        return [
          String(row.day),
          {
            day: String(row.day),
            answerCount: Number(row.answer_count ?? 0),
            activeStudents: Number(row.active_students ?? 0),
            correctCount: Number(row.correct_count ?? 0),
            wrongCount: Number(row.wrong_count ?? 0),
          },
        ]
      }),
    )

    // 补齐没有数据的日子，图表才不会断档
    const series: DailyActivity[] = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      series.push(
        byDay.get(key) ?? {
          day: key,
          answerCount: 0,
          activeStudents: 0,
          correctCount: 0,
          wrongCount: 0,
        },
      )
    }

    return { data: series }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取活跃度失败：', message)
    return { data: [], error: message }
  }
}

// ---------------------------------------------------------------------------
// 历史事件 CRUD
//
// 学生端的 HistoryStudy.vue 按朝代/类别分组展示，时间线内按年份从早到晚排；
// 后台的排序号（sort_order）决定事件库的整体展示顺序，拖拽维护。
// ---------------------------------------------------------------------------

/** 学生端 HistoryEvent 类别 —— 后台新建/编辑时只能选这六个 */
export const EVENT_CATEGORIES = ['政治', '文化', '战争', '科技', '经济', '社会'] as const

export interface AdminHistoryEvent {
  id: string
  title: string
  period: string | null
  year: string | null
  dynasty: string | null
  category: string | null
  description: string | null
  content: string | null
  significance: string | null
  keywords: string[]
  image: string | null
  relatedEvents: string[]
  sortOrder: number
}

export interface HistoryEventFormData {
  title: string
  period: string
  /** 年份原文，如 "前2070" / "618-907"，展示与排序（回填）都依赖它 */
  year: string
  dynasty: string
  category: string
  description: string
  content: string
  significance: string
  keywords: string[]
  image: string | null
  relatedEvents: string[]
}

interface HistoryEventRow {
  id: string
  title: string
  period: string | null
  year: string | null
  dynasty: string | null
  category: string | null
  description: string | null
  content: string | null
  significance: string | null
  keywords: string[] | null
  image: string | null
  related_events: string[] | null
  sort_order: number | null
}

function mapHistoryEvent(row: HistoryEventRow): AdminHistoryEvent {
  return {
    id: row.id,
    title: row.title,
    period: row.period,
    year: row.year,
    dynasty: row.dynasty,
    category: row.category,
    description: row.description,
    content: row.content,
    significance: row.significance,
    keywords: row.keywords ?? [],
    image: row.image,
    relatedEvents: row.related_events ?? [],
    sortOrder: row.sort_order ?? 0,
  }
}

/** 读取全部历史事件，按 sort_order 排列 */
export async function fetchAdminEvents(
  userId: string,
): Promise<AdminFetchResult<AdminHistoryEvent[]>> {
  if (!isSupabaseConfigured || !canPersist(userId)) {
    return { data: [], error: '尚未登录或未配置 Supabase' }
  }

  try {
    const { data, error } = await supabase
      .from('history_events')
      .select('*')
      .order('sort_order', { ascending: true })

    if (error) throw error
    return { data: (data ?? []).map((r) => mapHistoryEvent(r as unknown as HistoryEventRow)) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取历史事件失败：', message)
    return { data: [], error: message }
  }
}

/** 读取单个历史事件 */
export async function fetchAdminEvent(
  userId: string,
  id: string,
): Promise<AdminFetchResult<AdminHistoryEvent | null>> {
  if (!isSupabaseConfigured || !canPersist(userId)) {
    return { data: null, error: '尚未登录或未配置 Supabase' }
  }

  try {
    const { data, error } = await supabase
      .from('history_events')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) throw error
    return { data: data ? mapHistoryEvent(data as unknown as HistoryEventRow) : null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取历史事件失败：', message)
    return { data: null, error: message }
  }
}

/**
 * 生成下一个事件 id：event-<最大号+1>。
 * 纯序号逻辑见 src/utils/idSequence.ts（可单测），这里只负责查现有 id。
 */
export async function generateEventId(): Promise<string> {
  try {
    const { data } = await supabase.from('history_events').select('id')
    return nextNumberedId(
      (data ?? []).map((r) => (r as { id: string }).id),
      /^event-(\d+)$/,
      (n) => `event-${n}`,
    )
  } catch {
    return `event-${Date.now().toString(36)}`
  }
}

function toHistoryEventRow(data: HistoryEventFormData) {
  return {
    title: data.title.trim(),
    period: data.period.trim() || null,
    year: data.year.trim() || null,
    dynasty: data.dynasty.trim() || null,
    // 类别固定六选一（学生端 HistoryEvent 类型只认识这六个），
    // 界面用下拉约束，这里做最后一道兜底。
    category: EVENT_CATEGORIES.includes(data.category as (typeof EVENT_CATEGORIES)[number])
      ? data.category
      : '社会',
    description: data.description.trim() || null,
    content: data.content.trim() || null,
    significance: data.significance.trim() || null,
    keywords: data.keywords.map((k) => k.trim()).filter((k) => k.length > 0),
    image: data.image?.trim() || null,
    related_events: data.relatedEvents,
  }
}

/** 新建历史事件（追加到列表末尾） */
export async function createHistoryEvent(
  data: HistoryEventFormData,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const id = await generateEventId()

    const { data: existing } = await supabase.from('history_events').select('sort_order')
    const nextOrder = (existing ?? []).reduce(
      (max, r) => Math.max(max, (r as { sort_order: number | null }).sort_order ?? 0),
      -1,
    ) + 1

    const { error } = await supabase
      .from('history_events')
      .insert({ id, ...toHistoryEventRow(data), sort_order: nextOrder })

    if (error) throw error
    return { ok: true, id }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 新建历史事件失败：', message)
    return { ok: false, error: message }
  }
}

/** 更新历史事件（不改 sort_order，顺序由列表拖拽负责） */
export async function updateHistoryEvent(
  id: string,
  data: HistoryEventFormData,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('history_events')
      .update(toHistoryEventRow(data))
      .eq('id', id)
    if (error) throw error
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 更新历史事件失败：', message)
    return { ok: false, error: message }
  }
}

/** 更新历史事件排序 */
export async function updateEventOrder(
  orders: Array<{ id: string; sortOrder: number }>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    for (const { id, sortOrder } of orders) {
      const { error } = await supabase
        .from('history_events')
        .update({ sort_order: sortOrder })
        .eq('id', id)
      if (error) throw error
    }
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 更新事件排序失败：', message)
    return { ok: false, error: message }
  }
}

/**
 * 删除历史事件。
 *
 * 事件表与学生行为表没有外键关联，删除不会波及学习记录；
 * 但事件之间有 related_events 引用（知识图谱关联），
 * 被引用的事件被删后，引用方的「相关事件」会出现悬空 id ——
 * 因此调用方必须先展示影响面并要求二次确认。
 */
export async function deleteHistoryEvent(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('history_events').delete().eq('id', id)
    if (error) throw error
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 删除历史事件失败：', message)
    return { ok: false, error: message }
  }
}

/** 统计某个事件被多少其他事件的 related_events 引用 */
export async function fetchEventImpact(
  eventId: string,
): Promise<{ referencedBy: number; error?: string }> {
  try {
    const { count, error } = await supabase
      .from('history_events')
      .select('id', { count: 'exact', head: true })
      .neq('id', eventId)
      .contains('related_events', [eventId])

    if (error) throw error
    return { referencedBy: count ?? 0 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取事件影响面失败：', message)
    return { referencedBy: 0, error: message }
  }
}

// ---------------------------------------------------------------------------
// 博物馆 CRUD
//
// cover 语义与课程一致：cover_image 是 emoji（降级显示），
// cover_url 是上传的真实图片（优先显示）。
// ---------------------------------------------------------------------------

export interface AdminMuseum {
  id: string
  name: string
  nameEn: string | null
  location: string | null
  country: string | null
  established: string | null
  description: string | null
  coverImage: string | null
  coverUrl: string | null
  sortOrder: number
  /** 影响面：馆内文物数（删除博物馆会级联删除这些文物） */
  artifactCount: number
}

export interface MuseumFormData {
  name: string
  nameEn: string
  location: string
  country: string
  established: string
  description: string
  coverImage: string
  coverUrl: string | null
}

interface MuseumRow {
  id: string
  name: string
  name_en: string | null
  location: string | null
  country: string | null
  established: string | null
  description: string | null
  cover_image: string | null
  cover_url: string | null
  sort_order: number | null
}

function mapMuseum(row: MuseumRow, artifactCount = 0): AdminMuseum {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.name_en,
    location: row.location,
    country: row.country,
    established: row.established,
    description: row.description,
    coverImage: row.cover_image,
    coverUrl: row.cover_url,
    sortOrder: row.sort_order ?? 0,
    artifactCount,
  }
}

/** 读取全部博物馆（含馆内文物数），按 sort_order 排列 */
export async function fetchAdminMuseums(
  userId: string,
): Promise<AdminFetchResult<AdminMuseum[]>> {
  if (!isSupabaseConfigured || !canPersist(userId)) {
    return { data: [], error: '尚未登录或未配置 Supabase' }
  }

  try {
    const [museumsRes, artifactsRes] = await Promise.all([
      supabase.from('museums').select('*').order('sort_order', { ascending: true }),
      supabase.from('artifacts').select('museum_id'),
    ])

    if (museumsRes.error) throw museumsRes.error
    if (artifactsRes.error) throw artifactsRes.error

    const countByMuseum = new Map<string, number>()
    for (const a of artifactsRes.data ?? []) {
      const museumId = (a as { museum_id: string }).museum_id
      countByMuseum.set(museumId, (countByMuseum.get(museumId) ?? 0) + 1)
    }

    return {
      data: (museumsRes.data ?? []).map((r) =>
        mapMuseum(r as unknown as MuseumRow, countByMuseum.get((r as MuseumRow).id) ?? 0),
      ),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取博物馆失败：', message)
    return { data: [], error: message }
  }
}

/** 读取单个博物馆（含馆内文物数） */
export async function fetchAdminMuseum(
  userId: string,
  id: string,
): Promise<AdminFetchResult<AdminMuseum | null>> {
  if (!isSupabaseConfigured || !canPersist(userId)) {
    return { data: null, error: '尚未登录或未配置 Supabase' }
  }

  try {
    const { data, error } = await supabase.from('museums').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    if (!data) return { data: null }

    const impact = await fetchMuseumImpact(id)
    return { data: mapMuseum(data as unknown as MuseumRow, impact.artifactCount) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取博物馆失败：', message)
    return { data: null, error: message }
  }
}

/** 生成下一个博物馆 id：museum-<最大号+1> */
export async function generateMuseumId(): Promise<string> {
  try {
    const { data } = await supabase.from('museums').select('id')
    return nextNumberedId(
      (data ?? []).map((r) => (r as { id: string }).id),
      /^museum-(\d+)$/,
      (n) => `museum-${n}`,
    )
  } catch {
    return `museum-${Date.now().toString(36)}`
  }
}

function toMuseumRow(data: MuseumFormData) {
  return {
    name: data.name.trim(),
    name_en: data.nameEn.trim() || null,
    location: data.location.trim() || null,
    country: data.country.trim() || null,
    established: data.established.trim() || null,
    description: data.description.trim() || null,
    cover_image: data.coverImage.trim() || null,
    cover_url: data.coverUrl?.trim() || null,
  }
}

/** 新建博物馆（追加到列表末尾） */
export async function createMuseum(
  data: MuseumFormData,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const id = await generateMuseumId()

    const { data: existing } = await supabase.from('museums').select('sort_order')
    const nextOrder = (existing ?? []).reduce(
      (max, r) => Math.max(max, (r as { sort_order: number | null }).sort_order ?? 0),
      -1,
    ) + 1

    const { error } = await supabase
      .from('museums')
      .insert({ id, ...toMuseumRow(data), sort_order: nextOrder })

    if (error) throw error
    return { ok: true, id }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 新建博物馆失败：', message)
    return { ok: false, error: message }
  }
}

/** 更新博物馆（不改 sort_order，顺序由列表拖拽负责） */
export async function updateMuseum(
  id: string,
  data: MuseumFormData,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('museums').update(toMuseumRow(data)).eq('id', id)
    if (error) throw error
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 更新博物馆失败：', message)
    return { ok: false, error: message }
  }
}

/** 更新博物馆排序 */
export async function updateMuseumOrder(
  orders: Array<{ id: string; sortOrder: number }>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    for (const { id, sortOrder } of orders) {
      const { error } = await supabase
        .from('museums')
        .update({ sort_order: sortOrder })
        .eq('id', id)
      if (error) throw error
    }
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 更新博物馆排序失败：', message)
    return { ok: false, error: message }
  }
}

/**
 * 删除博物馆。
 *
 * ⚠️ artifacts.museum_id 是 ON DELETE CASCADE：
 * 删除一座博物馆会连带删除它的全部文物记录。
 * 文物不关联学生行为数据，所以不影响学习记录，
 * 但内容本身不可恢复 —— 调用方必须先展示文物数并要求二次确认。
 */
export async function deleteMuseum(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('museums').delete().eq('id', id)
    if (error) throw error
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 删除博物馆失败：', message)
    return { ok: false, error: message }
  }
}

/** 统计某座博物馆的馆藏文物数（删除时会被级联删除） */
export async function fetchMuseumImpact(
  museumId: string,
): Promise<{ artifactCount: number; error?: string }> {
  try {
    const { count, error } = await supabase
      .from('artifacts')
      .select('id', { count: 'exact', head: true })
      .eq('museum_id', museumId)

    if (error) throw error
    return { artifactCount: count ?? 0 }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取博物馆影响面失败：', message)
    return { artifactCount: 0, error: message }
  }
}

// ---------------------------------------------------------------------------
// 文物 CRUD
//
// 文物挂在博物馆下，没有独立的展示入口；学生端随所属博物馆一起读取。
// 文物不关联任何学生行为数据，删除只影响内容本身。
// ---------------------------------------------------------------------------

export interface AdminArtifact {
  id: string
  museumId: string
  /** 所属博物馆名称（列表展示用，一次查询带出避免 N+1） */
  museumName: string
  name: string
  nameEn: string | null
  period: string | null
  civilization: string | null
  material: string | null
  dimensions: string | null
  description: string | null
  detailedDescription: string | null
  imageUrl: string | null
  significance: string | null
  sortOrder: number
}

export interface ArtifactFormData {
  museumId: string
  name: string
  nameEn: string
  period: string
  civilization: string
  material: string
  dimensions: string
  description: string
  detailedDescription: string
  imageUrl: string | null
  significance: string
}

interface ArtifactRow {
  id: string
  museum_id: string
  name: string
  name_en: string | null
  period: string | null
  civilization: string | null
  material: string | null
  dimensions: string | null
  description: string | null
  detailed_description: string | null
  image_url: string | null
  significance: string | null
  sort_order: number | null
}

function mapArtifact(row: ArtifactRow, museumName: string): AdminArtifact {
  return {
    id: row.id,
    museumId: row.museum_id,
    museumName,
    name: row.name,
    nameEn: row.name_en,
    period: row.period,
    civilization: row.civilization,
    material: row.material,
    dimensions: row.dimensions,
    description: row.description,
    detailedDescription: row.detailed_description,
    imageUrl: row.image_url,
    significance: row.significance,
    sortOrder: row.sort_order ?? 0,
  }
}

/**
 * 读取文物（可选按馆筛选），按 sort_order 排列。
 * 博物馆名一次查出拼上，避免每行再查一次。
 */
export async function fetchAdminArtifacts(
  userId: string,
  museumId?: string,
): Promise<AdminFetchResult<AdminArtifact[]>> {
  if (!isSupabaseConfigured || !canPersist(userId)) {
    return { data: [], error: '尚未登录或未配置 Supabase' }
  }

  try {
    let query = supabase.from('artifacts').select('*').order('sort_order', { ascending: true })
    if (museumId) query = query.eq('museum_id', museumId)

    const [artifactsRes, museumsRes] = await Promise.all([
      query,
      supabase.from('museums').select('id, name'),
    ])

    if (artifactsRes.error) throw artifactsRes.error
    if (museumsRes.error) throw museumsRes.error

    const nameByMuseum = new Map(
      (museumsRes.data ?? []).map((m) => {
        const row = m as { id: string; name: string }
        return [row.id, row.name] as const
      }),
    )

    return {
      data: (artifactsRes.data ?? []).map((r) => {
        const row = r as unknown as ArtifactRow
        return mapArtifact(row, nameByMuseum.get(row.museum_id) ?? row.museum_id)
      }),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取文物失败：', message)
    return { data: [], error: message }
  }
}

/** 读取单件文物 */
export async function fetchAdminArtifact(
  userId: string,
  id: string,
): Promise<AdminFetchResult<AdminArtifact | null>> {
  if (!isSupabaseConfigured || !canPersist(userId)) {
    return { data: null, error: '尚未登录或未配置 Supabase' }
  }

  try {
    const { data, error } = await supabase.from('artifacts').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    if (!data) return { data: null }

    const row = data as unknown as ArtifactRow
    const { data: museum } = await supabase
      .from('museums')
      .select('name')
      .eq('id', row.museum_id)
      .maybeSingle()
    const museumName = (museum as { name: string } | null)?.name ?? row.museum_id

    return { data: mapArtifact(row, museumName) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取文物失败：', message)
    return { data: null, error: message }
  }
}

/**
 * 生成下一件文物的 id：artifact-<馆号>-<该馆最大序号+1>。
 * 序号按馆隔离（见 src/utils/idSequence.ts 的 nextArtifactId）。
 */
export async function generateArtifactId(museumId: string): Promise<string> {
  try {
    const { data } = await supabase.from('artifacts').select('id').eq('museum_id', museumId)
    return nextArtifactId(
      museumId,
      (data ?? []).map((r) => (r as { id: string }).id),
    )
  } catch {
    return `artifact-${Date.now().toString(36)}`
  }
}

function toArtifactRow(data: ArtifactFormData) {
  return {
    museum_id: data.museumId,
    name: data.name.trim(),
    name_en: data.nameEn.trim() || null,
    period: data.period.trim() || null,
    civilization: data.civilization.trim() || null,
    material: data.material.trim() || null,
    dimensions: data.dimensions.trim() || null,
    description: data.description.trim() || null,
    detailed_description: data.detailedDescription.trim() || null,
    image_url: data.imageUrl?.trim() || null,
    significance: data.significance.trim() || null,
  }
}

/** 新建文物（追加到所属馆的文物末尾） */
export async function createArtifact(
  data: ArtifactFormData,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const id = await generateArtifactId(data.museumId)

    const { data: siblings } = await supabase
      .from('artifacts')
      .select('sort_order')
      .eq('museum_id', data.museumId)
    const nextOrder = (siblings ?? []).reduce(
      (max, r) => Math.max(max, (r as { sort_order: number | null }).sort_order ?? 0),
      -1,
    ) + 1

    const { error } = await supabase
      .from('artifacts')
      .insert({ id, ...toArtifactRow(data), sort_order: nextOrder })

    if (error) throw error
    return { ok: true, id }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 新建文物失败：', message)
    return { ok: false, error: message }
  }
}

/** 更新文物（不改 sort_order，顺序由列表拖拽负责） */
export async function updateArtifact(
  id: string,
  data: ArtifactFormData,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('artifacts').update(toArtifactRow(data)).eq('id', id)
    if (error) throw error
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 更新文物失败：', message)
    return { ok: false, error: message }
  }
}

/** 更新文物排序 */
export async function updateArtifactOrder(
  orders: Array<{ id: string; sortOrder: number }>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    for (const { id, sortOrder } of orders) {
      const { error } = await supabase
        .from('artifacts')
        .update({ sort_order: sortOrder })
        .eq('id', id)
      if (error) throw error
    }
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 更新文物排序失败：', message)
    return { ok: false, error: message }
  }
}

/**
 * 删除文物。
 *
 * 文物表没有指向学生行为表的外键，删除不影响任何学习记录，
 * 只移除内容本身 —— 但仍不可恢复，调用方需二次确认。
 */
export async function deleteArtifact(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('artifacts').delete().eq('id', id)
    if (error) throw error
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 删除文物失败：', message)
    return { ok: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// 勋章（只读列表 + 文案维护）
//
// PRODUCT.md 已否决「勋章解锁规则的图形化配置」：解锁逻辑维护在
// 数据库函数 evaluate_badges 内。后台只允许改 name / description 这两个
// 纯文案字段，不提供新建 / 删除 / 排序入口。
// ---------------------------------------------------------------------------

export interface AdminBadge {
  id: string
  name: string
  description: string | null
  /** 图标（只读展示） */
  icon: string | null
  /** 解锁条件说明（只读展示，规则本身在数据库函数里） */
  requirement: string | null
  sortOrder: number
}

interface BadgeRow {
  id: string
  name: string
  description: string | null
  icon: string | null
  requirement: string | null
  sort_order: number | null
}

/** 读取全部勋章，按 sort_order 排列 */
export async function fetchAdminBadges(
  userId: string,
): Promise<AdminFetchResult<AdminBadge[]>> {
  if (!isSupabaseConfigured || !canPersist(userId)) {
    return { data: [], error: '尚未登录或未配置 Supabase' }
  }

  try {
    const { data, error } = await supabase
      .from('badges')
      .select('*')
      .order('sort_order', { ascending: true })

    if (error) throw error

    return {
      data: (data ?? []).map((r) => {
        const row = r as unknown as BadgeRow
        return {
          id: row.id,
          name: row.name,
          description: row.description,
          icon: row.icon,
          requirement: row.requirement,
          sortOrder: row.sort_order ?? 0,
        }
      }),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 读取勋章失败：', message)
    return { data: [], error: message }
  }
}

/** 更新勋章文案（仅 name / description 可改） */
export async function updateBadgeText(
  id: string,
  data: { name: string; description: string },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('badges')
      .update({ name: data.name.trim(), description: data.description.trim() || null })
      .eq('id', id)
    if (error) throw error
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[admin] 更新勋章失败：', message)
    return { ok: false, error: message }
  }
}
