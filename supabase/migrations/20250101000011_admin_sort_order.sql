-- ============================================================================
-- HistoriaQuest — 后台支持（二）：内容表排序字段
-- Migration: 20250101000011_admin_sort_order
--
-- 背景：
--   courses / questions / badges / timeline_events 早已有 sort_order，
--   供后台拖拽排序使用；但 history_events / museums / artifacts 三张表
--   当时漏了，导致后台只能「改内容、不能调顺序」——这与产品原则
--   「内容即数据，顺序即信息」相悖。
--
-- 内容：
--   1. 三张表各加 `sort_order int not null default 0`（幂等：IF NOT EXISTS）
--   2. 回填：保留当前学生端的展示顺序，避免迁移后内容「乱序」
--        history_events 按年份从早到晚
--          —— 年份形如 "前2070"（取 -2070）、"前770-476"（取首个数字 -770）、"960"
--          —— 含"前"视为公元前取负，与 HistoryStudy.vue 的 extractYear 一致
--        museums        按 id 编号（museum-1 … museum-8）
--        artifacts      按 (museum_id, id 尾号)（artifact-2-1 …）
--   3. 索引：内容读取都是按 sort_order 排的，加上索引
--
-- 注意：回填按「当前数据」计算行号；迁移只跑一次，之后顺序由后台拖拽维护。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 加列（幂等）
-- ---------------------------------------------------------------------------
alter table public.history_events
  add column if not exists sort_order int not null default 0;

alter table public.museums
  add column if not exists sort_order int not null default 0;

alter table public.artifacts
  add column if not exists sort_order int not null default 0;

comment on column public.history_events.sort_order is '后台拖拽排序号；越小越靠前';
comment on column public.museums.sort_order is '后台拖拽排序号；越小越靠前';
comment on column public.artifacts.sort_order is '后台拖拽排序号；越小越靠前';

-- ---------------------------------------------------------------------------
-- 2a. 回填 history_events：按年份从早到晚
-- ---------------------------------------------------------------------------
-- substring(year from '[0-9]+') 取年份字符串里第一组数字；
-- year 为 NULL 或无数字的行排在最后（ORDER BY … ASC 默认 NULLS LAST）。
with ordered as (
  select
    id,
    row_number() over (
      order by
        (case when year like '%前%' then -1 else 1 end)
          * (nullif(substring(year from '[0-9]+'), '')::int),
        id
    ) - 1 as rn
  from public.history_events
)
update public.history_events e
set sort_order = o.rn
from ordered o
where e.id = o.id;

-- ---------------------------------------------------------------------------
-- 2b. 回填 museums：按 id 编号
-- ---------------------------------------------------------------------------
with ordered as (
  select
    id,
    row_number() over (
      order by
        (nullif(substring(id from '[0-9]+'), '')::int),
        id
    ) - 1 as rn
  from public.museums
)
update public.museums m
set sort_order = o.rn
from ordered o
where m.id = o.id;

-- ---------------------------------------------------------------------------
-- 2c. 回填 artifacts：按 (museum_id, id 尾号)
-- ---------------------------------------------------------------------------
-- id 尾号取末尾的数字组（artifact-2-10 → 10），避免文本排序的 "10" < "2" 陷阱。
with ordered as (
  select
    id,
    row_number() over (
      order by
        museum_id,
        (nullif(substring(id from '[0-9]+$'), '')::int),
        id
    ) - 1 as rn
  from public.artifacts
)
update public.artifacts a
set sort_order = o.rn
from ordered o
where a.id = o.id;

-- ---------------------------------------------------------------------------
-- 3. 索引
-- ---------------------------------------------------------------------------
create index if not exists idx_history_events_sort on public.history_events (sort_order);
create index if not exists idx_museums_sort        on public.museums (sort_order);
create index if not exists idx_artifacts_sort      on public.artifacts (museum_id, sort_order);
