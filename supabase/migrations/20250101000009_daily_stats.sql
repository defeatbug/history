-- ============================================================================
-- HistoriaQuest — 后台支持（四）：按天聚合的答题统计
-- Migration: 20250101000009_daily_stats
--
-- 背景：
--   学习统计页要画「近 N 天答题活跃度」。若前端直接拉 user_answers 再自行分组，
--   数据量随使用增长会越来越慢，而且每个管理员打开页面都要重复聚合。
--
--   把聚合下沉到数据库：视图只返回「一天一行」的结果，
--   前端拉 14 行即可，与总答题量无关。
-- ============================================================================

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
  '按天聚合的答题统计（一天一行），供后台活跃度图表使用；按东八区切分日期';

grant select on public.daily_answer_stats to authenticated;

-- ---------------------------------------------------------------------------
-- 学生整体概览（一行汇总，供统计带的四个数字使用）
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

  -- 正确率只对「答过题」的学生求平均。
  -- 若把从未答题的学生（correct_rate 默认为 0）也算进来，
  -- 平均正确率会被稀释成一个没有意义的低值。
  coalesce(
    round((avg(correct_rate) filter (where answered_count > 0))::numeric, 4),
    0
  )                                                              as avg_correct_rate,

  -- 同时给出参与平均的人数，避免 UI 把「1 人的正确率」当成全体的
  count(*) filter (where answered_count > 0)                     as correct_rate_sample_size,

  coalesce(sum(answered_count), 0)                               as total_answers,
  coalesce(sum(wrong_count), 0)                                  as total_wrong
from public.student_progress_view;

comment on view public.student_overview_view is
  '学生整体概览（一行），供后台统计带使用';

grant select on public.student_overview_view to authenticated;
