-- P1-5 権限回帰テスト（0060対応）。実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

insert into auth.users (id) values
  ('c0000000-0000-0000-0000-00000000000a'), -- 一般参加者（攻撃者役）
  ('c0000000-0000-0000-0000-00000000000b'), -- 別の一般参加者（標的役）
  ('c0000000-0000-0000-0000-00000000000c')  -- admin
on conflict do nothing;
update public.profiles set role = 'admin' where id = 'c0000000-0000-0000-0000-00000000000c';

insert into public.lives (id, scheduled_at, current_phase, sequence_number, planned_group_count, max_players)
values ('c1000000-0000-0000-0000-000000000001', now(), 'opening', 9302, 1, 10)
on conflict do nothing;

insert into public.participants (id, live_id, user_id, role, preferred_role)
values
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000a', 'audience', 'audience'),
  ('c2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000b', 'audience', 'audience')
on conflict do nothing;

-- ============================================================
-- テスト1: 一般ユーザーが自分のrole/host_message/host_message_sent_at/
--          kicked_at/group_idを直接UPDATEできない（P1-5の核心）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000a', true);

  begin
    update public.participants set role = 'player' where id = 'c2000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: 参加者が自分のroleをplayerへ自己昇格できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 参加者は自分のroleを直接更新できない';
  end;

  begin
    update public.participants set host_message = '偽メッセージ' where id = 'c2000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: 参加者が自分のhost_messageを直接更新できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 参加者は自分のhost_messageを直接更新できない';
  end;

  begin
    update public.participants set kicked_at = null where id = 'c2000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: 参加者が自分のkicked_atを直接更新できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 参加者は自分のkicked_atを直接更新できない';
  end;

  begin
    update public.participants set group_id = gen_random_uuid() where id = 'c2000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: 参加者が自分のgroup_idを直接更新できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 参加者は自分のgroup_idを直接更新できない';
  end;
end $$;

-- ============================================================
-- テスト2: 他人（userB）の同列も当然更新できない（念のため）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000a', true);

  begin
    update public.participants set role = 'player' where id = 'c2000000-0000-0000-0000-000000000002';
    raise exception 'FAIL: 参加者が他人(userB)のroleを更新できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: 参加者は他人(userB)のroleを直接更新できない';
  end;
end $$;

-- ============================================================
-- テスト3: 非管理者はadmin_set_participant_messageを呼べない。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000a', true);

  begin
    perform public.admin_set_participant_message('c2000000-0000-0000-0000-000000000002', '自作自演');
    raise exception 'FAIL: 非管理者がadmin_set_participant_messageを実行できてしまった';
  exception
    when others then
      if sqlerrm = 'not authorized' then
        raise notice 'PASS: 非管理者はadmin_set_participant_messageを実行できない';
      else
        raise exception 'FAIL: 想定外のエラーで停止: %', sqlerrm;
      end if;
  end;
end $$;

-- ============================================================
-- テスト4: anonはRPCを実行できない。
-- ============================================================
do $$
begin
  set local role anon;
  begin
    perform public.admin_set_participant_message('c2000000-0000-0000-0000-000000000002', 'anon攻撃');
    raise exception 'FAIL: anonがadmin_set_participant_messageを実行できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonはadmin_set_participant_messageを実行できない';
  end;
end $$;

-- ============================================================
-- テスト5: 管理者は正規のRPC経由でhost_message送信・クリアができ、
--          送信時のみadmin_action_logsに記録される（既存挙動どおり）。
-- ============================================================
do $$
declare
  v_message text;
  v_sent_at timestamptz;
  v_log_count int;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000c', true);

  perform public.admin_set_participant_message('c2000000-0000-0000-0000-000000000002', '静粛にしてください');

  reset role;
  select host_message, host_message_sent_at into v_message, v_sent_at
    from public.participants where id = 'c2000000-0000-0000-0000-000000000002';
  if v_message <> '静粛にしてください' or v_sent_at is null then
    raise exception 'FAIL: 管理者によるhost_message送信が反映されなかった';
  end if;

  select count(*) into v_log_count from public.admin_action_logs
    where target_id = 'c2000000-0000-0000-0000-000000000002'
      and action = 'participant_private_message_sent';
  if v_log_count <> 1 then
    raise exception 'FAIL: admin_action_logsに送信が記録されなかった(件数=%)', v_log_count;
  end if;

  -- レビュー指摘対応：監査ログにメッセージ本文を複製していないこと、
  -- 「変更した事実」と「文字数」だけが記録されていることを確認する。
  declare
    v_detail jsonb;
  begin
    select detail into v_detail from public.admin_action_logs
      where target_id = 'c2000000-0000-0000-0000-000000000002'
        and action = 'participant_private_message_sent'
      order by created_at desc limit 1;
    if v_detail is null or v_detail ? 'message' then
      raise exception 'FAIL: admin_action_logsにメッセージ本文（またはmessageキー）が記録されてしまっている: %', coalesce(v_detail::text, 'null');
    end if;
    if (v_detail ->> 'message_changed') is distinct from 'true' then
      raise exception 'FAIL: admin_action_logsにmessage_changed:trueが記録されていない: %', coalesce(v_detail::text, 'null');
    end if;
    if (v_detail ->> 'message_length')::int <> char_length('静粛にしてください') then
      raise exception 'FAIL: admin_action_logsのmessage_lengthが想定と異なる: %', coalesce(v_detail::text, 'null');
    end if;
  end;
  raise notice 'PASS: admin_set_participant_messageの監査ログはメッセージ本文を複製せず、変更した事実と文字数だけを記録する';

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000c', true);
  perform public.admin_set_participant_message('c2000000-0000-0000-0000-000000000002', '');

  reset role;
  select host_message into v_message from public.participants where id = 'c2000000-0000-0000-0000-000000000002';
  if v_message is not null then
    raise exception 'FAIL: 管理者によるhost_messageクリアが反映されなかった';
  end if;

  raise notice 'PASS: 管理者は正規のRPC経由でhost_messageの送信・クリアができ、送信時のみ記録される';
end $$;

-- ============================================================
-- テスト6: 既存の正規フロー（kick/unkick/join_liveのpreferred_role更新）が
--          引き続き動く（回帰確認）。
-- ============================================================
do $$
declare
  v_kicked_at timestamptz;
  v_preferred_role text;
begin
  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000c', true);
  perform public.kick_participant('c2000000-0000-0000-0000-000000000001');

  reset role;
  select kicked_at into v_kicked_at from public.participants where id = 'c2000000-0000-0000-0000-000000000001';
  if v_kicked_at is null then
    raise exception 'FAIL: kick_participantが機能しなくなっている（回帰）';
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000c', true);
  perform public.unkick_participant('c2000000-0000-0000-0000-000000000001');

  reset role;
  select kicked_at into v_kicked_at from public.participants where id = 'c2000000-0000-0000-0000-000000000001';
  if v_kicked_at is not null then
    raise exception 'FAIL: unkick_participantが機能しなくなっている（回帰）';
  end if;

  set local role authenticated;
  perform set_config('myapp.uid', 'c0000000-0000-0000-0000-00000000000a', true);
  perform public.join_live('c1000000-0000-0000-0000-000000000001', 'player', null);

  reset role;
  select preferred_role into v_preferred_role from public.participants where id = 'c2000000-0000-0000-0000-000000000001';
  if v_preferred_role <> 'player' then
    raise exception 'FAIL: join_live経由のpreferred_role更新が機能しなくなっている（回帰）';
  end if;

  raise notice 'PASS: kick_participant/unkick_participant/join_liveは引き続き正常に動作する';
end $$;

select 'ALL P1-5 TESTS PASSED' as result;
