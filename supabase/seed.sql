-- ============================================================================
-- HistoriaQuest — 本地开发种子数据
-- ============================================================================
-- 说明：
--   * 课程 / 题目 / 勋章 / 历史事件 / 博物馆等**内容数据**在
--     supabase/migrations/20250101000003_seed_content.sql 中，随迁移一同执行，
--     本地与云端保持一致。
--   * 本文件仅用于**本地开发与答辩演示**（supabase db reset 时执行），
--     不会通过 supabase db push 同步到云端。
--
-- 演示账号：
--   邮箱: demo@historiaquest.dev
--   密码: demo1234
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 演示用户（插入 auth.users 后由触发器自动创建 profiles + user_progress）
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated',
  'demo@historiaquest.dev',
  crypt('demo1234', gen_salt('bf')),
  now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"演示用户"}'::jsonb,
  now(), now(),
  '', '', '', ''
)
on conflict (id) do nothing;

-- 同步 auth.identities（Supabase Auth 依赖该表做邮箱登录）
insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'email',
  '{"sub":"00000000-0000-0000-0000-000000000001","email":"demo@historiaquest.dev"}'::jsonb,
  now(), now(), now()
)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. 演示学习进度
-- ---------------------------------------------------------------------------
insert into public.user_progress (
  user_id, completed_lessons, total_study_time, correct_rate, current_streak,
  last_lesson_id, last_position, last_studied_at
) values (
  '00000000-0000-0000-0000-000000000001',
  array['lesson-1', 'lesson-2'],
  135,
  0.8571,
  3,
  'lesson-3',
  2,
  now()
)
on conflict (user_id) do update set
  completed_lessons = excluded.completed_lessons,
  total_study_time  = excluded.total_study_time,
  correct_rate      = excluded.correct_rate,
  current_streak    = excluded.current_streak,
  last_lesson_id    = excluded.last_lesson_id,
  last_position     = excluded.last_position,
  last_studied_at   = excluded.last_studied_at;

-- ---------------------------------------------------------------------------
-- 3. 演示答题记录（含错题，用于错题本 / 间隔重复演示）
--
--    ease_factor / interval_days / repetitions 按 SM-2 递推结果填写：
--      答对（q=4）EF 不变；答错（q=2）EF 每次减 0.32
--    next_review_at 故意设为过去，以便演示时能直接看到「待复习」队列
-- ---------------------------------------------------------------------------
insert into public.user_answers (
  user_id, question_id, user_answer, is_correct,
  wrong_count, correct_streak, ease_factor, interval_days, repetitions, next_review_at
)
values
  -- 稳定答对（已进入长间隔）
  ('00000000-0000-0000-0000-000000000001', 'q1-1', '1'::jsonb, true,
   0, 2, 2.50, 6, 2, now() + interval '6 days'),
  -- 答对两次
  ('00000000-0000-0000-0000-000000000001', 'q1-2', '1'::jsonb, true,
   0, 1, 2.50, 1, 1, now() + interval '1 day'),
  -- 错过两次（EF 降至 1.86），已到期待复习
  ('00000000-0000-0000-0000-000000000001', 'q1-3', '1'::jsonb, false,
   2, 0, 1.86, 1, 0, now() - interval '1 day'),
  -- 错过一次（EF 降至 2.18），已到期待复习
  ('00000000-0000-0000-0000-000000000001', 'q1-5', '0'::jsonb, false,
   1, 0, 2.18, 1, 0, now() - interval '2 hours')
on conflict (user_id, question_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. 演示勋章（由服务端函数按进度计算，保证规则一致）
--    用 DO 块包住以抑制结果输出，避免污染 supabase db reset 的日志
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.evaluate_badges('00000000-0000-0000-0000-000000000001');
end $$;
