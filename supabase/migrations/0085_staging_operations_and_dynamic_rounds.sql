-- 0085：第3段階（ステージング運営環境）対応。
--   (1) 周回を運営者が判断する仕様へ変更する。
--       - begin_gameは1周目分のターンだけを作る（2周目以降はお題未確定のため作らない）。
--       - create_live_preparationが要求するお題数も組数×1周に変更する
--         （2周目以降のお題は、運営者がhost_add_next_roundでその周に進む直前に指定する）。
--       - host_advance_group_result_to_nextは、次のターンが無い場合に以前は
--         即final_resultへ進めていたが、今後はawaiting_round_decision（運営者の
--         周回判断待ち）へ進める。current_phaseのCHECK制約にこの値を追加する。
--       - 新規RPC host_add_next_round：運営者が組ごとに1件お題を指定して次の周
--         （最大10周まで）を追加する（既存の本番仕様＝1組1お題を動的追加でも維持する。
--         p_topicsはgroup_id/topic_bodyの対応を持つjsonb配列で、配列の位置ではなく
--         group_idで対応させる）。新規RPC host_finish_live_from_round_decision：
--         運営者がその周でライブを終える（最終結果へ進む）。
--   (2) ステージング運営・参加の安全な分離。
--       - lives.access_restrictedを追加し、trueのライブはstaging_testersに許可された
--         利用者のみjoin_liveできるようにする（本番・通常のテストライブには影響しない。
--         既定値falseで従来どおり誰でも参加できる）。
--       - staging_testers（許可リスト。is_host()のみ発行・失効できる）を追加する。
--       - public._environment_marker（接続先が本当にステージングSupabaseかをDB側で
--         確認するための1行マーカー。このmigration自体は値を挿入しない。リモート
--         ステージングへ適用する際、運営がDashboard/psqlから手動で
--         insert into public._environment_marker values ('staging', ...) を実行する想定）。
--   0001〜0084は編集せず、既存のRPC（create_live_preparation・begin_game・
--   host_advance_group_result_to_next・join_live）は同じ関数名・シグネチャのまま
--   create or replaceで再定義する（0068→0079→0084と同じ、このリポジトリで
--   確立済みのパターン）。SECURITY DEFINER・search_path固定・is_host()/auth.uid()の
--   検証は既存の方針を維持する。実ユーザーID・本番Project Ref・キーは一切埋め込まない。
begin;

-- ============================================================
-- 1) lives.current_phaseのCHECK制約にawaiting_round_decisionを追加する。
--    既存のmigrationが付けた制約名が何であっても確実に置き換えられるよう、
--    current_phase列を対象にするcheck制約を動的に探してdropする。
-- ============================================================
do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.lives'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%current_phase%';
  if v_conname is not null then
    execute format('alter table public.lives drop constraint %I', v_conname);
  end if;
end $$;

alter table public.lives
  add constraint lives_current_phase_check
  check (current_phase in (
    'scheduled', 'interlude', 'opening', 'topic_reveal',
    'answering', 'group_result', 'awaiting_round_decision', 'final_result', 'closed'
  ));

-- ============================================================
-- 2) ステージングの参加制限用の列・許可リスト。
-- ============================================================
alter table public.lives
  add column access_restricted boolean not null default false;

create table public.staging_testers (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz
);

alter table public.staging_testers enable row level security;

create policy "staging_testers_select_own_or_host"
  on public.staging_testers for select
  using (auth.uid() = user_id or is_host());
-- insert/update/deleteは一般ロールへ一切許可しない（下記RPC経由のみ、SECURITY DEFINERで実行）。

create function public.host_grant_staging_tester(p_user_id uuid)
returns public.staging_testers
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.staging_testers;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;
  if p_user_id is null then
    raise exception 'INVALID_USER';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'USER_NOT_FOUND';
  end if;
  insert into public.staging_testers (user_id, added_by)
    values (p_user_id, auth.uid())
    on conflict (user_id) do update
      set revoked_at = null, added_by = auth.uid(), added_at = now()
    returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.host_grant_staging_tester(uuid) from public, anon;
grant execute on function public.host_grant_staging_tester(uuid) to authenticated;

create function public.host_revoke_staging_tester(p_user_id uuid)
returns public.staging_testers
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.staging_testers;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;
  update public.staging_testers set revoked_at = now()
    where user_id = p_user_id
    returning * into v_row;
  if v_row.user_id is null then
    raise exception 'NOT_FOUND';
  end if;
  return v_row;
end;
$$;

revoke all on function public.host_revoke_staging_tester(uuid) from public, anon;
grant execute on function public.host_revoke_staging_tester(uuid) to authenticated;

-- ============================================================
-- 3) 環境マーカー：接続先が本当にステージングのSupabaseプロジェクトかを
--    クライアント表示だけに頼らずDB側でも確認できるようにする（このテーブルに
--    'staging'行が無ければ、クライアントはステージング運営操作を拒否する設計。
--    行の挿入はこのmigrationでは行わない＝本番・ローカルでは常に空のまま）。
-- ============================================================
create table public._environment_marker (
  environment text primary key,
  note text,
  set_at timestamptz not null default now()
);

alter table public._environment_marker enable row level security;

create policy "environment_marker_select_all"
  on public._environment_marker for select
  using (true);
-- insert/update/deleteは一般ロールへ許可しない（Dashboard/psqlから運営が手動で設定する）。

-- ============================================================
-- 4) create_live_preparation：必要お題数を組数×1周へ変更する（2周目以降のお題は
--    host_add_next_roundでその都度指定するため、作成時点では1周分だけ必要）。
--    lives.rounds_per_liveには「現在作成済みの周回数」として1を保存する
--    （host_add_next_roundが周を追加するたびにこの値を増やす）。
--    シグネチャ・5〜8引数の呼び出し互換性・その他の検証は0084から変更しない。
-- ============================================================
create or replace function public.create_live_preparation(
  p_scheduled_at timestamptz,
  p_title text,
  p_max_players int,
  p_planned_group_count int,
  p_topic_bank_ids uuid[],
  p_live_mode text default 'test',
  p_manual_official_sequence_number int default null,
  p_timing_profile text default 'standard'
)
returns table (ok boolean, reason text, live_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initial_rounds constant int := 1; -- src/data/liveRoomTiming.tsのROUNDS_PER_LIVE_INITIALと必ず同じ値にすること。2周目以降はhost_add_next_roundで動的に追加する。
  v_existing_id uuid;
  v_live_id uuid;
  v_needed_topics int;
  v_distinct_count int;
  v_inserted_topics int;
  v_official_seq int;
  v_timing_profile text;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  if p_live_mode not in ('test', 'official') then
    return query select false, 'ライブ種別が不正です', null::uuid;
    return;
  end if;

  v_timing_profile := coalesce(p_timing_profile, 'standard');
  if v_timing_profile not in ('standard', 'short_test') then
    return query select false, '時間プロファイルが不正です', null::uuid;
    return;
  end if;
  if v_timing_profile = 'short_test' and p_live_mode <> 'test' then
    return query select false, '本番ライブでは短縮時間(short_test)を指定できません', null::uuid;
    return;
  end if;

  if p_live_mode = 'test' and p_manual_official_sequence_number is not null then
    return query select false, 'テストライブでは開催番号を指定できません', null::uuid;
    return;
  end if;

  if p_manual_official_sequence_number is not null and p_manual_official_sequence_number <= 0 then
    return query select false, '本番開催番号は1以上の整数で指定してください', null::uuid;
    return;
  end if;

  if p_planned_group_count < 1 then
    return query select false, '組数は1以上にしてください', null::uuid;
    return;
  end if;

  -- 0085で2周固定から動的な周回追加へ変更したため、ここで渡されたお題のうち
  -- 先頭v_needed_topics件（1周目分）だけを使う。既存の呼び出し元の多くは歴史的に
  -- 2周分（組数×2）のお題を渡しているが、過剰分はここで単に使われないだけで
  -- エラーにはしない（不足のみ拒否する。begin_gameの不足チェックと同じ方針）。
  v_needed_topics := p_planned_group_count * v_initial_rounds;
  if p_topic_bank_ids is null or array_length(p_topic_bank_ids, 1) < v_needed_topics then
    return query select false, format('お題の数が足りません（%s件必要）', v_needed_topics), null::uuid;
    return;
  end if;
  select count(distinct x) into v_distinct_count from unnest(p_topic_bank_ids[1:v_needed_topics]) as x;
  if v_distinct_count <> v_needed_topics then
    return query select false, 'お題が重複しています', null::uuid;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('create_live_preparation'));

  select id into v_existing_id from public.lives where current_phase <> 'closed' limit 1;
  if v_existing_id is not null then
    return query select false, '既に進行中のライブがあります', v_existing_id;
    return;
  end if;

  if p_live_mode = 'official' then
    if p_manual_official_sequence_number is not null then
      if exists (
        select 1 from public.lives where official_sequence_number = p_manual_official_sequence_number
      ) then
        return query select
          false,
          format('開催番号#%s は既に使用されています', lpad(p_manual_official_sequence_number::text, 4, '0')),
          null::uuid;
        return;
      end if;
      v_official_seq := p_manual_official_sequence_number;
      update public.official_live_counter
        set last_value = greatest(last_value, v_official_seq)
        where id = true;
    else
      update public.official_live_counter
        set last_value = last_value + 1
        where id = true
        returning last_value into v_official_seq;
    end if;
  else
    v_official_seq := null;
  end if;

  insert into public.lives (
    scheduled_at, current_phase, title, description, max_players,
    planned_group_count, reception_starts_at, reception_ends_at, created_by,
    live_mode, official_sequence_number, timing_profile, rounds_per_live
  ) values (
    p_scheduled_at, 'scheduled', p_title, null, p_max_players,
    p_planned_group_count, null, null, auth.uid(),
    p_live_mode, v_official_seq, v_timing_profile, v_initial_rounds
  )
  returning id into v_live_id;

  insert into public.topics (live_id, body, format, topic_bank_id)
  select v_live_id, tb.body, tb.format, tb.id
  from public.topic_bank tb
  where tb.id = any(p_topic_bank_ids[1:v_needed_topics]);
  get diagnostics v_inserted_topics = row_count;

  if v_inserted_topics <> v_needed_topics then
    raise exception 'お題の登録に失敗しました（一部のお題が見つかりません）';
  end if;

  return query select true, null::text, v_live_id;
end;
$$;

-- ============================================================
-- 5) begin_game：1周目分のターンだけを作る（従来の2周固定作成をやめる）。
--    保存されたrounds_per_liveが1でなければ開始しない（多層防御）。
-- ============================================================
create or replace function public.begin_game(p_live_id uuid)
returns table (ok boolean, reason text, first_turn_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_initial_rounds constant int := 1; -- src/data/liveRoomTiming.tsのROUNDS_PER_LIVE_INITIALと必ず同じ値にすること
  v_saved_rounds int;
  v_topic_reveal_ms int;
  v_timing_profile text;
  v_planned_group_count int;
  v_player_count int;
  v_group_count int;
  v_orphan_count int;
  v_needed_topics int;
  v_topic_count int;
  v_updated_rows int;
  v_topic_ids uuid[];
  v_topic_cursor int := 1;
  v_first_turn_id uuid;
  rec record;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select planned_group_count, timing_profile, rounds_per_live
    into v_planned_group_count, v_timing_profile, v_saved_rounds
    from public.lives where id = p_live_id;
  if v_saved_rounds is distinct from v_expected_initial_rounds then
    return query select false, 'このライブの周回数の設定が1周目開始の状態になっていません。運営に確認してください。', null::uuid;
    return;
  end if;
  v_topic_reveal_ms := public._live_phase_duration_ms(v_timing_profile, 'topic_reveal');

  select count(*) into v_orphan_count
  from public.participants p
  where p.live_id = p_live_id and p.role = 'player' and p.kicked_at is null
    and not public._is_guest_identity(p.user_id, p.is_guest)
    and (
      p.group_id is null
      or not exists (
        select 1 from public.groups g
        where g.id = p.group_id
          and g.live_id = p_live_id
          and g.group_order <= coalesce(v_planned_group_count, 2147483647)
      )
    );
  if v_orphan_count > 0 then
    return query select
      false,
      '組分けが現在の組数と一致していません。「もう一度ランダムに振り分ける」を実行してから開始してください。',
      null::uuid;
    return;
  end if;

  select count(*) into v_player_count
  from public.participants p
  where p.live_id = p_live_id and p.role = 'player' and p.kicked_at is null
    and not public._is_guest_identity(p.user_id, p.is_guest);
  if v_player_count = 0 then
    return query select false, '組分けされたプレイヤーがいません', null::uuid;
    return;
  end if;

  select count(*) into v_group_count
  from public.groups
  where live_id = p_live_id
    and group_order <= coalesce(v_planned_group_count, 2147483647);
  if v_group_count = 0 then
    return query select false, '組が作成されていません', null::uuid;
    return;
  end if;

  v_needed_topics := v_group_count * v_expected_initial_rounds;
  select count(*) into v_topic_count from public.topics where live_id = p_live_id;
  if v_topic_count < v_needed_topics then
    return query select false, 'お題の準備が不足しています', null::uuid;
    return;
  end if;

  update public.lives
  set current_phase = 'topic_reveal',
      phase_deadline = now() + (v_topic_reveal_ms::text || ' milliseconds')::interval
  where id = p_live_id
    and current_phase = 'opening'
    and current_turn_id is null;
  get diagnostics v_updated_rows = row_count;
  if v_updated_rows = 0 then
    return query select false, 'ライブの状態が別の操作によって変更されています。最新状態を取得してください。', null::uuid;
    return;
  end if;

  select array_agg(id order by created_at asc) into v_topic_ids
  from public.topics where live_id = p_live_id;

  for rec in
    select g.id as group_id,
      v_player_count - (
        select count(*) from public.participants p
        where p.live_id = p_live_id and p.role = 'player' and p.group_id = g.id
          and p.kicked_at is null
          and not public._is_guest_identity(p.user_id, p.is_guest)
      ) as eligible_judge_count
    from public.groups g
    where g.live_id = p_live_id
      and g.group_order <= coalesce(v_planned_group_count, 2147483647)
    order by g.group_order asc
  loop
    insert into public.turns (live_id, round, group_id, topic_id, status, eligible_judge_count)
    values (p_live_id, 1, rec.group_id, v_topic_ids[v_topic_cursor], 'pending', rec.eligible_judge_count);
    v_topic_cursor := v_topic_cursor + 1;
  end loop;

  update public.topics
  set locked = true
  where id = any(v_topic_ids[1:v_needed_topics]);

  select t.id into v_first_turn_id
  from public.turns t
  join public.groups g on g.id = t.group_id
  where t.live_id = p_live_id and t.round = 1
  order by g.group_order asc
  limit 1;

  update public.turns set status = 'active' where id = v_first_turn_id;

  update public.lives
  set current_turn_id = v_first_turn_id,
      answering_paused = false,
      answering_remaining_ms = null
  where id = p_live_id;

  return query select true, null::text, v_first_turn_id;
end;
$$;

-- ============================================================
-- 6) host_advance_group_result_to_next：次のターンが無い場合、以前は即
--    final_resultへ進めていたが、今後はawaiting_round_decision（運営者の
--    周回判断待ち）へ進める。current_turn_idは変更しない（直前の組の結果表示を
--    参加者画面がそのまま保持し続けられるようにするため）。
-- ============================================================
create or replace function public.host_advance_group_result_to_next(
  p_live_id uuid,
  p_expected_turn_id uuid,
  p_topic_reveal_duration_ms integer default null
)
returns table (updated boolean, advanced_to text, live public.lives)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live public.lives%rowtype;
  v_next_turn_id uuid;
  v_duration_ms integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    return query select false, null::text, null::public.lives;
    return;
  end if;
  v_duration_ms := public._live_phase_duration_ms(v_live.timing_profile, 'topic_reveal');

  if v_live.current_phase <> 'group_result' or v_live.current_turn_id is distinct from p_expected_turn_id then
    return query select false, null::text, v_live;
    return;
  end if;

  if v_live.phase_deadline is null or now() < v_live.phase_deadline then
    return query select false, null::text, v_live;
    return;
  end if;

  select next_id into v_next_turn_id
  from (
    select t.id, lead(t.id) over (order by t.round asc, g.group_order asc) as next_id
    from public.turns t
    join public.groups g on g.id = t.group_id
    where t.live_id = p_live_id
  ) ordered
  where ordered.id = p_expected_turn_id;

  if v_next_turn_id is not null then
    update public.lives
      set current_turn_id = v_next_turn_id,
          current_phase = 'topic_reveal',
          phase_deadline = now() + make_interval(secs => v_duration_ms / 1000.0),
          answering_paused = false,
          answering_remaining_ms = null
      where id = p_live_id
      returning * into v_live;

    update public.turns set status = 'active' where id = v_next_turn_id;

    return query select true, 'topic_reveal'::text, v_live;
  else
    -- このラウンドの全組が終了した。以前はここで即final_resultへ進めていたが、
    -- 今後は運営者が「次の周へ進む」か「ライブを終了する」かを選ぶまで待つ。
    -- current_turn_id・current_phaseの直前の組結果は変更しない（参加者画面は
    -- awaiting_round_decisionでもこのturn/topicを使って直前の結果を表示し続ける）。
    update public.lives
      set current_phase = 'awaiting_round_decision',
          phase_deadline = null
      where id = p_live_id
      returning * into v_live;

    return query select true, 'awaiting_round_decision'::text, v_live;
  end if;
end;
$$;

revoke all on function public.host_advance_group_result_to_next(uuid, uuid, integer) from public, anon;
grant execute on function public.host_advance_group_result_to_next(uuid, uuid, integer) to authenticated;

-- advance_live_progress_if_due（補助tick用の一括RPC）：group_resultの分岐が
-- 返すactionラベルに、新しいawaiting_round_decision遷移を反映する。
-- is_host()を要求しない既存の方針（0079）は変更しない。
create or replace function public.advance_live_progress_if_due(
  p_live_id uuid,
  p_expected_turn_id uuid
)
returns table (updated boolean, live public.lives, answer public.answers, action text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live public.lives%rowtype;
  v_active_answer_id uuid;
  v_reveal_result record;
  v_resolve_result record;
  v_pause_result record;
  v_advance_result record;
  v_next_result record;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  select * into v_live from public.lives where id = p_live_id;
  if not found then
    return query select false, null::public.lives, null::public.answers, null::text;
    return;
  end if;

  if v_live.current_phase = 'interlude' then
    select * into v_next_result from public.host_advance_interlude_to_opening(p_live_id);
    return query select
      v_next_result.updated,
      v_next_result.live,
      null::public.answers,
      (case when v_next_result.updated then 'advanced_to_opening' else null end);
    return;
  end if;

  if v_live.current_phase = 'topic_reveal' then
    select * into v_next_result from public.host_advance_topic_reveal_to_answering(p_live_id, p_expected_turn_id);
    return query select
      v_next_result.updated,
      v_next_result.live,
      null::public.answers,
      (case when v_next_result.updated then 'advanced_to_answering' else null end);
    return;
  end if;

  if v_live.current_phase = 'group_result' then
    select * into v_next_result from public.host_advance_group_result_to_next(p_live_id, p_expected_turn_id);
    return query select
      v_next_result.updated,
      (v_next_result.live),
      null::public.answers,
      (case
        when not v_next_result.updated then null
        when v_next_result.advanced_to = 'final_result' then 'advanced_to_final_result'
        when v_next_result.advanced_to = 'awaiting_round_decision' then 'advanced_to_round_decision'
        else 'advanced_to_topic_reveal'
      end);
    return;
  end if;

  if v_live.current_phase <> 'answering' then
    -- opening（beginGame待ち）・awaiting_round_decision（運営の周回判断待ち）・
    -- final_result・closed等：補助tickで行うことは無い。
    return query select false, v_live, null::public.answers, null::text;
    return;
  end if;

  select id into v_active_answer_id
  from public.answers
  where turn_id = p_expected_turn_id and revealed_at is not null and resolved = false
  limit 1;

  if v_active_answer_id is not null then
    select * into v_resolve_result from public.resolve_answer_if_due(v_active_answer_id);
    if v_resolve_result.updated then
      return query select true, v_resolve_result.live, v_resolve_result.answer, 'resolved'::text;
      return;
    end if;
    select * into v_pause_result from public.sync_answering_pause_if_due(p_live_id, p_expected_turn_id);
    return query select
      v_pause_result.updated,
      v_pause_result.live,
      null::public.answers,
      (case when v_pause_result.updated then 'paused'::text else null::text end);
    return;
  end if;

  select * into v_reveal_result from public.reveal_next_answer_if_due(p_live_id, p_expected_turn_id);
  if v_reveal_result.updated then
    return query select true, v_reveal_result.live, v_reveal_result.answer, 'revealed'::text;
    return;
  end if;

  select * into v_pause_result from public.sync_answering_pause_if_due(p_live_id, p_expected_turn_id);
  if v_pause_result.updated then
    return query select true, v_pause_result.live, null::public.answers, 'resumed_or_paused'::text;
    return;
  end if;

  select * into v_advance_result from public.host_advance_answering_to_group_result(p_live_id, p_expected_turn_id);
  return query select
    v_advance_result.updated,
    v_advance_result.live,
    null::public.answers,
    (case when v_advance_result.updated then 'advanced_to_group_result'::text else null::text end);
end;
$$;

revoke all on function public.advance_live_progress_if_due(uuid, uuid) from public, anon;
grant execute on function public.advance_live_progress_if_due(uuid, uuid) to authenticated;

-- ============================================================
-- 7) host_add_next_round：運営者が「組ごとに1件」お題を指定して次の周を追加する
--    （既存の本番仕様＝1組につき1お題を、動的に追加する周でも維持する）。
--    awaiting_round_decisionからだけ実行できる。p_expected_roundは「これから
--    追加する周の番号」をクライアントに事前計算させ、既に別タブが追加済みなら
--    一致せず安全にok=falseを返す（多重送信・古い画面からの実行の冪等化）。
--    1ライブあたり最大10周まで（安全上の上限。本文末尾の報告で判断理由を示す）。
--
--    p_topicsは [{"group_id": "<uuid>", "topic_body": "<お題>"}, ...] 形式のjsonb配列。
--    配列の並び順（位置）は信用せず、各要素のgroup_idで対応させる。現在のライブに
--    実在する組（group_order<=planned_group_count）の集合と、入力されたgroup_idの
--    集合が完全一致しない場合（不足・過剰・重複・存在しない組）は全て拒否する。
--
--    再送時の挙動：このRPCが成功すると即座にcurrent_phaseがtopic_revealへ進む。
--    通信断等でクライアントが応答を受け取れずに同じ要求（同じp_expected_round）を
--    再送しても、その時点のcurrent_phaseはもう awaiting_round_decision ではないため、
--    フェーズ確認で拒否され、turnが二重に作られることはない。
-- ============================================================
create function public.host_add_next_round(
  p_live_id uuid,
  p_expected_round int,
  p_topics jsonb
)
returns table (ok boolean, reason text, live public.lives, first_turn_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_rounds constant int := 10; -- src/data/liveRoomTiming.tsのMAX_ROUNDS_PER_LIVEと必ず同じ値にすること
  v_max_topic_len constant int := 200; -- host_add_next_round旧版・create_live_preparationと同じ上限
  v_live public.lives%rowtype;
  v_planned_group_count int;
  v_topic_id uuid;
  v_topic_reveal_ms int;
  v_new_round int;
  v_first_turn_id uuid;
  v_expected_group_ids uuid[];
  v_seen_group_ids uuid[] := array[]::uuid[];
  v_bodies_by_group jsonb := '{}'::jsonb;
  v_elem jsonb;
  v_group_id uuid;
  v_group_id_text text;
  v_topic_body text;
  rec record;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    return query select false, 'LIVE_NOT_FOUND', null::public.lives, null::uuid;
    return;
  end if;

  if v_live.current_phase <> 'awaiting_round_decision' then
    return query select false, '現在は周回の判断待ちの状態ではありません。最新状態を確認してください。', v_live, null::uuid;
    return;
  end if;

  v_new_round := v_live.rounds_per_live + 1;
  if p_expected_round is distinct from v_new_round then
    return query select false, '既に処理されています。最新状態を確認してください。', v_live, null::uuid;
    return;
  end if;

  if v_new_round > v_max_rounds then
    return query select false, format('周回数の上限（%s周）に達しています', v_max_rounds), v_live, null::uuid;
    return;
  end if;

  if p_topics is null or jsonb_typeof(p_topics) is distinct from 'array' then
    return query select false, 'お題の指定形式が不正です', v_live, null::uuid;
    return;
  end if;

  v_planned_group_count := v_live.planned_group_count;
  select array_agg(id) into v_expected_group_ids
    from public.groups
    where live_id = p_live_id and group_order <= coalesce(v_planned_group_count, 2147483647);
  if v_expected_group_ids is null or array_length(v_expected_group_ids, 1) is null then
    return query select false, '組が見つかりません', v_live, null::uuid;
    return;
  end if;

  -- 件数の不一致（不足・過剰）は、内容を見る前にまず拒否する（「同じ組の重複」は
  -- 件数が一致している場合だけを指す別の検証として、この後の要素ループで扱う）。
  if jsonb_array_length(p_topics) is distinct from array_length(v_expected_group_ids, 1) then
    return query select false, format('お題の数が一致しません（%s件必要）', array_length(v_expected_group_ids, 1)), v_live, null::uuid;
    return;
  end if;

  -- 各要素を検証しながら、group_id（現在のライブの組として実在するもの）→
  -- trim済みお題、のマップを組み立てる。配列の位置は一切信用しない。
  for v_elem in select * from jsonb_array_elements(p_topics)
  loop
    if jsonb_typeof(v_elem -> 'group_id') is distinct from 'string' then
      return query select false, '組の指定が不正です', v_live, null::uuid;
      return;
    end if;
    v_group_id_text := v_elem ->> 'group_id';
    begin
      v_group_id := v_group_id_text::uuid;
    exception when others then
      return query select false, '組の指定が不正です', v_live, null::uuid;
      return;
    end;

    if jsonb_typeof(v_elem -> 'topic_body') is distinct from 'string' then
      return query select false, 'お題は文字列で指定してください', v_live, null::uuid;
      return;
    end if;
    v_topic_body := trim(v_elem ->> 'topic_body');

    if v_group_id = any(v_seen_group_ids) then
      return query select false, '同じ組が重複して指定されています', v_live, null::uuid;
      return;
    end if;
    if not (v_group_id = any(v_expected_group_ids)) then
      return query select false, '現在のライブに存在しない組が指定されています', v_live, null::uuid;
      return;
    end if;
    if v_topic_body = '' then
      return query select false, 'お題を入力してください', v_live, null::uuid;
      return;
    end if;
    if length(v_topic_body) > v_max_topic_len then
      return query select false, format('お題は%s文字以内で入力してください', v_max_topic_len), v_live, null::uuid;
      return;
    end if;

    v_seen_group_ids := array_append(v_seen_group_ids, v_group_id);
    v_bodies_by_group := v_bodies_by_group || jsonb_build_object(v_group_id::text, v_topic_body);
  end loop;

  -- 多層防御：件数一致・重複なしは確認済みだが、念のため「現在の組の誰にも
  -- 入力が無い」状態が無いかもここで明示的に確認する（通常はここに到達する時点で
  -- 既に集合として完全一致しているはずだが、ロジック変更時の保険として残す）。
  if exists (
    select 1 from unnest(v_expected_group_ids) as g
    where not (g = any(v_seen_group_ids))
  ) then
    return query select false, 'すべての組のお題を入力してください', v_live, null::uuid;
    return;
  end if;

  v_topic_reveal_ms := public._live_phase_duration_ms(v_live.timing_profile, 'topic_reveal');

  -- 組ごとに1件のtopics行を作り、同じ組のturnへ割り当てる（group_orderの昇順で
  -- 作成することで、1組目のturnが一貫して最初のアクティブターンになる）。
  for rec in
    select g.id as group_id
    from public.groups g
    where g.live_id = p_live_id and g.group_order <= coalesce(v_planned_group_count, 2147483647)
    order by g.group_order asc
  loop
    v_topic_body := v_bodies_by_group ->> rec.group_id::text;

    insert into public.topics (live_id, body, format, topic_bank_id, locked)
      values (p_live_id, v_topic_body, 'text', null, true)
      returning id into v_topic_id;

    insert into public.turns (live_id, round, group_id, topic_id, status, eligible_judge_count)
    values (
      p_live_id, v_new_round, rec.group_id, v_topic_id, 'pending',
      (
        select count(*) from public.participants p
        where p.live_id = p_live_id and p.role = 'player' and p.group_id <> rec.group_id
          and p.kicked_at is null
          and not public._is_guest_identity(p.user_id, p.is_guest)
      )
    );
  end loop;

  select t.id into v_first_turn_id
  from public.turns t
  join public.groups g on g.id = t.group_id
  where t.live_id = p_live_id and t.round = v_new_round
  order by g.group_order asc
  limit 1;

  update public.turns set status = 'active' where id = v_first_turn_id;

  update public.lives
    set current_turn_id = v_first_turn_id,
        current_phase = 'topic_reveal',
        phase_deadline = now() + make_interval(secs => v_topic_reveal_ms / 1000.0),
        rounds_per_live = v_new_round,
        answering_paused = false,
        answering_remaining_ms = null
    where id = p_live_id
    returning * into v_live;

  return query select true, null::text, v_live, v_first_turn_id;
end;
$$;

revoke all on function public.host_add_next_round(uuid, int, jsonb) from public, anon;
grant execute on function public.host_add_next_round(uuid, int, jsonb) to authenticated;

-- ============================================================
-- 8) host_finish_live_from_round_decision：運営者がその周でライブを終える
--    （最終結果へ進む）。awaiting_round_decisionからだけ実行できる。
--    既にfinal_resultに到達済みなら二重操作として無害に扱う（エラーにしない）。
-- ============================================================
create function public.host_finish_live_from_round_decision(p_live_id uuid)
returns table (ok boolean, reason text, live public.lives)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live public.lives%rowtype;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    return query select false, 'LIVE_NOT_FOUND', null::public.lives;
    return;
  end if;

  if v_live.current_phase = 'final_result' then
    return query select true, null::text, v_live;
    return;
  end if;

  if v_live.current_phase <> 'awaiting_round_decision' then
    return query select false, '現在は周回の判断待ちの状態ではありません。最新状態を確認してください。', v_live;
    return;
  end if;

  update public.lives
    set current_phase = 'final_result', phase_deadline = null
    where id = p_live_id
    returning * into v_live;

  return query select true, null::text, v_live;
end;
$$;

revoke all on function public.host_finish_live_from_round_decision(uuid) from public, anon;
grant execute on function public.host_finish_live_from_round_decision(uuid) to authenticated;

-- ============================================================
-- 9) join_live：access_restricted=trueのライブは、staging_testersに許可され
--    （revoked_atがnull）利用者だけが参加できるようにする。それ以外の検証・
--    組み立て（0074本体のロジック）は一切変更しない。access_restrictedの既定値は
--    falseのため、既存の本番・通常のテストライブの挙動には影響しない。
-- ============================================================
create or replace function public.join_live(p_live_id uuid, p_preferred_role text, p_referral_source text default null)
returns public.participants
language plpgsql
security definer set search_path = public
as $$
declare
  v_max int;
  v_count int;
  v_phase text;
  v_access_restricted boolean;
  v_kicked timestamptz;
  v_suspended boolean;
  v_existing_role text;
  v_is_guest boolean;
  v_guest_number int;
  v_row public.participants;
  v_profile_referral_source text;
  v_effective_referral_source text;
begin
  if p_preferred_role not in ('player', 'audience') then
    raise exception 'INVALID_ROLE';
  end if;

  if p_referral_source is not null and p_referral_source not in ('x', 'friend', 'app', 'other') then
    raise exception 'INVALID_REFERRAL_SOURCE';
  end if;

  select (is_permanently_suspended or (suspended_until is not null and suspended_until > now()))
    into v_suspended
    from public.profiles where id = auth.uid();
  if coalesce(v_suspended, false) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;

  select max_players, current_phase, access_restricted into v_max, v_phase, v_access_restricted
    from public.lives where id = p_live_id for update;
  if not found then
    raise exception 'LIVE_NOT_FOUND';
  end if;

  if v_access_restricted and not exists (
    select 1 from public.staging_testers
    where user_id = auth.uid() and revoked_at is null
  ) then
    raise exception 'STAGING_ACCESS_DENIED';
  end if;

  v_is_guest := is_guest_user();
  if v_is_guest and p_preferred_role <> 'audience' then
    raise exception 'GUEST_AUDIENCE_ONLY';
  end if;

  select kicked_at into v_kicked
    from public.participants
    where live_id = p_live_id and user_id = auth.uid();
  if v_kicked is not null then
    raise exception 'PARTICIPANT_KICKED';
  end if;

  select preferred_role into v_existing_role
    from public.participants
    where live_id = p_live_id and user_id = auth.uid();
  if v_existing_role = 'player' and p_preferred_role = 'audience' then
    raise exception 'ROLE_DOWNGRADE_NOT_ALLOWED';
  end if;

  if p_preferred_role = 'player' and v_phase not in ('interlude', 'opening') then
    raise exception 'PLAYER_JOIN_CLOSED';
  end if;

  if v_max is not null and p_preferred_role = 'player' then
    select count(*) into v_count
      from public.participants
      where live_id = p_live_id
        and preferred_role = 'player'
        and user_id <> auth.uid();
    if v_count >= v_max then
      raise exception 'PLAYER_LIMIT_REACHED';
    end if;
  end if;

  if v_is_guest then
    select coalesce(max(guest_number), 0) + 1 into v_guest_number
      from public.participants
      where live_id = p_live_id and is_guest;
  else
    v_guest_number := null;
  end if;

  if v_is_guest then
    v_effective_referral_source := null;
  else
    select referral_source into v_profile_referral_source
      from public.profiles where id = auth.uid() for update;

    if v_profile_referral_source is not null then
      v_effective_referral_source := v_profile_referral_source;
    elsif p_referral_source is not null then
      update public.profiles
        set referral_source = p_referral_source,
            referral_source_answered_at = now()
        where id = auth.uid()
          and referral_source is null;
      v_effective_referral_source := p_referral_source;
    else
      v_effective_referral_source := null;
    end if;
  end if;

  insert into public.participants (live_id, user_id, preferred_role, referral_source, is_guest, guest_number)
  values (p_live_id, auth.uid(), p_preferred_role, v_effective_referral_source, v_is_guest, v_guest_number)
  on conflict (live_id, user_id) do update
    set preferred_role = excluded.preferred_role,
        referral_source = coalesce(public.participants.referral_source, excluded.referral_source)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.join_live(uuid, text, text) to authenticated;
revoke execute on function public.join_live(uuid, text, text) from public;
revoke execute on function public.join_live(uuid, text, text) from anon;

commit;
