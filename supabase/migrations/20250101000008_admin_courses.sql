-- ============================================================================
-- HistoriaQuest — 后台支持（三）：课程管理视图
-- Migration: 20250101000008_admin_courses
--
-- 背景：
--   后台课程看板的每张卡片需要显示「影响面」—— 也就是这门课被多少学生
--   学过、产生了多少答题记录。这正是本界面的核心想法（THESIS）：
--   影响面常驻在卡片上，而不是等点删除才提示。
--
--   若不做视图，前端要发三次查询再自行聚合（N+1），且分页时会算错。
-- ============================================================================

drop view if exists public.course_admin_view;

create view public.course_admin_view
with (security_invoker = true)
as
select
  c.id,
  c.title,
  c.description,
  c.period,
  c.civilization,
  c.difficulty,
  c.estimated_time,
  c.cover_image,
  c.cover_url,
  c.sort_order,
  c.created_at,
  c.updated_at,

  -- 题目数
  coalesce(q.question_count, 0)          as question_count,
  coalesce(q.questions_without_explanation, 0) as questions_without_explanation,

  -- 影响面：有多少学生的 completed_lessons 里含这门课
  coalesce(up.student_completed_count, 0) as student_completed_count,
  coalesce(up.student_answered_count, 0)   as student_answered_count,
  coalesce(ans.answer_record_count, 0)     as answer_record_count

from public.courses c
left join (
  select
    course_id,
    count(*)                                                   as question_count,
    count(*) filter (where explanation is null or explanation = '') as questions_without_explanation
  from public.questions
  group by course_id
) q on q.course_id = c.id
left join (
  -- 学生完成数 / 有做题记录的学生数
  select
    lesson_id,
    count(*)                              as student_completed_count,
    count(*)                              as student_answered_count
  from (
    select unnest(completed_lessons) as lesson_id, user_id
    from public.user_progress
  ) t
  group by lesson_id
) up on up.lesson_id = c.id
left join (
  -- 该课程下题目的答题记录总数
  select q2.course_id, count(ua.id) as answer_record_count
  from public.questions q2
  join public.user_answers ua on ua.question_id = q2.id
  group by q2.course_id
) ans on ans.course_id = c.id;

comment on view public.course_admin_view is
  '课程管理视图：含题目数、学生完成数、答题记录数（影响面），供后台看板使用';

grant select on public.course_admin_view to authenticated;
