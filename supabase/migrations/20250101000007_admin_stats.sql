-- ============================================================================
-- HistoriaQuest — 后台支持（二）：学习统计的读权限 + 引用完整性
-- Migration: 20250101000007_admin_stats
--
-- 内容：
--   1. 允许管理员读取全部学生的学习数据（学生仍只能读自己）
--   2. 修复「删除课程后完成率超过 100%」的引用完整性缺陷
--   3. 建立学生进度视图，供后台列表一次查询到位
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 管理员读权限
--
--    设计原则：**不放宽原有策略，而是新增一条独立的管理员策略**。
--    PostgreSQL 的多个 permissive 策略是「或」的关系，因此：
--      学生 → 命中 user_progress_owner_select（auth.uid() = user_id）
--      管理员 → 命中 user_progress_admin_read（is_admin()）
--    原有策略一字未改，学生侧的隔离强度不变。
-- ---------------------------------------------------------------------------
drop policy if exists user_progress_admin_read on public.user_progress;
create policy user_progress_admin_read
  on public.user_progress for select
  to authenticated
  using (public.is_admin());

drop policy if exists user_answers_admin_read on public.user_answers;
create policy user_answers_admin_read
  on public.user_answers for select
  to authenticated
  using (public.is_admin());

-- 管理员可读用户勋章记录（用于统计）
drop policy if exists user_badges_admin_read on public.user_badges;
create policy user_badges_admin_read
  on public.user_badges for select
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. 引用完整性：删除课程时清理悬空的 completed_lessons
--
--    问题背景：
--      user_progress.completed_lessons 是 text[]，**无法建立外键**。
--      删除课程后数组里会留下已不存在的 id，导致后台统计出现
--      「已完成 14 门 / 共 13 门 = 108%」这类不可能的数字。
--
--    解决方式：在数据库层用触发器维护，而不是依赖前端每次查询时过滤。
--    这样无论内容从后台删除、还是直接执行 SQL，数据都是一致的。
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_completed_lesson()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.user_progress
     set completed_lessons = array_remove(completed_lessons, old.id)
   where old.id = any (completed_lessons);

  return old;
end;
$$;

comment on function public.cleanup_completed_lesson() is
  '课程被删除时，从所有用户的 completed_lessons 中移除该课程 id';

drop trigger if exists trg_cleanup_completed_lesson on public.courses;
create trigger trg_cleanup_completed_lesson
  after delete on public.courses
  for each row execute function public.cleanup_completed_lesson();

-- ---------------------------------------------------------------------------
-- 3. 学生进度视图
--
--    后台需要「一行一个学生」的汇总：完成课程数、学习时长、正确率、
--    最后活跃时间、错题数、已获勋章数。
--    用视图而不是多次查询，避免前端做 N+1。
--
--    security_invoker：视图按调用者权限执行，自动继承底层表的 RLS
--    （学生调用时只能看到自己那一行，管理员能看到全部）。
-- ---------------------------------------------------------------------------
drop view if exists public.student_progress_view;

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
  -- 答题统计
  coalesce(a.answered_count, 0)            as answered_count,
  coalesce(a.wrong_unique_count, 0)        as wrong_count,
  coalesce(a.correct_count, 0)             as correct_count,
  -- 勋章
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
where p.role = 'student';   -- 管理员不计入学生统计

comment on view public.student_progress_view is
  '学生进度汇总（一行一个学生），供后台学习统计使用；继承 RLS，学生只能看到自己';

grant select on public.student_progress_view to authenticated;
