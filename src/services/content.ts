/**
 * 内容数据服务
 * ---------------------------------------------------------------
 * 负责从 Supabase 读取课程 / 题目 / 勋章 / 历史事件 / 时间轴 / 博物馆，
 * 并把数据库行（snake_case）转换为应用层模型（camelCase）。
 *
 * 设计原则：**优雅降级**
 *   若 Supabase 未配置、数据库尚未迁移、或网络请求失败，
 *   则回退到 src/data/ 下的本地 mock 数据，保证页面始终可用。
 *   每次回退都会在控制台输出警告，便于排查。
 */

import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { CourseRow, QuestionRow, BadgeRow, TimelineEventRow } from '@/types/database'
import type { Lesson, Question, Badge, TimelineEvent } from '@/data/mockData'
import { mockBadges } from '@/data/mockData'
import type { HistoryEvent } from '@/data/chinaHistory'
import type { Museum, Artifact } from '@/data/museumData'
import type { HistoryEventRow, MuseumRow, ArtifactRow } from '@/types/database'

// ---------------------------------------------------------------------------
// 行 → 模型 映射
// ---------------------------------------------------------------------------

export function mapQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    content: row.content,
    type: row.type,
    options: Array.isArray(row.options) ? (row.options as string[]) : [],
    // 单选/连线题答案在库中存为 jsonb 数字或对象，这里统一取数字索引
    answer: typeof row.answer === 'number' ? row.answer : Number(row.answer ?? 0),
    explanation: row.explanation ?? undefined,
  }
}

export function mapLesson(course: CourseRow, questions: QuestionRow[]): Lesson {
  return {
    id: course.id,
    title: course.title,
    description: course.description ?? '',
    period: course.period ?? '',
    civilization: course.civilization ?? '',
    difficulty: course.difficulty,
    estimatedTime: course.estimated_time,
    coverImage: course.cover_image ?? undefined,
    questions: questions
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(mapQuestion),
  }
}

export function mapBadge(row: BadgeRow): Badge {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    icon: row.icon ?? '🏅',
    requirement: row.requirement ?? '',
  }
}

export function mapHistoryEvent(row: HistoryEventRow): HistoryEvent {
  return {
    id: row.id,
    title: row.title,
    period: row.period ?? '',
    year: row.year ?? '',
    dynasty: row.dynasty ?? '',
    category: (row.category ?? '社会') as HistoryEvent['category'],
    description: row.description ?? '',
    content: row.content ?? '',
    significance: row.significance ?? '',
    keywords: row.keywords ?? [],
    image: row.image ?? undefined,
    relatedEvents: row.related_events ?? [],
  }
}

export function mapTimelineEvent(row: TimelineEventRow): TimelineEvent {
  return {
    id: row.id,
    year: row.year ?? '',
    title: row.title,
    description: row.description ?? '',
    civilization: row.civilization ?? '',
    lessonId: row.lesson_id ?? undefined,
  }
}

export function mapArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.name_en ?? '',
    museumId: row.museum_id,
    period: row.period ?? '',
    civilization: row.civilization ?? '',
    material: row.material ?? '',
    dimensions: row.dimensions ?? '',
    description: row.description ?? '',
    detailedDescription: row.detailed_description ?? '',
    imageUrl: row.image_url ?? '',
    significance: row.significance ?? '',
  }
}

export function mapMuseum(row: MuseumRow, artifacts: ArtifactRow[]): Museum {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.name_en ?? '',
    location: row.location ?? '',
    country: row.country ?? '',
    established: row.established ?? '',
    description: row.description ?? '',
    coverImage: row.cover_image ?? '🏛️',
    artifacts: artifacts.map(mapArtifact),
  }
}

// ---------------------------------------------------------------------------
// 远程读取（带本地回退）
// ---------------------------------------------------------------------------

/** 统一的查询结果类型 */
export interface FetchResult<T> {
  data: T
  /** remote = 来自 Supabase；mock = 回退到本地数据 */
  source: 'remote' | 'mock'
  error?: string
}

function fallback<T>(label: string, data: T, error: unknown): FetchResult<T> {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[content] 读取 ${label} 失败，回退到本地 mock 数据：${message}`)
  return { data, source: 'mock', error: message }
}

/** 是否应当尝试远程读取 */
function canUseRemote(): boolean {
  return isSupabaseConfigured
}

/**
 * 读取全部课程（含题目）
 */
export async function fetchLessons(fallbackData: Lesson[]): Promise<FetchResult<Lesson[]>> {
  if (!canUseRemote()) return { data: fallbackData, source: 'mock' }

  try {
    const [coursesRes, questionsRes] = await Promise.all([
      supabase.from('courses').select('*').order('sort_order', { ascending: true }),
      supabase.from('questions').select('*').order('sort_order', { ascending: true }),
    ])

    if (coursesRes.error) throw coursesRes.error
    if (questionsRes.error) throw questionsRes.error
    if (!coursesRes.data?.length) {
      return { data: fallbackData, source: 'mock', error: '数据库课程表为空' }
    }

    const questionsByCourse = new Map<string, QuestionRow[]>()
    for (const q of questionsRes.data) {
      const list = questionsByCourse.get(q.course_id) ?? []
      list.push(q)
      questionsByCourse.set(q.course_id, list)
    }

    const data = coursesRes.data.map((c) => mapLesson(c, questionsByCourse.get(c.id) ?? []))
    return { data, source: 'remote' }
  } catch (error) {
    return fallback('courses', fallbackData, error)
  }
}

/**
 * 读取全部勋章定义
 */
export async function fetchBadges(): Promise<FetchResult<Badge[]>> {
  if (!canUseRemote()) return { data: mockBadges, source: 'mock' }

  try {
    const { data, error } = await supabase
      .from('badges')
      .select('*')
      .order('sort_order', { ascending: true })

    if (error) throw error
    if (!data?.length) return { data: mockBadges, source: 'mock', error: '数据库勋章表为空' }

    return { data: data.map(mapBadge), source: 'remote' }
  } catch (error) {
    return fallback('badges', mockBadges, error)
  }
}

/**
 * 读取历史事件库
 */
export async function fetchHistoryEvents(
  fallbackData: HistoryEvent[],
): Promise<FetchResult<HistoryEvent[]>> {
  if (!canUseRemote()) return { data: fallbackData, source: 'mock' }

  try {
    const { data, error } = await supabase
      .from('history_events')
      .select('*')
      .order('year', { ascending: true })

    if (error) throw error
    if (!data?.length) return { data: fallbackData, source: 'mock', error: '数据库事件表为空' }

    return { data: data.map(mapHistoryEvent), source: 'remote' }
  } catch (error) {
    return fallback('history_events', fallbackData, error)
  }
}

/**
 * 读取时间轴节点
 */
export async function fetchTimelineEvents(
  track: 'china' | 'world',
  fallbackData: TimelineEvent[],
): Promise<FetchResult<TimelineEvent[]>> {
  if (!canUseRemote()) return { data: fallbackData, source: 'mock' }

  try {
    const { data, error } = await supabase
      .from('timeline_events')
      .select('*')
      .eq('track', track)
      .order('sort_order', { ascending: true })

    if (error) throw error
    if (!data?.length) return { data: fallbackData, source: 'mock', error: `${track} 时间轴为空` }

    return { data: data.map(mapTimelineEvent), source: 'remote' }
  } catch (error) {
    return fallback('timeline_events', fallbackData, error)
  }
}

/**
 * 读取博物馆（含文物）
 */
export async function fetchMuseums(
  fallbackData: Museum[],
): Promise<FetchResult<Museum[]>> {
  if (!canUseRemote()) return { data: fallbackData, source: 'mock' }

  try {
    const [museumsRes, artifactsRes] = await Promise.all([
      supabase.from('museums').select('*'),
      supabase.from('artifacts').select('*'),
    ])

    if (museumsRes.error) throw museumsRes.error
    if (artifactsRes.error) throw artifactsRes.error
    if (!museumsRes.data?.length) {
      return { data: fallbackData, source: 'mock', error: '数据库博物馆表为空' }
    }

    const byMuseum = new Map<string, ArtifactRow[]>()
    for (const a of artifactsRes.data) {
      const list = byMuseum.get(a.museum_id) ?? []
      list.push(a)
      byMuseum.set(a.museum_id, list)
    }

    const data = museumsRes.data.map((m) => mapMuseum(m, byMuseum.get(m.id) ?? []))
    return { data, source: 'remote' }
  } catch (error) {
    return fallback('museums', fallbackData, error)
  }
}

// 进度相关的读取/写入见 src/services/progress.ts
