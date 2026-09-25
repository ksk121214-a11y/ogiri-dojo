-- ============================================================
-- ライブ進行の司会ブラウザ依存を解消する（サーバー側を正とした進行方式）。
--
-- 背景（現状の問題点）：
-- 1. 全ての自動進行（reveal→resolve→pause/resume→group_result遷移→次ターン
--    遷移→final_result）が、司会クライアントの500ms setInterval(advanceIfDue)
--    だけをドライバーにしていた。司会ブラウザが閉じる・スリープする・通信が
--    切れると進行全体が完全停止する。
-- 2. 0065のhost_advance_answering_to_group_result/host_advance_group_result_to_next
--    は「phase/turn_idの期待値確認・行ロック・アトミック性」は既にあったが、
--    ①締切(phase_deadline)を過ぎているかどうかをサーバー側で一切確認しておらず
--    締切前に直接呼んでも成功してしまう、②締切時刻そのものをクライアントの
--    Date.now()から生成した値としてそのまま受け取っていた、という2つの弱点が
--    あった。
-- 3. topic_reveal→answering・interlude→opening・回答時間のpause/resume・採点
--    確定(resolve)は、RPCすら無く生のUPDATE（RLSのis_host()のみで保護）だった。
-- 4. 採点確定(answers.resolved等の確定)とlives.reveal_sequence_untilの更新が
--    別リクエストで、片方だけ成功する部分失敗があり得た。
-- 5. close_liveがどのフェーズからでも呼べ、final_result前に終了しても本番
--    モードなら報酬付与処理まで走ってしまっていた。
--
-- 本マイグレーションの方針：
-- - 「期限到達時だけ進める」系のRPCは全てPostgreSQLのnow()で判定し、クライアントの
--   時計・自由なタイムスタンプは一切信用しない（duration_msだけを受け取り、
--   妥当な範囲へclampした上でnow()から締切を生成する）。
-- - これらのRPCはis_host()を要求しない（auth.uid()が取れていれば良い＝観客・
--   回答者を含む「認証済みの誰か」なら呼べる）。行ロック・期待するphase/turn_id・
--   締切超過・未処理回答なし、を全てサーバー側で確認してからしか状態を変えない
--   ため、呼び出し元の権限に関わらず安全（早送り・巻き戻し・情報漏えいのいずれも
--   起こり得ない）。これにより、司会ブラウザが落ちても、観客・回答者のどれか
--   1つでも画面を開いていれば進行が続く（全員が閉じている間だけ進行が止まり、
--   誰かが再度開いた瞬間にDB時刻から見て正しい状態へ即座に追いつく）。
-- - 一方、実際に裁量のある操作（ライブ準備・ゲーム開始・退場・通常終了・
--   緊急中止等）は引き続きis_host()必須のまま変更しない。
-- - 本番Supabaseへは未適用。既存マイグレーション0001〜0078は書き換えない
--   （0065が定義した関数は本ファイルでcreate or replace／drop&createにより
--   差し替えるが、0065のファイル自体は無編集）。
-- ============================================================

-- 途中で1文でも失敗した場合に半端な状態を残さないよう、ファイル全体を1トランザクションにする
-- （0068・0073と同じ流儀）。
begin;

-- ------------------------------------------------------------
-- 0) lives：通常終了と緊急中止を区別するための列、回答表示前の約2.2秒の間
--    （ドラマチックポーズ）をDB時刻だけで管理するための列、および
--    ライブごとの信頼済み時間プロファイルを保持する列を追加する。
-- ------------------------------------------------------------
alter table public.lives
  add column if not exists emergency_closed boolean not null default false,
  add column if not exists emergency_close_reason text,
  -- 2回目レビュー対応：次の回答をreveal（表示）してよい時刻。未発表回答が
  -- ある状態を最初に検知した呼び出しがnow()+2200msをここへ書き込み、以後の
  -- 呼び出しはこの時刻を過ぎるまでreveal_next_answer_if_dueが実際には
  -- revealしない（クライアントのDate.now()に頼らないための「進行中の間」印）。
  add column if not exists next_reveal_pending_at timestamptz,
  -- 3回目レビュー対応（項目2：通常時間と短縮テスト時間の不一致解消）：
  -- 'standard'=本番相当の時間、'short_test'=通し稽古用の短縮時間。
  -- 進行RPC・画面表示のどちらも、この列の値だけを見て時間を決める（クライアントの
  -- NEXT_PUBLIC_LIVE_TIMING_MODEというビルド時フラグには一切依存しなくする）。
  -- 既存ライブは既定値'standard'に揃う。
  add column if not exists timing_profile text not null default 'standard';

alter table public.lives drop constraint if exists lives_timing_profile_enum_check;
alter table public.lives
  add constraint lives_timing_profile_enum_check
  check (timing_profile in ('standard', 'short_test'));

-- 公式(本番)ライブはshort_testへ変更できない（DB制約による最後の砦。
-- RPC側でも同じ条件をアプリ的なエラーとして先に拒否するが、それとは別に
-- ここでも強制する）。
alter table public.lives drop constraint if exists lives_official_timing_profile_check;
alter table public.lives
  add constraint lives_official_timing_profile_check
  check (live_mode <> 'official' or timing_profile = 'standard');

-- ------------------------------------------------------------
-- 0b) _live_phase_duration_ms：timing_profileごとの各フェーズの持ち時間を
--     1箇所にまとめたヘルパー。src/data/liveRoomTiming.tsのSTANDARD_TIMING/
--     SHORT_TEST_TIMINGと必ず同じ値にすること（変更時は両方直す）。
--     一般利用者・匿名ゲストに時間を渡させないという方針は変えないため、
--     入力はlives.timing_profile（DBの信頼済みの値）のみで、クライアントからの
--     任意の数値は一切受け取らない。
-- ------------------------------------------------------------
create or replace function public._live_phase_duration_ms(p_timing_profile text, p_phase text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_timing_profile
    when 'short_test' then
      case p_phase
        when 'interlude' then 4000
        when 'opening' then 8000
        when 'topic_reveal' then 7000
        when 'answering' then 20000
        when 'judge' then 6000
        when 'group_result' then 6000
      end
    else
      case p_phase
        when 'interlude' then 15000
        when 'opening' then 45000
        when 'topic_reveal' then 13000
        when 'answering' then 60000
        when 'judge' then 10000
        when 'group_result' then 15000
      end
  end;
$$;

revoke execute on function public._live_phase_duration_ms(text, text) from public;
revoke execute on function public._live_phase_duration_ms(text, text) from anon;
revoke execute on function public._live_phase_duration_ms(text, text) from authenticated;

-- ------------------------------------------------------------
-- 0b2) get_live_server_time（4回目レビュー対応）：DBの現在時刻だけを返す軽量RPC。
--     クライアントの共通時計(src/lib/serverClock.ts)が「往復時間の中間点」で
--     サーバー時刻との差を求めるために使う。締切(phase_deadline等)はDBのnow()から
--     作られるため、端末時計のずれ(±30秒・±60秒等)が残り時間表示・拍手音・BGM
--     開始位置に影響しないようにする。
--     戻り値はtimestamptz1つだけ（ライブ・個人情報は一切返さない）。
--     権限：authenticatedのみ。匿名ゲスト(signInAnonymously)もSupabase上では
--     authenticatedロールとして動作する設計（0070のis_guest_user()参照）のため、
--     ゲストにもこのgrantで足りる。anon（未ログイン）・publicにはgrantしない
--     （未ログインではライブ画面の進行タイマーを使わない）。
-- ------------------------------------------------------------
create or replace function public.get_live_server_time()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select clock_timestamp();
$$;

revoke execute on function public.get_live_server_time() from public;
revoke execute on function public.get_live_server_time() from anon;
grant execute on function public.get_live_server_time() to authenticated;

-- ============================================================
-- 0c) create_live_preparation：ライブ作成時にtiming_profileを指定できるようにする
--    （3回目レビュー対応・項目2）。0073版（7引数）とロジックは完全に同一で、
--    末尾にp_timing_profile（既定値'standard'）を追加しただけ。0073のファイル
--    自体は無編集（drop&createで差し替える。0068・0073と同じ流儀）。
--    is_host()必須なのは変更なし＝一般利用者・観客・回答者・ゲストはそもそも
--    この関数を呼べない。official（本番）ライブにshort_testは指定できない
--    （アプリ的なエラーとしてここで先に拒否し、万一すり抜けても上のDB制約
--    lives_official_timing_profile_checkが最後の砦として拒否する）。
-- ============================================================
drop function if exists public.create_live_preparation(timestamptz, text, int, int, uuid[], text, int);

create or replace function public.create_live_preparation(
  p_scheduled_at timestamptz,
  p_title text,
  p_max_players int,
  p_planned_group_count int,
  p_topic_bank_ids uuid[],
  p_live_mode text default 'test',
  p_manual_official_sequence_number int default null,
  -- 2026-09-25追加：作成時の時間プロファイル。nullなら'standard'として扱う。
  p_timing_profile text default 'standard'
)
returns table (ok boolean, reason text, live_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rounds_per_live constant int := 1; -- src/data/liveRoomTiming.tsのROUNDS_PER_LIVE_DEFAULTと必ず同じ値にすること
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

  -- 2026-09-22追加：テストライブでは開催番号を消費させない（手動指定自体を拒否する）。
  if p_live_mode = 'test' and p_manual_official_sequence_number is not null then
    return query select false, 'テストライブでは開催番号を指定できません', null::uuid;
    return;
  end if;

  -- 2026-09-22追加：0・負数・小数はここで拒否する（小数はint引数の時点でPostgres側の
  -- 型変換エラーになるため、ここでは主に0・負数を拒否する）。
  if p_manual_official_sequence_number is not null and p_manual_official_sequence_number <= 0 then
    return query select false, '本番開催番号は1以上の整数で指定してください', null::uuid;
    return;
  end if;

  if p_planned_group_count < 1 then
    return query select false, '組数は1以上にしてください', null::uuid;
    return;
  end if;

  v_needed_topics := p_planned_group_count * v_rounds_per_live;
  if p_topic_bank_ids is null or array_length(p_topic_bank_ids, 1) is distinct from v_needed_topics then
    return query select false, format('お題の数が一致しません（%s件必要）', v_needed_topics), null::uuid;
    return;
  end if;
  select count(distinct x) into v_distinct_count from unnest(p_topic_bank_ids) as x;
  if v_distinct_count <> array_length(p_topic_bank_ids, 1) then
    return query select false, 'お題が重複しています', null::uuid;
    return;
  end if;

  -- (a) この関数の実行自体を直列化する（0055・0068から変更なし）。手動番号の
  -- 重複チェック～カウンター更新も、この直列化のおかげで同時作成時に安全になる。
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
    live_mode, official_sequence_number, timing_profile
  ) values (
    p_scheduled_at, 'scheduled', p_title, null, p_max_players,
    p_planned_group_count, null, null, auth.uid(),
    p_live_mode, v_official_seq, v_timing_profile
  )
  returning id into v_live_id;

  insert into public.topics (live_id, body, format, topic_bank_id)
  select v_live_id, tb.body, tb.format, tb.id
  from public.topic_bank tb
  where tb.id = any(p_topic_bank_ids);
  get diagnostics v_inserted_topics = row_count;

  if v_inserted_topics <> v_needed_topics then
    raise exception 'お題の登録に失敗しました（一部のお題が見つかりません）';
  end if;

  return query select true, null::text, v_live_id;
end;
$$;

revoke execute on function public.create_live_preparation(timestamptz, text, int, int, uuid[], text, int, text) from public;
revoke execute on function public.create_live_preparation(timestamptz, text, int, int, uuid[], text, int, text) from anon;
grant execute on function public.create_live_preparation(timestamptz, text, int, int, uuid[], text, int, text) to authenticated;

-- ============================================================
-- 0d) begin_game：opening→topic_reveal（ゲーム開始、最初のお題発表）の締切も
--    timing_profileから取得するようにする（3回目レビュー対応・項目2）。
--    0071版（本文は966〜1103行目、以後未変更）とロジックは完全に同一で、
--    v_topic_reveal_ms（以前は固定13000ms）だけをこのライブのtiming_profileから
--    取得するよう変更した。これは司会が一度だけ手動で押す裁量操作
--    （is_host()必須のまま変更しない）だが、その後のtopic_revealフェーズの
--    締切そのものは他の自動進行フェーズと同じ意味を持つため、short_testの
--    ライブで最初のお題発表だけ本番相当の13秒になる、という食い違いを防ぐ。
-- ============================================================
create or replace function public.begin_game(p_live_id uuid)
returns table (ok boolean, reason text, first_turn_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rounds constant int := 1;
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
  round_no int;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select planned_group_count, timing_profile into v_planned_group_count, v_timing_profile
    from public.lives where id = p_live_id;
  v_topic_reveal_ms := public._live_phase_duration_ms(v_timing_profile, 'topic_reveal');

  select count(*) into v_orphan_count
  from public.participants p
  where p.live_id = p_live_id and p.role = 'player' and p.kicked_at is null
    -- 0071追加（3回目レビュー対応で統一判定へ変更）：ゲストは組整合チェックの
    -- 対象外にする（多層防御。7)のトリガーにより通常はrole='player'になり得ない）。
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
    -- 0071追加（3回目レビュー対応で統一判定へ変更）：ゲストはプレイヤー人数から
    -- 除外する（多層防御）。
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

  v_needed_topics := v_group_count * v_rounds;
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

  for round_no in 1..v_rounds loop
    for rec in
      select g.id as group_id,
        v_player_count - (
          select count(*) from public.participants p
          where p.live_id = p_live_id and p.role = 'player' and p.group_id = g.id
            and p.kicked_at is null
            -- 0071追加（3回目レビュー対応で統一判定へ変更）：ゲストは審査員の
            -- 分母から除外する（多層防御）。
            and not public._is_guest_identity(p.user_id, p.is_guest)
        ) as eligible_judge_count
      from public.groups g
      where g.live_id = p_live_id
        and g.group_order <= coalesce(v_planned_group_count, 2147483647)
      order by g.group_order asc
    loop
      insert into public.turns (live_id, round, group_id, topic_id, status, eligible_judge_count)
      values (p_live_id, round_no, rec.group_id, v_topic_ids[v_topic_cursor], 'pending', rec.eligible_judge_count);
      v_topic_cursor := v_topic_cursor + 1;
    end loop;
  end loop;

  update public.topics
  set locked = true
  where id = any(v_topic_ids[1:v_topic_cursor - 1]);

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

grant execute on function public.begin_game(uuid) to authenticated;
revoke execute on function public.begin_game(uuid) from public;
revoke execute on function public.begin_game(uuid) from anon;

-- ============================================================
-- 1) host_advance_answering_to_group_result
--    answering→group_result。0065版との違い：
--    - p_group_result_deadline(timestamptz)ではなくp_group_result_duration_ms
--      を受け取るが、この引数の値は使わない（2回目レビュー対応：一般利用者・
--      匿名ゲストもauthenticatedとしてこのRPCを直接呼べるため、時間を自由に
--      渡せる引数を残すと回答時間・組結果時間の短縮/延長に悪用できてしまう。
--      引数自体は既存呼び出し元との互換のため残すが、締切は必ずこの関数内の
--      固定値(GROUP_RESULT_DURATION_MS、src/data/liveRoomTiming.tsの
--      PRODUCTION_TIMING.groupResultMsと同じ15000ms)から生成する）。
--    - phase_deadlineを過ぎている・answering_pausedでない・reveal_sequence_until
--      が終わっている・未表示/未確定の回答が残っていない、を全てサーバー側で
--      確認してからしか遷移しない。
--    - is_host()を要求しない（auth.uid()が取れていれば良い）。
-- ============================================================
drop function if exists public.host_advance_answering_to_group_result(uuid, uuid, timestamptz);

create function public.host_advance_answering_to_group_result(
  p_live_id uuid,
  p_expected_turn_id uuid,
  p_group_result_duration_ms integer default null
)
returns table (updated boolean, live public.lives)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live public.lives%rowtype;
  -- 2回目レビュー対応：クライアントから渡されたp_group_result_duration_msは
  -- 一切使わない（コンパイラ/リンタが未使用引数を警告しないPL/pgSQLの都合上、
  -- 意図的に無視していることが分かるよう変数へは代入しない）。
  -- 3回目レビュー対応：固定値の15000msではなく、このライブのtiming_profile
  -- （'standard'/'short_test'）から時間を取得する。
  v_duration_ms integer;
  v_pending_count integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    return query select false, null::public.lives;
    return;
  end if;
  v_duration_ms := public._live_phase_duration_ms(v_live.timing_profile, 'group_result');

  if v_live.current_phase <> 'answering' or v_live.current_turn_id is distinct from p_expected_turn_id then
    return query select false, v_live;
    return;
  end if;

  -- 一時停止中（審査サイクル中）は進めない。
  if v_live.answering_paused then
    return query select false, v_live;
    return;
  end if;

  -- サーバー側の期限確認：DBのnow()で本当に締切を過ぎている場合だけ進める
  -- （クライアントの時計のずれ・締切前の直接呼び出しはここで安全に拒否される）。
  if v_live.phase_deadline is null or now() < v_live.phase_deadline then
    return query select false, v_live;
    return;
  end if;

  -- 採点確定演出が終わるまでは進めない。
  if v_live.reveal_sequence_until is not null and now() < v_live.reveal_sequence_until then
    return query select false, v_live;
    return;
  end if;

  -- 未表示・未確定の回答が残っていないか、その場でDBを直接数える
  -- （「取得できなかった＝0件」という誤判定が原理的に起こらない）。
  select count(*) into v_pending_count
  from public.answers
  where turn_id = p_expected_turn_id
    and (revealed_at is null or resolved = false);
  if v_pending_count > 0 then
    return query select false, v_live;
    return;
  end if;

  update public.lives
    set current_phase = 'group_result',
        phase_deadline = now() + make_interval(secs => v_duration_ms / 1000.0),
        answering_paused = false,
        answering_remaining_ms = null,
        -- reveal_next_answer_if_dueのドラマチックポーズ管理用タイマーは
        -- answeringフェーズ専用なので、次のフェーズへ持ち越さない。
        next_reveal_pending_at = null
    where id = p_live_id
    returning * into v_live;

  update public.turns set status = 'done' where id = p_expected_turn_id;

  return query select true, v_live;
end;
$$;

revoke execute on function public.host_advance_answering_to_group_result(uuid, uuid, integer) from public;
revoke execute on function public.host_advance_answering_to_group_result(uuid, uuid, integer) from anon;
grant execute on function public.host_advance_answering_to_group_result(uuid, uuid, integer) to authenticated;

-- ============================================================
-- 2) host_advance_group_result_to_next
--    group_result→次ターン(topic_reveal)/final_result。0065版との違いは
--    上と同様（duration_ms化、締切超過のサーバー確認、is_host()不要）。
-- ============================================================
drop function if exists public.host_advance_group_result_to_next(uuid, uuid, timestamptz);

create function public.host_advance_group_result_to_next(
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
  -- 2回目レビュー対応：p_topic_reveal_duration_msは使わない（上のコメント参照）。
  -- 3回目レビュー対応：固定値ではなくtiming_profileから取得する。
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
    update public.lives
      set current_phase = 'final_result',
          phase_deadline = null
      where id = p_live_id
      returning * into v_live;

    return query select true, 'final_result'::text, v_live;
  end if;
end;
$$;

revoke execute on function public.host_advance_group_result_to_next(uuid, uuid, integer) from public;
revoke execute on function public.host_advance_group_result_to_next(uuid, uuid, integer) from anon;
grant execute on function public.host_advance_group_result_to_next(uuid, uuid, integer) to authenticated;

-- ============================================================
-- 3) host_advance_topic_reveal_to_answering（新規）
--    topic_reveal→answering。以前は生のupdateLiveIfPhase（クライアント直接UPDATE）
--    だけで、締切超過のサーバー確認が無かった。
-- ============================================================
create or replace function public.host_advance_topic_reveal_to_answering(
  p_live_id uuid,
  p_expected_turn_id uuid,
  p_answering_duration_ms integer default null
)
returns table (updated boolean, live public.lives)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live public.lives%rowtype;
  -- 2回目レビュー対応：p_answering_duration_msは使わない（上のコメント参照）。
  -- 3回目レビュー対応：固定値ではなくtiming_profileから取得する。
  v_duration_ms integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    return query select false, null::public.lives;
    return;
  end if;
  v_duration_ms := public._live_phase_duration_ms(v_live.timing_profile, 'answering');

  if v_live.current_phase <> 'topic_reveal' or v_live.current_turn_id is distinct from p_expected_turn_id then
    return query select false, v_live;
    return;
  end if;
  if v_live.phase_deadline is null or now() < v_live.phase_deadline then
    return query select false, v_live;
    return;
  end if;

  update public.lives
    set current_phase = 'answering',
        phase_deadline = now() + make_interval(secs => v_duration_ms / 1000.0),
        answering_paused = false,
        answering_remaining_ms = null,
        -- 新しいターンの回答受付を、前のターンの残り物のドラマチックポーズ
        -- タイマーを持ち越さず、必ずクリアな状態から始める。
        next_reveal_pending_at = null
    where id = p_live_id
    returning * into v_live;

  return query select true, v_live;
end;
$$;

revoke execute on function public.host_advance_topic_reveal_to_answering(uuid, uuid, integer) from public;
revoke execute on function public.host_advance_topic_reveal_to_answering(uuid, uuid, integer) from anon;
grant execute on function public.host_advance_topic_reveal_to_answering(uuid, uuid, integer) to authenticated;

-- ============================================================
-- 4) host_advance_interlude_to_opening（新規）
--    interlude→opening。以前は生のupdateLive（期待フェーズの確認すら無い
--    単純UPDATE）だった。interludeにcurrent_turn_idは存在しない（ゲーム開始前）
--    ため、turn_idの期待値確認は行わない。
-- ============================================================
create or replace function public.host_advance_interlude_to_opening(
  p_live_id uuid,
  p_opening_duration_ms integer default null
)
returns table (updated boolean, live public.lives)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live public.lives%rowtype;
  -- 2回目レビュー対応：p_opening_duration_msは使わない（上のコメント参照）。
  -- 3回目レビュー対応：固定値ではなくtiming_profileから取得する。
  v_duration_ms integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    return query select false, null::public.lives;
    return;
  end if;
  v_duration_ms := public._live_phase_duration_ms(v_live.timing_profile, 'opening');

  if v_live.current_phase <> 'interlude' then
    return query select false, v_live;
    return;
  end if;
  if v_live.phase_deadline is null or now() < v_live.phase_deadline then
    return query select false, v_live;
    return;
  end if;

  update public.lives
    set current_phase = 'opening',
        phase_deadline = now() + make_interval(secs => v_duration_ms / 1000.0)
    where id = p_live_id
    returning * into v_live;

  return query select true, v_live;
end;
$$;

revoke execute on function public.host_advance_interlude_to_opening(uuid, integer) from public;
revoke execute on function public.host_advance_interlude_to_opening(uuid, integer) from anon;
grant execute on function public.host_advance_interlude_to_opening(uuid, integer) to authenticated;

-- ============================================================
-- 4b) open_reception（新規・3回目レビュー対応・項目1）
--    「参加受付を開始する」(scheduled→interlude)。以前はクライアントの
--    Date.now()から締切を作り、生のUPDATE（RLSのlives_write_host＝is_host()の
--    みで保護、締切超過確認なし・phase以外の期待値確認なし）で行っていた。
--    司会端末の時計が進んでいる／遅れていると、最初の受付だけ早く進んだり
--    0秒のまま止まったりし得た。
--    他のhost_advance_*と異なり、これは「時間経過で自動的に進む」操作ではなく
--    「司会が今この瞬間に受付を開始する」という裁量操作なので、is_host()を
--    要求したまま変更しない（観客・回答者からは呼べない）。締切(phase_deadline)
--    だけをDBのnow()＋信頼済みtiming_profileの時間から生成する。
-- ============================================================
create or replace function public.open_reception(p_live_id uuid)
returns table (updated boolean, live public.lives, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live public.lives%rowtype;
  v_duration_ms integer;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    return query select false, null::public.lives, 'LIVE_NOT_FOUND'::text;
    return;
  end if;

  -- current_phase='scheduled'のみ許可する：終了済み(closed)・緊急中止済み
  -- （emergency_close_liveはcurrent_phase='closed'にする）・既に受付開始済み
  -- (interlude以降)のいずれも、ここで安全に拒否される。二重クリック・複数タブ
  -- からの同時実行は、行ロック(for update)により1つ目の更新が確定してから
  -- でないと2つ目が読み進められないため、2つ目は必ずcurrent_phase<>'scheduled'
  -- を見て「想定内の操作」として何もせず返る（例外にはしない）。
  if v_live.current_phase <> 'scheduled' then
    return query select false, v_live, 'NOT_SCHEDULED'::text;
    return;
  end if;

  v_duration_ms := public._live_phase_duration_ms(v_live.timing_profile, 'interlude');

  update public.lives
    set current_phase = 'interlude',
        phase_deadline = now() + make_interval(secs => v_duration_ms / 1000.0)
    where id = p_live_id
    returning * into v_live;

  return query select true, v_live, null::text;
end;
$$;

revoke execute on function public.open_reception(uuid) from public;
revoke execute on function public.open_reception(uuid) from anon;
grant execute on function public.open_reception(uuid) to authenticated;

-- ============================================================
-- 5) sync_answering_pause_if_due（新規）
--    answering中の持ち時間の一時停止／再開をアトミックに行う。busy判定
--    （未表示/未確定の回答がある、または演出シーケンス中）をRPC内で直接
--    再計算するため、クライアントの古いstateを信じる余地が無い。
--    行ロック後に現在のanswering_pausedを読み直してから判定するため、
--    複数タブ・順序逆転・同時実行でも矛盾した状態にならない。
-- ============================================================
create or replace function public.sync_answering_pause_if_due(
  p_live_id uuid,
  p_expected_turn_id uuid
)
returns table (updated boolean, live public.lives)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live public.lives%rowtype;
  v_busy boolean;
  v_remaining_ms bigint;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    return query select false, null::public.lives;
    return;
  end if;

  if v_live.current_phase <> 'answering' or v_live.current_turn_id is distinct from p_expected_turn_id then
    return query select false, v_live;
    return;
  end if;

  select
    exists(
      select 1 from public.answers
      where turn_id = p_expected_turn_id
        and (revealed_at is null or resolved = false)
    )
    or (v_live.reveal_sequence_until is not null and now() < v_live.reveal_sequence_until)
  into v_busy;

  if v_busy and not v_live.answering_paused then
    v_remaining_ms := case
      when v_live.phase_deadline is null then 0
      else greatest(0, floor(extract(epoch from (v_live.phase_deadline - now())) * 1000))::bigint
    end;
    update public.lives
      set answering_paused = true,
          answering_remaining_ms = v_remaining_ms,
          phase_deadline = null
      where id = p_live_id
      returning * into v_live;
    return query select true, v_live;
    return;
  end if;

  if not v_busy and v_live.answering_paused then
    update public.lives
      set answering_paused = false,
          phase_deadline = now() + make_interval(secs => coalesce(v_live.answering_remaining_ms, 0) / 1000.0),
          answering_remaining_ms = null
      where id = p_live_id
      returning * into v_live;
    return query select true, v_live;
    return;
  end if;

  return query select false, v_live;
end;
$$;

revoke execute on function public.sync_answering_pause_if_due(uuid, uuid) from public;
revoke execute on function public.sync_answering_pause_if_due(uuid, uuid) from anon;
grant execute on function public.sync_answering_pause_if_due(uuid, uuid) to authenticated;

-- ============================================================
-- 6) resolve_answer_if_due（新規）
--    採点確定処理の原子化。以前は「answers.resolved等の確定」と
--    「lives.reveal_sequence_untilの更新」が別リクエストで、片方だけ成功する
--    部分失敗があり得た。本RPCは対象回答の行ロック→未確定確認→scoresの
--    サーバー側集計→確定条件（全員投票済み or 締切+猶予超過）の確認→
--    answers確定とlives.reveal_sequence_until設定を1トランザクションで行う。
--    scoreの集計はクライアントから受け取らず、常にDBのscores行から直接
--    再計算する（「取得に失敗したから0件」という誤判定が起こり得ない）。
--    reveal_sequence演出の長さ(7820ms=revealGraceMs+ballPopPauseMs+
--    ボールpopアニメ320ms+scoreDisplayMs+gateTailMs)はtest/本番モードで
--    共通の固定値のため定数として埋め込む
--    （src/data/liveRoomTiming.tsのREVEAL_SEQUENCE_MSと同じ値。変更時は
--    両方直すこと）。judgeGraceMs(400ms)も同様にtest/本番共通の固定値。
--    2回目レビュー対応（過去ターン・別ライブの回答確定防止）：対象回答が
--    「今まさにanswering中のcurrent_turn_id」に属している場合だけを確定対象に
--    する（v_live.current_phase='answering' かつ v_live.current_turn_id =
--    v_answer.turn_id）。これにより、既に次のターン・フェーズへ進んだ後や
--    ライブが終了・緊急中止された後に、過去の未確定回答を後から確定させて
--    現在のライブのreveal_sequence_untilを書き換える、といった操作ができない。
--    また、未発表・確定済み・条件不一致など「更新しない」全ての経路で
--    answer列を必ずnullにする（SECURITY DEFINERがRLSを迂回して、本来
--    見えないはずの回答本文を戻り値経由で漏らさないようにするため）。
-- ============================================================
create or replace function public.resolve_answer_if_due(
  p_answer_id uuid
)
returns table (updated boolean, live public.lives, answer public.answers)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_answer public.answers%rowtype;
  v_turn public.turns%rowtype;
  v_live public.lives%rowtype;
  v_eligible_judge_count integer;
  v_voted_judge_count integer;
  v_score_total integer;
  v_top_score_votes integer;
  v_laugh_triggered boolean;
  v_deadline_passed boolean;
  v_all_voted boolean;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  select * into v_answer from public.answers where id = p_answer_id for update;
  if not found then
    return query select false, null::public.lives, null::public.answers;
    return;
  end if;

  if v_answer.revealed_at is null or v_answer.resolved then
    -- 2回目レビュー対応：未発表・確定済みの回答は、本文等を一切返さない
    -- （SECURITY DEFINERがRLSを迂回して非公開情報を漏らさないようにする）。
    return query select false, null::public.lives, null::public.answers;
    return;
  end if;

  select * into v_turn from public.turns where id = v_answer.turn_id;
  if not found then
    return query select false, null::public.lives, null::public.answers;
    return;
  end if;

  select * into v_live from public.lives where id = v_turn.live_id for update;
  if not found then
    return query select false, null::public.lives, null::public.answers;
    return;
  end if;

  -- 2回目レビュー対応（過去ターン・別ライブ・終了済みライブの回答確定防止）：
  -- 対象の回答が「今まさに進行中のanswering・current_turn_id」に属している
  -- 場合だけを確定対象にする。ライブが既にclosed・emergency_closed・
  -- 次のターン/フェーズへ進んでいる場合、この回答はもう「現在表示中の回答」
  -- ではないため、本文等を一切返さず何も更新しない。
  if v_live.current_phase <> 'answering' or v_live.current_turn_id is distinct from v_answer.turn_id then
    return query select false, null::public.lives, null::public.answers;
    return;
  end if;

  -- 退場済みの参加者は審査対象から除外する（既存のクライアント側ロジックと同じ）。
  select count(*) into v_eligible_judge_count
  from public.participants p
  where p.live_id = v_turn.live_id
    and p.role = 'player'
    and p.group_id is distinct from v_turn.group_id
    and p.kicked_at is null;

  select count(*), coalesce(sum(s.points), 0), count(*) filter (where s.points = 3)
    into v_voted_judge_count, v_score_total, v_top_score_votes
  from public.scores s
  join public.participants p on p.id = s.judge_participant_id
  where s.answer_id = p_answer_id
    and p.live_id = v_turn.live_id
    and p.role = 'player'
    and p.group_id is distinct from v_turn.group_id
    and p.kicked_at is null;

  v_all_voted := v_eligible_judge_count > 0 and v_voted_judge_count = v_eligible_judge_count;
  v_deadline_passed :=
    v_answer.judging_ends_at is not null
    and now() >= v_answer.judging_ends_at + interval '400 milliseconds';

  if not v_all_voted and not v_deadline_passed then
    return query select false, null::public.lives, null::public.answers;
    return;
  end if;

  v_laugh_triggered := v_top_score_votes > floor(v_eligible_judge_count / 2.0);

  update public.answers
    set resolved = true,
        score_total = v_score_total,
        top_score_votes = v_top_score_votes,
        judge_count = v_eligible_judge_count,
        laugh_triggered = v_laugh_triggered
    where id = p_answer_id
    returning * into v_answer;

  update public.lives
    set reveal_sequence_until = now() + interval '7820 milliseconds'
    where id = v_turn.live_id
    returning * into v_live;

  return query select true, v_live, v_answer;
end;
$$;

revoke execute on function public.resolve_answer_if_due(uuid) from public;
revoke execute on function public.resolve_answer_if_due(uuid) from anon;
grant execute on function public.resolve_answer_if_due(uuid) to authenticated;

-- ============================================================
-- 6b) reveal_next_answer_if_due（新規・2回目レビュー対応）
--    未発表回答の表示(revealed_at/judging_ends_atの設定)をサーバー側RPCへ
--    移す。以前は司会クライアントのprocessRevealQueueだけがこれを行っており
--    （生のUPDATE、RLSのis_host()のみで保護）、司会ブラウザが閉じると未発表
--    回答が永久に残り「審査中…」のまま停止していた。
--    回答表示前の約2.2秒のドラマチックポーズは、クライアントのDate.now()では
--    なくlives.next_reveal_pending_at（DB時刻）で管理する：未発表回答を検知した
--    最初の呼び出しがnow()+2200msをここへ書き込み、以後の呼び出しはこの時刻を
--    過ぎるまで実際にはrevealしない。行ロック（lives→対象answerの順）により、
--    複数端末から同時に呼ばれても実際にrevealされるのは1件だけ。
--    revealed_at/judging_ends_atは共にnow()から生成し、クライアントの時刻・
--    自由な採点時間を一切受け取らない（judgeMs=10000msは固定値）。
-- ============================================================
create or replace function public.reveal_next_answer_if_due(
  p_live_id uuid,
  p_expected_turn_id uuid
)
returns table (updated boolean, live public.lives, answer public.answers)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live public.lives%rowtype;
  v_answer public.answers%rowtype;
  v_target_id uuid;
  -- revealDelayMsはstandard/short_testの両プロファイルで共通の固定値
  -- （src/data/liveRoomTiming.tsのSTANDARD_TIMING/SHORT_TEST_TIMING双方で
  -- revealDelayMs=2200のため、timing_profileを見る必要が無い）。
  -- judgeMsは3回目レビュー対応でtiming_profileから取得するよう変更した
  -- （以前は固定10000msで、通し稽古(short_test)時に画面表示のjudgeMsと
  -- ずれていた）。
  v_reveal_delay_ms constant integer := 2200;
  v_judge_ms integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    return query select false, null::public.lives, null::public.answers;
    return;
  end if;
  v_judge_ms := public._live_phase_duration_ms(v_live.timing_profile, 'judge');

  if v_live.current_phase <> 'answering' or v_live.current_turn_id is distinct from p_expected_turn_id then
    return query select false, v_live, null::public.answers;
    return;
  end if;

  -- 表示中(revealed_at is not null)で未確定の回答が既にあれば、新たにrevealしない。
  if exists (
    select 1 from public.answers
    where turn_id = p_expected_turn_id and revealed_at is not null and resolved = false
  ) then
    return query select false, v_live, null::public.answers;
    return;
  end if;

  -- 直前の採点確定演出が終わるまでは新しい回答を表示しない。
  if v_live.reveal_sequence_until is not null and now() < v_live.reveal_sequence_until then
    return query select false, v_live, null::public.answers;
    return;
  end if;

  select id into v_target_id
  from public.answers
  where turn_id = p_expected_turn_id and revealed_at is null
  order by created_at asc
  limit 1
  for update;

  if v_target_id is null then
    -- 表示すべき未発表回答が無い：保留中のドラマチックポーズのタイマーが
    -- 残っていれば片付ける（次に何か積まれた時、正しく新しいタイマーから
    -- 始められるようにする）。
    if v_live.next_reveal_pending_at is not null then
      update public.lives set next_reveal_pending_at = null where id = p_live_id returning * into v_live;
    end if;
    return query select false, v_live, null::public.answers;
    return;
  end if;

  if v_live.next_reveal_pending_at is null then
    -- ドラマチックポーズをまだ始めていない：今始めて一旦終える。実際の
    -- revealは、この時刻をDBのnow()が過ぎてからの次回以降の呼び出しで行う
    -- （クライアントのタイマー・Date.now()には一切依存しない）。
    update public.lives
      set next_reveal_pending_at = now() + make_interval(secs => v_reveal_delay_ms / 1000.0)
      where id = p_live_id
      returning * into v_live;
    return query select false, v_live, null::public.answers;
    return;
  end if;

  if now() < v_live.next_reveal_pending_at then
    return query select false, v_live, null::public.answers;
    return;
  end if;

  update public.answers
    set revealed_at = now(),
        judging_ends_at = now() + make_interval(secs => v_judge_ms / 1000.0)
    where id = v_target_id
    returning * into v_answer;

  update public.lives
    set next_reveal_pending_at = null
    where id = p_live_id
    returning * into v_live;

  return query select true, v_live, v_answer;
end;
$$;

revoke execute on function public.reveal_next_answer_if_due(uuid, uuid) from public;
revoke execute on function public.reveal_next_answer_if_due(uuid, uuid) from anon;
grant execute on function public.reveal_next_answer_if_due(uuid, uuid) to authenticated;

-- ============================================================
-- 6c) advance_live_progress_if_due（新規・2回目レビュー対応）
--    観客・回答者側の補助tick専用の統合RPC。「5秒ごとに最大3つのRPCを無条件で
--    呼び、その後さらに無条件でrefetchAll()する」という過剰な通信を減らすため、
--    現在のフェーズにおいて意味のある1段階だけを1回のRPC呼び出し（＝1回の
--    ネットワーク往復）で試みる。中身は上で定義済みの各RPCをDB内部で
--    そのまま呼び出しているだけで、判定・行ロック・アトミック性は完全に
--    委譲する（ロジックの二重実装をしない）。
--    answeringフェーズでは「表示中の回答の確定 → 未発表回答のreveal →
--    pause/resumeの同期 → 組結果への遷移」の優先順で最初に何か変化した
--    ものだけを行い、そこで打ち切る（司会側の500ms tickの処理順と同じ）。
--    戻り値のupdatedがfalseの場合、呼び出し元は原則としてliveの列以外の
--    再取得（重いrefetchAll等）を行う必要が無い。
-- ============================================================
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
        else 'advanced_to_topic_reveal'
      end);
    return;
  end if;

  if v_live.current_phase <> 'answering' then
    -- opening（beginGame待ち）・final_result・closed等：補助tickで行うことは無い。
    return query select false, v_live, null::public.answers, null::text;
    return;
  end if;

  -- ここから answering フェーズ。司会側のprocessRevealQueue→resolveIfDue→
  -- syncAnsweringPauseと同じ優先順で、最初に何か変化した段階だけを実行する。
  select id into v_active_answer_id
  from public.answers
  where turn_id = p_expected_turn_id and revealed_at is not null and resolved = false
  limit 1;

  if v_active_answer_id is not null then
    -- 1) 表示中の回答があれば、まず確定を試みる（全員投票済み or 締切+猶予超過）。
    select * into v_resolve_result from public.resolve_answer_if_due(v_active_answer_id);
    if v_resolve_result.updated then
      return query select true, v_resolve_result.live, v_resolve_result.answer, 'resolved'::text;
      return;
    end if;
    -- まだ確定できない：この間は回答時間を一時停止しておく（同期のみ試みる）。
    select * into v_pause_result from public.sync_answering_pause_if_due(p_live_id, p_expected_turn_id);
    return query select
      v_pause_result.updated,
      v_pause_result.live,
      null::public.answers,
      (case when v_pause_result.updated then 'paused'::text else null::text end);
    return;
  end if;

  -- 2) 表示中の回答が無ければ、未発表回答があればrevealを試みる。
  select * into v_reveal_result from public.reveal_next_answer_if_due(p_live_id, p_expected_turn_id);
  if v_reveal_result.updated then
    return query select true, v_reveal_result.live, v_reveal_result.answer, 'revealed'::text;
    return;
  end if;

  -- 3) 表示すべき未発表回答も無ければ、pause/resumeの同期を試みる。
  select * into v_pause_result from public.sync_answering_pause_if_due(p_live_id, p_expected_turn_id);
  if v_pause_result.updated then
    return query select true, v_pause_result.live, null::public.answers, 'resumed_or_paused'::text;
    return;
  end if;

  -- 4) busyでなければ、組結果への遷移を試みる。
  select * into v_advance_result from public.host_advance_answering_to_group_result(p_live_id, p_expected_turn_id);
  return query select
    v_advance_result.updated,
    v_advance_result.live,
    null::public.answers,
    (case when v_advance_result.updated then 'advanced_to_group_result'::text else null::text end);
end;
$$;

revoke execute on function public.advance_live_progress_if_due(uuid, uuid) from public;
revoke execute on function public.advance_live_progress_if_due(uuid, uuid) from anon;
grant execute on function public.advance_live_progress_if_due(uuid, uuid) to authenticated;

-- ============================================================
-- 7) 通常終了と緊急中止の分離。
--    close_live：final_resultからのみ実行可能（通常の報酬付与を行う）。
--    emergency_close_live：どの進行中フェーズからでも実行可能だが、報酬
--    （ポイント・段位・実績・参加回数）は一切付与しない。
-- ============================================================
drop function if exists public.close_live(uuid);

create function public.close_live(p_live_id uuid)
returns table (closed boolean, rewards_applied boolean, rewards_error text, error_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_closed boolean := false;
  v_rewards_applied boolean := false;
  v_rewards_error text := null;
  v_live_mode text;
  v_phase text;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select current_phase into v_phase from public.lives where id = p_live_id for update;
  if v_phase is null then
    return query select false, false, null::text, 'LIVE_NOT_FOUND'::text;
    return;
  end if;
  if v_phase = 'closed' then
    -- 二重クリック等、想定内の操作。エラーにはしない。
    return query select false, false, null::text, null::text;
    return;
  end if;
  if v_phase <> 'final_result' then
    -- 最終結果に達する前の終了は緊急中止(emergency_close_live)からのみ行う。
    return query select false, false, null::text, 'NOT_FINAL_RESULT'::text;
    return;
  end if;

  update public.lives
  set current_phase = 'closed',
      phase_deadline = null,
      ended_at = coalesce(ended_at, now())
  where id = p_live_id;
  v_closed := true;

  select l.live_mode into v_live_mode from public.lives l where l.id = p_live_id;

  if v_live_mode = 'test' then
    v_rewards_applied := true;
    v_rewards_error := null;
  else
    begin
      perform public.apply_live_rank_rewards(p_live_id);
      select l.rank_rewards_applied into v_rewards_applied from public.lives l where l.id = p_live_id;
    exception when others then
      v_rewards_error := sqlerrm;
      v_rewards_applied := false;
    end;
  end if;

  return query select v_closed, v_rewards_applied, v_rewards_error, null::text;
end;
$$;

revoke execute on function public.close_live(uuid) from public;
revoke execute on function public.close_live(uuid) from anon;
grant execute on function public.close_live(uuid) to authenticated;

-- 2回目レビュー対応：final_resultに到達済みのライブは、通常終了(close_live)を
-- 使うべきであり、緊急中止を実行できてしまうと報酬が永久に付与されなくなる
-- 事故につながる。final_resultからの緊急中止はDB側でも拒否する（UIのボタン
-- 非表示だけに頼らない多層防御）。
drop function if exists public.emergency_close_live(uuid, text);

create function public.emergency_close_live(p_live_id uuid, p_reason text default null)
returns table (updated boolean, live public.lives, error_code text)
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
    return query select false, null::public.lives, 'LIVE_NOT_FOUND'::text;
    return;
  end if;
  if v_live.current_phase = 'closed' then
    -- 二重操作等、想定内。エラーにはしない。
    return query select false, v_live, null::text;
    return;
  end if;
  if v_live.current_phase = 'final_result' then
    -- 最終結果に到達済みなら、通常終了(close_live)を使うべき。
    return query select false, v_live, 'FINAL_RESULT_USE_NORMAL_CLOSE'::text;
    return;
  end if;

  update public.lives
  set current_phase = 'closed',
      phase_deadline = null,
      ended_at = coalesce(ended_at, now()),
      emergency_closed = true,
      emergency_close_reason = p_reason
  where id = p_live_id
  returning * into v_live;

  return query select true, v_live, null::text;
end;
$$;

revoke execute on function public.emergency_close_live(uuid, text) from public;
revoke execute on function public.emergency_close_live(uuid, text) from anon;
grant execute on function public.emergency_close_live(uuid, text) to authenticated;

-- ============================================================
-- 8) apply_live_rank_rewards：緊急中止されたライブには報酬を絶対に付与しない
--    ガードを追加する（close_live経由の自動付与・retry_live_rank_rewards
--    経由の手動再試行の両方をここ1箇所で防ぐ）。0071版からの差分はこの
--    1ガードのみで、それ以外の集計ロジックは一切変更しない。
-- ============================================================
create or replace function public.apply_live_rank_rewards(p_live_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already boolean;
  v_phase text;
  v_live_mode text;
  v_emergency_closed boolean;
begin
  if auth.uid() is not null and not is_host() then
    raise exception 'not authorized';
  end if;

  select rank_rewards_applied, current_phase, live_mode, emergency_closed
    into v_already, v_phase, v_live_mode, v_emergency_closed
    from public.lives where id = p_live_id for update;
  if v_already is null then
    return; -- ライブが存在しない
  end if;
  if v_already then
    return; -- 既に加算済み（二重付与防止）
  end if;
  if v_live_mode = 'test' then
    return;
  end if;
  if v_phase <> 'closed' then
    raise exception 'LIVE_NOT_CLOSED';
  end if;
  if v_emergency_closed then
    raise exception 'LIVE_EMERGENCY_CLOSED';
  end if;

  with player_totals as (
    select p.id as participant_id, p.user_id,
           coalesce(sum(a.score_total), 0) as total_score
    from public.participants p
    left join public.answers a on a.participant_id = p.id and a.resolved = true
    where p.live_id = p_live_id
      and p.role = 'player'
      and not public._is_guest_identity(p.user_id, p.is_guest)
    group by p.id, p.user_id
  ),
  ranked as (
    select *, rank() over (order by total_score desc) as rnk
    from player_totals
  ),
  gains as (
    select
      participant_id, user_id, total_score, rnk,
      10 + total_score
        + (case rnk when 1 then 100 when 2 then 60 when 3 then 30 else 0 end) as gain
    from ranked
  ),
  upd as (
    update public.profiles pr set
      mastery_meter = pr.mastery_meter + g.gain,
      total_points = pr.total_points + g.gain,
      points_balance = pr.points_balance + g.gain,
      live_count = pr.live_count + 1,
      award_count_first = pr.award_count_first + (case when g.rnk = 1 then 1 else 0 end),
      award_count_second = pr.award_count_second + (case when g.rnk = 2 then 1 else 0 end),
      award_count_third = pr.award_count_third + (case when g.rnk = 3 then 1 else 0 end)
    from gains g
    where pr.id = g.user_id
    returning pr.id as user_id, g.gain, g.rnk
  )
  insert into public.point_history (user_id, live_id, points, mastery, label)
  select
    upd.user_id, p_live_id, upd.gain, upd.gain,
    '第' || l.official_sequence_number || '回ライブ'
      || (case upd.rnk when 1 then '（1位）' when 2 then '（2位）' when 3 then '（3位）' else '' end)
  from upd, public.lives l
  where l.id = p_live_id;

  update public.lives set rank_rewards_applied = true where id = p_live_id;
end;
$$;

commit;
