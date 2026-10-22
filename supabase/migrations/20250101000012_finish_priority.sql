-- ============================================================================
-- HistoriaQuest — 收尾修复（第三批）
-- Migration: 20250101000012_finish_priority
--
-- 内容：
--   1. related_events 引用一致性：删除历史事件时清理其他事件里的悬空 id
--   2. 连续学习天数：由 user_answers 的活动日期在数据库层计算并维护
--   3. 补全 4 枚此前永不触发的勋章判定规则（badge-4 / badge-7 / badge-8 / badge-9）
--
-- 设计说明：
--   * 连续天数由数据库维护，而不是前端：学生可能换设备、清缓存，只有
--     服务端才知道完整的答题日期。前端只负责展示，不再回写该字段。
--   * 日期边界按 Asia/Shanghai（目标用户所在时区）切分，避免 UTC 零点
--     把晚上 8 点的学习记到"前一天"。
--   * 引用清理用触发器实现，与迁移 07 的 cleanup_completed_lesson 保持同一
--     套做法：无论从后台删除还是直接执行 SQL，数据都保持一致。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. related_events 引用一致性
--
--    问题背景：
--      history_events.related_events 是 text[]，无法建立外键。删除一个事件后，
--      其他事件的 related_events 里会永久残留已不存在的 id。
--      后台虽然只在删除前统计"被几条引用"，但不会清理引用本身。
--
--    解决方式：数据库层触发器，在事件被删除后从所有引用方中移除该 id。
--    学生端渲染时也会再过滤一次（防御性渲染），两层保证不出现空关联。
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_related_event_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.history_events
     set related_events = array_remove(related_events, old.id)
   where old.id = any (related_events);

  return old;
end;
$$;

comment on function public.cleanup_related_event_reference() is
  '历史事件被删除时，从其他事件的 related_events 中移除该事件 id';

drop trigger if exists trg_cleanup_related_event on public.history_events;
create trigger trg_cleanup_related_event
  after delete on public.history_events
  for each row execute function public.cleanup_related_event_reference();

-- ---------------------------------------------------------------------------
-- 2. 连续学习天数（current_streak）
--
--    问题背景：
--      user_progress.current_streak 建表时就有，但从来没有任何地方写入，
--      因此首页/统计页的"连续学习 N 天"恒为 0，badge-4 也永远无法解锁。
--
--    计算口径：
--      * 只统计"有答题记录"的自然日（答一题即算当天学习过）；
--      * 连续 = 日期序列里无间断；
--      * 若最后一次学习是今天或昨天，连续记录仍然有效（今天还没开始学，
--        不应把昨天以前攒下的连续天数清零）；
--      * 超过一天没有学习，连续天数归零。
--
--    实现：把「最近学习日所在的连续区间」长度算出来。先取 distinct 日期，
--    再用 date - row_number() 把连续日期压成同一个 island，最后数 island 长度。
-- ---------------------------------------------------------------------------
create or replace function public.compute_streak(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  with days as (
    select distinct (ua.answered_at at time zone 'Asia/Shanghai')::date as d
      from public.user_answers ua
     where ua.user_id = p_user_id
  ),
  ranked as (
    select d, d - (row_number() over (order by d))::int as island
      from days
  ),
  last_day as (
    select max(d) as d from days
  )
  select coalesce((
    select count(*)::int
      from ranked r
     where r.island = (
             select r2.island
               from ranked r2, last_day l
              where r2.d = l.d
                and l.d >= (now() at time zone 'Asia/Shanghai')::date - 1
           )
  ), 0);
$$;

comment on function public.compute_streak(uuid) is
  '按 Asia/Shanghai 自然日计算某用户当前连续学习天数（0 表示已中断或从未学习）';

-- 只允许触发器内部调用，不通过 PostgREST 暴露成 RPC
revoke all on function public.compute_streak(uuid) from public;
revoke execute on function public.compute_streak(uuid) from anon, authenticated;

create or replace function public.refresh_streak_on_answer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_streak int;
begin
  v_streak := public.compute_streak(new.user_id);

  -- 用 upsert：新用户可能还没来得及生成 user_progress 行
  insert into public.user_progress (user_id, current_streak)
  values (new.user_id, v_streak)
  on conflict (user_id) do update
     set current_streak = excluded.current_streak,
         updated_at     = now();

  return new;
end;
$$;

comment on function public.refresh_streak_on_answer() is
  '答题记录写入后刷新 user_progress.current_streak';

drop trigger if exists trg_refresh_streak on public.user_answers;
create trigger trg_refresh_streak
  after insert or update of answered_at on public.user_answers
  for each row execute function public.refresh_streak_on_answer();

-- 回填存量用户：迁移前已有的答题记录也要有正确的连续天数
update public.user_progress up
   set current_streak = public.compute_streak(up.user_id)
 where exists (
   select 1 from public.user_answers ua where ua.user_id = up.user_id
 );

-- ---------------------------------------------------------------------------
-- 3. 勋章判定补全
--
--    问题背景：
--      badge-4（连续学习 7 天）、badge-7（文艺复兴）、badge-8（工业革命）、
--      badge-9（两次世界大战）在 evaluate_badges() 里没有任何判定分支，
--      数据库里有这 4 枚勋章的定义，但永远不可能解锁（10 枚里 4 枚是死勋章）。
--
--    判定口径：
--      * badge-4：current_streak >= 7（依赖本节上面的 streak 维护）
--      * badge-7/8/9：completed_lessons 中存在对应主题的课程。
--        用课程标题匹配而不是写死 lesson-id，后台新建课程时不会失效。
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_badges(p_user_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed_ids  text[];
  v_completed      int;
  v_total_lessons  int;
  v_total_time     int;
  v_correct_rate   numeric;
  v_streak         int;
  v_civilizations  int;
  v_diff_count     int;
  v_new_badges     text[] := '{}';
begin
  select completed_lessons,
         total_study_time,
         correct_rate,
         current_streak
    into v_completed_ids, v_total_time, v_correct_rate, v_streak
    from public.user_progress
   where user_id = p_user_id;

  v_completed_ids := coalesce(v_completed_ids, '{}');
  v_completed     := coalesce(array_length(v_completed_ids, 1), 0);
  v_total_time    := coalesce(v_total_time, 0);
  v_correct_rate  := coalesce(v_correct_rate, 0);
  v_streak        := coalesce(v_streak, 0);

  select count(*) into v_total_lessons from public.courses;

  -- 不同文明数量 & 不同难度数量
  select count(distinct c.civilization), count(distinct c.difficulty)
    into v_civilizations, v_diff_count
    from public.courses c
   where c.id = any (v_completed_ids);

  -- badge-1 历史初学者：完成任意一门
  if v_completed >= 1 then v_new_badges := array_append(v_new_badges, 'badge-1'); end if;
  -- badge-2 文明探索者：完成 3 门不同文明
  if v_civilizations >= 3 then v_new_badges := array_append(v_new_badges, 'badge-2'); end if;
  -- badge-3 完美答题者：单次课程正确率 100%
  if v_correct_rate >= 1 then v_new_badges := array_append(v_new_badges, 'badge-3'); end if;
  -- badge-4 连续学习者：连续学习 7 天
  if v_streak >= 7 then v_new_badges := array_append(v_new_badges, 'badge-4'); end if;
  -- badge-5 历史大师：完成所有课程
  if v_total_lessons > 0 and v_completed >= v_total_lessons then
    v_new_badges := array_append(v_new_badges, 'badge-5');
  end if;
  -- badge-6 时间旅行者：累计学习 600 分钟（10 小时）
  if v_total_time >= 600 then v_new_badges := array_append(v_new_badges, 'badge-6'); end if;
  -- badge-7 文艺复兴大师：完成文艺复兴与大航海时代课程
  if exists (
    select 1 from public.courses c
     where c.id = any (v_completed_ids) and c.title like '%文艺复兴%'
  ) then
    v_new_badges := array_append(v_new_badges, 'badge-7');
  end if;
  -- badge-8 工业先驱：完成工业革命与现代化课程
  if exists (
    select 1 from public.courses c
     where c.id = any (v_completed_ids) and c.title like '%工业革命%'
  ) then
    v_new_badges := array_append(v_new_badges, 'badge-8');
  end if;
  -- badge-9 战争史学者：完成两次世界大战课程
  if exists (
    select 1 from public.courses c
     where c.id = any (v_completed_ids) and c.title like '%世界大战%'
  ) then
    v_new_badges := array_append(v_new_badges, 'badge-9');
  end if;
  -- badge-10 全科通才：完成 5 种不同难度课程（当前仅有 3 档，按 >=3 记）
  if v_diff_count >= 3 then v_new_badges := array_append(v_new_badges, 'badge-10'); end if;

  insert into public.user_badges (user_id, badge_id)
  select p_user_id, b
    from unnest(v_new_badges) as b
  on conflict do nothing;

  return v_new_badges;
end;
$$;

comment on function public.evaluate_badges(uuid) is
  '根据用户进度计算并写入应解锁的勋章（10 枚均有判定），返回本次新增勋章 id';