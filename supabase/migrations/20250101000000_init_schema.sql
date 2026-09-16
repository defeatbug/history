-- ============================================================================
-- HistoriaQuest 数据库初始化 — 表结构
-- Migration: 20250101000000_init_schema
--
-- 设计说明：
--   * 内容类表（courses / questions / badges / history_events / museums /
--     artifacts）使用业务可读的 text 主键（如 'lesson-1'、'badge-3'），
--     保证 seed 数据可稳定复现，且前端 mock 数据可无缝迁移。
--   * 用户行为类表（user_progress / user_answers / user_badges /
--     friendships / pk_matches）使用 uuid 主键。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles —— 用户档案（扩展 auth.users）
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null,
  avatar      text,
  role        text not null default 'student' check (role in ('student', 'admin')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is '用户档案，与 auth.users 一对一，由触发器自动创建';

-- ---------------------------------------------------------------------------
-- 2. courses —— 课程
-- ---------------------------------------------------------------------------
create table if not exists public.courses (
  id              text primary key,
  title           text not null,
  description     text,
  period          text,
  civilization    text,
  difficulty      text not null check (difficulty in ('beginner', 'intermediate', 'advanced')),
  estimated_time  int  not null default 0,
  cover_image     text,
  sort_order      int  not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.courses is '历史课程';

-- ---------------------------------------------------------------------------
-- 3. questions —— 题目
-- ---------------------------------------------------------------------------
create table if not exists public.questions (
  id           text primary key,
  course_id    text not null references public.courses (id) on delete cascade,
  content      text not null,
  type         text not null check (type in ('multiple_choice', 'matching', 'scenario', 'fill_blank')),
  options      jsonb not null default '[]'::jsonb,
  answer       jsonb not null,
  explanation  text,
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now()
);

comment on column public.questions.options is '选项数组，如 ["夏朝","商朝"]；连线题为配对结构';
comment on column public.questions.answer  is '正确答案，单选为索引数字，连线/情境题为结构化对象';

create index if not exists idx_questions_course on public.questions (course_id, sort_order);

-- ---------------------------------------------------------------------------
-- 4. badges —— 勋章定义
-- ---------------------------------------------------------------------------
create table if not exists public.badges (
  id           text primary key,
  name         text not null,
  description  text,
  icon         text,
  requirement  text,
  sort_order   int  not null default 0
);

comment on table public.badges is '勋章定义（静态配置）';

-- ---------------------------------------------------------------------------
-- 5. history_events —— 历史事件库
-- ---------------------------------------------------------------------------
create table if not exists public.history_events (
  id            text primary key,
  title         text not null,
  period        text,
  year          text,
  dynasty       text,
  category      text,
  description   text,
  content       text,
  significance  text,
  keywords      text[] not null default '{}',
  image         text,
  related_events text[] not null default '{}'
);

comment on table public.history_events is '中国历史事件库，related_events 用于知识图谱关联';

create index if not exists idx_history_events_dynasty  on public.history_events (dynasty);
create index if not exists idx_history_events_category on public.history_events (category);

-- ---------------------------------------------------------------------------
-- 5b. timeline_events —— 学习路径时间轴
-- ---------------------------------------------------------------------------
create table if not exists public.timeline_events (
  id            text primary key,
  track         text not null check (track in ('china', 'world')),
  year          text,
  title         text not null,
  description   text,
  civilization  text,
  lesson_id     text references public.courses (id) on delete set null,
  sort_order    int not null default 0
);

comment on table public.timeline_events is '学习路径时间轴节点，track 区分中国史/世界史';

create index if not exists idx_timeline_events_track on public.timeline_events (track, sort_order);

-- ---------------------------------------------------------------------------
-- 6. museums / artifacts —— 博物馆与文物
-- ---------------------------------------------------------------------------
create table if not exists public.museums (
  id            text primary key,
  name          text not null,
  name_en       text,
  location      text,
  country       text,
  established   text,
  description   text,
  cover_image   text
);

create table if not exists public.artifacts (
  id                    text primary key,
  museum_id             text not null references public.museums (id) on delete cascade,
  name                  text not null,
  name_en               text,
  period                text,
  civilization          text,
  material              text,
  dimensions            text,
  description           text,
  detailed_description  text,
  image_url             text,
  significance          text
);

create index if not exists idx_artifacts_museum on public.artifacts (museum_id);

-- ---------------------------------------------------------------------------
-- 7. user_progress —— 学习进度（1:1，支持断点续学）
-- ---------------------------------------------------------------------------
create table if not exists public.user_progress (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  completed_lessons  text[] not null default '{}',
  total_study_time   int    not null default 0,          -- 累计学习分钟数
  correct_rate       numeric(5, 4) not null default 0,   -- 最近一次课程正确率 0-1
  current_streak     int    not null default 0,          -- 连续学习天数
  last_lesson_id     text references public.courses (id) on delete set null,
  last_position      int    not null default 0,          -- 断点：上次答到的题号
  last_studied_at    timestamptz,
  updated_at         timestamptz not null default now()
);

comment on column public.user_progress.last_position is '断点续学：上次答题的题目索引';

-- ---------------------------------------------------------------------------
-- 8. user_answers —— 答题记录（含错题本 + SM-2 间隔重复字段）
-- ---------------------------------------------------------------------------
create table if not exists public.user_answers (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  question_id     text not null references public.questions (id) on delete cascade,
  user_answer     jsonb,
  is_correct      boolean not null,
  answered_at     timestamptz not null default now(),
  -- --- 间隔重复（SM-2）---
  ease_factor     numeric(4, 2) not null default 2.5,
  interval_days   int not null default 0,
  repetitions     int not null default 0,
  next_review_at  timestamptz,
  unique (user_id, question_id)
);

create index if not exists idx_user_answers_wrong
  on public.user_answers (user_id, is_correct);
create index if not exists idx_user_answers_review
  on public.user_answers (user_id, next_review_at);

comment on table public.user_answers is '答题记录；每用户每题仅一条，错题本与复习调度基于此表';

-- ---------------------------------------------------------------------------
-- 9. user_badges —— 用户已解锁勋章
-- ---------------------------------------------------------------------------
create table if not exists public.user_badges (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  badge_id     text not null references public.badges (id) on delete cascade,
  unlocked_at  timestamptz not null default now(),
  primary key (user_id, badge_id)
);

-- ---------------------------------------------------------------------------
-- 10. friendships —— 好友关系（有向边 + 状态）
-- ---------------------------------------------------------------------------
create table if not exists public.friendships (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references public.profiles (id) on delete cascade,
  addressee_id  uuid not null references public.profiles (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint friendships_no_self check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

create index if not exists idx_friendships_addressee on public.friendships (addressee_id, status);

-- ---------------------------------------------------------------------------
-- 11. pk_matches —— PK 对战记录
-- ---------------------------------------------------------------------------
create table if not exists public.pk_matches (
  id                uuid primary key default gen_random_uuid(),
  challenger_id     uuid not null references public.profiles (id) on delete cascade,
  opponent_id       uuid references public.profiles (id) on delete set null,
  status            text not null default 'waiting'
                      check (status in ('waiting', 'in_progress', 'finished', 'cancelled')),
  challenger_score  int not null default 0,
  opponent_score    int not null default 0,
  question_ids      text[] not null default '{}',
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz
);

create index if not exists idx_pk_matches_challenger on public.pk_matches (challenger_id, status);
create index if not exists idx_pk_matches_opponent   on public.pk_matches (opponent_id, status);
