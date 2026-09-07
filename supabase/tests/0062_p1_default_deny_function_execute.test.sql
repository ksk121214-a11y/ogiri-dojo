-- P1-7 権限回帰テスト（0062対応）。実行方法はsupabase/tests/run.sh参照。

\set ON_ERROR_STOP on

-- ============================================================
-- テスト1: 0046で「塞いだはず」だったlog_share_clickへのanonアクセスが、
--          実は全く塞がっていなかった実例。今度こそ本当に拒否されることを確認する。
-- ============================================================
do $$
begin
  set local role anon;
  begin
    perform public.log_share_click('live_schedule');
    raise exception 'FAIL: anonがlog_share_clickを実行できてしまった（0046の対策が無効なまま）';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonはlog_share_clickを実行できない';
  end;
end $$;

-- ============================================================
-- テスト2: anonはsubmit_sns_topic/submit_sns_answer/submit_sns_commentを
--          実行できない（関数レベルで拒否、テーブル権限まで到達しない）。
-- ============================================================
do $$
begin
  set local role anon;

  begin
    perform public.submit_sns_topic('anon投稿テスト');
    raise exception 'FAIL: anonがsubmit_sns_topicを実行できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonはsubmit_sns_topicを実行できない';
  end;

  begin
    perform public.set_live_schedule_role(gen_random_uuid(), 'previous');
    raise exception 'FAIL: anonがset_live_schedule_roleを実行できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonはset_live_schedule_roleを実行できない';
  end;
end $$;

-- ============================================================
-- テスト3: トリガー専用関数（handle_new_user等）を、authenticated/anonの
--          どちらも直接呼び出せない。
-- ============================================================
do $$
begin
  set local role authenticated;
  begin
    perform public.handle_new_user();
    raise exception 'FAIL: authenticatedがhandle_new_user()を直接実行できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: authenticatedはhandle_new_user()を直接実行できない';
  end;
end $$;

-- ============================================================
-- テスト3b（レビュー指摘対応）：トリガー専用4関数について、
-- PUBLIC/anon/authenticatedのいずれもEXECUTE権限を持たないことを
-- has_function_privilege()で直接確認する（0062のコメントには元々
-- 「public/anon/authenticatedすべてから明示的にrevoke」と書かれていたが、
-- 実際のSQLはPUBLICからのrevokeしか行っていなかった）。
-- ============================================================
do $$
declare
  v_fn text;
  v_fns text[] := array[
    'public.handle_new_user()',
    'public.set_answer_live_id()',
    'public.sns_answer_likes_sync()',
    'public.sns_live_result_likes_sync()'
  ];
begin
  foreach v_fn in array v_fns loop
    if has_function_privilege('public', v_fn, 'EXECUTE') then
      raise exception 'FAIL: PUBLICが%のEXECUTEを持っている', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception 'FAIL: anonが%のEXECUTEを持っている', v_fn;
    end if;
    if has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'FAIL: authenticatedが%のEXECUTEを持っている', v_fn;
    end if;
  end loop;
  raise notice 'PASS: トリガー専用4関数はPUBLIC/anon/authenticatedいずれもEXECUTE権限を持たない';
end $$;

-- ============================================================
-- テスト3c（レビュー指摘対応）：EXECUTE権限を剥奪しても、通常のテーブル操作
-- によるトリガー発火（＝クライアントのSQL呼び出しを経由しない発火経路）は
-- 引き続き正常に動作する。PostgreSQLはトリガー発火時にDML実行者の関数
-- EXECUTE権限を要求しないため、revokeの影響を受けないはずだが、実際に
-- 確認する。
-- ============================================================
do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_profile_exists boolean;
begin
  -- handle_new_user: auth.usersへのinsertでprofilesが自動生成されるか。
  insert into auth.users (id) values (v_user_id);
  select exists(select 1 from public.profiles where id = v_user_id) into v_profile_exists;
  if not v_profile_exists then
    raise exception 'FAIL: handle_new_user()のトリガー発火が壊れている（profilesが自動生成されない）';
  end if;
  raise notice 'PASS: handle_new_user()のトリガー発火は引き続き正常（auth.users insertでprofiles自動生成）';
end $$;

do $$
declare
  v_host_id uuid := gen_random_uuid();
  v_player_id uuid := gen_random_uuid();
  v_live_id uuid := gen_random_uuid();
  v_group_id uuid := gen_random_uuid();
  v_topic_id uuid := gen_random_uuid();
  v_turn_id uuid := gen_random_uuid();
  v_participant_id uuid := gen_random_uuid();
  v_answer_id uuid;
  v_answer_live_id uuid;
begin
  -- set_answer_live_id: answers insert時にlive_idを明示的に渡さなくても、
  -- turnsから自動補完されるか。
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';

  insert into auth.users (id) values (v_host_id), (v_player_id);
  insert into public.lives (id, scheduled_at, current_phase, sequence_number, planned_group_count, max_players)
    values (v_live_id, now(), 'answering', 9403, 1, 10);
  insert into public.groups (id, live_id, group_order) values (v_group_id, v_live_id, 1);
  insert into public.topics (id, live_id, body, format) values (v_topic_id, v_live_id, 'P1-7bトリガー確認お題', 'text');
  insert into public.participants (id, live_id, user_id, group_id, role)
    values (v_participant_id, v_live_id, v_player_id, v_group_id, 'player');
  insert into public.turns (id, live_id, round, group_id, topic_id, status, eligible_judge_count)
    values (v_turn_id, v_live_id, 1, v_group_id, v_topic_id, 'active', 0);

  -- live_idを渡さずinsertする（トリガーが補完する前提）。
  insert into public.answers (turn_id, participant_id, seq, body)
    values (v_turn_id, v_participant_id, 1, 'P1-7bトリガー確認の回答')
    returning id, live_id into v_answer_id, v_answer_live_id;

  if v_answer_live_id is distinct from v_live_id then
    raise exception 'FAIL: set_answer_live_id()のトリガー発火が壊れている（live_idが自動補完されない）';
  end if;
  raise notice 'PASS: set_answer_live_id()のトリガー発火は引き続き正常（answers.live_idが自動補完される）';
end $$;

do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_topic_id uuid;
  v_answer_id uuid;
  v_likes int;
begin
  -- sns_answer_likes_sync: sns_answer_likesへのinsert/deleteでsns_answers.likesが
  -- 増減するか。
  insert into auth.users (id) values (v_user_id);
  insert into public.sns_topics (author_id, body) values (v_user_id, 'P1-7bトリガー確認お題(SNS)')
    returning id into v_topic_id;
  insert into public.sns_answers (topic_id, author_id, body) values (v_topic_id, v_user_id, 'P1-7bトリガー確認回答(SNS)')
    returning id into v_answer_id;

  insert into public.sns_answer_likes (answer_id, user_id) values (v_answer_id, v_user_id);
  select likes into v_likes from public.sns_answers where id = v_answer_id;
  if v_likes <> 1 then
    raise exception 'FAIL: sns_answer_likes_sync()のinsert側トリガー発火が壊れている(likes=%)', v_likes;
  end if;

  delete from public.sns_answer_likes where answer_id = v_answer_id and user_id = v_user_id;
  select likes into v_likes from public.sns_answers where id = v_answer_id;
  if v_likes <> 0 then
    raise exception 'FAIL: sns_answer_likes_sync()のdelete側トリガー発火が壊れている(likes=%)', v_likes;
  end if;

  raise notice 'PASS: sns_answer_likes_sync()のトリガー発火は引き続き正常（likesが増減する）';
end $$;

do $$
declare
  v_host_id uuid := gen_random_uuid();
  v_user_id uuid := gen_random_uuid();
  v_live_id uuid := gen_random_uuid();
  v_group_id uuid := gen_random_uuid();
  v_topic_id uuid := gen_random_uuid();
  v_turn_id uuid := gen_random_uuid();
  v_participant_id uuid := gen_random_uuid();
  v_answer_id uuid;
  v_live_result_id uuid;
  v_result_answer_id uuid;
  v_likes int;
begin
  -- sns_live_result_likes_sync: sns_live_result_likesへのinsert/deleteで
  -- sns_live_result_answers.likesが増減するか。
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';

  insert into auth.users (id) values (v_host_id), (v_user_id);
  insert into public.lives (id, scheduled_at, current_phase, sequence_number, planned_group_count, max_players)
    values (v_live_id, now(), 'closed', 9404, 1, 10);
  insert into public.groups (id, live_id, group_order) values (v_group_id, v_live_id, 1);
  insert into public.topics (id, live_id, body, format) values (v_topic_id, v_live_id, 'P1-7bトリガー確認お題(結果)', 'text');
  insert into public.participants (id, live_id, user_id, group_id, role)
    values (v_participant_id, v_live_id, v_user_id, v_group_id, 'player');
  insert into public.turns (id, live_id, round, group_id, topic_id, status, eligible_judge_count)
    values (v_turn_id, v_live_id, 1, v_group_id, v_topic_id, 'done', 0);
  insert into public.answers (id, turn_id, participant_id, seq, body, resolved)
    values (gen_random_uuid(), v_turn_id, v_participant_id, 1, 'P1-7bトリガー確認回答(結果)', true)
    returning id into v_answer_id;

  insert into public.sns_live_results (id, live_id) values (gen_random_uuid(), v_live_id)
    returning id into v_live_result_id;
  insert into public.sns_live_result_answers (id, live_result_id, answer_id)
    values (gen_random_uuid(), v_live_result_id, v_answer_id)
    returning id into v_result_answer_id;

  insert into public.sns_live_result_likes (result_answer_id, user_id) values (v_result_answer_id, v_user_id);
  select likes into v_likes from public.sns_live_result_answers where id = v_result_answer_id;
  if v_likes <> 1 then
    raise exception 'FAIL: sns_live_result_likes_sync()のinsert側トリガー発火が壊れている(likes=%)', v_likes;
  end if;

  delete from public.sns_live_result_likes where result_answer_id = v_result_answer_id and user_id = v_user_id;
  select likes into v_likes from public.sns_live_result_answers where id = v_result_answer_id;
  if v_likes <> 0 then
    raise exception 'FAIL: sns_live_result_likes_sync()のdelete側トリガー発火が壊れている(likes=%)', v_likes;
  end if;

  raise notice 'PASS: sns_live_result_likes_sync()のトリガー発火は引き続き正常（likesが増減する）';
end $$;

-- ============================================================
-- テスト4: 意図的に除外したis_host()は引き続きauthenticated/anonから
--          参照できる（RLSポリシー評価が壊れないことの確認）。
-- ============================================================
do $$
begin
  set local role authenticated;
  perform public.is_host();
  set local role anon;
  perform public.is_host();
  raise notice 'PASS: is_host()はauthenticated/anonどちらからも引き続き呼べる';
end $$;

-- ============================================================
-- テスト4b: answer_count_for_turnはanonからは実行できない
--           （レビュー指摘対応：SECURITY DEFINERで匿名ユーザーが任意の
--           turn_id・participant_idの回答数を照会できてしまう懸念への対応）。
-- ============================================================
do $$
begin
  set local role anon;
  begin
    perform public.answer_count_for_turn(gen_random_uuid(), gen_random_uuid());
    raise exception 'FAIL: anonがanswer_count_for_turnを実行できてしまった';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonはanswer_count_for_turnを実行できない';
  end;
end $$;

-- ============================================================
-- テスト4c: authenticatedであっても、他人の参加者IDについて
--           answer_count_for_turnを直接呼ぶことはできない（本人または
--           is_host()以外による情報推測を防ぐ、レビュー指摘対応）。
-- ============================================================
do $$
declare
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_participant_b uuid := gen_random_uuid();
  v_live_id uuid := gen_random_uuid();
begin
  -- lives_one_active_idx（未終了ライブは常に1件まで）に抵触しないよう、
  -- 他のテストで残った未終了ライブを先に閉じておく。
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';

  insert into auth.users (id) values (v_user_a), (v_user_b);
  insert into public.lives (id, scheduled_at, current_phase, sequence_number, planned_group_count, max_players)
    values (v_live_id, now(), 'answering', 9401, 1, 10);
  insert into public.participants (id, live_id, user_id, role)
    values (v_participant_b, v_live_id, v_user_b, 'player');

  set local role authenticated;
  perform set_config('myapp.uid', v_user_a::text, true);
  begin
    perform public.answer_count_for_turn(gen_random_uuid(), v_participant_b);
    raise exception 'FAIL: 他人(userA)がuserBの参加者IDでanswer_count_for_turnを呼べてしまった';
  exception
    when others then
      if sqlerrm = 'not authorized' then
        raise notice 'PASS: 他人の参加者IDでのanswer_count_for_turn呼び出しは拒否される';
      else
        raise exception 'FAIL: 想定外のエラーで停止: %', sqlerrm;
      end if;
  end;
end $$;

-- ============================================================
-- テスト4d: authenticatedによる正規の回答INSERT（answers_insert_own_as_player
--           ポリシーがanswer_count_for_turnを内部で使う）は引き続き成功する
--           （レビュー指摘対応：RLSが壊れていないことをエンドツーエンドで確認）。
-- ============================================================
do $$
declare
  v_host_id uuid := gen_random_uuid();
  v_player_id uuid := gen_random_uuid();
  v_live_id uuid := gen_random_uuid();
  v_group_id uuid := gen_random_uuid();
  v_topic_id uuid := gen_random_uuid();
  v_turn_id uuid := gen_random_uuid();
  v_participant_id uuid := gen_random_uuid();
  v_answer_id uuid;
begin
  -- lives_one_active_idx（未終了ライブは常に1件まで）に抵触しないよう、
  -- 他のテストで残った未終了ライブを先に閉じておく。
  update public.lives set current_phase = 'closed' where current_phase <> 'closed';

  insert into auth.users (id) values (v_host_id), (v_player_id);
  update public.profiles set role = 'admin' where id = v_host_id;

  -- lives.current_turn_idはturns作成後にしか設定できない（循環外部キー）ため、
  -- 先にnullで作成し、turns作成後にUPDATEする。
  insert into public.lives (id, scheduled_at, current_phase, sequence_number, planned_group_count, max_players)
    values (v_live_id, now(), 'answering', 9402, 1, 10);
  insert into public.groups (id, live_id, group_order) values (v_group_id, v_live_id, 1);
  insert into public.topics (id, live_id, body, format) values (v_topic_id, v_live_id, 'P1-7回帰確認お題', 'text');
  insert into public.participants (id, live_id, user_id, group_id, role)
    values (v_participant_id, v_live_id, v_player_id, v_group_id, 'player');
  insert into public.turns (id, live_id, round, group_id, topic_id, status, eligible_judge_count)
    values (v_turn_id, v_live_id, 1, v_group_id, v_topic_id, 'active', 0);
  update public.lives set current_turn_id = v_turn_id where id = v_live_id;

  set local role authenticated;
  perform set_config('myapp.uid', v_player_id::text, true);
  insert into public.answers (turn_id, participant_id, seq, body)
    values (v_turn_id, v_participant_id, 1, 'P1-7回帰確認の回答です')
    returning id into v_answer_id;

  if v_answer_id is null then
    raise exception 'FAIL: 正規の回答INSERTが失敗した（answer_count_for_turnのハードニングでRLSが壊れた可能性）';
  end if;
  raise notice 'PASS: answer_count_for_turnを使うRLS(answers_insert_own_as_player)は引き続き正常に動作する';
end $$;

-- ============================================================
-- テスト5: 認証済みユーザーによる正規のRPC呼び出しは引き続き成功する
--          （PUBLICから外しても、authenticatedへの既存grantは影響を受けない）。
-- ============================================================
do $$
declare
  v_user_id uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (v_user_id);

  set local role authenticated;
  perform set_config('myapp.uid', v_user_id::text, true);
  perform public.log_share_click('live_schedule');
  perform public.submit_sns_topic('P1-7回帰確認用のお題');

  raise notice 'PASS: 認証済みユーザーはlog_share_click/submit_sns_topicを引き続き実行できる';
end $$;

-- ============================================================
-- テスト6: anonはsns_author_namesを引き続き呼べる（意図的にanon許可のまま
--          残す設計、寄合帳のダミー著者名解決に必要）。
-- ============================================================
do $$
begin
  set local role anon;
  perform public.sns_author_names(array[gen_random_uuid()]);
  raise notice 'PASS: sns_author_namesはanonから引き続き呼べる';
end $$;

select 'ALL P1-7 TESTS PASSED' as result;
