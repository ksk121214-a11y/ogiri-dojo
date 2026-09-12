-- 「Xログインせずに、テストライブだけゲスト（匿名）として参加できるようにする」対応。
--
-- 背景：動作確認・体験会等でXアカウントを持たない人にもテストライブ
-- （lives.live_mode='test'、0068）へその場で参加してもらいたい。Supabase Authの
-- 匿名サインイン（signInAnonymously、auth.users.is_anonymous=trueの行が作られる）を
-- 使う。本番ライブ（live_mode='official'）には一切参加させない。ポイント・実績・
-- point_history・SNS投稿・プロフィール自己編集等、ゲストに一切触らせてはいけない
-- 経路は、0059/0060/0068の「RLS・列GRANT・SECURITY DEFINER RPCの多層防御」という
-- 既存の設計方針をそのまま踏襲してガードする。
--
-- 【ゲストのDB側識別（二重照合）】
-- public.is_guest_user()を新設する（is_host()と対になる設計）。
--   - auth.users.is_anonymous（Supabase Authが管理する実列。クライアントから
--     直接読めないためSECURITY DEFINERで参照する）
--   - profiles.is_guest（本マイグレーションで追加、handle_new_user()がauth.usersの
--     is_anonymousから複製する）
-- のどちらか一方でもtrueなら「ゲスト」と判定する（片方だけを信用しないfail-safe
-- 設計）。auth.uid()がnull（SQL Editor・未ログイン相当）ならfalseを返す
-- （is_host()の既存の振る舞いと揃える）。
--
-- 【ゲスト番号の割り当て】
-- join_live()は元々「select ... from public.lives where id=p_live_id for update」で
-- lives行をロックしてから処理する設計（0053）。このロックのおかげで、同じライブへの
-- join_live呼び出し全体が直列化されるため、「select coalesce(max(guest_number),0)+1」
-- という単純な採番でも複数ゲストの同時参加で重複しない（0068のofficial_sequence_number
-- 採番と同じ考え方）。念のため(live_id, guest_number) whereis_guestの一意インデックスも
-- 追加し、万一の重複はDB制約でも拒否する。
--
-- 【匿名セッションのままXログインを開始する際の統合懸念】
-- Supabaseの匿名認証は、匿名セッションが有効なままsignInWithOAuthを開始すると、
-- 実装によっては同じauth.uid()のまま「本アカウントへアップグレード」される
-- （＝ゲストのprofiles行がそのまま本アカウント化される）ケースがあるとされる。
-- これは「ゲストのポイントを後付けしない」という要件と衝突しうるため、フロント側
-- （useAuthStore.signInWithX）は必ずsignOut()してからsignInWithOAuth()を呼ぶ方針にする
-- （詳細はsrc/store/useAuthStore.ts参照）。DB側はこの前提が崩れた場合の保険として、
-- is_guest_user()の二重照合（is_anonymous or profiles.is_guest）を維持する。
--
-- 0001〜0069は一切書き換えない。CREATE OR REPLACE / DROP POLICY→CREATE POLICYは、
-- grep -n "function public.<name>" / grep -n "<policy名>" で洗い出した「マイグレー
-- ション履歴上最新の」本体を基準にし、live_mode/is_guest関連の分岐だけを追加している
-- （既存の条件・ロジックは一切削らない）。0056/0068の流儀にならい、begin/commitで
-- 1トランザクションにまとめる。

begin;

-- ============================================================
-- 1) profiles.is_guest列を追加する。
-- ============================================================
alter table public.profiles
  add column is_guest boolean not null default false;

-- 自己編集可能列の一覧（display_name/display_name_set/bio/avatar_icon/avatar_color、
-- 0003/0007/0015/0033）にis_guestは追加しない。profilesは元々テーブル単位で
-- authenticatedにUPDATE権限が付与されており(Supabaseの新規テーブル標準権限)、
-- ALTER TABLE ADD COLUMNした新しい列も自動的にその対象へ含まれてしまうため、
-- 0059と同じ考え方で明示的に剥奪しておく（本人による自己申告・自己解除を防ぐ、
-- 念のための多層防御。profiles_update_ownのUSING句自体も後段6)でis_guest_user()を
-- 満たす行の更新を丸ごと拒否するようにするため、実質的には二重の防御になる）。
revoke update (is_guest) on public.profiles from authenticated;

-- ============================================================
-- 2) handle_new_user()：新規auth.users行のis_anonymousをprofiles.is_guestへ複製する。
-- ============================================================
-- 現行本体は0001（36〜51行目、0062はgrant/revokeのみでbody再定義なし）。
-- 既存のX関連ロジック（raw_user_meta_data からの display_name/x_username/avatar_url
-- 抽出）は一切変更しない。auth.users.is_anonymousは実際のSupabaseに実在する列
-- （匿名認証機能の一部）。ローカルテスト用シム(supabase/tests/fixtures/
-- local_supabase_shim.sql)にも同名・同型の列を追加している。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, x_username, avatar_url, is_guest)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'user_name', '名無しの弟子'),
    new.raw_user_meta_data ->> 'user_name',
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(new.is_anonymous, false)
  );
  return new;
end;
$$;

-- ============================================================
-- 3) is_guest_user()：is_host()と対になる、ゲスト判定のSECURITY DEFINER関数。
-- ============================================================
create function public.is_guest_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select u.is_anonymous from auth.users u where u.id = auth.uid()), false)
    or coalesce((select p.is_guest from public.profiles p where p.id = auth.uid()), false);
$$;

grant execute on function public.is_guest_user() to authenticated;
revoke execute on function public.is_guest_user() from public;
revoke execute on function public.is_guest_user() from anon;

-- ============================================================
-- 4) participants.is_guest / guest_numberを追加する。
-- ============================================================
alter table public.participants
  add column is_guest boolean not null default false,
  add column guest_number int;

alter table public.participants
  add constraint participants_guest_number_consistency_check
  check (
    (is_guest = false and guest_number is null)
    or (is_guest = true and guest_number is not null)
  );

-- 採番自体はjoin_live内のlives行FOR UPDATEロックにより直列化されて重複しない設計だが、
-- 万一に備えたDB制約側の最後の砦として一意インデックスも追加する
-- （lives_official_sequence_number_key、0068と同じ考え方）。
create unique index participants_guest_number_key
  on public.participants (live_id, guest_number)
  where is_guest;

-- participants.is_guest/guest_numberは、0060で既にauthenticatedからのテーブル単位の
-- UPDATE権限が丸ごと剥奪済み（個別に再許可された列はgroup_id/role/host_message/
-- host_message_sent_at/kicked_atのみ）のため、新しく追加したこの2列も追加のrevokeを
-- 要さず最初から直接UPDATEできない（join_live経由でのみ書き込まれる）。

-- ============================================================
-- 5) join_live：テストライブ限定のゲスト参加拒否・ゲスト番号の採番を追加する。
-- ============================================================
-- 現行本体は0053（333〜403行目）。既存の処理順序・ロック・全チェック（役割検証・
-- 利用停止確認・退場済み確認・役割ダウングレード禁止・player参加はinterlude/opening
-- のみ・定員確認・on conflict時の扱い）はそのまま維持し、以下だけを追加する：
--   (a) lives行をFOR UPDATEで取得する同じSELECTでlive_modeも取得し、ゲストが
--       official（本番）ライブへ参加しようとしたら'GUEST_OFFICIAL_NOT_ALLOWED'。
--   (b) ゲストの場合だけ、guest_numberを「同じライブの既存ゲストの最大値+1」で
--       採番し、is_guest/guest_numberをinsertする（on conflict do update句には
--       含めない＝再joinや役割変更で値が変わらないようにする）。
create or replace function public.join_live(p_live_id uuid, p_preferred_role text, p_referral_source text default null)
returns public.participants
language plpgsql
security definer set search_path = public
as $$
declare
  v_max int;
  v_count int;
  v_phase text;
  v_live_mode text;
  v_kicked timestamptz;
  v_suspended boolean;
  v_existing_role text;
  v_is_guest boolean;
  v_guest_number int;
  v_row public.participants;
begin
  if p_preferred_role not in ('player', 'audience') then
    raise exception 'INVALID_ROLE';
  end if;

  select (is_permanently_suspended or (suspended_until is not null and suspended_until > now()))
    into v_suspended
    from public.profiles where id = auth.uid();
  if coalesce(v_suspended, false) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;

  select max_players, current_phase, live_mode into v_max, v_phase, v_live_mode
    from public.lives where id = p_live_id for update;
  if not found then
    raise exception 'LIVE_NOT_FOUND';
  end if;

  -- 0070追加：ゲスト（匿名）は本番ライブへ一切参加できない（テストライブのみ）。
  v_is_guest := is_guest_user();
  if v_is_guest and v_live_mode = 'official' then
    raise exception 'GUEST_OFFICIAL_NOT_ALLOWED';
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

  -- 0070追加：ゲストの表示用番号を採番する（lives行を上でFOR UPDATE済みのため、
  -- 同じライブへの同時参加でも重複しない）。既存参加者（再join）の場合はon
  -- conflict句でis_guest/guest_numberを更新しないため、この計算結果は新規insert
  -- 時にしか使われない。
  if v_is_guest then
    select coalesce(max(guest_number), 0) + 1 into v_guest_number
      from public.participants
      where live_id = p_live_id and is_guest;
  else
    v_guest_number := null;
  end if;

  insert into public.participants (live_id, user_id, preferred_role, referral_source, is_guest, guest_number)
  values (p_live_id, auth.uid(), p_preferred_role, p_referral_source, v_is_guest, v_guest_number)
  on conflict (live_id, user_id) do update
    set preferred_role = excluded.preferred_role,
        -- 既に流入元が記録済みなら上書きしない（再度role変更で呼ばれた時に消さない）。
        referral_source = coalesce(public.participants.referral_source, excluded.referral_source)
        -- is_guest/guest_numberは意図的に更新しない（初回参加時の値を保持する）。
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.join_live(uuid, text, text) to authenticated;
revoke execute on function public.join_live(uuid, text, text) from public;
revoke execute on function public.join_live(uuid, text, text) from anon;

-- ============================================================
-- 6) participant_display_names：ゲストは固定の表示名・アイコン・色を返す。
-- ============================================================
-- 現行本体は0015（26〜36行目）。戻り値の型（列構成）は変更しない
-- （フロント側src/store/useLiveFollowerStore.tsのfetchParticipantProfiles()は
-- participant_id/display_name/avatar_icon/avatar_colorの4列だけを読んでおり、
-- これを変えずに済ませることで呼び出し元の型・実装の追随を不要にする）。
-- ゲストのavatar_icon/avatar_color固定値は、src/lib/avatarIcons.ts /
-- avatarColors.tsの既存プリセットの値域内（"default" / "#171513"＝黒）から選ぶ
-- （存在しない値を返すとフロントの描画が壊れるため）。
create or replace function public.participant_display_names(p_live_id uuid)
returns table (participant_id uuid, display_name text, avatar_icon text, avatar_color text)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    case when p.is_guest then 'ゲスト' || lpad(p.guest_number::text, 2, '0') else pr.display_name end,
    case when p.is_guest then 'default' else pr.avatar_icon end,
    case when p.is_guest then '#171513' else pr.avatar_color end
  from public.participants p
  join public.profiles pr on pr.id = p.user_id
  where p.live_id = p_live_id;
$$;

grant execute on function public.participant_display_names(uuid) to authenticated;
revoke execute on function public.participant_display_names(uuid) from public;
revoke execute on function public.participant_display_names(uuid) from anon;

-- ============================================================
-- 7) profiles_update_own：ゲストは自分のプロフィール（表示名・アイコン・色・
--    一言コメント等）を一切自己編集できないようにする。
-- ============================================================
-- 現行本体は0001（31〜33行目、以後未変更）。USING句だけでなくWITH CHECK句にも
-- 同条件を明示し、USINGとの食い違いを起こさないようにする（WITH CHECK未指定時は
-- USINGと同じ扱いになるが、ここでは明示する）。
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id and not is_guest_user())
  with check (auth.uid() = id and not is_guest_user());

-- ============================================================
-- 8) 寄合帳（SNS）投稿系RPC：ゲストは投稿できない。
-- ============================================================
-- submit_sns_topicの現行本体は0061（70〜110行目）。
create or replace function public.submit_sns_topic(p_body text)
returns public.sns_topics
language plpgsql
security definer set search_path = public
as $$
declare
  v_trimmed text;
  v_suspended boolean;
  v_ok boolean;
  v_row public.sns_topics;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;
  if is_guest_user() then
    raise exception 'GUEST_NOT_ALLOWED';
  end if;

  select (is_permanently_suspended or (suspended_until is not null and suspended_until > now()))
    into v_suspended
    from public.profiles where id = auth.uid();
  if coalesce(v_suspended, false) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;

  v_trimmed := trim(p_body);
  if v_trimmed is null or char_length(v_trimmed) = 0 then
    raise exception 'EMPTY_BODY';
  end if;
  if char_length(v_trimmed) > 300 then
    raise exception 'BODY_TOO_LONG';
  end if;

  v_ok := private.consume_ticket_for_user(auth.uid());
  if not v_ok then
    raise exception 'NO_TICKETS';
  end if;

  insert into public.sns_topics (author_id, body) values (auth.uid(), v_trimmed)
    returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.submit_sns_topic(text) to authenticated;
revoke execute on function public.submit_sns_topic(text) from public;
revoke execute on function public.submit_sns_topic(text) from anon;

-- submit_sns_answerの現行本体は0067（205〜254行目）。お題のFOR SHAREロック・
-- is_hidden確認等の既存強化はそのまま維持する。
create or replace function public.submit_sns_answer(p_topic_id uuid, p_body text)
returns public.sns_answers
language plpgsql
security definer set search_path = public
as $$
declare
  v_trimmed text;
  v_suspended boolean;
  v_ok boolean;
  v_row public.sns_answers;
  v_topic_hidden boolean;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;
  if is_guest_user() then
    raise exception 'GUEST_NOT_ALLOWED';
  end if;

  select is_hidden into v_topic_hidden from public.sns_topics where id = p_topic_id for share;
  if not found or v_topic_hidden then
    raise exception 'TOPIC_NOT_FOUND';
  end if;

  select (is_permanently_suspended or (suspended_until is not null and suspended_until > now()))
    into v_suspended
    from public.profiles where id = auth.uid();
  if coalesce(v_suspended, false) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;

  v_trimmed := trim(p_body);
  if v_trimmed is null or char_length(v_trimmed) = 0 then
    raise exception 'EMPTY_BODY';
  end if;
  if char_length(v_trimmed) > 300 then
    raise exception 'BODY_TOO_LONG';
  end if;

  v_ok := private.consume_ticket_for_user(auth.uid());
  if not v_ok then
    raise exception 'NO_TICKETS';
  end if;

  insert into public.sns_answers (topic_id, author_id, body) values (p_topic_id, auth.uid(), v_trimmed)
    returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.submit_sns_answer(uuid, text) to authenticated;
revoke execute on function public.submit_sns_answer(uuid, text) from public;
revoke execute on function public.submit_sns_answer(uuid, text) from anon;

-- submit_sns_commentの現行本体は0067（266〜328行目）。お題→回答の順のFOR SHARE
-- ロック等の既存強化はそのまま維持する。
create or replace function public.submit_sns_comment(p_answer_id uuid, p_body text)
returns public.sns_comments
language plpgsql
security definer set search_path = public
as $$
declare
  v_trimmed text;
  v_suspended boolean;
  v_ok boolean;
  v_row public.sns_comments;
  v_topic_id uuid;
  v_topic_hidden boolean;
  v_answer_hidden boolean;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;
  if is_guest_user() then
    raise exception 'GUEST_NOT_ALLOWED';
  end if;

  select topic_id into v_topic_id from public.sns_answers where id = p_answer_id;
  if v_topic_id is null then
    raise exception 'ANSWER_NOT_FOUND';
  end if;

  select is_hidden into v_topic_hidden from public.sns_topics where id = v_topic_id for share;
  if not found or v_topic_hidden then
    raise exception 'ANSWER_NOT_FOUND';
  end if;

  select is_hidden into v_answer_hidden from public.sns_answers where id = p_answer_id for share;
  if not found or v_answer_hidden then
    raise exception 'ANSWER_NOT_FOUND';
  end if;

  select (is_permanently_suspended or (suspended_until is not null and suspended_until > now()))
    into v_suspended
    from public.profiles where id = auth.uid();
  if coalesce(v_suspended, false) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;

  v_trimmed := trim(p_body);
  if v_trimmed is null or char_length(v_trimmed) = 0 then
    raise exception 'EMPTY_BODY';
  end if;
  if char_length(v_trimmed) > 300 then
    raise exception 'BODY_TOO_LONG';
  end if;

  v_ok := private.consume_ticket_for_user(auth.uid());
  if not v_ok then
    raise exception 'NO_TICKETS';
  end if;

  insert into public.sns_comments (answer_id, author_id, body) values (p_answer_id, auth.uid(), v_trimmed)
    returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.submit_sns_comment(uuid, text) to authenticated;
revoke execute on function public.submit_sns_comment(uuid, text) from public;
revoke execute on function public.submit_sns_comment(uuid, text) from anon;

-- ============================================================
-- 9) 寄合帳（SNS）削除系RPC：ゲストは削除もできない
--    （そもそも投稿できないため実際には自分の投稿を持ち得ないが、他人の投稿を
--    対象にNOT_OWNERへ到達する前に確実に弾く多層防御として追加する）。
-- ============================================================
-- 現行本体は全て0067（50〜159行目）。
create or replace function public.delete_own_sns_topic(p_topic_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_author_id uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;
  if is_guest_user() then
    raise exception 'GUEST_NOT_ALLOWED';
  end if;

  select author_id into v_author_id from public.sns_topics where id = p_topic_id for update;
  if not found then
    raise exception 'TOPIC_NOT_FOUND';
  end if;
  if v_author_id <> auth.uid() then
    raise exception 'NOT_OWNER';
  end if;

  update public.sns_topics
    set is_hidden = true, hidden_reason = 'deleted_by_author', hidden_by = auth.uid(), hidden_at = now()
    where id = p_topic_id and not is_hidden;

  update public.sns_answers
    set is_hidden = true, hidden_reason = 'deleted_by_author_topic_removed', hidden_by = auth.uid(), hidden_at = now()
    where topic_id = p_topic_id and not is_hidden;

  update public.sns_comments
    set is_hidden = true, hidden_reason = 'deleted_by_author_topic_removed', hidden_by = auth.uid(), hidden_at = now()
    where not is_hidden
      and answer_id in (select id from public.sns_answers where topic_id = p_topic_id);
end;
$$;

revoke execute on function public.delete_own_sns_topic(uuid) from public;
revoke execute on function public.delete_own_sns_topic(uuid) from anon;
grant execute on function public.delete_own_sns_topic(uuid) to authenticated;

create or replace function public.delete_own_sns_answer(p_answer_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_author_id uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;
  if is_guest_user() then
    raise exception 'GUEST_NOT_ALLOWED';
  end if;

  select author_id into v_author_id from public.sns_answers where id = p_answer_id for update;
  if not found then
    raise exception 'ANSWER_NOT_FOUND';
  end if;
  if v_author_id <> auth.uid() then
    raise exception 'NOT_OWNER';
  end if;

  update public.sns_answers
    set is_hidden = true, hidden_reason = 'deleted_by_author', hidden_by = auth.uid(), hidden_at = now()
    where id = p_answer_id and not is_hidden;

  update public.sns_comments
    set is_hidden = true, hidden_reason = 'deleted_by_author_answer_removed', hidden_by = auth.uid(), hidden_at = now()
    where answer_id = p_answer_id and not is_hidden;
end;
$$;

revoke execute on function public.delete_own_sns_answer(uuid) from public;
revoke execute on function public.delete_own_sns_answer(uuid) from anon;
grant execute on function public.delete_own_sns_answer(uuid) to authenticated;

create or replace function public.delete_own_sns_comment(p_comment_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_author_id uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;
  if is_guest_user() then
    raise exception 'GUEST_NOT_ALLOWED';
  end if;

  select author_id into v_author_id from public.sns_comments where id = p_comment_id for update;
  if not found then
    raise exception 'COMMENT_NOT_FOUND';
  end if;
  if v_author_id <> auth.uid() then
    raise exception 'NOT_OWNER';
  end if;

  update public.sns_comments
    set is_hidden = true, hidden_reason = 'deleted_by_author', hidden_by = auth.uid(), hidden_at = now()
    where id = p_comment_id and not is_hidden;
end;
$$;

revoke execute on function public.delete_own_sns_comment(uuid) from public;
revoke execute on function public.delete_own_sns_comment(uuid) from anon;
grant execute on function public.delete_own_sns_comment(uuid) to authenticated;

-- ============================================================
-- 10) 直接テーブルINSERT用RLSポリシー：通報・いいね・フォローをゲストに許可しない。
-- ============================================================
-- reports_insert_ownの現行本体は0022（24〜26行目）。
drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own"
  on public.reports for insert
  with check (auth.uid() = reporter_id and not is_guest_user());

-- sns_answer_likes_insert_ownの現行本体は0030（36〜44行目）。
drop policy if exists "sns_answer_likes_insert_own" on public.sns_answer_likes;
create policy "sns_answer_likes_insert_own" on public.sns_answer_likes for insert
  with check (
    auth.uid() = user_id
    and not is_guest_user()
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_permanently_suspended or (p.suspended_until is not null and p.suspended_until > now()))
    )
  );

-- sns_follows_insert_ownの現行本体は0030（91〜99行目）。
drop policy if exists "sns_follows_insert_own" on public.sns_follows;
create policy "sns_follows_insert_own" on public.sns_follows for insert
  with check (
    auth.uid() = follower_id
    and not is_guest_user()
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_permanently_suspended or (p.suspended_until is not null and p.suspended_until > now()))
    )
  );

-- sns_live_result_likes_insert_own / sns_live_result_comments_insert_ownの現行本体は
-- 0068（536〜551行目・593〜608行目）。official・results_published確認等の既存条件は
-- そのまま維持する。
drop policy if exists "sns_live_result_likes_insert_own" on public.sns_live_result_likes;
create policy "sns_live_result_likes_insert_own" on public.sns_live_result_likes for insert
  with check (
    auth.uid() = user_id
    and not is_guest_user()
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_permanently_suspended or (p.suspended_until is not null and p.suspended_until > now()))
    )
    and exists (
      select 1 from public.sns_live_result_answers ra
      join public.sns_live_results r on r.id = ra.live_result_id
      join public.lives l on l.id = r.live_id
      where ra.id = result_answer_id and ra.included and l.results_published and l.live_mode = 'official'
    )
  );

drop policy if exists "sns_live_result_comments_insert_own" on public.sns_live_result_comments;
create policy "sns_live_result_comments_insert_own" on public.sns_live_result_comments for insert
  with check (
    auth.uid() = author_id
    and not is_guest_user()
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_permanently_suspended or (p.suspended_until is not null and p.suspended_until > now()))
    )
    and exists (
      select 1 from public.sns_live_result_answers ra
      join public.sns_live_results r on r.id = ra.live_result_id
      join public.lives l on l.id = r.live_id
      where ra.id = result_answer_id and ra.included and l.results_published and l.live_mode = 'official'
    )
  );

commit;
