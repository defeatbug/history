-- ============================================================================
-- HistoriaQuest — 错题本需要的统计字段
-- Migration: 20250101000005_answer_stats
--
-- 背景：
--   user_answers 在 P1-1 已预埋 SM-2 间隔重复字段
--   （ease_factor / interval_days / repetitions / next_review_at），
--   但错题本还需要知道「这题错过多少次」「连续答对几次」。
--
-- 语义约定：
--   is_correct     最近一次是否答对
--   wrong_count    累计答错次数（只增不减，用于统计与错题本筛选）
--   correct_streak 连续答对次数（答错即归零，用于判定「已掌握」）
-- ============================================================================

alter table public.user_answers
  add column if not exists wrong_count int not null default 0,
  add column if not exists correct_streak int not null default 0;

comment on column public.user_answers.wrong_count    is '累计答错次数（只增不减）';
comment on column public.user_answers.correct_streak is '连续答对次数（答错归零）';

-- ---------------------------------------------------------------------------
-- 错题本查询索引：找出「错过」的题
-- ---------------------------------------------------------------------------
create index if not exists idx_user_answers_wrong_book
  on public.user_answers (user_id, wrong_count desc, answered_at desc)
  where wrong_count > 0;

-- ---------------------------------------------------------------------------
-- 复习队列索引：按到期时间取待复习题
-- ---------------------------------------------------------------------------
create index if not exists idx_user_answers_due
  on public.user_answers (user_id, next_review_at)
  where next_review_at is not null;

-- ---------------------------------------------------------------------------
-- 视图：错题本（关联题目内容，避免前端二次查询）
--
-- 注意：视图使用 security_invoker，使查询走调用者权限，
--       从而自动继承 user_answers 的 RLS 策略（不会越权读他人错题）。
-- ---------------------------------------------------------------------------
drop view if exists public.wrong_answers_view;

create view public.wrong_answers_view
with (security_invoker = true)
as
select
  ua.user_id,
  ua.question_id,
  ua.user_answer,
  ua.is_correct,
  ua.wrong_count,
  ua.correct_streak,
  ua.ease_factor,
  ua.interval_days,
  ua.repetitions,
  ua.next_review_at,
  ua.answered_at,
  q.content        as question_content,
  q.type           as question_type,
  q.options        as question_options,
  q.answer         as question_answer,
  q.explanation    as question_explanation,
  q.course_id,
  c.title          as course_title
from public.user_answers ua
join public.questions q on q.id = ua.question_id
left join public.courses c on c.id = q.course_id
where ua.wrong_count > 0;

comment on view public.wrong_answers_view is '错题本视图：错过至少一次的题目及其掌握状态';
