-- 機能4「『どこでこのライブを知りましたか？』を運営画面で確認できるようにする」
-- 機能5「流入アンケートは1アカウントにつき一度だけ表示する」対応。
--
-- 機能4：participants.referral_source（0070で追加済み、CHECK制約なし）自体は
-- 変更しない。フロントエンド（司会コンソール参加者一覧）で日本語ラベル表示・
-- 集計を追加するだけなので、DB側はCHECK制約を追加して不正値を防ぐだけにする。
--
-- 機能5：「通常会員が一度でも回答済みなら、以後のライブでは表示しない」を
-- localStorageに頼らずDBへ永続化するため、profilesへ新しい列を追加する。
-- 一度保存した回答は本人でも直接書き換えられないよう、この2列への
-- authenticatedロールへのUPDATE権限は意図的にgrantしない（0033のmastery_meter等
-- と同じ方針）。書き込みはjoin_live（SECURITY DEFINER）内の
-- 「referral_source is null」ガード付きUPDATEからのみ行い、初回の非空回答だけを
-- 保存し以後は上書きしない。
begin;

-- ============================================================
-- 1) participants.referral_sourceへCHECK制約を追加する（不正値を拒否）。
-- ============================================================
-- フロントは元々x/friend/app/other/null(空欄)しか送らないため、既存データに
-- 違反する行が無い前提（無ければこのALTERは即座に成功する）。
alter table public.participants
  add constraint participants_referral_source_check
  check (referral_source is null or referral_source in ('x', 'friend', 'app', 'other'));

-- ============================================================
-- 2) profilesに流入アンケートの永続回答列を追加する。
-- ============================================================
alter table public.profiles
  add column referral_source text,
  add column referral_source_answered_at timestamptz;

alter table public.profiles
  add constraint profiles_referral_source_check
  check (referral_source is null or referral_source in ('x', 'friend', 'app', 'other'));

-- 意図的にgrantしない＝authenticatedロールから直接UPDATEできない
-- （0033のmastery_meter等と同じ方針。既にprofilesはUPDATE権限を列単位で
-- 絞ってgrantしている前提のため、明示的なrevokeは不要）。

-- ============================================================
-- 3) join_live：許可値チェックの追加と、通常会員（ゲストを除く）の
--    初回の流入元回答だけをprofilesへ永続化する処理を追加する。
--    既存のロジック（0070本体）は一切変更しない。
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

  -- 2026-09-22追加：流入元の許可値チェック（DB側でも不正値を拒否する。
  -- CHECK制約でも最終的に拒否されるが、生の制約違反エラーではなく
  -- フロントが既存のエラーコード方式で分かりやすい文言に変換できるようにする）。
  if p_referral_source is not null and p_referral_source not in ('x', 'friend', 'app', 'other') then
    raise exception 'INVALID_REFERRAL_SOURCE';
  end if;

  select (is_permanently_suspended or (suspended_until is not null and suspended_until > now()))
    into v_suspended
    from public.profiles where id = auth.uid();
  if coalesce(v_suspended, false) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;

  select max_players, current_phase into v_max, v_phase
    from public.lives where id = p_live_id for update;
  if not found then
    raise exception 'LIVE_NOT_FOUND';
  end if;

  -- 0070追加（ゲスト観客対応で仕様変更）：ゲスト（匿名）は本番・テストどちらの
  -- ライブへも観客(audience)として参加できる。プレイヤー希望は選べない。
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

  -- 2026-09-22追加：通常会員（ゲストを除く）が今回はじめて流入元を回答した
  -- 場合だけ、profilesへ永続化する（アカウント単位で以後は二度と表示しない
  -- ため）。「referral_source is null」を対象条件にしているため、既に
  -- 回答済みの場合はこのUPDATEが0件ヒットで終わり、改ざんされた値が来ても
  -- 上書きされない。ゲストの使い捨てプロフィールへは書き込まない。
  if p_referral_source is not null and not v_is_guest then
    update public.profiles
      set referral_source = p_referral_source,
          referral_source_answered_at = now()
      where id = auth.uid()
        and referral_source is null;
  end if;

  return v_row;
end;
$$;

grant execute on function public.join_live(uuid, text, text) to authenticated;
revoke execute on function public.join_live(uuid, text, text) from public;
revoke execute on function public.join_live(uuid, text, text) from anon;

commit;
