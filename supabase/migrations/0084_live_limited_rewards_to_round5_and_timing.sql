-- 0084：本番ライブの仕様変更（初回ライブ結果を受けて）。
--   (1) 限定特典「最初の目撃者」・限定アイコンの対象を、本番開催番号#0001〜#0005へ拡張
--       （mark_final_result_presence / _apply_first_live_reward の範囲判定と付与理由の開催番号化）
--   (2) 本番(standard)の回答時間を60秒から90秒へ（_live_phase_duration_ms）
--   (3) ライブを1周から2周へ（create_live_preparationは保存値rounds_per_live=2を明示的に入れ、
--       begin_gameは保存値が2でなければ開始しない）
--   (4) 末尾で、再定義した公開RPC・内部ヘルパーの実行権限を明示する（create or replaceの
--       ACL継承に依存しない）
--   0081・0079は編集せず、同じ関数名をcreate or replaceで再定義する（SECURITY DEFINERは維持）。
--   エラーコードNOT_FIRST_OFFICIAL_LIVEは、フロントの既存のエラー分岐との互換のため名前を変えない。
--   既存ライブ（終了済み・未開始）の行は更新しない。
begin;

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
        when 'answering' then 90000
        when 'judge' then 10000
        when 'group_result' then 15000
      end
  end;
$$;

create or replace function public.mark_final_result_presence(p_live_id uuid, p_expected_user_id uuid)
returns public.final_result_presence
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_live public.lives;
  v_participant public.participants;
  v_row public.final_result_presence;
begin
  if v_uid is null then
    raise exception 'NOT_LOGGED_IN';
  end if;
  -- 2026-09-28（レビュー対応・世代ガード）：クライアントが処理開始時点で認識していた
  -- 利用者ID(p_expected_user_id)を明示的に渡させ、実行時点の実際の認証ユーザー
  -- (auth.uid())と一致しない場合は拒否する。mark完了後・grant開始前にアカウントが
  -- 切り替わった場合等、古い利用者向けの処理が新しい認証セッション上で実行される
  -- ことを防ぐ（auth.uid()自体は常に「今」の認証ユーザーを返すため、これだけでは
  -- クライアント側が意図した利用者とのズレを検出できない）。
  if p_expected_user_id is null or p_expected_user_id <> v_uid then
    raise exception 'USER_MISMATCH';
  end if;
  if public._is_guest_identity(v_uid, false) then
    raise exception 'GUEST_NOT_ELIGIBLE';
  end if;
  if not public._is_x_login_identity(v_uid) then
    raise exception 'NOT_X_LOGIN';
  end if;

  -- 1) livesを先にロックする。close_liveのUPDATEと同じ行ロックのため、
  --    ここで確実にどちらか一方の完了を待ってから最新状態を読む。
  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    raise exception 'LIVE_NOT_FOUND';
  end if;
  -- ロック取得後の最新状態で、現在のフェーズが正確にfinal_resultであること
  -- （closed後は新規到達記録を作れない）。
  if v_live.current_phase <> 'final_result' then
    raise exception 'NOT_FINAL_RESULT_PHASE';
  end if;
  if v_live.live_mode <> 'official' or v_live.official_sequence_number not between 1 and 5 then
    raise exception 'NOT_FIRST_OFFICIAL_LIVE';
  end if;
  if v_live.emergency_closed then
    raise exception 'LIVE_EMERGENCY_CLOSED';
  end if;

  -- 2) 続いてparticipantsをロックする。kick_participantのFOR UPDATE/UPDATEと
  --    同じ行ロックのため、退場処理と競合しない（順序はlives→participantsで統一）。
  select * into v_participant from public.participants
    where live_id = p_live_id and user_id = v_uid for update;
  if not found then
    raise exception 'NOT_A_PARTICIPANT';
  end if;
  if v_participant.kicked_at is not null then
    raise exception 'PARTICIPANT_KICKED';
  end if;
  if v_participant.is_guest then
    raise exception 'GUEST_NOT_ELIGIBLE';
  end if;
  if v_participant.role not in ('player', 'audience') then
    raise exception 'INVALID_PARTICIPANT_ROLE';
  end if;

  -- ロック取得後のこの時点でも上記の条件を満たす場合だけ、到達記録を新規作成できる。
  -- 同じライブ・同じ利用者の到達記録は1件だけ（複数タブ・再読込・再接続でも冪等）。
  -- 既に記録済みなら最初のseen_atを維持し、上書きしない。
  insert into public.final_result_presence (live_id, user_id, participant_id)
  values (p_live_id, v_uid, v_participant.id)
  on conflict (live_id, user_id) do nothing;

  select * into v_row from public.final_result_presence
    where live_id = p_live_id and user_id = v_uid;
  return v_row;
end;
$$;

grant execute on function public.mark_final_result_presence(uuid, uuid) to authenticated;
revoke execute on function public.mark_final_result_presence(uuid, uuid) from public, anon;

-- ============================================================
-- 7) _apply_first_live_reward：到達記録を前提に、限定称号・限定アイコン・通知を
--    付与する内部ヘルパー（p_user_idを明示的に取るため、本人経由(8番)・
--    運営再付与(11番)の両方から共通して呼べる）。newly_grantedは「このコールで
--    新規に何か付与したか」（複数タブ同時押しでも、実際に行を作れたのは
--    どちらか一方だけなので、trueになるのは正確に1回だけ）。title_display_nameは
--    付与時点のtitles.display_name（運営が改称していれば、新しい表示名を返す）。
--    2026-09-28（レビュー対応）：lives→final_result_presence→participantsの順で
--    FOR UPDATEロックを取得し、各SELECT直後にNOT FOUNDを確認する（以前はlives行を
--    ロックせず、participant取得のNOT FOUNDも確認していなかった）。
-- ============================================================

create or replace function public._apply_first_live_reward(p_user_id uuid, p_live_id uuid)
returns public.first_live_reward_result
language plpgsql
security definer set search_path = public
as $$
declare
  v_live public.lives;
  v_presence public.final_result_presence;
  v_participant public.participants;
  v_title_inserted boolean;
  v_icon_inserted boolean;
  v_newly_granted boolean;
  v_title_name text;
  v_result public.first_live_reward_result;
begin
  -- 1) lives行をFOR UPDATEでロックし、存在・official #1・非緊急中止を確認する。
  --    close_liveのUPDATEと同じ行ロックのため、緊急中止・終了処理と競合しない。
  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    raise exception 'LIVE_NOT_FOUND';
  end if;
  if v_live.live_mode <> 'official' or v_live.official_sequence_number not between 1 and 5 then
    raise exception 'NOT_FIRST_OFFICIAL_LIVE';
  end if;
  if v_live.emergency_closed then
    raise exception 'LIVE_EMERGENCY_CLOSED';
  end if;

  -- 2) final_result_presence行をFOR UPDATEでロックし、存在を確認する。到達記録が
  --    無ければ付与しない（参加登録があるだけの一括付与を構造的に禁止する）。
  --    ここではcurrent_phaseを見ない：final_result中に正しく作られた到達記録
  --    さえあれば、ライブがclosedになった後（通信復旧後の再試行・運営の再付与）
  --    でも通す仕様を維持する。
  select * into v_presence from public.final_result_presence
    where live_id = p_live_id and user_id = p_user_id for update;
  if not found then
    raise exception 'NO_PRESENCE_RECORD';
  end if;

  -- 3) presenceが指すparticipant行を、participant_id・live_id・user_idがすべて
  --    一致する条件でFOR UPDATEロックする（presence.participant_idが別ライブ・
  --    別利用者のparticipant行を指してしまっていないかの多層防御）。
  --    kick_participantと同じ行ロックのため、「確認した直後に退場処分が入る」
  --    競合も防げる。ロック順序はlives→final_result_presence→participantsで統一する。
  select * into v_participant from public.participants
    where id = v_presence.participant_id and live_id = p_live_id and user_id = p_user_id
    for update;
  if not found then
    raise exception 'PARTICIPANT_NOT_FOUND';
  end if;
  if v_participant.kicked_at is not null then
    raise exception 'PARTICIPANT_KICKED';
  end if;
  if v_participant.is_guest then
    raise exception 'GUEST_NOT_ELIGIBLE';
  end if;
  if v_participant.role not in ('player', 'audience') then
    raise exception 'INVALID_PARTICIPANT_ROLE';
  end if;

  -- 多層防御：到達記録があってもゲスト・ボット（Xログインでない）には付与しない。
  if public._is_guest_identity(p_user_id, false) then
    raise exception 'GUEST_NOT_ELIGIBLE';
  end if;
  if not public._is_x_login_identity(p_user_id) then
    raise exception 'NOT_X_LOGIN';
  end if;

  -- 表示名は毎回titlesから最新のdisplay_nameを取得する（運営が改称していれば、
  -- 新しく作る通知・戻り値には新しい表示名が使われる。既存の所有行・過去に
  -- 作成済みの通知本文は書き換えない）。titles行は物理削除されない設計のため
  -- 通常nullにはならないが、多層防御として一般的な文言へフォールバックする。
  select display_name into v_title_name from public.titles where slug = 'first-witness';
  v_title_name := coalesce(v_title_name, '限定称号');

  insert into public.user_titles (user_id, title_slug, granted_reason)
    values (p_user_id, 'first-witness', 'official_' || lpad(v_live.official_sequence_number::text, 4, '0') || '_final_result')
    on conflict (user_id, title_slug) do nothing
    returning true into v_title_inserted;

  insert into public.user_limited_icons (user_id, icon_slug, granted_reason)
    values (p_user_id, 'first-witness', 'official_' || lpad(v_live.official_sequence_number::text, 4, '0') || '_final_result')
    on conflict (user_id, icon_slug) do nothing
    returning true into v_icon_inserted;

  v_newly_granted := coalesce(v_title_inserted, false) or coalesce(v_icon_inserted, false);

  -- 通知も一件だけ（title/iconのどちらかを実際にこのコールで新規挿入できた場合のみ、
  -- かつ既に同種の通知が無い場合だけ挿入する二重ガード）。
  if v_newly_granted then
    insert into public.notifications (user_id, type, title, body)
    select p_user_id, 'first_live_reward', '初期ライブ限定特典を獲得しました',
      '限定称号「' || v_title_name || '」と初期ライブ限定アイコンを獲得しました。マイページで選択できます。'
    where not exists (
      select 1 from public.notifications where user_id = p_user_id and type = 'first_live_reward'
    );
  end if;

  v_result.newly_granted := v_newly_granted;
  v_result.title_display_name := v_title_name;
  return v_result;
end;
$$;

revoke execute on function public._apply_first_live_reward(uuid, uuid) from public, anon, authenticated;

-- (3) ライブを1周から2周へ（ROUNDS_PER_LIVE）。begin_gameが2周分のターン（同じ組・同じ順番、
--     2周目は別のお題）を作り、進行（host_advance_group_result_to_next）は既存の
--     round→group_order順のまま、最後のターンの組結果後だけfinal_resultへ進む。
--     create_live_preparationのお題必要数も組数×2に一致させる。

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
  v_rounds_per_live constant int := 2; -- src/data/liveRoomTiming.tsのROUNDS_PER_LIVE_DEFAULTと必ず同じ値にすること
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
    live_mode, official_sequence_number, timing_profile, rounds_per_live
  ) values (
    p_scheduled_at, 'scheduled', p_title, null, p_max_players,
    p_planned_group_count, null, null, auth.uid(),
    p_live_mode, v_official_seq, v_timing_profile, v_rounds_per_live
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

create or replace function public.begin_game(p_live_id uuid)
returns table (ok boolean, reason text, first_turn_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rounds constant int := 2; -- 2周固定。作成時にlives.rounds_per_liveへ保存した値と一致しなければ開始しない
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
  round_no int;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select planned_group_count, timing_profile, rounds_per_live
    into v_planned_group_count, v_timing_profile, v_saved_rounds
    from public.lives where id = p_live_id;
  if v_saved_rounds is distinct from v_rounds then
    return query select false, 'このライブの周回数の設定が2周になっていません。運営に確認してください。', null::uuid;
    return;
  end if;
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

-- ============================================================
-- 9) 実行権限の明示（0084で再定義したRPC・内部ヘルパー）。
--    既存の権限設計（0053・0054・0056・0068・0079・0081）と同じ形に固定する：
--    公開RPCはauthenticatedのみ、内部ヘルパーは誰からも直接呼べない。
--    create_live_preparationの実在シグネチャは8引数版の1つだけ（0068・0073・0079が
--    5〜7引数版をdrop済み）。5〜7引数の呼び出しは末尾のdefault引数で同じ8引数版へ解決され、
--    同じ2周制の処理が実行される（0084_create_live_entrypointsで検証）。
-- ============================================================
revoke all on function public.create_live_preparation(timestamptz, text, int, int, uuid[], text, int, text) from public, anon;
grant execute on function public.create_live_preparation(timestamptz, text, int, int, uuid[], text, int, text) to authenticated;

revoke all on function public.begin_game(uuid) from public, anon;
grant execute on function public.begin_game(uuid) to authenticated;

revoke all on function public.mark_final_result_presence(uuid, uuid) from public, anon;
grant execute on function public.mark_final_result_presence(uuid, uuid) to authenticated;

revoke all on function public._apply_first_live_reward(uuid, uuid) from public, anon, authenticated;

commit;
