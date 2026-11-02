-- ============================================================================
-- HistoriaQuest — PK 超时 / 掉线判负
-- Migration: 20250101000014_pk_timeout
--
-- 背景：
--   迁移 13 的 PK 只有「双方都答完」才会结束。如果对手应战后直接退出，
--   对局会永远停在 in_progress，剩下的一方只能干等。本迁移补上服务端结算：
--
--   1. pk_matches 增加 finished_reason（completed / timeout）与 forfeited_by；
--   2. pk_settle_stale_matches(p_timeout_minutes)：
--        超过 N 分钟没有「作答 / 交卷」动作的一方判负；
--        双方都超时则保留比分，按比分判胜/负/平；
--        已经交卷的一方不会被判负（只可能因另一位超时获胜）。
--   3. pk_get_match / pk_list_matches 读取前先调用结算，客户端无需额外 RPC；
--      这样离线用户下次打开好友页或 PK 房间时也能看到已结算的结果。
--   4. 正常双方交卷时由触发器补 finished_reason='completed'，不重写大函数。
--
-- 超时阈值：服务端固定 10 分钟（与前端 PK_TIMEOUT_MINUTES 一致）。
-- 幂等性：列 if not exists、约束先查 pg_constraint、函数 create or replace，
--         触发器先 drop 再建；可安全重放。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 一、表结构
-- ---------------------------------------------------------------------------
alter table public.pk_matches
  add column if not exists finished_reason text,
  add column if not exists forfeited_by   uuid references public.profiles (id) on delete set null;

comment on column public.pk_matches.finished_reason is
  '结束原因：completed=双方交卷；timeout=超时/掉线结算；cancelled 的对局为 null';
comment on column public.pk_matches.forfeited_by is
  '超时判负时被判定放弃的用户；双方都超时则为 null（按比分判）';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'pk_matches_finished_reason_check'
       and conrelid = 'public.pk_matches'::regclass
  ) then
    alter table public.pk_matches
      add constraint pk_matches_finished_reason_check
      check (finished_reason is null or finished_reason in ('completed', 'timeout'));
  end if;
end $$;

-- 历史已结束对局没有原因，统一视为正常交卷
update public.pk_matches
   set finished_reason = 'completed'
 where status = 'finished'
   and finished_reason is null;

-- 结算时按 status 过滤，partial index 足够小
create index if not exists idx_pk_matches_in_progress
  on public.pk_matches (id) where status = 'in_progress';

-- ---------------------------------------------------------------------------
-- 二、正常交卷补原因（避免整段复制 pk_submit_answer）
-- ---------------------------------------------------------------------------
create or replace function public.pk_matches_default_finished_reason()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'finished'
     and old.status is distinct from 'finished'
     and new.finished_reason is null then
    new.finished_reason := 'completed';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pk_matches_finished_reason on public.pk_matches;
create trigger trg_pk_matches_finished_reason
  before update of status on public.pk_matches
  for each row execute function public.pk_matches_default_finished_reason();

-- ---------------------------------------------------------------------------
-- 三、超时结算
--
-- 规则：
--   * 最后活动时间 = 交卷时间（已交卷）或该用户最近一次作答时间或开局时间；
--   * 一方最后活动早于 now() - 超时阈值 → 该方判负；
--   * 双方都超时 → forfeited_by=null，按比分判定（平局保留 draw）；
--   * 只有一位已交卷、另一位超时 → 超时方判负（交卷方不会因等待被误判）。
-- ---------------------------------------------------------------------------
create or replace function public.pk_settle_stale_matches(p_timeout_minutes int default 10)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid              uuid := auth.uid();
  v_timeout          interval;
  v_cutoff           timestamptz;
  v_match            public.pk_matches%rowtype;
  v_base             timestamptz;
  v_challenger_last  timestamptz;
  v_opponent_last    timestamptz;
  v_challenger_stale boolean;
  v_opponent_stale   boolean;
  v_loser            uuid;
  v_settled          int := 0;
begin
  if v_uid is null then
    raise exception '请先登录';
  end if;

  v_timeout := make_interval(mins => greatest(1, least(60, coalesce(p_timeout_minutes, 10))));
  v_cutoff  := now() - v_timeout;

  for v_match in
    select *
      from public.pk_matches
     where status = 'in_progress'
       and (challenger_id = v_uid or opponent_id = v_uid)
       for update
  loop
    v_base := coalesce(v_match.started_at, v_match.created_at);

    if v_match.challenger_finished_at is not null then
      v_challenger_last := v_match.challenger_finished_at;
    else
      select max(a.answered_at) into v_challenger_last
        from public.pk_answers a
       where a.match_id = v_match.id
         and a.user_id = v_match.challenger_id;
      v_challenger_last := coalesce(v_challenger_last, v_base);
    end if;

    if v_match.opponent_id is null then
      -- 对手已注销：没有可判负的对象，交给后续人工/清理，不在这里结算
      continue;
    end if;

    if v_match.opponent_finished_at is not null then
      v_opponent_last := v_match.opponent_finished_at;
    else
      select max(a.answered_at) into v_opponent_last
        from public.pk_answers a
       where a.match_id = v_match.id
         and a.user_id = v_match.opponent_id;
      v_opponent_last := coalesce(v_opponent_last, v_base);
    end if;

    v_challenger_stale := v_challenger_last < v_cutoff;
    v_opponent_stale   := v_opponent_last   < v_cutoff;

    if v_match.challenger_finished_at is not null
       and v_match.opponent_finished_at is null then
      if not v_opponent_stale then
        continue;
      end if;
      v_loser := v_match.opponent_id;
    elsif v_match.opponent_finished_at is not null
          and v_match.challenger_finished_at is null then
      if not v_challenger_stale then
        continue;
      end if;
      v_loser := v_match.challenger_id;
    else
      -- 双方都没交卷：只有至少一方超时才结算；都超时按比分解
      if not v_challenger_stale and not v_opponent_stale then
        continue;
      elsif v_challenger_stale and v_opponent_stale then
        v_loser := null;
      elsif v_challenger_stale then
        v_loser := v_match.challenger_id;
      else
        v_loser := v_match.opponent_id;
      end if;
    end if;

    update public.pk_matches
       set status          = 'finished',
           finished_at     = now(),
           finished_reason = 'timeout',
           forfeited_by    = v_loser
     where id = v_match.id;

    v_settled := v_settled + 1;
  end loop;

  return v_settled;
end;
$$;

comment on function public.pk_settle_stale_matches(int) is
  '结算当前用户参与且超时的 PK 对局；返回本次结算数量（默认 10 分钟）';

-- ---------------------------------------------------------------------------
-- 四、读取入口先结算（客户端无需额外调用）
-- ---------------------------------------------------------------------------
create or replace function public.pk_get_match(p_match_id uuid)
returns jsonb
language plpgsql
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

  -- 超时/掉线结算：详情页每次读取都先结算一次，双方在轮询或刷新时都能看到结果
  perform public.pk_settle_stale_matches(10);

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
    'my_role',     v_role,
    'finished_reason', v_match.finished_reason,
    'forfeited_by',    v_match.forfeited_by,
    'timeout_minutes', 10
  );
end;
$$;


comment on function public.pk_get_match(uuid) is
  '对战详情；未作答且未结束时隐藏 correct_index/explanation，对手答案不泄露；读取前结算超时';

-- 返回列新增 finished_reason / forfeited_by，且函数改为 volatile（内部会结算超时）
drop function if exists public.pk_list_matches(int);

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
  finished_at       timestamptz,
  finished_reason   text,
  forfeited_by      uuid
)
language plpgsql
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

  -- 超时/掉线结算：好友页拉历史时顺手结算，避免「对手退出后永远 in_progress」
  perform public.pk_settle_stale_matches(10);

  v_limit := greatest(1, least(50, coalesce(p_limit, 20)));

  return query
  select s.id,
         s.status,
         s.opponent_id,
         coalesce(p.username, '已注销用户'),
         s.my_score,
         s.opponent_score,
         case
           when s.status <> 'finished' then 'pending'
           -- 超时判负：被判定放弃的一方直接判负，不再让「退出时领先」的人赢
           when s.finished_reason = 'timeout' and s.forfeited_by is not null then
             case when s.forfeited_by = v_uid then 'lose' else 'win' end
           when s.my_score > s.opponent_score then 'win'
           when s.my_score < s.opponent_score then 'lose'
           else 'draw'
         end,
         s.question_count,
         s.my_role,
         s.created_at,
         s.started_at,
         s.finished_at,
         s.finished_reason,
         s.forfeited_by
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
             m.finished_at,
             m.finished_reason,
             m.forfeited_by
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
  '当前用户的 PK 历史（我的视角），含胜负结果、比分、角色与超时判负标记';

-- ---------------------------------------------------------------------------
-- 五、权限
-- ---------------------------------------------------------------------------
revoke all on function public.pk_settle_stale_matches(int) from public;
revoke all on function public.pk_settle_stale_matches(int) from anon;
grant execute on function public.pk_settle_stale_matches(int) to authenticated;

revoke all on function public.pk_list_matches(int) from public;
revoke all on function public.pk_list_matches(int) from anon;
grant execute on function public.pk_list_matches(int) to authenticated;

revoke all on function public.pk_get_match(uuid) from public;
revoke all on function public.pk_get_match(uuid) from anon;
grant execute on function public.pk_get_match(uuid) to authenticated;
