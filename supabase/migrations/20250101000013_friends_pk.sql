-- ============================================================================
-- HistoriaQuest — 好友 PK
-- Migration: 20250101000013_friends_pk
--
-- 内容：
--   1. pk_matches 增加双方各自的完成时间；新建 pk_answers（PK 答题明细）
--   2. 好友关系 RPC：搜索 / 发起 / 响应 / 删除 / 列表
--   3. 好友 PK RPC：创建 / 响应 / 取消 / 详情 / 交卷 / 历史
--   4. Realtime：把 pk_matches / friendships 接入 supabase_realtime
--
-- 安全模型：
--   * 所有写入只走 security definer RPC。客户端对 pk_matches / pk_answers
--     只有读权限，无法伪造比分、也无法补写/篡改答案。
--   * 对错判定与计分完全在数据库内完成；未作答且未结束时，RPC 不返回
--     correct_index / explanation，避免对战时从网络响应里偷看答案。
--   * 每个 RPC 内部都会校验「当前用户是否为该对战/好友关系的参与方」，
--     RLS 只是第二道防线（RPC 以 definer 身份运行，不依赖 RLS 兜底）。
--
-- 幂等性：
--   表结构全部 if not exists；函数用 create or replace；权限与策略先
--   drop/revoke 再创建，因此本迁移可以安全地在本地 reset 或云端 db push 重放。
-- ============================================================================


-- ===========================================================================
-- 一、表结构变更
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1.1 pk_matches：记录双方各自「答完全部题目」的时间
--
--     比分本身在 submit_answer 里累加；这两个时间戳用来区分「谁先交卷」
--     与「双方是否都已完成」，从而决定对局何时置为 finished。
-- ---------------------------------------------------------------------------
alter table public.pk_matches
  add column if not exists challenger_finished_at timestamptz,
  add column if not exists opponent_finished_at   timestamptz;

comment on column public.pk_matches.challenger_finished_at is
  '挑战者答完全部题目的时间（未完成时为 null）';
comment on column public.pk_matches.opponent_finished_at is
  '应战者答完全部题目的时间（未完成时为 null）';

-- ---------------------------------------------------------------------------
-- 1.2 pk_answers：PK 对战中的逐题作答明细
--
--     与 user_answers（学习错题本）分开存：PK 答案只服务于本场对战，
--     不参与 SM-2 复习调度，也不应被错题本统计重复计算。
-- ---------------------------------------------------------------------------
create table if not exists public.pk_answers (
  id             uuid primary key default gen_random_uuid(),
  match_id       uuid not null references public.pk_matches (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  question_id    text not null,
  selected_index int  not null,
  is_correct     boolean not null,
  answered_at    timestamptz not null default now(),
  -- 同一场对战、同一用户、同一道题只允许一条记录（重复提交靠它兜底幂等）
  unique (match_id, user_id, question_id)
);

comment on table public.pk_answers is
  'PK 对战逐题作答记录；写入只走 pk_submit_answer，客户端仅可读';

create index if not exists idx_pk_answers_match_user
  on public.pk_answers (match_id, user_id);

-- ---------------------------------------------------------------------------
-- 1.3 pk_answers 的 RLS 与权限
--
--     读取：仅本场对战的两位参与者可读（不向第三方泄露）。
--     写入：不建任何 insert/update/delete 策略，并显式 revoke，
--           全部交给 pk_submit_answer RPC。
-- ---------------------------------------------------------------------------
alter table public.pk_answers enable row level security;

drop policy if exists pk_answers_participant_select on public.pk_answers;
create policy pk_answers_participant_select
  on public.pk_answers for select
  to authenticated
  using (
    exists (
      select 1
        from public.pk_matches m
       where m.id = pk_answers.match_id
         and (m.challenger_id = auth.uid() or m.opponent_id = auth.uid())
    )
  );

-- 迁移 02 的 default privileges 会让新建表自动获得 authenticated 的全量写权限，
-- 这里必须显式收回；anon 也一并收回，确保 pk_answers 只有「参与者可读」一种访问方式。
revoke all on table public.pk_answers from public;
revoke all on table public.pk_answers from anon;
revoke all on table public.pk_answers from authenticated;
grant select on table public.pk_answers to authenticated;

-- ---------------------------------------------------------------------------
-- 1.4 pk_matches：写入只走 RPC
--
--     迁移 02 给 authenticated 授了 insert/update/delete。若不收回，
--     客户端可以直接 update 自己的 challenger_score 刷分，或伪造一条对战记录。
--     这里保留已有的 select 策略，仅收回写权限。
-- ---------------------------------------------------------------------------
revoke insert, update, delete on table public.pk_matches from authenticated;
revoke insert, update, delete on table public.pk_matches from anon;


-- ===========================================================================
-- 二、好友关系 RPC
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 2.1 friends_search —— 按用户名搜索用户，并给出我与对方的关系
--
--     relation 取值：friends / request_sent / request_received / blocked / none
--     空查询（trim 后无内容）直接返回空集，避免把全站用户翻出来。
-- ---------------------------------------------------------------------------
create or replace function public.friends_search(p_query text)
returns table (
  user_id  uuid,
  username text,
  avatar   text,
  relation text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_q   text := trim(coalesce(p_query, ''));
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  if length(v_q) < 1 then
    return;
  end if;

  return query
  select p.id,
         p.username,
         p.avatar,
         case
           -- 只要任一方向存在 blocked，就按 blocked 显示（优先于好友）
           when exists (
             select 1 from public.friendships f
              where f.status = 'blocked'
                and ((f.requester_id = v_uid and f.addressee_id = p.id)
                  or (f.requester_id = p.id   and f.addressee_id = v_uid))
           ) then 'blocked'
           when exists (
             select 1 from public.friendships f
              where f.status = 'accepted'
                and ((f.requester_id = v_uid and f.addressee_id = p.id)
                  or (f.requester_id = p.id   and f.addressee_id = v_uid))
           ) then 'friends'
           when exists (
             select 1 from public.friendships f
              where f.status = 'pending'
                and f.requester_id = v_uid and f.addressee_id = p.id
           ) then 'request_sent'
           when exists (
             select 1 from public.friendships f
              where f.status = 'pending'
                and f.requester_id = p.id and f.addressee_id = v_uid
           ) then 'request_received'
           else 'none'
         end
    from public.profiles p
   where p.id <> v_uid
     and p.username ilike '%' || v_q || '%'
   order by p.username, p.id
   limit 10;
end;
$$;

comment on function public.friends_search(text) is
  '按用户名模糊搜索用户（排除自己，最多 10 条），并返回与当前用户的好友关系';

-- ---------------------------------------------------------------------------
-- 2.2 friends_send_request —— 发起好友请求（带合并与幂等）
--
--     * 已是好友            → 报错「已经是好友」
--     * 存在拉黑关系        → 报错
--     * 我已发过 pending    → 直接返回原 id（幂等，防止连点）
--     * 对方先发给我 pending → 视为互相添加，直接置为 accepted
--     * 其余                → 新建 pending
-- ---------------------------------------------------------------------------
create or replace function public.friends_send_request(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_friendship public.friendships%rowtype;
  v_id         uuid;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  if p_user_id is null then
    raise exception '用户不存在';
  end if;

  if p_user_id = v_uid then
    raise exception '不能添加自己为好友';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception '用户不存在';
  end if;

  -- 已是好友（任意方向）
  select * into v_friendship
    from public.friendships f
   where f.status = 'accepted'
     and ((f.requester_id = v_uid and f.addressee_id = p_user_id)
       or (f.requester_id = p_user_id and f.addressee_id = v_uid))
   limit 1;
  if found then
    raise exception '已经是好友';
  end if;

  -- 存在拉黑关系：不允许再发起
  select * into v_friendship
    from public.friendships f
   where f.status = 'blocked'
     and ((f.requester_id = v_uid and f.addressee_id = p_user_id)
       or (f.requester_id = p_user_id and f.addressee_id = v_uid))
   limit 1;
  if found then
    raise exception '无法向该用户发送好友请求';
  end if;

  -- 我已经发过请求：幂等返回
  select * into v_friendship
    from public.friendships f
   where f.requester_id = v_uid
     and f.addressee_id = p_user_id
     and f.status = 'pending';
  if found then
    return v_friendship.id;
  end if;

  -- 对方先发给我：直接成为好友
  select * into v_friendship
    from public.friendships f
   where f.requester_id = p_user_id
     and f.addressee_id = v_uid
     and f.status = 'pending';
  if found then
    update public.friendships
       set status = 'accepted'
     where id = v_friendship.id;
    return v_friendship.id;
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
  values (v_uid, p_user_id, 'pending')
  on conflict (requester_id, addressee_id) do update
     set updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.friends_send_request(uuid) is
  '发起好友请求；重复请求幂等返回原 id，反向 pending 自动合并为好友';

-- ---------------------------------------------------------------------------
-- 2.3 friends_respond_request —— 被邀请方接受 / 拒绝好友请求
--
--     接受 → status = accepted；拒绝 → 删除这一行（请求不留痕）。
-- ---------------------------------------------------------------------------
create or replace function public.friends_respond_request(
  p_friendship_id uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_friendship public.friendships%rowtype;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  select * into v_friendship
    from public.friendships f
   where f.id = p_friendship_id
     for update;
  if not found then
    raise exception '好友请求不存在';
  end if;

  if v_friendship.addressee_id <> v_uid then
    raise exception '无权处理该好友请求';
  end if;

  if v_friendship.status <> 'pending' then
    raise exception '该好友请求已处理';
  end if;

  if p_accept then
    update public.friendships
       set status = 'accepted'
     where id = p_friendship_id;
    return 'accepted';
  else
    delete from public.friendships where id = p_friendship_id;
    return 'deleted';
  end if;
end;
$$;

comment on function public.friends_respond_request(uuid, boolean) is
  '接受或拒绝收到的好友请求；接受返回 accepted，拒绝删除并返回 deleted';

-- ---------------------------------------------------------------------------
-- 2.4 friends_remove —— 解除好友关系 / 撤回待处理请求
--
--     任一参与方均可删除（已接受的好友或仍 pending 的请求）。
-- ---------------------------------------------------------------------------
create or replace function public.friends_remove(p_friendship_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_friendship public.friendships%rowtype;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  select * into v_friendship
    from public.friendships f
   where f.id = p_friendship_id
     for update;
  if not found then
    raise exception '好友关系不存在';
  end if;

  if v_friendship.requester_id <> v_uid and v_friendship.addressee_id <> v_uid then
    raise exception '无权删除该好友关系';
  end if;

  delete from public.friendships where id = p_friendship_id;
  return 'removed';
end;
$$;

comment on function public.friends_remove(uuid) is
  '任一参与方删除好友关系或待处理请求，返回 removed';

-- ---------------------------------------------------------------------------
-- 2.5 friends_list —— 好友列表 + 双方 PK 战绩 + 进行中的对战
--
--     friendship_id：好友关系的 friendships.id（前端删除好友要拿它调
--                    friends_remove；一条好友关系只会有一行 accepted）
--     total_matches：双方之间 status='finished' 的对战数（不分谁发起）
--     wins         ：其中我分数更高的场次
--     active_match_id：双方之间 waiting/in_progress 的最新一场，可为 null
-- ---------------------------------------------------------------------------
create or replace function public.friends_list()
returns table (
  user_id         uuid,
  friendship_id   uuid,
  username        text,
  avatar          text,
  total_matches   int,
  wins            int,
  active_match_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  return query
  select f.friend_id,
         f.friendship_id,
         p.username,
         p.avatar,
         (
           select count(*)::int
             from public.pk_matches m
            where m.status = 'finished'
              and ((m.challenger_id = v_uid       and m.opponent_id = f.friend_id)
                or (m.challenger_id = f.friend_id and m.opponent_id = v_uid))
         ),
         (
           select count(*)::int
             from public.pk_matches m
            where m.status = 'finished'
              and ((m.challenger_id = v_uid and m.opponent_id = f.friend_id
                    and m.challenger_score > m.opponent_score)
                or (m.opponent_id = v_uid and m.challenger_id = f.friend_id
                    and m.opponent_score > m.challenger_score))
         ),
         (
           select m.id
             from public.pk_matches m
            where m.status in ('waiting', 'in_progress')
              and ((m.challenger_id = v_uid       and m.opponent_id = f.friend_id)
                or (m.challenger_id = f.friend_id and m.opponent_id = v_uid))
            order by m.created_at desc, m.id desc
            limit 1
         )
    from (
      -- 正常情况下一对好友只会有一行 accepted；若历史数据里存在反向重复，
      -- 用 distinct on 取最早一条，保证每个好友只出现一次且 friendship_id 明确。
      select distinct on (
               case when fr.requester_id = v_uid then fr.addressee_id
                    else fr.requester_id
               end
             )
             fr.id as friendship_id,
             case when fr.requester_id = v_uid then fr.addressee_id
                  else fr.requester_id
             end as friend_id
        from public.friendships fr
       where fr.status = 'accepted'
         and (fr.requester_id = v_uid or fr.addressee_id = v_uid)
       order by case when fr.requester_id = v_uid then fr.addressee_id
                     else fr.requester_id
                end,
                fr.created_at,
                fr.id
    ) f
    join public.profiles p on p.id = f.friend_id
   order by p.username, f.friend_id;
end;
$$;

comment on function public.friends_list() is
  '好友列表，附带双方历史战绩与进行中的对战 id';


-- ===========================================================================
-- 三、好友 PK RPC
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 3.1 pk_create_match —— 创建对战
--
--     * 必须是好友、不能挑战自己、对手必须存在
--     * 双方已有 waiting/in_progress 的对战 → 直接返回该场（防重复点击）
--     * 题量 clamp 到 3..10；随机抽取可作答的单选题，不足则取实际数量
-- ---------------------------------------------------------------------------
create or replace function public.pk_create_match(
  p_opponent_id uuid,
  p_question_count int default 7
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_existing_id  uuid;
  v_count        int;
  v_question_ids text[];
  v_match_id     uuid;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  if p_opponent_id is null then
    raise exception '对手不存在';
  end if;

  if p_opponent_id = v_uid then
    raise exception '不能向自己发起对战';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_opponent_id) then
    raise exception '对手不存在';
  end if;

  if not exists (
    select 1
      from public.friendships f
     where f.status = 'accepted'
       and ((f.requester_id = v_uid and f.addressee_id = p_opponent_id)
         or (f.requester_id = p_opponent_id and f.addressee_id = v_uid))
  ) then
    raise exception '你们还不是好友';
  end if;

  -- 已有未结束的对战：不重复创建，直接返回那一场
  select m.id into v_existing_id
    from public.pk_matches m
   where m.status in ('waiting', 'in_progress')
     and ((m.challenger_id = v_uid and m.opponent_id = p_opponent_id)
       or (m.challenger_id = p_opponent_id and m.opponent_id = v_uid))
   order by m.created_at desc, m.id desc
   limit 1;
  if v_existing_id is not null then
    return v_existing_id;
  end if;

  v_count := greatest(3, least(10, coalesce(p_question_count, 7)));

  select array_agg(q.id)
    into v_question_ids
    from (
      select qs.id
        from public.questions qs
       where qs.type = 'multiple_choice'
         and jsonb_typeof(qs.answer) = 'number'
       order by random()
       limit v_count
    ) q;

  if v_question_ids is null or array_length(v_question_ids, 1) is null then
    raise exception '题库中没有可用于 PK 的题目';
  end if;

  insert into public.pk_matches (challenger_id, opponent_id, status, question_ids)
  values (v_uid, p_opponent_id, 'waiting', v_question_ids)
  returning id into v_match_id;

  return v_match_id;
end;
$$;

comment on function public.pk_create_match(uuid, int) is
  '向好友发起 PK；双方已有未结束对战时幂等返回原对局 id';

-- ---------------------------------------------------------------------------
-- 3.2 pk_respond_match —— 被邀请方接受 / 拒绝对战邀请
-- ---------------------------------------------------------------------------
create or replace function public.pk_respond_match(
  p_match_id uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_match  public.pk_matches%rowtype;
  v_status text;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  select * into v_match
    from public.pk_matches
   where id = p_match_id
     for update;
  if not found then
    raise exception '对战不存在';
  end if;

  if v_match.opponent_id is null or v_match.opponent_id <> v_uid then
    raise exception '只有被邀请方可以响应这场对战';
  end if;

  if v_match.status <> 'waiting' then
    raise exception '这场对战已被处理';
  end if;

  if p_accept then
    update public.pk_matches
       set status     = 'in_progress',
           started_at = coalesce(started_at, now())
     where id = p_match_id
     returning status into v_status;
  else
    update public.pk_matches
       set status = 'cancelled'
     where id = p_match_id
     returning status into v_status;
  end if;

  return v_status;
end;
$$;

comment on function public.pk_respond_match(uuid, boolean) is
  '被邀请方接受（waiting→in_progress）或拒绝（→cancelled）对战';

-- ---------------------------------------------------------------------------
-- 3.3 pk_cancel_match —— 发起方在对方响应前撤回对战
-- ---------------------------------------------------------------------------
create or replace function public.pk_cancel_match(p_match_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_match  public.pk_matches%rowtype;
  v_status text;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  select * into v_match
    from public.pk_matches
   where id = p_match_id
     for update;
  if not found then
    raise exception '对战不存在';
  end if;

  if v_match.challenger_id <> v_uid then
    raise exception '只有发起方可以取消对战';
  end if;

  if v_match.status <> 'waiting' then
    raise exception '对战已开始或已结束，无法取消';
  end if;

  update public.pk_matches
     set status = 'cancelled'
   where id = p_match_id
   returning status into v_status;

  return v_status;
end;
$$;

comment on function public.pk_cancel_match(uuid) is
  '发起方取消仍在等待响应的对战，返回 cancelled';

-- ---------------------------------------------------------------------------
-- 3.4 pk_get_match —— 对战详情（含防作弊的题目答案控制）
--
--     返回结构与前端 PkMatchDetail 对齐：
--       { id, status, question_ids, challenger{...}, opponent{...},
--         created_at, started_at, finished_at,
--         questions[{id, content, options, course_title, explanation,
--                    correct_index}],
--         my_answers[{question_id, selected_index, is_correct}],
--         opponent_answered, my_role }
--
--     防作弊：
--       correct_index / explanation 仅在对局已结束（status='finished'）
--       或「我已作答过该题」时才返回，否则为 null。
--       对手的具体答案永不返回，只给已答题数。
-- ---------------------------------------------------------------------------
create or replace function public.pk_get_match(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid                 uuid := auth.uid();
  v_match               public.pk_matches%rowtype;
  v_role                text;
  v_challenger_username text;
  v_opponent_username   text;
  v_questions           jsonb;
  v_my_answers          jsonb;
  v_opponent_answered   int;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  select * into v_match
    from public.pk_matches
   where id = p_match_id;
  if not found then
    raise exception '对战不存在';
  end if;

  -- 用 is distinct from 处理 opponent_id 为 null（对手已注销）的情况
  if v_uid is distinct from v_match.challenger_id
     and v_uid is distinct from v_match.opponent_id then
    raise exception '你不是这场对战的参与者';
  end if;

  v_role := case when v_uid = v_match.challenger_id then 'challenger' else 'opponent' end;

  select p.username into v_challenger_username
    from public.profiles p
   where p.id = v_match.challenger_id;

  if v_match.opponent_id is not null then
    select p.username into v_opponent_username
      from public.profiles p
     where p.id = v_match.opponent_id;
  end if;

  -- 题目按 question_ids 的原顺序返回（unnest ... with ordinality）
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',            qq.id,
               'content',       qq.content,
               'options',       qq.options,
               'course_title',  qq.course_title,
               'explanation',   case when qq.revealed then qq.explanation else null end,
               'correct_index', case
                                  when qq.revealed and jsonb_typeof(qq.answer) = 'number'
                                    then (qq.answer)::int
                                  else null
                                end
             )
             order by qq.ord
           ),
           '[]'::jsonb
         )
    into v_questions
    from (
      select q.id,
             q.content,
             q.options,
             q.explanation,
             q.answer,
             c.title as course_title,
             u.ord,
             (
               v_match.status = 'finished'
               or exists (
                 select 1
                   from public.pk_answers a
                  where a.match_id = v_match.id
                    and a.user_id = v_uid
                    and a.question_id = q.id
               )
             ) as revealed
        from unnest(v_match.question_ids) with ordinality as u(qid, ord)
        join public.questions q on q.id = u.qid
        left join public.courses c on c.id = q.course_id
    ) qq;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'question_id',    a.question_id,
               'selected_index', a.selected_index,
               'is_correct',     a.is_correct
             )
             order by a.answered_at, a.id
           ),
           '[]'::jsonb
         )
    into v_my_answers
    from public.pk_answers a
   where a.match_id = v_match.id
     and a.user_id = v_uid;

  select count(*)::int
    into v_opponent_answered
    from public.pk_answers a
   where a.match_id = v_match.id
     and a.user_id = case
                       when v_uid = v_match.challenger_id then v_match.opponent_id
                       else v_match.challenger_id
                     end;

  return jsonb_build_object(
    'id',           v_match.id,
    'status',       v_match.status,
    'question_ids', to_jsonb(v_match.question_ids),
    'challenger', jsonb_build_object(
      'id',          v_match.challenger_id,
      'username',    coalesce(v_challenger_username, '已注销用户'),
      'score',       v_match.challenger_score,
      'finished_at', v_match.challenger_finished_at
    ),
    'opponent', jsonb_build_object(
      'id',          v_match.opponent_id,
      'username',    coalesce(v_opponent_username, '已注销用户'),
      'score',       v_match.opponent_score,
      'finished_at', v_match.opponent_finished_at
    ),
    'created_at',  v_match.created_at,
    'started_at',  v_match.started_at,
    'finished_at', v_match.finished_at,
    'questions',   v_questions,
    'my_answers',  v_my_answers,
    'opponent_answered', v_opponent_answered,
    'my_role',     v_role
  );
end;
$$;

comment on function public.pk_get_match(uuid) is
  '对战详情；未作答且未结束时隐藏 correct_index/explanation，对手答案不泄露';

-- ---------------------------------------------------------------------------
-- 3.5 pk_submit_answer —— 提交一道题的答案
--
--     并发：先对 pk_matches 行加 for update 锁，同一场对战的所有提交串行化，
--           避免两个请求同时读到旧比分导致加分丢失。
--     幂等：同一题重复提交返回 already_answered=true，不重复加分。
--     结束：某方答完全部题目 → 写该方 finished_at；
--           双方都完成 → status='finished'、finished_at=now()。
-- ---------------------------------------------------------------------------
create or replace function public.pk_submit_answer(
  p_match_id uuid,
  p_question_id text,
  p_selected_index int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid                 uuid := auth.uid();
  v_match               public.pk_matches%rowtype;
  v_question            public.questions%rowtype;
  v_answer              public.pk_answers%rowtype;
  v_role                text;
  v_total               int;
  v_my_answered         int;
  v_correct_index       int;
  v_is_correct          boolean;
  v_challenger_score    int;
  v_opponent_score      int;
  v_status              text;
  v_challenger_finished timestamptz;
  v_opponent_finished   timestamptz;
  v_my_finished         boolean;
  v_opponent_finished_b boolean;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  -- 行锁：同一场对战内所有交卷请求串行执行
  select * into v_match
    from public.pk_matches
   where id = p_match_id
     for update;
  if not found then
    raise exception '对战不存在';
  end if;

  if v_uid = v_match.challenger_id then
    v_role := 'challenger';
  elsif v_uid = v_match.opponent_id then
    v_role := 'opponent';
  else
    raise exception '你不是这场对战的参与者';
  end if;

  if v_match.status = 'finished' then
    raise exception '对战已结束';
  elsif v_match.status = 'cancelled' then
    raise exception '对战已取消';
  elsif v_match.status <> 'in_progress' then
    raise exception '对战尚未开始';
  end if;

  if p_question_id is null or not (p_question_id = any (v_match.question_ids)) then
    raise exception '该题目不属于这场对战';
  end if;

  select * into v_question
    from public.questions q
   where q.id = p_question_id;
  if not found then
    raise exception '题目不存在';
  end if;

  if jsonb_typeof(v_question.answer) <> 'number' then
    raise exception '该题目不支持 PK 作答';
  end if;

  if jsonb_typeof(v_question.options) <> 'array'
     or p_selected_index is null
     or p_selected_index < 0
     or p_selected_index >= jsonb_array_length(v_question.options) then
    raise exception '选项超出范围';
  end if;

  v_correct_index := (v_question.answer)::int;

  -- 幂等：已答过该题则原样返回现状，不加分
  select * into v_answer
    from public.pk_answers a
   where a.match_id = p_match_id
     and a.user_id = v_uid
     and a.question_id = p_question_id;

  if found then
    v_my_finished := case when v_role = 'challenger'
                          then v_match.challenger_finished_at is not null
                          else v_match.opponent_finished_at is not null
                     end;
    v_opponent_finished_b := case when v_role = 'challenger'
                                  then v_match.opponent_finished_at is not null
                                  else v_match.challenger_finished_at is not null
                             end;

    return jsonb_build_object(
      'is_correct',        v_answer.is_correct,
      'correct_index',     v_correct_index,
      'status',            v_match.status,
      'challenger_score',  v_match.challenger_score,
      'opponent_score',    v_match.opponent_score,
      'my_finished',       v_my_finished,
      'opponent_finished', v_opponent_finished_b,
      'finished',          v_match.status = 'finished',
      'already_answered',  true
    );
  end if;

  v_is_correct := (v_correct_index = p_selected_index);

  insert into public.pk_answers (match_id, user_id, question_id, selected_index, is_correct)
  values (p_match_id, v_uid, p_question_id, p_selected_index, v_is_correct);

  v_total := coalesce(array_length(v_match.question_ids, 1), 0);

  select count(*)::int into v_my_answered
    from public.pk_answers a
   where a.match_id = p_match_id
     and a.user_id = v_uid;

  -- 加分 + 记录本人是否已答完（只有真正答满全部题才写 finished_at）
  update public.pk_matches
     set challenger_score = challenger_score
           + case when v_role = 'challenger' and v_is_correct then 1 else 0 end,
         opponent_score = opponent_score
           + case when v_role = 'opponent' and v_is_correct then 1 else 0 end,
         challenger_finished_at = case
             when v_role = 'challenger' and v_my_answered >= v_total
               then coalesce(challenger_finished_at, now())
             else challenger_finished_at
           end,
         opponent_finished_at = case
             when v_role = 'opponent' and v_my_answered >= v_total
               then coalesce(opponent_finished_at, now())
             else opponent_finished_at
           end
   where id = p_match_id
   returning challenger_score,
             opponent_score,
             challenger_finished_at,
             opponent_finished_at,
             status
     into v_challenger_score,
          v_opponent_score,
          v_challenger_finished,
          v_opponent_finished,
          v_status;

  -- 双方都交卷 → 对局结束
  if v_challenger_finished is not null
     and v_opponent_finished is not null
     and v_status <> 'finished' then
    update public.pk_matches
       set status      = 'finished',
           finished_at = now()
     where id = p_match_id
     returning status into v_status;
  end if;

  v_my_finished := case when v_role = 'challenger'
                        then v_challenger_finished is not null
                        else v_opponent_finished is not null
                   end;
  v_opponent_finished_b := case when v_role = 'challenger'
                                then v_opponent_finished is not null
                                else v_challenger_finished is not null
                           end;

  return jsonb_build_object(
    'is_correct',        v_is_correct,
    'correct_index',     v_correct_index,
    'status',            v_status,
    'challenger_score',  v_challenger_score,
    'opponent_score',    v_opponent_score,
    'my_finished',       v_my_finished,
    'opponent_finished', v_opponent_finished_b,
    'finished',          v_status = 'finished',
    'already_answered',  false
  );
end;
$$;

comment on function public.pk_submit_answer(uuid, text, int) is
  '提交 PK 答案；行锁串行化、重复提交幂等、答完与双方结束状态自动推进';

-- ---------------------------------------------------------------------------
-- 3.6 pk_list_matches —— 我的对战历史（我的视角）
--
--     result：finished 时 win/lose/draw，其余 pending
--     my_role：challenger/opponent，供前端区分「我挑战别人」与「别人挑战我」
--     opponent_id 为 null（对手注销）时 username 返回「已注销用户」
-- ---------------------------------------------------------------------------
create or replace function public.pk_list_matches(p_limit int default 20)
returns table (
  id                uuid,
  status            text,
  opponent_id       uuid,
  opponent_username text,
  my_score          int,
  opponent_score    int,
  result            text,
  question_count    int,
  my_role           text,
  created_at        timestamptz,
  started_at        timestamptz,
  finished_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_limit int;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  v_limit := greatest(1, least(50, coalesce(p_limit, 20)));

  return query
  select s.id,
         s.status,
         s.opponent_id,
         coalesce(p.username, '已注销用户'),
         s.my_score,
         s.opponent_score,
         case
           when s.status = 'finished' then
             case
               when s.my_score > s.opponent_score then 'win'
               when s.my_score < s.opponent_score then 'lose'
               else 'draw'
             end
           else 'pending'
         end,
         s.question_count,
         s.my_role,
         s.created_at,
         s.started_at,
         s.finished_at
    from (
      select m.id,
             m.status,
             case when m.challenger_id = v_uid then m.opponent_id
                  else m.challenger_id
             end as opponent_id,
             case when m.challenger_id = v_uid then m.challenger_score
                  else m.opponent_score
             end as my_score,
             case when m.challenger_id = v_uid then m.opponent_score
                  else m.challenger_score
             end as opponent_score,
             coalesce(array_length(m.question_ids, 1), 0) as question_count,
             case when m.challenger_id = v_uid then 'challenger'
                  else 'opponent'
             end as my_role,
             m.created_at,
             m.started_at,
             m.finished_at
        from public.pk_matches m
       where m.challenger_id = v_uid
          or m.opponent_id = v_uid
    ) s
    left join public.profiles p on p.id = s.opponent_id
   order by s.created_at desc, s.id desc
   limit v_limit;
end;
$$;

comment on function public.pk_list_matches(int) is
  '当前用户的 PK 历史（我的视角），含胜负结果、比分与我在对战中的角色';


-- ===========================================================================
-- 四、函数权限
--
--   函数一律 revoke 掉 PUBLIC（以及 anon）的 execute，只授权给 authenticated，
--   未登录用户连函数入口都进不来（函数内部另有「请先登录」兜底）。
-- ===========================================================================
revoke all on function public.friends_search(text) from public;
revoke all on function public.friends_search(text) from anon;
grant execute on function public.friends_search(text) to authenticated;

revoke all on function public.friends_send_request(uuid) from public;
revoke all on function public.friends_send_request(uuid) from anon;
grant execute on function public.friends_send_request(uuid) to authenticated;

revoke all on function public.friends_respond_request(uuid, boolean) from public;
revoke all on function public.friends_respond_request(uuid, boolean) from anon;
grant execute on function public.friends_respond_request(uuid, boolean) to authenticated;

revoke all on function public.friends_remove(uuid) from public;
revoke all on function public.friends_remove(uuid) from anon;
grant execute on function public.friends_remove(uuid) to authenticated;

revoke all on function public.friends_list() from public;
revoke all on function public.friends_list() from anon;
grant execute on function public.friends_list() to authenticated;

revoke all on function public.pk_create_match(uuid, int) from public;
revoke all on function public.pk_create_match(uuid, int) from anon;
grant execute on function public.pk_create_match(uuid, int) to authenticated;

revoke all on function public.pk_respond_match(uuid, boolean) from public;
revoke all on function public.pk_respond_match(uuid, boolean) from anon;
grant execute on function public.pk_respond_match(uuid, boolean) to authenticated;

revoke all on function public.pk_cancel_match(uuid) from public;
revoke all on function public.pk_cancel_match(uuid) from anon;
grant execute on function public.pk_cancel_match(uuid) to authenticated;

revoke all on function public.pk_get_match(uuid) from public;
revoke all on function public.pk_get_match(uuid) from anon;
grant execute on function public.pk_get_match(uuid) to authenticated;

revoke all on function public.pk_submit_answer(uuid, text, int) from public;
revoke all on function public.pk_submit_answer(uuid, text, int) from anon;
grant execute on function public.pk_submit_answer(uuid, text, int) to authenticated;

revoke all on function public.pk_list_matches(int) from public;
revoke all on function public.pk_list_matches(int) from anon;
grant execute on function public.pk_list_matches(int) to authenticated;


-- ===========================================================================
-- 五、Realtime
--
--   Supabase 云端通过 supabase_realtime publication 决定哪些表变更会广播。
--   * 裸 PostgreSQL（本地开发脚本）没有该 publication → 整段跳过；
--   * 云端重复执行时表可能已在 publication 中 → 吞掉 duplicate_object；
--   * 若 publication 已是 FOR ALL TABLES，则本来就包含所有表 → 无需添加。
-- ===========================================================================
do $$
declare
  v_all_tables boolean;
begin
  select pub.puballtables into v_all_tables
    from pg_publication pub
   where pub.pubname = 'supabase_realtime';

  -- 没有 publication（裸 PG）或已是 FOR ALL TABLES：跳过
  if v_all_tables is null or v_all_tables then
    return;
  end if;

  begin
    alter publication supabase_realtime add table public.pk_matches;
  exception
    when duplicate_object then null;  -- 已在 publication 中
  end;

  begin
    alter publication supabase_realtime add table public.friendships;
  exception
    when duplicate_object then null;
  end;
end $$;