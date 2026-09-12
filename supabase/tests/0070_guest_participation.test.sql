-- 0070 回帰テスト：ゲスト（匿名）参加の権限境界の確認。
-- 実行方法は supabase/tests/run.sh 参照。
--
-- 注意：public.create_live_preparation()は「進行中(current_phase<>'closed')の
-- ライブは常に1件」という既存の排他制約(0055)を持つため、このファイルでは
-- 常に「1つのライブを開いて、必要な検証を全て終えてから閉じる」という
-- セッション単位で処理を進める（開いたまま次のライブを作ろうとすると、
-- create_live_preparationはエラーではなく「既に進行中のライブがあります」を
-- 返し、既存の進行中ライブのidをそのまま返してしまうため、検証したいライブと
-- 別のライブを誤って操作してしまう事故を避けるため）。

\set ON_ERROR_STOP on

do $$
begin
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';
end $$;

-- host（運営者）とX（非匿名）ユーザーをまず用意する（is_anonymous明示false）。
insert into auth.users (id, is_anonymous) values
  ('b0000000-0000-0000-0000-00000000000f', false), -- host(admin)
  ('b0000000-0000-0000-0000-00000000000b', false), -- xuser1（通常のXログインユーザー）
  ('b0000000-0000-0000-0000-00000000000c', false)  -- xuser2（通常のXログインユーザー、SNS投稿の元ネタ用）
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'b0000000-0000-0000-0000-00000000000f';

insert into public.topic_bank (id, body, format, is_active) values
  ('b0100000-0000-0000-0000-000000000001', '0070テスト用お題1', 'text', true),
  ('b0100000-0000-0000-0000-000000000002', '0070テスト用お題2', 'text', true),
  ('b0100000-0000-0000-0000-000000000003', '0070テスト用お題3', 'text', true),
  ('b0100000-0000-0000-0000-000000000004', '0070テスト用お題4', 'text', true)
on conflict do nothing;

create temporary table _t0070_ctx (key text primary key, live_id uuid, participant_id uuid);

-- ============================================================
-- セッション1（テスト2・テスト3前半）：公式ライブでは、匿名ゲストは参加拒否
--          （GUEST_OFFICIAL_NOT_ALLOWED）、Xログイン利用者は従来どおり参加できる。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_failed boolean := false;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0070テスト-officialライブ', 20, 1,
    array['b0100000-0000-0000-0000-000000000002']::uuid[], 'official'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  -- 匿名ゲストのauth.users行を作る（is_anonymous=true）。この直後、
  -- handle_new_user()トリガーによりprofiles.is_guest=trueの行が自動生成される。
  insert into auth.users (id, is_anonymous) values ('b0000000-0000-0000-0000-00000000001a', true)
    on conflict do nothing;
  if (select is_guest from public.profiles where id = 'b0000000-0000-0000-0000-00000000001a') is not true then
    raise exception 'FAIL: 匿名ユーザーのprofiles.is_guestがtrueになっていない（handle_new_user()の複製漏れ）';
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000001a', true);
  begin
    perform public.join_live(v_live_id, 'player', null);
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'GUEST_OFFICIAL_NOT_ALLOWED' then
        v_failed := true;
      else
        reset role;
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: 匿名ゲストが公式ライブへ参加できてしまった';
  end if;

  -- Xログイン利用者は従来どおり公式ライブへ参加できる。
  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000000b', true);
  perform public.join_live(v_live_id, 'player', null);
  reset role;
  if not exists (
    select 1 from public.participants
    where live_id = v_live_id and user_id = 'b0000000-0000-0000-0000-00000000000b'
      and is_guest = false and guest_number is null
  ) then
    raise exception 'FAIL: Xログイン利用者が公式ライブへ参加できていない、またはis_guest/guest_numberが不正';
  end if;

  update public.lives set current_phase = 'closed' where id = v_live_id;
  raise notice 'PASS: 公式ライブは匿名ゲストを拒否し(GUEST_OFFICIAL_NOT_ALLOWED)、Xログイン利用者は従来どおり参加できる';
end $$;

-- ============================================================
-- セッション2（テスト1・4・5・6）：テストライブでのゲスト参加・番号採番・再join・
--          表示名/アイコンの確認。
-- ============================================================
do $$
declare
  v_live_id uuid;
  v_row public.participants;
  v_row2 public.participants;
  v_row3 public.participants;
  v_count int;
  v_guest_name text;
  v_guest_icon text;
  v_guest_color text;
  v_xuser_name text;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0070テスト-testライブ', 20, 1,
    array['b0100000-0000-0000-0000-000000000001']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;
  insert into _t0070_ctx (key, live_id) values ('test_live', v_live_id);

  -- テスト1：匿名ゲストはテストライブへ参加でき、is_guest=true・guest_number=1になる。
  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000001a', true);
  select * into v_row from public.join_live(v_live_id, 'player', null);
  reset role;
  if v_row.is_guest is not true or v_row.guest_number <> 1 then
    raise exception 'FAIL: ゲストがテストライブへ参加してもis_guest=true・guest_number=1にならなかった(is_guest=%, guest_number=%)', v_row.is_guest, v_row.guest_number;
  end if;
  insert into _t0070_ctx (key, live_id, participant_id) values ('guest1_participant', v_live_id, v_row.id);
  raise notice 'PASS: 匿名ゲストはテストライブへ参加でき、is_guest=true・guest_number=1が付与される';

  -- テスト3後半：Xログイン利用者はテストライブでも従来どおり参加でき、is_guest=falseになる。
  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000000b', true);
  select * into v_row from public.join_live(v_live_id, 'player', null);
  reset role;
  if v_row.is_guest is not false or v_row.guest_number is not null then
    raise exception 'FAIL: Xユーザーがテストライブに参加したのにis_guest=false/guest_number=nullにならなかった(is_guest=%, guest_number=%)', v_row.is_guest, v_row.guest_number;
  end if;
  insert into _t0070_ctx (key, live_id, participant_id) values ('xuser1_test_participant', v_live_id, v_row.id);
  raise notice 'PASS: Xログイン利用者はテストライブでも従来どおり参加でき、is_guest=falseのまま';

  -- テスト4：同じゲストの再joinでparticipantが増えず、guest_number・is_guestも変わらない。
  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000001a', true);
  select * into v_row from public.join_live(v_live_id, 'player', null);
  reset role;
  if v_row.is_guest is not true or v_row.guest_number <> 1 then
    raise exception 'FAIL: 再joinでゲストのis_guest/guest_numberが変化した(is_guest=%, guest_number=%)', v_row.is_guest, v_row.guest_number;
  end if;
  select count(*) into v_count from public.participants
    where live_id = v_live_id and user_id = 'b0000000-0000-0000-0000-00000000001a';
  if v_count <> 1 then
    raise exception 'FAIL: 再joinでparticipant行が増えた(件数=%)', v_count;
  end if;
  raise notice 'PASS: 同じゲストの再joinはparticipant行を増やさず、guest_number/is_guestも維持される';

  -- テスト5：複数ゲストの番号が重ならない（連番になる）。
  insert into auth.users (id, is_anonymous) values
    ('b0000000-0000-0000-0000-00000000002a', true),
    ('b0000000-0000-0000-0000-00000000003a', true)
  on conflict do nothing;

  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000002a', true);
  select * into v_row2 from public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000003a', true);
  select * into v_row3 from public.join_live(v_live_id, 'player', null);
  reset role;
  if v_row2.guest_number <> 2 or v_row3.guest_number <> 3 then
    raise exception 'FAIL: 複数ゲストの採番が連番になっていない(2人目=%, 3人目=%)', v_row2.guest_number, v_row3.guest_number;
  end if;
  raise notice 'PASS: 複数ゲストの番号は重ならず連番になる(2,3)。並行性はjoin_live内のlives行FOR UPDATEロックにより保証される（0068のofficial_sequence_number採番と同じ機構でありdblinkによる並行性検証は既に存在するため、ここでは連番の正しさのみ確認する）';

  -- テスト6：participant_display_namesはゲストに固定の表示名・アイコン・色を返し、
  --          Xユーザーは従来どおりprofilesの値をそのまま返す。
  select display_name, avatar_icon, avatar_color into v_guest_name, v_guest_icon, v_guest_color
    from public.participant_display_names(v_live_id)
    where participant_id = (select participant_id from _t0070_ctx where key = 'guest1_participant');
  if v_guest_name <> 'ゲスト01' or v_guest_icon <> 'default' or v_guest_color <> '#171513' then
    raise exception 'FAIL: ゲストの表示名/アイコン/色が想定と違う(name=%, icon=%, color=%)', v_guest_name, v_guest_icon, v_guest_color;
  end if;
  select display_name into v_xuser_name
    from public.participant_display_names(v_live_id)
    where participant_id = (select participant_id from _t0070_ctx where key = 'xuser1_test_participant');
  if v_xuser_name = 'ゲスト01' or v_xuser_name is null then
    raise exception 'FAIL: Xユーザーの表示名がゲスト形式または空になっている(name=%)', v_xuser_name;
  end if;
  raise notice 'PASS: participant_display_namesはゲストに固定の表示名・アイコン・色を返し、Xユーザーは従来どおり';

  update public.lives set current_phase = 'closed' where id = v_live_id;
end $$;

-- ============================================================
-- セッション3（テスト7・8・9・12・13の一部）：回答・採点の本人限定確認
--          （ゲスト・Xユーザーどちらの役回りになっても成立することを、実際の
--          ランダム組分け結果に依存せず動的に判定して検証する）、退場後の拒否、
--          テストライブ終了時のポイント不変。
-- ============================================================
create temporary table _t0070_flow (key text primary key, val text);

do $$
declare
  v_live_id uuid;
  v_turn_a uuid;
  v_answerer_uid uuid;
  v_judge_uid uuid;
  v_answerer_participant uuid;
  v_judge_participant uuid;
  v_answer_id uuid;
  v_failed boolean := false;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000000f', true);
  select live_id into v_live_id from public.create_live_preparation(
    now(), '0070テスト-回答採点フロー', 20, 2,
    array['b0100000-0000-0000-0000-000000000004', 'b0100000-0000-0000-0000-000000000001']::uuid[], 'test'
  );
  reset role;
  update public.lives set current_phase = 'opening' where id = v_live_id;

  insert into auth.users (id, is_anonymous) values ('b0000000-0000-0000-0000-00000000004a', true)
    on conflict do nothing; -- このフロー専用のゲスト

  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000004a', true);
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000000c', true); -- xuser2
  perform public.join_live(v_live_id, 'player', null);
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000000f', true);
  perform public.randomize_groups(v_live_id);
  perform public.begin_game(v_live_id);
  reset role;

  -- begin_game直後はtopic_reveal。RLS経由の回答/採点insertを検証するため、
  -- 0065/0066テストと同じく、直接answering/activeへ整える（superuser実行のため
  -- RLSの対象外＝運営操作の代理）。
  select t.id into v_turn_a from public.turns t
    where t.live_id = v_live_id and t.round = 1
    order by (select g.group_order from public.groups g where g.id = t.group_id) asc
    limit 1;
  update public.lives set current_phase = 'answering', current_turn_id = v_turn_a, answering_paused = false where id = v_live_id;
  update public.turns set status = 'active' where id = v_turn_a;

  -- turn_aのgroup_idに属する参加者が「回答者」、そうでない方が「採点者」になる
  -- （プレイヤーは2人・組は2つのため、必ずどちらか一方ずつになる。ランダム組分け
  -- の結果に依存せず判定する）。
  select p.user_id, p.id into v_answerer_uid, v_answerer_participant
    from public.participants p
    where p.live_id = v_live_id and p.role = 'player' and p.group_id = (select group_id from public.turns where id = v_turn_a);
  select p.user_id, p.id into v_judge_uid, v_judge_participant
    from public.participants p
    where p.live_id = v_live_id and p.role = 'player' and p.id <> v_answerer_participant;

  insert into _t0070_flow (key, val) values
    ('live_id', v_live_id::text),
    ('turn_a', v_turn_a::text),
    ('answerer_uid', v_answerer_uid::text),
    ('judge_uid', v_judge_uid::text),
    ('answerer_participant', v_answerer_participant::text),
    ('judge_participant', v_judge_participant::text),
    -- 2026-09-13レビュー対応：テスト12（ポイント不変確認）が組分け結果次第で
    -- v_judge_uidになったりならなかったりする「このフロー専用のゲスト」の
    -- UUIDを、役回りに関係なく明示的に固定して後から参照できるようにする。
    ('guest_uid', 'b0000000-0000-0000-0000-00000000004a');

  raise notice '情報: このフローでは%が回答者、%が採点者の役回りになった',
    (case when v_answerer_uid = 'b0000000-0000-0000-0000-00000000004a' then 'ゲスト' else 'Xユーザー' end),
    (case when v_judge_uid = 'b0000000-0000-0000-0000-00000000004a' then 'ゲスト' else 'Xユーザー' end);

  -- 回答者本人としての回答投稿は成功する。
  set local role authenticated;
  perform set_config('myapp.uid', v_answerer_uid::text, true);
  insert into public.answers (turn_id, participant_id, seq, body)
    values (v_turn_a, v_answerer_participant, 1, '0070テスト回答')
    returning id into v_answer_id;
  reset role;

  -- 回答者が「採点者のparticipant_id」でなりすまして回答しようとすると拒否される。
  set local role authenticated;
  perform set_config('myapp.uid', v_answerer_uid::text, true);
  begin
    insert into public.answers (turn_id, participant_id, seq, body)
      values (v_turn_a, v_judge_participant, 2, 'なりすまし回答');
    v_failed := false;
  exception
    when others then
      if sqlerrm like '%row-level security%' then
        v_failed := true;
      else
        reset role;
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: 他人のparticipant_idを使った回答のなりすましが成功してしまった';
  end if;

  -- 採点対象にするため、この回答をrevealed済みにする（運営側の演出処理の代理、superuser実行）。
  update public.answers set revealed_at = now() where id = v_answer_id;

  -- 採点者本人としての採点は成功する。
  set local role authenticated;
  perform set_config('myapp.uid', v_judge_uid::text, true);
  insert into public.scores (answer_id, judge_participant_id, points) values (v_answer_id, v_judge_participant, 2);
  reset role;

  -- 採点者が「回答者のparticipant_id」でなりすまして採点しようとすると拒否される。
  v_failed := false;
  set local role authenticated;
  perform set_config('myapp.uid', v_judge_uid::text, true);
  begin
    insert into public.scores (answer_id, judge_participant_id, points) values (v_answer_id, v_answerer_participant, 3);
    v_failed := false;
  exception
    when others then
      if sqlerrm like '%row-level security%' then
        v_failed := true;
      else
        reset role;
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: 他人のparticipant_idを使った採点のなりすましが成功してしまった';
  end if;

  -- テスト9（kick_participant）のため、採点が確定済み（resolved=true）の状態に
  -- しておく（運営の確定操作の代理、superuser実行）。kick_participantは
  -- 「answering中・revealed済みで未確定(resolved=false)の回答がある間は退場操作を
  -- 禁止する」仕様(0054)のため、これをしておかないと後続のkick_participantが
  -- ok=falseを返すだけで実際には退場させられない。
  update public.answers set resolved = true, score_total = 2, judge_count = 1 where id = v_answer_id;

  raise notice 'PASS: 回答者・採点者は自分の参加者IDでのみ回答・採点でき、他人へのなりすましは拒否される（ゲスト・Xユーザーいずれの役回りでも成立）';
end $$;

-- テスト9：退場後は回答・再参加が拒否される（対象はこのフローの回答者）。
do $$
declare
  v_live_id uuid;
  v_turn_a uuid;
  v_answerer_uid uuid;
  v_answerer_participant uuid;
  v_failed boolean := false;
  v_kick_result record;
begin
  select val::uuid into v_live_id from _t0070_flow where key = 'live_id';
  select val::uuid into v_turn_a from _t0070_flow where key = 'turn_a';
  select val::uuid into v_answerer_uid from _t0070_flow where key = 'answerer_uid';
  select val::uuid into v_answerer_participant from _t0070_flow where key = 'answerer_participant';

  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000000f', true);
  select * into v_kick_result from public.kick_participant(v_answerer_participant);
  reset role;
  if v_kick_result.ok is not true then
    raise exception 'FAIL: kick_participantが失敗した(reason=%)', v_kick_result.reason;
  end if;

  -- 退場後の再参加は拒否される。
  set local role authenticated;
  perform set_config('myapp.uid', v_answerer_uid::text, true);
  begin
    perform public.join_live(v_live_id, 'player', null);
    v_failed := false;
  exception
    when others then
      if sqlerrm = 'PARTICIPANT_KICKED' then
        v_failed := true;
      else
        reset role;
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: 退場済みの参加者が再参加できてしまった';
  end if;

  -- 退場後の追加回答も拒否される（kicked_at is null条件をRLSが見ているため）。
  v_failed := false;
  set local role authenticated;
  perform set_config('myapp.uid', v_answerer_uid::text, true);
  begin
    insert into public.answers (turn_id, participant_id, seq, body)
      values (v_turn_a, v_answerer_participant, 3, '退場後の回答');
    v_failed := false;
  exception
    when others then
      if sqlerrm like '%row-level security%' then
        v_failed := true;
      else
        reset role;
        raise exception 'FAIL: 想定外のエラー内容(%)', sqlerrm;
      end if;
  end;
  reset role;
  if not v_failed then
    raise exception 'FAIL: 退場済みの参加者が回答を追加できてしまった';
  end if;

  raise notice 'PASS: 退場済みの参加者（ゲスト/Xユーザーいずれの役回りでも）は再参加・追加回答ともに拒否される';
end $$;

-- テスト12：テストライブ終了後もポイント・実績・point_historyが増えない（ゲストの
--           参加を含めても既存0068の多層防御が効く）。
-- 2026-09-13レビュー対応：v_judge_uidは組分け結果次第でゲストにもXユーザーにも
-- なり得る（役回りに依存しない判定にすると「たまたまXユーザーが採点者になった
-- 回だけ検証している」状態を見逃しかねない）。ここでは_t0070_flowに固定保存した
-- guest_uid（このフロー専用のゲスト本人）を明示的に使い、ゲスト本人のポイントが
-- 変化しないことを直接確認する（v_judge_uidの確認は既存の回帰確認としてそのまま残す）。
do $$
declare
  v_live_id uuid;
  v_judge_uid uuid;
  v_guest_uid uuid;
  v_close_result record;
  v_ph_count int;
  v_before record;
  v_after record;
  v_guest_before record;
  v_guest_after record;
begin
  select val::uuid into v_live_id from _t0070_flow where key = 'live_id';
  select val::uuid into v_judge_uid from _t0070_flow where key = 'judge_uid';
  select val::uuid into v_guest_uid from _t0070_flow where key = 'guest_uid';

  select mastery_meter, total_points, points_balance, live_count into v_before
    from public.profiles where id = v_judge_uid;
  select mastery_meter, total_points, points_balance, live_count into v_guest_before
    from public.profiles where id = v_guest_uid;

  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000000f', true);
  select * into v_close_result from public.close_live(v_live_id);
  reset role;

  if v_close_result.rewards_applied is not true or v_close_result.rewards_error is not null then
    raise exception 'FAIL: テストライブのclose_liveが想定通りの結果を返さなかった(applied=%, error=%)',
      v_close_result.rewards_applied, v_close_result.rewards_error;
  end if;

  select mastery_meter, total_points, points_balance, live_count into v_after
    from public.profiles where id = v_judge_uid;
  if v_before.mastery_meter <> v_after.mastery_meter
    or v_before.total_points <> v_after.total_points
    or v_before.points_balance <> v_after.points_balance
    or v_before.live_count <> v_after.live_count
  then
    raise exception 'FAIL: ゲストを含むテストライブ終了で段位・ポイントが変化した';
  end if;

  -- ゲスト本人（役回りに関係なく固定UUID）のポイントも変化しないことを直接確認する。
  select mastery_meter, total_points, points_balance, live_count into v_guest_after
    from public.profiles where id = v_guest_uid;
  if v_guest_before.mastery_meter <> v_guest_after.mastery_meter
    or v_guest_before.total_points <> v_guest_after.total_points
    or v_guest_before.points_balance <> v_guest_after.points_balance
    or v_guest_before.live_count <> v_guest_after.live_count
  then
    raise exception 'FAIL: ゲスト本人（固定UUID）の段位・ポイントがテストライブ終了で変化した';
  end if;

  select count(*) into v_ph_count from public.point_history where live_id = v_live_id;
  if v_ph_count <> 0 then
    raise exception 'FAIL: ゲストを含むテストライブなのにpoint_historyが% 件作られている', v_ph_count;
  end if;

  raise notice 'PASS: ゲストを含むテストライブの終了でもポイント・実績・point_historyは一切変化しない（役回りに依存せずゲスト本人のUUIDで直接確認）';
end $$;

-- ============================================================
-- テスト10：ゲストはプロフィール（display_name等）を変更できない。
--           通常のXユーザーは従来どおり変更できる（回帰確認、テスト13の一部）。
-- ============================================================
do $$
declare
  v_before text;
  v_after text;
begin
  select display_name into v_before from public.profiles where id = 'b0000000-0000-0000-0000-00000000001a';

  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000001a', true);
  update public.profiles set display_name = 'ゲストが自称した名前' where id = 'b0000000-0000-0000-0000-00000000001a';
  reset role;

  select display_name into v_after from public.profiles where id = 'b0000000-0000-0000-0000-00000000001a';
  if v_after <> v_before then
    raise exception 'FAIL: ゲストがdisplay_nameを自己編集できてしまった(before=%, after=%)', v_before, v_after;
  end if;

  -- 通常のXユーザーは従来どおり自己編集できる。
  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000000b', true);
  update public.profiles set display_name = 'Xユーザーの新しい名前' where id = 'b0000000-0000-0000-0000-00000000000b';
  reset role;

  select display_name into v_after from public.profiles where id = 'b0000000-0000-0000-0000-00000000000b';
  if v_after <> 'Xユーザーの新しい名前' then
    raise exception 'FAIL: 通常のXユーザーが自己のdisplay_nameを編集できなくなっている(after=%)', v_after;
  end if;

  raise notice 'PASS: ゲストはプロフィールを自己編集できず、通常のXユーザーは従来どおり編集できる';
end $$;

-- ============================================================
-- テスト11：ゲストはSNS投稿・削除・いいね・フォロー・通報を直接実行できない。
-- ============================================================
do $$
declare
  v_topic_id uuid;
  v_answer_id uuid;
  v_failed boolean;
begin
  -- 元ネタ（xuser2による正規の投稿）を用意する。
  insert into public.sns_topics (id, author_id, body)
    values ('b0200000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000c', '0070テスト用お題(SNS)')
    returning id into v_topic_id;
  insert into public.sns_answers (id, topic_id, author_id, body)
    values ('b0200000-0000-0000-0000-000000000002', v_topic_id, 'b0000000-0000-0000-0000-00000000000c', '0070テスト用回答(SNS)')
    returning id into v_answer_id;

  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000001a', true);

  v_failed := false;
  begin
    perform public.submit_sns_topic('ゲストのお題投稿');
  exception when others then
    if sqlerrm = 'GUEST_NOT_ALLOWED' then v_failed := true;
    else reset role; raise exception 'FAIL: 想定外のエラー内容(submit_sns_topic, %)', sqlerrm; end if;
  end;
  if not v_failed then reset role; raise exception 'FAIL: ゲストがsubmit_sns_topicできてしまった'; end if;

  v_failed := false;
  begin
    perform public.submit_sns_answer(v_topic_id, 'ゲストの回答投稿');
  exception when others then
    if sqlerrm = 'GUEST_NOT_ALLOWED' then v_failed := true;
    else reset role; raise exception 'FAIL: 想定外のエラー内容(submit_sns_answer, %)', sqlerrm; end if;
  end;
  if not v_failed then reset role; raise exception 'FAIL: ゲストがsubmit_sns_answerできてしまった'; end if;

  v_failed := false;
  begin
    perform public.submit_sns_comment(v_answer_id, 'ゲストのツッコミ投稿');
  exception when others then
    if sqlerrm = 'GUEST_NOT_ALLOWED' then v_failed := true;
    else reset role; raise exception 'FAIL: 想定外のエラー内容(submit_sns_comment, %)', sqlerrm; end if;
  end;
  if not v_failed then reset role; raise exception 'FAIL: ゲストがsubmit_sns_commentできてしまった'; end if;

  -- delete_own_sns_answer（他人の投稿であってもGUEST_NOT_ALLOWEDが先に出る）
  v_failed := false;
  begin
    perform public.delete_own_sns_answer(v_answer_id);
  exception when others then
    if sqlerrm = 'GUEST_NOT_ALLOWED' then v_failed := true;
    else reset role; raise exception 'FAIL: 想定外のエラー内容(delete_own_sns_answer, %)', sqlerrm; end if;
  end;
  if not v_failed then reset role; raise exception 'FAIL: ゲストがdelete_own_sns_answerできてしまった'; end if;

  -- いいね・フォロー・通報の直接INSERT。
  v_failed := false;
  begin
    insert into public.sns_answer_likes (answer_id, user_id) values (v_answer_id, 'b0000000-0000-0000-0000-00000000001a');
  exception when others then
    if sqlerrm like '%row-level security%' then v_failed := true;
    else reset role; raise exception 'FAIL: 想定外のエラー内容(sns_answer_likes, %)', sqlerrm; end if;
  end;
  if not v_failed then reset role; raise exception 'FAIL: ゲストがsns_answer_likesへ直接INSERTできてしまった'; end if;

  v_failed := false;
  begin
    insert into public.sns_follows (follower_id, following_id) values ('b0000000-0000-0000-0000-00000000001a', 'b0000000-0000-0000-0000-00000000000c');
  exception when others then
    if sqlerrm like '%row-level security%' then v_failed := true;
    else reset role; raise exception 'FAIL: 想定外のエラー内容(sns_follows, %)', sqlerrm; end if;
  end;
  if not v_failed then reset role; raise exception 'FAIL: ゲストがsns_followsへ直接INSERTできてしまった'; end if;

  v_failed := false;
  begin
    insert into public.reports (reporter_id, target_type, target_id, snapshot_body, reason)
      values ('b0000000-0000-0000-0000-00000000001a', 'sns_answer', v_answer_id, 'スナップショット', '荒らし');
  exception when others then
    if sqlerrm like '%row-level security%' then v_failed := true;
    else reset role; raise exception 'FAIL: 想定外のエラー内容(reports, %)', sqlerrm; end if;
  end;
  if not v_failed then reset role; raise exception 'FAIL: ゲストがreportsへ直接INSERTできてしまった'; end if;

  reset role;
  raise notice 'PASS: ゲストはSNS投稿・削除・いいね・フォロー・通報のいずれも直接実行できない';
end $$;

-- ============================================================
-- テスト14：is_guest_user()の権限境界（anon・authenticated(guest/xuser)・
--           SQL Editor相当(auth.uid()がnull)）。
-- ============================================================
do $$
declare
  v_result boolean;
begin
  perform set_config('myapp.uid', '', true);
  select public.is_guest_user() into v_result;
  if v_result is not false then
    raise exception 'FAIL: auth.uid()がnull(SQL Editor相当)のときis_guest_user()がfalseを返さない';
  end if;
  raise notice 'PASS: auth.uid()がnullの場合、is_guest_user()はfalseを返す';
end $$;

do $$
declare
  v_result boolean;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000001a', true);
  select public.is_guest_user() into v_result;
  reset role;
  if v_result is not true then
    raise exception 'FAIL: ゲストのauth.uid()でis_guest_user()がtrueを返さない';
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000000b', true);
  select public.is_guest_user() into v_result;
  reset role;
  if v_result is not false then
    raise exception 'FAIL: 通常のXユーザーのauth.uid()でis_guest_user()がfalseを返さない';
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', 'b0000000-0000-0000-0000-00000000000f', true);
  select public.is_guest_user() into v_result;
  reset role;
  if v_result is not false then
    raise exception 'FAIL: hostのauth.uid()でis_guest_user()がfalseを返さない';
  end if;

  raise notice 'PASS: is_guest_user()はゲスト=true、Xユーザー/host=falseを正しく返す';
end $$;

do $$
declare
  v_denied boolean := false;
begin
  set local role anon;
  begin
    perform public.is_guest_user();
  exception
    when insufficient_privilege then
      v_denied := true;
  end;
  reset role;
  if not v_denied then
    raise exception 'FAIL: anonロールに対する想定したEXECUTE拒否が発生しなかった';
  end if;
  raise notice 'PASS: anonロールはis_guest_user()のEXECUTE権限を持たない';
end $$;

drop table _t0070_ctx;
drop table _t0070_flow;

select 'ALL 0070 TESTS PASSED' as result;
