-- ============================================================================
-- HistoriaQuest 数据库初始化 — 函数与触发器
-- Migration: 20250101000001_functions_triggers
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 通用 updated_at 自动维护
-- ---------------------------------------------------------------------------
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

drop trigger if exists trg_courses_updated_at on public.courses;
create trigger trg_courses_updated_at
  before update on public.courses
  for each row execute function public.handle_updated_at();

drop trigger if exists trg_user_progress_updated_at on public.user_progress;
create trigger trg_user_progress_updated_at
  before update on public.user_progress
  for each row execute function public.handle_updated_at();

drop trigger if exists trg_friendships_updated_at on public.friendships;
create trigger trg_friendships_updated_at
  before update on public.friendships
  for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 2. 新用户注册时自动创建 profiles + user_progress
--
--    使用 security definer 以便在 auth.users 触发器上下文中写入 public 表；
--    显式设置 search_path 防止 search_path 劫持。
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, avatar)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1), '历史学习者'),
    new.raw_user_meta_data ->> 'avatar'
  )
  on conflict (id) do nothing;

  insert into public.user_progress (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 3. 勋章解锁判定（服务端权威逻辑）
--
--    前端本地也会跑一份用于即时反馈，但以本函数结果为准，
--    避免客户端篡改进度直接刷勋章。
-- ---------------------------------------------------------------------------
create or replace function public.evaluate_badges(p_user_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed      int;
  v_total_lessons  int;
  v_total_time     int;
  v_correct_rate   numeric;
  v_civilizations  int;
  v_diff_count     int;
  v_new_badges     text[] := '{}';
begin
  select coalesce(array_length(completed_lessons, 1), 0),
         total_study_time,
         correct_rate
    into v_completed, v_total_time, v_correct_rate
    from public.user_progress
   where user_id = p_user_id;

  select count(*) into v_total_lessons from public.courses;

  -- 不同文明数量 & 不同难度数量
  select count(distinct c.civilization), count(distinct c.difficulty)
    into v_civilizations, v_diff_count
    from public.courses c
   where c.id = any (
     coalesce((select completed_lessons from public.user_progress where user_id = p_user_id), '{}')
   );

  -- badge-1 历史初学者：完成任意一门
  if v_completed >= 1 then v_new_badges := array_append(v_new_badges, 'badge-1'); end if;
  -- badge-2 文明探索者：完成 3 门不同文明
  if v_civilizations >= 3 then v_new_badges := array_append(v_new_badges, 'badge-2'); end if;
  -- badge-3 完美答题者：正确率 100%
  if v_correct_rate >= 1 then v_new_badges := array_append(v_new_badges, 'badge-3'); end if;
  -- badge-5 历史大师：完成所有课程
  if v_total_lessons > 0 and v_completed >= v_total_lessons then
    v_new_badges := array_append(v_new_badges, 'badge-5');
  end if;
  -- badge-6 时间旅行者：累计学习 600 分钟（10 小时）
  if v_total_time >= 600 then v_new_badges := array_append(v_new_badges, 'badge-6'); end if;
  -- badge-10 全科通才：完成 5 种不同难度课程（当前仅有 3 档，按 >=3 记）
  if v_diff_count >= 3 then v_new_badges := array_append(v_new_badges, 'badge-10'); end if;

  insert into public.user_badges (user_id, badge_id)
  select p_user_id, b
    from unnest(v_new_badges) as b
  on conflict do nothing;

  return v_new_badges;
end;
$$;

comment on function public.evaluate_badges(uuid) is '根据用户进度计算并写入应解锁的勋章，返回本次新增勋章 id';
