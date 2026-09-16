-- ============================================================================
-- HistoriaQuest 数据库初始化 — 行级安全策略（RLS）
-- Migration: 20250101000002_rls_policies
--
-- 安全模型：
--   * 内容类数据（课程/题目/勋章/事件/博物馆/文物）：所有人可读，仅管理员可写
--   * 用户私有数据（进度/答题/勋章）：仅本人可读写
--   * 社交数据（好友/PK）：仅相关方可见
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 管理员判定辅助函数
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'admin'
  );
$$;

comment on function public.is_admin() is '当前登录用户是否为管理员';

-- ---------------------------------------------------------------------------
-- 统一开启 RLS
-- ---------------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.courses        enable row level security;
alter table public.questions      enable row level security;
alter table public.badges         enable row level security;
alter table public.history_events enable row level security;
alter table public.timeline_events enable row level security;
alter table public.museums        enable row level security;
alter table public.artifacts      enable row level security;
alter table public.user_progress  enable row level security;
alter table public.user_answers   enable row level security;
alter table public.user_badges    enable row level security;
alter table public.friendships    enable row level security;
alter table public.pk_matches     enable row level security;

-- ===========================================================================
-- 内容类表：公开只读 + 管理员可写
-- ===========================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'courses', 'questions', 'badges', 'history_events', 'timeline_events',
    'museums', 'artifacts'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_public_read', t);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_public_read', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_write', t
    );
  end loop;
end $$;

-- ===========================================================================
-- profiles
-- ===========================================================================
drop policy if exists profiles_authenticated_read on public.profiles;
create policy profiles_authenticated_read
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ===========================================================================
-- user_progress：仅本人
-- ===========================================================================
drop policy if exists user_progress_owner_select on public.user_progress;
create policy user_progress_owner_select
  on public.user_progress for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_progress_owner_insert on public.user_progress;
create policy user_progress_owner_insert
  on public.user_progress for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists user_progress_owner_update on public.user_progress;
create policy user_progress_owner_update
  on public.user_progress for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ===========================================================================
-- user_answers：仅本人
-- ===========================================================================
drop policy if exists user_answers_owner_select on public.user_answers;
create policy user_answers_owner_select
  on public.user_answers for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_answers_owner_insert on public.user_answers;
create policy user_answers_owner_insert
  on public.user_answers for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists user_answers_owner_update on public.user_answers;
create policy user_answers_owner_update
  on public.user_answers for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_answers_owner_delete on public.user_answers;
create policy user_answers_owner_delete
  on public.user_answers for delete
  to authenticated
  using (auth.uid() = user_id);

-- ===========================================================================
-- user_badges：本人可读；写入走 security definer 函数（evaluate_badges）
-- ===========================================================================
drop policy if exists user_badges_owner_select on public.user_badges;
create policy user_badges_owner_select
  on public.user_badges for select
  to authenticated
  using (auth.uid() = user_id);

-- ===========================================================================
-- friendships：仅相关方可见；请求方可创建；双方可更新状态
-- ===========================================================================
drop policy if exists friendships_participant_select on public.friendships;
create policy friendships_participant_select
  on public.friendships for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists friendships_requester_insert on public.friendships;
create policy friendships_requester_insert
  on public.friendships for insert
  to authenticated
  with check (auth.uid() = requester_id);

drop policy if exists friendships_participant_update on public.friendships;
create policy friendships_participant_update
  on public.friendships for update
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id)
  with check (auth.uid() = requester_id or auth.uid() = addressee_id);

drop policy if exists friendships_participant_delete on public.friendships;
create policy friendships_participant_delete
  on public.friendships for delete
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- ===========================================================================
-- pk_matches：仅参与者可见；挑战者可创建；参与者可更新比分
-- ===========================================================================
drop policy if exists pk_matches_participant_select on public.pk_matches;
create policy pk_matches_participant_select
  on public.pk_matches for select
  to authenticated
  using (auth.uid() = challenger_id or auth.uid() = opponent_id);

drop policy if exists pk_matches_challenger_insert on public.pk_matches;
create policy pk_matches_challenger_insert
  on public.pk_matches for insert
  to authenticated
  with check (auth.uid() = challenger_id);

drop policy if exists pk_matches_participant_update on public.pk_matches;
create policy pk_matches_participant_update
  on public.pk_matches for update
  to authenticated
  using (auth.uid() = challenger_id or auth.uid() = opponent_id)
  with check (auth.uid() = challenger_id or auth.uid() = opponent_id);

-- ===========================================================================
-- 权限授予
--   RLS 负责“行级”可见性，GRANT 负责“表级”可达性，两者缺一不可。
--   Supabase 平台的 public schema 默认 privileges 会自动授予这些权限，
--   此处显式声明以保证迁移在任何环境下行为一致，并让安全模型自解释。
-- ===========================================================================
grant usage on schema public to anon, authenticated;

-- 匿名用户：只读内容（RLS 会进一步限制可见行）
grant select on all tables in schema public to anon;

-- 登录用户：读写（私有表的实际写入由 RLS 策略限制为本人数据）
grant select, insert, update, delete on all tables in schema public to authenticated;

-- 让今后新建的表自动继承同样权限，避免遗漏
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
