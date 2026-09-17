-- ============================================================================
-- Supabase 认证层桩（仅用于本地裸 PostgreSQL 开发）
-- ============================================================================
-- 背景：
--   项目迁移脚本引用了 Supabase 平台提供的两个东西：
--     1. auth.users 表      —— 注册触发器 on_auth_user_created 挂载于此
--     2. auth.uid() 函数    —— RLS 策略用它取当前登录用户 id
--   裸 PostgreSQL 没有这些，本文件用来补齐，使同一套迁移能在本地跑通。
--
-- 重要：
--   * 本文件【不是】迁移，不会被 supabase db push 推到云端。
--   * 云端由 Supabase 平台自己提供真正的 auth schema，无需此文件。
--   * 这里只实现迁移用到的字段，是"够用就好"的最小实现。
--
-- 与云端的行为差异：
--   * auth.uid() 在云端从 JWT 读用户 id；这里从会话变量 request.jwt.claim.sub 读，
--     便于测试时手动 SET 来模拟不同登录用户。
-- ============================================================================

-- pgcrypto: 提供 crypt() / gen_salt()，供 seed.sql 生成演示账号密码
create extension if not exists pgcrypto;

create schema if not exists auth;

-- ---------------------------------------------------------------------------
-- auth.users —— 只列出迁移与 seed 会用到的列
-- ---------------------------------------------------------------------------
create table if not exists auth.users (
  instance_id             uuid,
  id                      uuid primary key,
  aud                     varchar(255),
  role                    varchar(255),
  email                   varchar(255),
  encrypted_password      varchar(255),
  email_confirmed_at      timestamptz,
  invited_at              timestamptz,
  confirmation_token      varchar(255) default '',
  confirmation_sent_at    timestamptz,
  recovery_token          varchar(255) default '',
  recovery_sent_at        timestamptz,
  email_change_token_new  varchar(255) default '',
  email_change            varchar(255) default '',
  email_change_sent_at    timestamptz,
  last_sign_in_at         timestamptz,
  raw_app_meta_data       jsonb,
  raw_user_meta_data      jsonb,
  is_super_admin          boolean,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now(),
  phone                   text unique default null,
  phone_confirmed_at      timestamptz,
  is_sso_user             boolean not null default false,
  deleted_at              timestamptz,
  is_anonymous            boolean not null default false
);

-- ---------------------------------------------------------------------------
-- auth.identities —— Supabase Auth 依赖它做邮箱登录
-- ---------------------------------------------------------------------------
create table if not exists auth.identities (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  provider_id     text not null,
  provider        text not null,
  identity_data   jsonb not null,
  last_sign_in_at timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (provider_id, provider)
);

-- ---------------------------------------------------------------------------
-- auth.uid() —— 从会话变量读当前用户，方便测试时 SET 模拟登录
--
--   用法：
--     set role authenticated;
--     set request.jwt.claim.sub = '用户uuid';
--     select * from user_progress;          -- 只会看到该用户的行
-- ---------------------------------------------------------------------------
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- storage schema 桩（Supabase 平台提供，裸 PG 没有）
--
-- 后台的图片上传功能引用了 storage.buckets 与 storage.objects，
-- 这里补齐最小结构，使迁移 06 能在本地跑通。
-- ---------------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean default false,
  avif_autodetection boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table if not exists storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets (id),
  name             text,
  owner            uuid,
  metadata         jsonb,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now()
);

alter table storage.objects enable row level security;

-- ---------------------------------------------------------------------------
-- Supabase 内置角色 —— RLS 策略中的 `to anon, authenticated` 需要它们存在
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- auth.uid() 的执行权限
--
-- 真实 Supabase 会把 auth schema 的 usage 与 auth.uid() 的 execute
-- 授予 anon / authenticated。本地桩必须一并模拟，
-- 否则 security_invoker 视图里的 auth.uid() 会报“permission denied for schema auth”。
-- ---------------------------------------------------------------------------
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
