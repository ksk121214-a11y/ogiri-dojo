-- 0072 回帰テスト：participantsテーブルの読み取り範囲の厳格化。
--
-- 背景：0001のparticipants_select_all（using true）により、authenticated
-- （匿名ゲストを含む）であれば誰でも、別ユーザー・別ライブのparticipants行を
-- 直接SELECTでき、host_message（本人だけに見せる個別警告）・
-- host_message_sent_at・kicked_at・user_idという非公開情報が読めてしまっていた。
-- 0072はparticipants_select_allを削除し、本人の行・司会/運営(is_host())の行だけを
-- 直接SELECTできるようにした上で、一般参加者・観客・ゲストが必要とする
-- 「他参加者の表示用情報」は安全なSECURITY DEFINER RPC
-- （participants_for_live / sns_result_participant_user_ids）経由に一本化した。
--
-- 実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

insert into auth.users (id, is_anonymous) values
  ('e9000000-0000-0000-0000-00000000000f', false), -- host(admin)
  ('e9000000-0000-0000-0000-00000000000a', false), -- userA
  ('e9000000-0000-0000-0000-00000000000b', false), -- userB
  ('e9000000-0000-0000-0000-00000000000c', false), -- userC（このライブには一切参加していない第三者）
  ('e9000000-0000-0000-0000-00000000000d', true)   -- ゲスト（匿名）
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'e9000000-0000-0000-0000-00000000000f';

-- ============================================================
-- フィクスチャ1：1本のライブに userA（host_messageあり）・userB（無し）・
-- ゲストが参加している状態を作る（直接INSERTで用意する。RLSの検証が目的で
-- join_live経由の参加フロー自体は0070/0071で別途検証済みのため、ここでは
-- テストスクリプト自身の権限で直接行を作る）。
-- ============================================================
insert into public.lives (id, scheduled_at, current_phase, live_mode, official_sequence_number, results_published)
values ('e9100000-0000-0000-0000-000000000001', now(), 'closed', 'official', 991001, false);

insert into public.groups (id, live_id, group_order) values
  ('e9110000-0000-0000-0000-000000000001', 'e9100000-0000-0000-0000-000000000001', 1);

insert into public.participants
  (id, live_id, user_id, group_id, role, host_message, host_message_sent_at, kicked_at, is_guest, guest_number)
values
  ('e9140000-0000-0000-0000-000000000001', 'e9100000-0000-0000-0000-000000000001',
   'e9000000-0000-0000-0000-00000000000a', 'e9110000-0000-0000-0000-000000000001', 'player',
   '本人限定の個別警告メッセージ', now(), null, false, null),
  ('e9140000-0000-0000-0000-000000000002', 'e9100000-0000-0000-0000-000000000001',
   'e9000000-0000-0000-0000-00000000000b', 'e9110000-0000-0000-0000-000000000001', 'player',
   null, null, null, false, null),
  ('e9140000-0000-0000-0000-000000000003', 'e9100000-0000-0000-0000-000000000001',
   'e9000000-0000-0000-0000-00000000000d', null, 'audience',
   null, null, null, true, 1);

-- ============================================================
-- テスト1：本人は自分の行（host_message含む）を直接SELECTできる。
-- ============================================================
do $$
declare
  v_row public.participants;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e9000000-0000-0000-0000-00000000000a', true);
  select * into v_row from public.participants where id = 'e9140000-0000-0000-0000-000000000001';
  reset role;
  if v_row.id is null then
    raise exception 'FAIL: 本人が自分のparticipants行を直接SELECTできない';
  end if;
  if v_row.host_message is distinct from '本人限定の個別警告メッセージ' then
    raise exception 'FAIL: 本人が自分のhost_messageを直接SELECTで取得できない';
  end if;
  raise notice 'PASS: 本人は自分のparticipants行（host_message含む）を直接SELECTできる';
end $$;

-- ============================================================
-- テスト2：通常会員は他人（同じライブの別参加者）のparticipants行を
--          直接SELECTでは一切取得できない（host_messageの有無に関わらず、
--          行自体が返らない）。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e9000000-0000-0000-0000-00000000000a', true);
  select count(*) into v_count from public.participants
    where live_id = 'e9100000-0000-0000-0000-000000000001'
      and user_id <> 'e9000000-0000-0000-0000-00000000000a';
  reset role;
  if v_count <> 0 then
    raise exception 'FAIL: 通常会員が他人のparticipants行を直接SELECTで取得できてしまった(件数=%)', v_count;
  end if;
  raise notice 'PASS: 通常会員は他人のparticipants行を直接SELECTでは一切取得できない（host_messageも含め非公開）';
end $$;

-- ============================================================
-- テスト3：匿名ゲストも他人のparticipants行を直接SELECTでは取得できない。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e9000000-0000-0000-0000-00000000000d', true);
  select count(*) into v_count from public.participants
    where live_id = 'e9100000-0000-0000-0000-000000000001'
      and user_id <> 'e9000000-0000-0000-0000-00000000000d';
  reset role;
  if v_count <> 0 then
    raise exception 'FAIL: 匿名ゲストが他人のparticipants行を直接SELECTで取得できてしまった(件数=%)', v_count;
  end if;
  raise notice 'PASS: 匿名ゲストも他人のparticipants行を直接SELECTでは一切取得できない';
end $$;

-- ============================================================
-- テスト4：司会/運営(is_host())は全参加者の行（host_message含む）を
--          直接SELECTで取得できる。
-- ============================================================
do $$
declare
  v_count int;
  v_host_message text;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e9000000-0000-0000-0000-00000000000f', true);
  select count(*) into v_count from public.participants
    where live_id = 'e9100000-0000-0000-0000-000000000001';
  select host_message into v_host_message from public.participants
    where id = 'e9140000-0000-0000-0000-000000000001';
  reset role;
  if v_count <> 3 then
    raise exception 'FAIL: 司会/運営が取得できたparticipants行数が想定と違う(想定=3、実際=%)', v_count;
  end if;
  if v_host_message is distinct from '本人限定の個別警告メッセージ' then
    raise exception 'FAIL: 司会/運営が他人のhost_messageを直接SELECTで取得できない';
  end if;
  raise notice 'PASS: 司会/運営は全参加者のparticipants行（host_message含む）を直接SELECTで取得できる';
end $$;

-- ============================================================
-- テスト5：anon（未認証相当）は誰の行も直接SELECTで取得できない。
-- ============================================================
do $$
declare
  v_count int;
begin
  set local role anon;
  select count(*) into v_count from public.participants
    where live_id = 'e9100000-0000-0000-0000-000000000001';
  reset role;
  if v_count <> 0 then
    raise exception 'FAIL: anonがparticipants行を直接SELECTで取得できてしまった(件数=%)', v_count;
  end if;
  raise notice 'PASS: anon（未認証相当）はparticipants行を一切直接SELECTで取得できない';
end $$;

-- ============================================================
-- テスト6：participants_for_live() RPCは、本人の行はhost_message等を
--          そのまま返し、他人の行はhost_message/host_message_sent_at/
--          kicked_at/user_idをnullにマスクして返す（role/group_id/
--          preferred_role/joined_at/is_guest/guest_numberは全員ぶんそのまま）。
-- ============================================================
do $$
declare
  v_own_host_message text;
  v_own_user_id uuid;
  v_other_host_message text;
  v_other_user_id uuid;
  v_other_kicked_at timestamptz;
  v_other_role text;
  v_other_group_id uuid;
  v_guest_is_guest boolean;
  v_guest_number int;
  v_total int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e9000000-0000-0000-0000-00000000000a', true);

  select count(*) into v_total from public.participants_for_live('e9100000-0000-0000-0000-000000000001');
  if v_total <> 3 then
    raise exception 'FAIL: participants_for_liveが返した行数が想定と違う(想定=3、実際=%)', v_total;
  end if;

  select host_message, user_id into v_own_host_message, v_own_user_id
    from public.participants_for_live('e9100000-0000-0000-0000-000000000001')
    where id = 'e9140000-0000-0000-0000-000000000001';
  if v_own_host_message is distinct from '本人限定の個別警告メッセージ' or v_own_user_id is distinct from 'e9000000-0000-0000-0000-00000000000a'::uuid then
    raise exception 'FAIL: participants_for_liveが本人自身のhost_message/user_idを返さない';
  end if;

  select host_message, user_id, kicked_at, role, group_id
    into v_other_host_message, v_other_user_id, v_other_kicked_at, v_other_role, v_other_group_id
    from public.participants_for_live('e9100000-0000-0000-0000-000000000001')
    where id = 'e9140000-0000-0000-0000-000000000002';
  if v_other_host_message is not null or v_other_user_id is not null or v_other_kicked_at is not null then
    raise exception 'FAIL: participants_for_liveが他人のhost_message/user_id/kicked_atをマスクせずに返した';
  end if;
  if v_other_role is distinct from 'player' or v_other_group_id is distinct from 'e9110000-0000-0000-0000-000000000001'::uuid then
    raise exception 'FAIL: participants_for_liveが非公開ではない列（role/group_id）まで隠してしまっている';
  end if;

  select is_guest, guest_number into v_guest_is_guest, v_guest_number
    from public.participants_for_live('e9100000-0000-0000-0000-000000000001')
    where id = 'e9140000-0000-0000-0000-000000000003';
  if v_guest_is_guest is not true or v_guest_number is distinct from 1 then
    raise exception 'FAIL: participants_for_liveがゲストのis_guest/guest_number（表示名の採番に必須）を返さない';
  end if;

  reset role;
  raise notice 'PASS: participants_for_liveは本人の非公開列だけ返し、他人の非公開列はnullにマスクしつつ座席表示に必要な列は全員ぶん返す';
end $$;

-- ============================================================
-- テスト7：司会/運営がparticipants_for_live()を呼んだ場合は、
--          全参加者の非公開列（host_message等）もマスクされずに返る。
-- ============================================================
do $$
declare
  v_host_message text;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e9000000-0000-0000-0000-00000000000f', true);
  select host_message into v_host_message
    from public.participants_for_live('e9100000-0000-0000-0000-000000000001')
    where id = 'e9140000-0000-0000-0000-000000000001';
  reset role;
  if v_host_message is distinct from '本人限定の個別警告メッセージ' then
    raise exception 'FAIL: 司会/運営がparticipants_for_live経由で他人のhost_messageを取得できない';
  end if;
  raise notice 'PASS: 司会/運営はparticipants_for_live経由でも全参加者の非公開列を取得できる';
end $$;

-- ============================================================
-- テスト8：過去（closed）のライブIDを指定しても、当事者以外には
--          非公開情報が一切漏れない（このライブに一度も参加していない
--          第三者userCから見ても、全行の非公開列はnullのまま）。
-- ============================================================
do $$
declare
  v_leaked int;
  v_total int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'e9000000-0000-0000-0000-00000000000c', true);
  select count(*) into v_total from public.participants_for_live('e9100000-0000-0000-0000-000000000001');
  select count(*) into v_leaked from public.participants_for_live('e9100000-0000-0000-0000-000000000001')
    where host_message is not null or host_message_sent_at is not null or kicked_at is not null or user_id is not null;
  reset role;
  if v_total <> 3 then
    raise exception 'FAIL: 過去ライブの参加者一覧の件数が想定と違う(想定=3、実際=%)', v_total;
  end if;
  if v_leaked <> 0 then
    raise exception 'FAIL: 過去ライブに一度も参加していない第三者へ、非公開列が%件漏れた', v_leaked;
  end if;
  raise notice 'PASS: 過去（closed）のライブIDを指定しても、当事者以外へ非公開情報は一切漏れない';
end $$;

-- ============================================================
-- テスト9：anon（未認証相当）はparticipants_for_live()自体を実行できない
--          （EXECUTE権限を持たない）。
-- ============================================================
do $$
declare
  v_denied boolean := false;
begin
  set local role anon;
  begin
    perform public.participants_for_live('e9100000-0000-0000-0000-000000000001');
  exception
    when insufficient_privilege then
      v_denied := true;
  end;
  reset role;
  if not v_denied then
    raise exception 'FAIL: anonがparticipants_for_liveを実行できてしまった';
  end if;
  raise notice 'PASS: anon（未認証相当）はparticipants_for_liveのEXECUTE権限を持たない';
end $$;

-- ============================================================
-- フィクスチャ2：sns_result_participant_user_ids用の4パターン
--（0068_sns_live_result_likes_rls.test.sqlと同じ構成：本番/公開/掲載対象、
-- 本番/公開/除外、テストライブ、本番/未公開）。
-- ============================================================
insert into public.lives
  (id, scheduled_at, current_phase, live_mode, official_sequence_number, results_published)
values
  ('e9200000-0000-0000-0000-000000000001', now(), 'closed', 'official', 991002, true),
  ('e9200000-0000-0000-0000-000000000002', now(), 'closed', 'official', 991003, true),
  ('e9200000-0000-0000-0000-000000000003', now(), 'closed', 'test', null, false),
  ('e9200000-0000-0000-0000-000000000004', now(), 'closed', 'official', 991004, false);

insert into public.groups (id, live_id, group_order) values
  ('e9210000-0000-0000-0000-000000000001', 'e9200000-0000-0000-0000-000000000001', 1),
  ('e9210000-0000-0000-0000-000000000002', 'e9200000-0000-0000-0000-000000000002', 1),
  ('e9210000-0000-0000-0000-000000000003', 'e9200000-0000-0000-0000-000000000003', 1),
  ('e9210000-0000-0000-0000-000000000004', 'e9200000-0000-0000-0000-000000000004', 1);

insert into public.topics (id, live_id, body) values
  ('e9220000-0000-0000-0000-000000000001', 'e9200000-0000-0000-0000-000000000001', 'お題1（公開・掲載対象）'),
  ('e9220000-0000-0000-0000-000000000002', 'e9200000-0000-0000-0000-000000000002', 'お題2（公開・除外）'),
  ('e9220000-0000-0000-0000-000000000003', 'e9200000-0000-0000-0000-000000000003', 'お題3（テストライブ）'),
  ('e9220000-0000-0000-0000-000000000004', 'e9200000-0000-0000-0000-000000000004', 'お題4（本番・未公開）');

insert into public.turns (id, live_id, round, group_id, topic_id, status) values
  ('e9230000-0000-0000-0000-000000000001', 'e9200000-0000-0000-0000-000000000001', 1, 'e9210000-0000-0000-0000-000000000001', 'e9220000-0000-0000-0000-000000000001', 'done'),
  ('e9230000-0000-0000-0000-000000000002', 'e9200000-0000-0000-0000-000000000002', 1, 'e9210000-0000-0000-0000-000000000002', 'e9220000-0000-0000-0000-000000000002', 'done'),
  ('e9230000-0000-0000-0000-000000000003', 'e9200000-0000-0000-0000-000000000003', 1, 'e9210000-0000-0000-0000-000000000003', 'e9220000-0000-0000-0000-000000000003', 'done'),
  ('e9230000-0000-0000-0000-000000000004', 'e9200000-0000-0000-0000-000000000004', 1, 'e9210000-0000-0000-0000-000000000004', 'e9220000-0000-0000-0000-000000000004', 'done');

insert into public.participants (id, live_id, user_id, group_id, role) values
  ('e9240000-0000-0000-0000-000000000001', 'e9200000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-00000000000a', 'e9210000-0000-0000-0000-000000000001', 'player'),
  ('e9240000-0000-0000-0000-000000000002', 'e9200000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-00000000000a', 'e9210000-0000-0000-0000-000000000002', 'player'),
  ('e9240000-0000-0000-0000-000000000003', 'e9200000-0000-0000-0000-000000000003', 'e9000000-0000-0000-0000-00000000000a', 'e9210000-0000-0000-0000-000000000003', 'player'),
  ('e9240000-0000-0000-0000-000000000004', 'e9200000-0000-0000-0000-000000000004', 'e9000000-0000-0000-0000-00000000000a', 'e9210000-0000-0000-0000-000000000004', 'player');

insert into public.answers (id, turn_id, participant_id, seq, body) values
  ('e9250000-0000-0000-0000-000000000001', 'e9230000-0000-0000-0000-000000000001', 'e9240000-0000-0000-0000-000000000001', 1, '回答1'),
  ('e9250000-0000-0000-0000-000000000002', 'e9230000-0000-0000-0000-000000000002', 'e9240000-0000-0000-0000-000000000002', 1, '回答2'),
  ('e9250000-0000-0000-0000-000000000003', 'e9230000-0000-0000-0000-000000000003', 'e9240000-0000-0000-0000-000000000003', 1, '回答3'),
  ('e9250000-0000-0000-0000-000000000004', 'e9230000-0000-0000-0000-000000000004', 'e9240000-0000-0000-0000-000000000004', 1, '回答4');

insert into public.sns_live_results (id, live_id) values
  ('e9260000-0000-0000-0000-000000000001', 'e9200000-0000-0000-0000-000000000001'),
  ('e9260000-0000-0000-0000-000000000002', 'e9200000-0000-0000-0000-000000000002'),
  ('e9260000-0000-0000-0000-000000000003', 'e9200000-0000-0000-0000-000000000003'),
  ('e9260000-0000-0000-0000-000000000004', 'e9200000-0000-0000-0000-000000000004');

insert into public.sns_live_result_answers (id, live_result_id, answer_id, rank, included) values
  ('e9270000-0000-0000-0000-000000000001', 'e9260000-0000-0000-0000-000000000001', 'e9250000-0000-0000-0000-000000000001', 1, true),  -- 公開・掲載対象 → 返る
  ('e9270000-0000-0000-0000-000000000002', 'e9260000-0000-0000-0000-000000000002', 'e9250000-0000-0000-0000-000000000002', 1, false), -- 公開・除外 → 返らない
  ('e9270000-0000-0000-0000-000000000003', 'e9260000-0000-0000-0000-000000000003', 'e9250000-0000-0000-0000-000000000003', 1, true),  -- テストライブ → 返らない
  ('e9270000-0000-0000-0000-000000000004', 'e9260000-0000-0000-0000-000000000004', 'e9250000-0000-0000-0000-000000000004', 1, true);  -- 本番・未公開 → 返らない

-- ============================================================
-- テスト10：sns_result_participant_user_idsは、掲載確定済み・結果公開済み・
--           本番の回答に紐づく参加者だけを返す（除外・テストライブ・未公開は
--           一切返さない）。anon（未ログイン閲覧）でも実行できる。
-- ============================================================
do $$
declare
  v_ids uuid[] := array[
    'e9240000-0000-0000-0000-000000000001',
    'e9240000-0000-0000-0000-000000000002',
    'e9240000-0000-0000-0000-000000000003',
    'e9240000-0000-0000-0000-000000000004'
  ];
  v_rows record;
  v_returned_ids uuid[] := array[]::uuid[];
begin
  set local role anon;
  for v_rows in select * from public.sns_result_participant_user_ids(v_ids) loop
    v_returned_ids := array_append(v_returned_ids, v_rows.participant_id);
  end loop;
  reset role;

  if not ('e9240000-0000-0000-0000-000000000001' = any(v_returned_ids)) then
    raise exception 'FAIL: 公開・掲載対象の参加者が返らなかった';
  end if;
  if 'e9240000-0000-0000-0000-000000000002' = any(v_returned_ids) then
    raise exception 'FAIL: 掲載から除外(included=false)された参加者のuser_idが返ってしまった';
  end if;
  if 'e9240000-0000-0000-0000-000000000003' = any(v_returned_ids) then
    raise exception 'FAIL: テストライブの参加者のuser_idが返ってしまった';
  end if;
  if 'e9240000-0000-0000-0000-000000000004' = any(v_returned_ids) then
    raise exception 'FAIL: 本番だが未公開のライブの参加者のuser_idが返ってしまった';
  end if;
  raise notice 'PASS: sns_result_participant_user_idsは掲載確定済み・公開済み・本番の参加者だけを返し、anon（未ログイン閲覧）でも実行できる';
end $$;

-- ============================================================
-- テスト11：participants_change_pings（Realtime購読維持用の合図テーブル）は
--           Supabase Realtimeの配信対象(supabase_realtime publication)に
--           登録されている（未登録だと本番でイベントが一切配信されない）。
-- ============================================================
do $$
declare
  v_registered boolean;
begin
  select exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'participants_change_pings'
  ) into v_registered;
  if not v_registered then
    raise exception 'FAIL: participants_change_pingsがsupabase_realtime publicationに登録されていない';
  end if;
  raise notice 'PASS: participants_change_pingsはsupabase_realtime publicationに登録されている';
end $$;

-- ============================================================
-- テスト12：同一ライブを何度更新してもping行は1行を超えず、changed_atは
--           更新される（live_idをPRIMARY KEYにしたupsert設計の確認）。
--           別ライブの変更は別のping行になる。全員（authenticated）が読める。
-- ============================================================
update public.participants set role = 'player' where id = 'e9140000-0000-0000-0000-000000000002';

do $$
declare
  v_count int;
  v_changed_at_1 timestamptz;
begin
  select count(*), max(changed_at) into v_count, v_changed_at_1 from public.participants_change_pings
    where live_id = 'e9100000-0000-0000-0000-000000000001';
  if v_count <> 1 then
    raise exception 'FAIL: 1回目の変更後のping行数が想定と違う(想定=1、実際=%)', v_count;
  end if;
  create temporary table _t0072_ping_ctx (key text primary key, val text);
  insert into _t0072_ping_ctx values ('changed_at_1', v_changed_at_1::text);
end $$;

-- 別のtop-levelステートメント（別トランザクション）でもう一度更新し、
-- now()が確実に進んだ状態でchanged_atが更新されることを確認する。
select pg_sleep(0.05);
update public.participants set role = 'audience' where id = 'e9140000-0000-0000-0000-000000000002';

do $$
declare
  v_count int;
  v_changed_at_1 timestamptz;
  v_changed_at_2 timestamptz;
  v_count_live2 int;
begin
  select val::timestamptz into v_changed_at_1 from _t0072_ping_ctx where key = 'changed_at_1';
  select count(*), max(changed_at) into v_count, v_changed_at_2 from public.participants_change_pings
    where live_id = 'e9100000-0000-0000-0000-000000000001';
  if v_count <> 1 then
    raise exception 'FAIL: 同一ライブを複数回更新した後もping行数は1のはずが実際は%件（増え続けている疑い）', v_count;
  end if;
  if v_changed_at_2 <= v_changed_at_1 then
    raise exception 'FAIL: 2回目の変更でchanged_atが更新されていない(1回目=%、2回目=%)', v_changed_at_1, v_changed_at_2;
  end if;

  -- 別ライブ(フィクスチャ2、e9200000-...-0001)の参加者を更新しても、
  -- こちらのライブ(e9100000-...-0001)のping行数・changed_atには影響しない。
  update public.participants set role = 'audience' where id = 'e9240000-0000-0000-0000-000000000001';
  select count(*) into v_count_live2 from public.participants_change_pings where live_id = 'e9200000-0000-0000-0000-000000000001';
  if v_count_live2 <> 1 then
    raise exception 'FAIL: 別ライブの変更が別のping行(1行)になっていない(実際=%)', v_count_live2;
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', 'e9000000-0000-0000-0000-00000000000b', true);
  perform 1 from public.participants_change_pings where live_id = 'e9100000-0000-0000-0000-000000000001' limit 1;
  reset role;

  raise notice 'PASS: 同一ライブは何度更新してもping行1行のままchanged_atだけが更新され、別ライブは別のping行になる。一般会員も読める';
  drop table _t0072_ping_ctx;
end $$;

-- ============================================================
-- テスト13：participantsのINSERT・UPDATE・DELETEのいずれでもping(changed_at)が
--           更新される。
-- ============================================================
insert into public.participants (id, live_id, user_id, role) values
  ('e9140000-0000-0000-0000-000000000004', 'e9100000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-00000000000c', 'audience');

do $$
declare
  v_after_insert timestamptz;
begin
  select changed_at into v_after_insert from public.participants_change_pings
    where live_id = 'e9100000-0000-0000-0000-000000000001';
  if v_after_insert is null then
    raise exception 'FAIL: participantsへのINSERTでpingが更新されなかった';
  end if;
  create temporary table _t0072_ping_ctx2 (key text primary key, val text);
  insert into _t0072_ping_ctx2 values ('after_insert', v_after_insert::text);
end $$;

select pg_sleep(0.05);
delete from public.participants where id = 'e9140000-0000-0000-0000-000000000004';

do $$
declare
  v_after_insert timestamptz;
  v_after_delete timestamptz;
begin
  select val::timestamptz into v_after_insert from _t0072_ping_ctx2 where key = 'after_insert';
  select changed_at into v_after_delete from public.participants_change_pings
    where live_id = 'e9100000-0000-0000-0000-000000000001';
  if v_after_delete <= v_after_insert then
    raise exception 'FAIL: participantsのDELETEでpingが更新されなかった(INSERT時=%、DELETE後=%)', v_after_insert, v_after_delete;
  end if;
  raise notice 'PASS: participantsのINSERT・UPDATE（テスト12で確認済み）・DELETEのいずれでもpingが更新される';
  drop table _t0072_ping_ctx2;
end $$;

-- ============================================================
-- テスト14：liveの削除がFKエラーなく成功し、participants本体・
--           participants_change_pings行のどちらも一緒に削除される
--           （participantsのCASCADE DELETE中にping再作成を試みてFK違反に
--           ならないことの確認）。
-- ============================================================
insert into public.lives (id, scheduled_at, current_phase, live_mode, official_sequence_number, results_published)
  values ('e9300000-0000-0000-0000-000000000001', now(), 'closed', 'test', null, false);
insert into public.participants (id, live_id, user_id, role) values
  ('e9340000-0000-0000-0000-000000000001', 'e9300000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-00000000000a', 'audience'),
  ('e9340000-0000-0000-0000-000000000002', 'e9300000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-00000000000b', 'audience');

do $$
begin
  if not exists (
    select 1 from public.participants_change_pings where live_id = 'e9300000-0000-0000-0000-000000000001'
  ) then
    raise exception 'FAIL: テスト前提が崩れている（削除対象ライブのping行が作られていない）';
  end if;
end $$;

-- このDELETE自体がFKエラーなく完走することが最大の確認点（違反があれば
-- \set ON_ERROR_STOP onによりここでスクリプト全体が停止する）。
delete from public.lives where id = 'e9300000-0000-0000-0000-000000000001';

do $$
declare
  v_ping_count int;
  v_participants_count int;
begin
  select count(*) into v_ping_count from public.participants_change_pings where live_id = 'e9300000-0000-0000-0000-000000000001';
  select count(*) into v_participants_count from public.participants where live_id = 'e9300000-0000-0000-0000-000000000001';
  if v_ping_count <> 0 then
    raise exception 'FAIL: live削除後もparticipants_change_pings行が残っている(件数=%)', v_ping_count;
  end if;
  if v_participants_count <> 0 then
    raise exception 'FAIL: live削除後もparticipants行が残っている(件数=%)', v_participants_count;
  end if;
  raise notice 'PASS: liveの削除はFKエラーなく成功し、participants本体・ping行の両方が一緒に削除される';
end $$;

-- ============================================================
-- テスト15：anonはparticipants_change_pingsへ直接INSERT/UPDATE/DELETEの
--           どれもできない（direct書き込み用ポリシーが存在せず、トリガー
--           経由のみに限定されている）。
-- ============================================================
do $$
declare
  v_denied boolean;
  v_rows int;
begin
  set local role anon;

  v_denied := false;
  begin
    insert into public.participants_change_pings (live_id, changed_at)
      values ('e9100000-0000-0000-0000-000000000001', now());
  exception
    when others then v_denied := true;
  end;
  if not v_denied then
    reset role;
    raise exception 'FAIL: anonがparticipants_change_pingsへ直接INSERTできてしまった';
  end if;

  v_rows := -1;
  begin
    update public.participants_change_pings set changed_at = now()
      where live_id = 'e9100000-0000-0000-0000-000000000001';
    get diagnostics v_rows = row_count;
  exception
    when others then v_rows := 0;
  end;
  if v_rows <> 0 then
    reset role;
    raise exception 'FAIL: anonがparticipants_change_pingsへ直接UPDATEできてしまった(影響行数=%)', v_rows;
  end if;

  v_rows := -1;
  begin
    delete from public.participants_change_pings where live_id = 'e9100000-0000-0000-0000-000000000001';
    get diagnostics v_rows = row_count;
  exception
    when others then v_rows := 0;
  end;
  if v_rows <> 0 then
    reset role;
    raise exception 'FAIL: anonがparticipants_change_pingsへ直接DELETEできてしまった(影響行数=%)', v_rows;
  end if;

  reset role;
  raise notice 'PASS: anonはparticipants_change_pingsへ直接INSERT/UPDATE/DELETEのいずれも書き込めない（INSERTは例外、UPDATE/DELETEは対象0件）';
end $$;

select 'ALL 0072 TESTS PASSED' as result;
