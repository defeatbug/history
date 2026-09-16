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
