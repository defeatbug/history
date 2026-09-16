-- ============================================================================
-- HistoriaQuest — AI 调用用量表
-- Migration: 20250101000004_ai_usage
--
-- 用途：
--   记录每次 AI 调用的时间，供 Edge Function 做「按用户限流」，
--   同时为论文提供「AI 使用情况统计」的原始数据。
--
-- 为什么不用内存计数：
--   Edge Function 是无状态、多实例的，内存计数无法跨实例生效，
--   必须依赖共享存储（数据库）才能实现可靠的限流。
-- ============================================================================

create table if not exists public.ai_usage (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  -- 便于后续统计：token 消耗、模型、耗时等
  model       text,
  prompt_chars int,
  created_at  timestamptz not null default now()
);

comment on table public.ai_usage is 'AI 调用记录，用于限流与用量统计';

-- 限流查询走这个索引：where user_id = ? and created_at > ?
create index if not exists idx_ai_usage_rate_limit
  on public.ai_usage (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS：用户只能读写自己的用量记录
-- ---------------------------------------------------------------------------
alter table public.ai_usage enable row level security;

drop policy if exists ai_usage_owner_select on public.ai_usage;
create policy ai_usage_owner_select
  on public.ai_usage for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists ai_usage_owner_insert on public.ai_usage;
create policy ai_usage_owner_insert
  on public.ai_usage for insert
  to authenticated
  with check (auth.uid() = user_id);

-- 只有 service_role（Edge Function 的管理客户端）能清理历史记录
grant select, insert on public.ai_usage to authenticated;

-- ---------------------------------------------------------------------------
-- 辅助函数：统计某用户最近 N 秒内的调用次数
-- ---------------------------------------------------------------------------
create or replace function public.ai_usage_count(
  p_user_id uuid,
  p_window_seconds int default 60
)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.ai_usage
   where user_id = p_user_id
     and created_at > now() - make_interval(secs => p_window_seconds);
$$;

comment on function public.ai_usage_count(uuid, int) is '统计用户最近 N 秒内的 AI 调用次数';

-- 仅登录用户与 service_role 可调用（避免匿名探测他人用量）
revoke all on function public.ai_usage_count(uuid, int) from public;
grant execute on function public.ai_usage_count(uuid, int) to authenticated, service_role;
