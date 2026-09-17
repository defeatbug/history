/**
 * Supabase 数据库类型定义
 * ---------------------------------------------------------------
 * 与 supabase/migrations/ 中的表结构一一对应。
 *
 * 维护方式（二选一）：
 *   1. 手工维护本文件（当前方式，可读性好、注释完整）
 *   2. 由 CLI 自动生成覆盖：
 *        supabase gen types typescript --linked > src/types/database.ts
 *
 * 字段命名遵循数据库的 snake_case；应用层模型见 src/data/mockData.ts，
 * 两者之间的转换由 src/services/content.ts 负责。
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

/** 表定义辅助类型：Row 显式声明，Insert/Update 由此派生 */
type Table<Row> = {
  Row: Row
  Insert: Partial<Row>
  Update: Partial<Row>
  Relationships: []
}

/** 视图定义辅助类型（视图只读，无 Insert/Update） */
type View<Row> = {
  Row: Row
  Relationships: []
}
// ---------------------------------------------------------------------------
// 行类型
// ---------------------------------------------------------------------------
export type ProfileRow = {
  id: string
  username: string
  avatar: string | null
  role: 'student' | 'admin'
  created_at: string
  updated_at: string
}
export type CourseRow = {
  id: string
  title: string
  description: string | null
  period: string | null
  civilization: string | null
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  estimated_time: number
  /** emoji 图标，未上传图片时的降级显示 */
  cover_image: string | null
  /** 真实封面图片 URL（P2-5 新增） */
  cover_url: string | null
  sort_order: number
  created_at: string
  updated_at: string
}
export type QuestionRow = {
  id: string
  course_id: string
  content: string
  type: 'multiple_choice' | 'matching' | 'scenario' | 'fill_blank'
  options: Json
  answer: Json
  explanation: string | null
  sort_order: number
  created_at: string
}
export type BadgeRow = {
  id: string
  name: string
  description: string | null
  icon: string | null
  requirement: string | null
  sort_order: number
}
export type HistoryEventRow = {
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
  related_events: string[]
}
export type TimelineEventRow = {
  id: string
  track: 'china' | 'world'
  year: string | null
  title: string
  description: string | null
  civilization: string | null
  lesson_id: string | null
  sort_order: number
}
export type MuseumRow = {
  id: string
  name: string
  name_en: string | null
  location: string | null
  country: string | null
  established: string | null
  description: string | null
  cover_image: string | null
  /** 真实封面图片 URL（P2-5 新增） */
  cover_url: string | null
}
export type ArtifactRow = {
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
}
export type UserProgressRow = {
  user_id: string
  completed_lessons: string[]
  total_study_time: number
  correct_rate: number
  current_streak: number
  last_lesson_id: string | null
  last_position: number
  last_studied_at: string | null
  updated_at: string
}
export type UserAnswerRow = {
  id: string
  user_id: string
  question_id: string
  user_answer: Json
  is_correct: boolean
  answered_at: string
  ease_factor: number
  interval_days: number
  repetitions: number
  next_review_at: string | null
  /** 累计答错次数（P2-1 新增） */
  wrong_count: number
  /** 连续答对次数，答错归零（P2-1 新增） */
  correct_streak: number
}

/** AI 调用用量记录（P1-4 新增） */
export type AiUsageRow = {
  id: string
  user_id: string
  model: string | null
  prompt_chars: number | null
  created_at: string
}
export type UserBadgeRow = {
  user_id: string
  badge_id: string
  unlocked_at: string
}
export type FriendshipRow = {
  id: string
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted' | 'blocked'
  created_at: string
  updated_at: string
}
export type PkMatchRow = {
  id: string
  challenger_id: string
  opponent_id: string | null
  status: 'waiting' | 'in_progress' | 'finished' | 'cancelled'
  challenger_score: number
  opponent_score: number
  question_ids: string[]
  created_at: string
  started_at: string | null
  finished_at: string | null
}

/** 错题本视图（P2-1 新增）：user_answers 关联 questions / courses */export type WrongAnswerViewRow = {
  user_id: string
  question_id: string
  user_answer: Json
  is_correct: boolean
  wrong_count: number
  correct_streak: number
  ease_factor: number
  interval_days: number
  repetitions: number
  next_review_at: string | null
  answered_at: string
  question_content: string
  question_type: string
  question_options: Json
  question_answer: Json
  question_explanation: string | null
  course_id: string
  course_title: string | null
}

/** 课程管理视图（P2-5 新增）：含题目数与影响面统计 */
export type CourseAdminViewRow = {
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
  created_at: string
  updated_at: string
  question_count: number | null
  questions_without_explanation: number | null
  student_completed_count: number | null
  student_answered_count: number | null
  answer_record_count: number | null
}

/** 学生进度视图（P2-5 新增）：一行一个学生，供后台学习统计 */
export type StudentProgressViewRow = {
  user_id: string
  username: string
  role: string
  joined_at: string
  completed_lessons: string[]
  completed_count: number
  total_study_time: number
  correct_rate: number
  current_streak: number
  last_studied_at: string | null
  answered_count: number
  wrong_count: number
  correct_count: number
  badge_count: number
}

/** 按天聚合的答题统计（P2-5 新增）：一天一行 */
export type DailyAnswerStatsRow = {
  day: string
  answer_count: number
  active_students: number
  correct_count: number
  wrong_count: number
}

/** 学生整体概览（P2-5 新增）：单行汇总 */
export type StudentOverviewViewRow = {
  total_students: number
  active_students: number
  progressing_students: number
  avg_completed: number | string
  avg_study_minutes: number | string
  avg_correct_rate: number | string
  /** 参与正确率平均的学生数（仅统计答过题的人） */
  correct_rate_sample_size: number
  total_answers: number
  total_wrong: number
}
// ---------------------------------------------------------------------------
// Database 根类型（供 createClient<Database> 使用）
// ---------------------------------------------------------------------------
export interface Database {
  public: {
    Tables: {
      profiles: Table<ProfileRow>
      courses: Table<CourseRow>
      questions: Table<QuestionRow>
      badges: Table<BadgeRow>
      history_events: Table<HistoryEventRow>
      timeline_events: Table<TimelineEventRow>
      museums: Table<MuseumRow>
      artifacts: Table<ArtifactRow>
      user_progress: Table<UserProgressRow>
      user_answers: Table<UserAnswerRow>
      user_badges: Table<UserBadgeRow>
      friendships: Table<FriendshipRow>
      pk_matches: Table<PkMatchRow>
      ai_usage: Table<AiUsageRow>
    }
    Views: {
      wrong_answers_view: View<WrongAnswerViewRow>
      course_admin_view: View<CourseAdminViewRow>
      student_progress_view: View<StudentProgressViewRow>
      daily_answer_stats: View<DailyAnswerStatsRow>
      student_overview_view: View<StudentOverviewViewRow>
    }
    Functions: {
      is_admin: {
        Args: Record<string, never>
        Returns: boolean
      }
      evaluate_badges: {
        Args: { p_user_id: string }
        Returns: string[]
      }
      ai_usage_count: {
        Args: { p_user_id: string; p_window_seconds?: number }
        Returns: number
      }
    }
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}