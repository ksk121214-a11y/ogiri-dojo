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
-- と同じ方針）。書き込みはjoin_live（SECURITY DEFINER）内、profiles行をFOR UPDATEで
-- 直列化した上での「referral_source is null」ガード付きUPDATEからのみ行い、
-- 初回の非空回答だけを保存し以後は上書きしない（2026-09-22レビュー対応で、
-- participants.referral_sourceも常にDB側で確定した値を使うよう修正済み）。
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

-- 2026-09-22（レビュー対応・項目3）：referral_sourceとreferral_source_answered_atは
-- 常にセットで確定する（片方だけ値が入る状態を許さない）。「両方null（未回答）」
-- 「両方not null（回答済み）」のどちらかしか成立しない。0074はまだ本番へ
-- 適用していないため、新規migrationを増やさずこのファイル自体に追記する。
alter table public.profiles
  add constraint profiles_referral_source_answered_at_pairing_check
  check ((referral_source is null) = (referral_source_answered_at is null));

-- 意図的にgrantしない＝authenticatedロールから直接UPDATEできない
-- （0033のmastery_meter等と同じ方針。既にprofilesはUPDATE権限を列単位で
-- 絞ってgrantしている前提のため、明示的なrevokeは不要）。

-- ============================================================
-- 3) join_live：許可値チェックの追加と、通常会員（ゲストを除く）の流入元を
--    アカウント単位で正しく引き継ぐ処理を追加する。既存のロジック（0070本体）の
--    うち、流入元に無関係な検証・組み立て（権限確認・停止確認・定員確認・
--    ゲスト番号採番等）は一切変更しない。
--
-- 2026-09-22（レビュー対応・項目1）：以前はp_referral_sourceをそのまま
-- participants.referral_sourceへ入れており、(a) 既に回答済みの通常会員が
-- 次のライブへnullで参加すると「未回答」に見えてしまう、(b) 回答済みの値を
-- 改ざんした値で上書きできてしまう、という2つの問題があった。
-- 「そのユーザーについて今回のparticipants行へ実際に記録すべき値」を
-- v_effective_referral_sourceとして一度だけ確定させ、それだけをparticipants
-- へ書き込む（p_referral_sourceを直接insertへは使わない）。
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
  v_profile_referral_source text;
  v_effective_referral_source text;
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

  -- 2026-09-22（レビュー対応・項目1）：v_effective_referral_sourceを確定する。
  -- ゲストは常にnull（運営の流入元集計を汚さない・使い捨てプロフィールへは
  -- 書き込まない）。通常会員は、
  --   (a) 既に回答済み（profiles.referral_sourceがnot null）なら、クライアントが
  --       今回何を送ってきたか（null・改ざんされた別の値のいずれでも）に関わらず、
  --       保存済みの値をそのまま使う。
  --   (b) 未回答で、今回許可された値が送られた場合だけ、この場でprofilesへ
  --       初回保存し、その値を使う。
  --   (c) 未回答で、今回もnull（「選択しない」）なら、未回答のままにする。
  -- 同時に複数のライブへ参加しても初回回答が競合しないよう、profiles行を
  -- FOR UPDATEで直列化する（lives→profilesの順で一貫してロックするため、
  -- 他の経路との間でデッドロックは生じない）。
  if v_is_guest then
    v_effective_referral_source := null;
  else
    select referral_source into v_profile_referral_source
      from public.profiles where id = auth.uid() for update;

    if v_profile_referral_source is not null then
      v_effective_referral_source := v_profile_referral_source;
    elsif p_referral_source is not null then
      -- FOR UPDATEで排他済みのため、ここでのUPDATEは必ずこの呼び出しだけが行う
      -- （「referral_source is null」の再確認は、将来のリファクタでロックが
      -- 外れた場合の保険として残す）。
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

  -- participantsへ書き込む値は、クライアントが送ってきたp_referral_sourceでは
  -- なく、DB側で確定したv_effective_referral_sourceにする（改ざん・古い回答の
  -- 送信いずれでも、実際に記録される値はDBが確定したものになる）。
  insert into public.participants (live_id, user_id, preferred_role, referral_source, is_guest, guest_number)
  values (p_live_id, auth.uid(), p_preferred_role, v_effective_referral_source, v_is_guest, v_guest_number)
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

commit;
