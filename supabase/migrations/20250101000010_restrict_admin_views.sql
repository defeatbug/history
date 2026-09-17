-- ============================================================================
-- HistoriaQuest — 安全加固：管理视图按「自己的 / 他人的」分级
-- Migration: 20250101000010_restrict_admin_views
--
-- 问题（实测发现）：
--   建这些视图时用的是 `grant select ... to authenticated`，
--   也就是「任何登录用户都能查」。实测后果：
--
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"<普通学生>"}';
--     select * from student_progress_view;
--     -- 返回 5 行（全部学生的用户名），进度指标被 RLS 归零
--
--   好消息：**学习数据本身没有泄露**。这些视图都是 security_invoker，
--   底层 user_progress / user_answers 的 RLS 生效，LEFT JOIN 对他人行
--   产出 NULL，被 coalesce 成 0。实测「演示用户」对学生显示 完成=0，
--   而真实值是 完成=2。
--
--   但仍有问题：学生能看到**全部学生的用户名名册**，
--   且看到「5 个学生进度全为 0」这种误导性结果。
--
-- 分级规则（本迁移确立）：
--
--   ┌────────────────────────────┬──────────────┬──────────────┐
--   │ 视图                       │ 管理员       │ 学生         │
--   ├────────────────────────────┼──────────────┼──────────────┤
--   │ student_progress_view      │ 全部学生     │ 仅自己那一行 │
--   │ daily_answer_stats         │ 全部活跃度   │ 仅自己的活跃 │
--   │ student_overview_view      │ 全班汇总     │ 0 行（见下） │
--   │ course_admin_view          │ 全部         │ 0 行         │
--   └────────────────────────────┴──────────────┴──────────────┘
--
--   为什么 student_overview_view 对学生返回 0 行：
--   它的语义是「**全班**平均正确率 / 平均完成课程数」。
--   对单个学生而言，这些数字要么恒等于他自己的值（没有参考意义），
--   要么会被误读为「我在班里的位置」。
--   学生想看自己的统计，应当读 student_progress_view 的自己那一行。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 学生进度视图：管理员看全部，学生看自己
-- ---------------------------------------------------------------------------
drop view if exists public.student_progress_view cascade;

create view public.student_progress_view
with (security_invoker = true)
as
select
  p.id                                    as user_id,
  p.username,
  p.role,
  p.created_at                            as joined_at,
  coalesce(up.completed_lessons, '{}')     as completed_lessons,
  coalesce(array_length(up.completed_lessons, 1), 0) as completed_count,
  coalesce(up.total_study_time, 0)         as total_study_time,
  coalesce(up.correct_rate, 0)             as correct_rate,
  coalesce(up.current_streak, 0)           as current_streak,
  up.last_studied_at,
  coalesce(a.answered_count, 0)            as answered_count,
  coalesce(a.wrong_unique_count, 0)        as wrong_count,
  coalesce(a.correct_count, 0)             as correct_count,
  coalesce(b.badge_count, 0)               as badge_count
from public.profiles p
left join public.user_progress up on up.user_id = p.id
left join (
  select
    user_id,
    count(*)                                        as answered_count,
    count(*) filter (where not is_correct)          as wrong_unique_count,
    count(*) filter (where is_correct)              as correct_count
  from public.user_answers
  group by user_id
) a on a.user_id = p.id
left join (
  select user_id, count(*) as badge_count
  from public.user_badges
  group by user_id
) b on b.user_id = p.id
where p.role = 'student'
  -- 关键分级：管理员看全部，学生只看自己
  and (public.is_admin() or p.id = auth.uid());

comment on view public.student_progress_view is
  '学生进度汇总（一行一个学生）：管理员可见全部，学生仅可见自己那一行';

-- ---------------------------------------------------------------------------
-- 2. 学生概览视图（全班汇总）
--
--    聚合自 student_progress_view，因此自动继承上面的分级；
--    但它是「全班」语义，对学生开放会被误读，故显式限制为管理员。
-- ---------------------------------------------------------------------------
drop view if exists public.student_overview_view cascade;

create view public.student_overview_view
with (security_invoker = true)
as
select
  count(*)                                                       as total_students,
  count(*) filter (where answered_count > 0)                     as active_students,
  count(*) filter (where completed_count > 0)                    as progressing_students,
  coalesce(round(avg(completed_count)::numeric, 2), 0)           as avg_completed,
  coalesce(round(avg(total_study_time)::numeric, 1), 0)          as avg_study_minutes,
  -- 正确率只对「答过题」的学生求平均，避免被未答题者的 0 稀释
  coalesce(
    round((avg(correct_rate) filter (where answered_count > 0))::numeric, 4),
    0
  )                                                              as avg_correct_rate,
  count(*) filter (where answered_count > 0)                     as correct_rate_sample_size,
  coalesce(sum(answered_count), 0)                               as total_answers,
  coalesce(sum(wrong_count), 0)                                  as total_wrong
from public.student_progress_view
-- 全班汇总语义，仅管理员可见。
--
-- 注意：这是**无 GROUP BY 的聚合查询**，WHERE 只能过滤输入行，
-- 即便一行都不匹配，count(*) 仍会返回一个全 0 的结果行。
-- 因此必须用 HAVING 才能真地对学生返回 0 行。
having public.is_admin();

comment on view public.student_overview_view is
  '学生整体概览（一行，全班汇总），仅管理员可见';

-- ---------------------------------------------------------------------------
-- 3. 按天答题统计
--
--    不加视图级过滤：底层 user_answers 的 RLS 已经做了正确的事 ——
--      管理员 → 命中 admin 读策略 → 看到全班的按天活跃度
--      学生   → 命中 owner 策略     → 只看到自己的按天活跃度
--    这对学生是有意义的（「我的学习曲线」），因此保留给学生。
-- ---------------------------------------------------------------------------
drop view if exists public.daily_answer_stats;

create view public.daily_answer_stats
with (security_invoker = true)
as
select
  (answered_at at time zone 'Asia/Shanghai')::date as day,
  count(*)                                          as answer_count,
  count(distinct user_id)                           as active_students,
  count(*) filter (where is_correct)                as correct_count,
  count(*) filter (where not is_correct)            as wrong_count
from public.user_answers
group by 1;

comment on view public.daily_answer_stats is
  '按天聚合的答题统计：管理员看到全班，学生只看到自己';

-- ---------------------------------------------------------------------------
-- 4. 课程管理视图（含跨学生的影响面统计）
--
--    「多少名学生学过这门课」是管理视角的指标，学生无需也不应看到，
--    因此限制为管理员。
-- ---------------------------------------------------------------------------
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
  coalesce(q.question_count, 0)                  as question_count,
  coalesce(q.questions_without_explanation, 0)   as questions_without_explanation,
  coalesce(up.student_completed_count, 0)        as student_completed_count,
  coalesce(up.student_answered_count, 0)         as student_answered_count,
  coalesce(ans.answer_record_count, 0)           as answer_record_count
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
  select lesson_id, count(*) as student_completed_count, count(*) as student_answered_count
  from (
    select unnest(completed_lessons) as lesson_id, user_id
    from public.user_progress
  ) t
  group by lesson_id
) up on up.lesson_id = c.id
left join (
  select q2.course_id, count(ua.id) as answer_record_count
  from public.questions q2
  join public.user_answers ua on ua.question_id = q2.id
  group by q2.course_id
) ans on ans.course_id = c.id
-- 管理工具，仅管理员可见
where public.is_admin();

comment on view public.course_admin_view is
  '课程管理视图（含题目数与跨学生影响面），仅管理员可见';

-- ---------------------------------------------------------------------------
-- 授权说明
--
-- 仍授予 authenticated：管理员本身就是 authenticated 角色。
-- 行级可见性由视图内的 is_admin() / auth.uid() 负责，而非 GRANT。
--
-- 注意：wrong_answers_view（错题本）**故意不在本迁移调整** ——
-- 它是学生自己的功能，底层 RLS 已保证只能看到自己的错题。
-- ---------------------------------------------------------------------------
grant select on public.student_progress_view to authenticated;
grant select on public.student_overview_view to authenticated;
grant select on public.daily_answer_stats to authenticated;
grant select on public.course_admin_view to authenticated;
