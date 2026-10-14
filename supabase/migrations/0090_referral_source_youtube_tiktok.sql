-- 流入アンケート「どこでこのライブを知りましたか？」の選択肢変更（2026-10-14）。
--
-- 新しい選択肢（表示順）：X・YouTube・TikTok・友人・その他
--   - youtube / tiktok を追加する。
--   - app（アプリ内）は新規回答の選択肢から外す。
--
-- 【過去の回答データは一切変更しない】
-- 既にapp等で回答済みの profiles.referral_source / participants.referral_source
-- は削除・変換しない（UPDATE文を一切含まない）。過去の回答は履歴データとして
-- 読み取り・表示・集計できるよう、CHECK制約にはappを残す。
-- 特に participants.referral_source は、0074のjoin_liveが「保存済みの
-- profiles.referral_source」を参加のたびに引き継いでinsertするため、過去に
-- appと回答した会員が今後ライブへ参加した場合も新しいparticipants行にappが
-- 記録される。CHECK制約からappを外すとその参加自体が失敗してしまうため、
-- 「新規回答として受け付けない」制限はCHECK制約ではなくjoin_liveの
-- p_referral_source（クライアントが今回送ってきた値）の判定だけで行う。
--
-- 【回答済み状態はリセットしない】
-- referral_source / referral_source_answered_at の既存値・アンケートの表示条件
-- （両方nullの会員にだけ表示する）は変更しない。回答済みの会員には再表示されない。
--
-- 【旧クライアントからのappの扱い】
-- デプロイ切替前後に古い画面を開いたままの未回答会員がapp（アプリ内）を
-- 選んで参加した場合、エラーにして参加自体を失敗させるのではなく、
-- 「選択しない」と同じ扱い（未回答のまま・保存しない）にして参加は成功させる。
-- これによりappが新規回答として保存されることは無く、その会員には次回以降の
-- ライブで新しい5択が表示される。それ以外の不正値は従来どおり
-- INVALID_REFERRAL_SOURCEで拒否する。
--
-- 【法務文書】（2026-10-14追記）
-- プライバシーポリシーの流入アンケートの記載（選択肢の列挙）を新しい5択へ改定し、
-- あわせて利用規約第1条第4項・プライバシーポリシーの短尺動画掲載の同意条件の文言を
-- 「許可バージョンの組のいずれかへの同意」へ改めたため、
-- current_legal_document_versions()をcreate or replaceし、terms 2026-10-14-v4 /
-- privacy 2026-10-14-v5へ更新する。既存利用者は次回アクセス時に再同意が必要になる。terms_consentsの既存同意記録・流入アンケートの回答済み
-- 状態は一切変更しない（UPDATE・DELETEを含めない）。
-- あわせて、短尺動画・切り抜き動画掲載の許諾の対象判定を、現在の法務文書バージョン
-- から分離した専用関数（short_video_license_*）として新設する（4)参照）。
--
-- 0001〜0089は書き換えない。
begin;

-- ============================================================
-- 1) CHECK制約：保存され得る値にyoutube/tiktokを追加する（appは履歴用に残す）。
-- ============================================================
alter table public.participants
  drop constraint participants_referral_source_check;
alter table public.participants
  add constraint participants_referral_source_check
  check (referral_source is null or referral_source in ('x', 'youtube', 'tiktok', 'friend', 'app', 'other'));

alter table public.profiles
  drop constraint profiles_referral_source_check;
alter table public.profiles
  add constraint profiles_referral_source_check
  check (referral_source is null or referral_source in ('x', 'youtube', 'tiktok', 'friend', 'app', 'other'));

-- ============================================================
-- 2) join_live：0085の定義から、流入元の許可値判定だけを変更する。
--    それ以外の検証・組み立て（権限確認・停止確認・ステージング制限・定員確認・
--    ゲスト番号採番・回答済みなら保存済みの値を優先する処理等）は一切変更しない。
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
  v_new_referral_source text;
begin
  if p_preferred_role not in ('player', 'audience') then
    raise exception 'INVALID_ROLE';
  end if;

  -- 0090：新規回答として受け付ける値はx/youtube/tiktok/friend/otherだけ。
  -- 旧選択肢のappは「選択しない」(null)と同じ扱いにする（冒頭コメント参照）。
  if p_referral_source is not null
     and p_referral_source not in ('x', 'youtube', 'tiktok', 'friend', 'app', 'other') then
    raise exception 'INVALID_REFERRAL_SOURCE';
  end if;
  v_new_referral_source := nullif(p_referral_source, 'app');

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
      -- 回答済み（過去のappを含む）なら保存済みの値をそのまま使う。
      v_effective_referral_source := v_profile_referral_source;
    elsif v_new_referral_source is not null then
      update public.profiles
        set referral_source = v_new_referral_source,
            referral_source_answered_at = now()
        where id = auth.uid()
          and referral_source is null;
      v_effective_referral_source := v_new_referral_source;
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

-- ============================================================
-- 3) admin_referral_survey_summary：youtube_count / tiktok_count を追加する。
--    app_count（旧選択肢）は過去の回答の集計として残し、answered_totalにも
--    含め続ける。戻り値の列構成が変わるためcreate or replaceでは置き換えられず、
--    dropしてから0075と同じ権限設計で作り直す（同一トランザクション内）。
-- ============================================================
drop function public.admin_referral_survey_summary();

create function public.admin_referral_survey_summary()
returns table (
  x_count int,
  youtube_count int,
  tiktok_count int,
  friend_count int,
  other_count int,
  app_count int,
  answered_total int
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;

  if not is_host() then
    raise exception 'not authorized';
  end if;

  return query
    select
      count(*) filter (where p.referral_source = 'x')::int as x_count,
      count(*) filter (where p.referral_source = 'youtube')::int as youtube_count,
      count(*) filter (where p.referral_source = 'tiktok')::int as tiktok_count,
      count(*) filter (where p.referral_source = 'friend')::int as friend_count,
      count(*) filter (where p.referral_source = 'other')::int as other_count,
      count(*) filter (where p.referral_source = 'app')::int as app_count,
      count(*)::int as answered_total
    from public.profiles p
    where p.is_guest = false
      and p.role <> 'admin'
      and p.referral_source in ('x', 'youtube', 'tiktok', 'friend', 'app', 'other');
end;
$$;

grant execute on function public.admin_referral_survey_summary() to authenticated;
revoke execute on function public.admin_referral_survey_summary() from public;
revoke execute on function public.admin_referral_survey_summary() from anon;

-- ============================================================
-- 4) 法務文書の現在版：terms 2026-10-14-v4 / privacy 2026-10-14-v5へ更新する。
--    0088の定義と同じシグネチャ・属性（language sql stable、SECURITY DEFINERなし）の
--    ままcreate or replaceする。create or replaceは既存のEXECUTE権限（0087で
--    public/anon/authenticatedから剥奪済み）を変更しない。
--    src/lib/legalInfo.tsのTERMS_VERSION/PRIVACY_VERSIONと必ず同じ値にすること。
-- ============================================================
create or replace function public.current_legal_document_versions()
returns table (terms_version text, privacy_version text)
language sql
stable
as $$
  select '2026-10-14-v4'::text, '2026-10-14-v5'::text;
$$;

-- ============================================================
-- 5) 短尺動画・切り抜き動画掲載の許諾（利用規約第1条第4項・プライバシーポリシー
--    「投稿内容の公式SNS等への掲載について」）の対象判定。
--
--    条項の適用条件は「(a)効力発生日（2026年10月10日、日本時間0時）以後に生成され、
--    かつ(b)生成した利用者が生成時点で許可バージョンの組のいずれかへ同意を完了して
--    いたこと」。効力発生日と許可バージョンの組は、current_legal_document_versions()
--    （現在の版）からは独立させる。これにより、法務文書の改定で効力発生日が移動
--    したり、terms v3＋privacy v4へ同意済みの既存利用者が対象外になったりしない。
--    許可バージョンの組は、過去分（terms 2026-10-10-v3＋privacy 2026-10-10-v4）と
--    現在分（terms 2026-10-14-v4＋privacy 2026-10-14-v5）の2つ。短尺動画許諾を含む新しい版へ改定する場合は、
--    short_video_license_consent_versions()へ組を追記する（既存の組は削除しない）。
--    src/lib/legalInfo.tsのSHORT_VIDEO_LICENSE_*と必ず同じ値にすること。
--
--    いずれも運営の確認・SQLエディタ用の内部関数で、クライアントロールには
--    EXECUTEを付与しない（同意記録という個人に紐づく情報を参照するため）。
-- ============================================================
create function public.short_video_license_effective_from()
returns timestamptz
language sql
immutable
as $$
  select '2026-10-10 00:00:00+09'::timestamptz;
$$;

create function public.short_video_license_consent_versions()
returns table (terms_version text, privacy_version text)
language sql
immutable
as $$
  values
    ('2026-10-10-v3'::text, '2026-10-10-v4'::text),
    ('2026-10-14-v4'::text, '2026-10-14-v5'::text);
$$;

create function public.short_video_license_applies(p_user_id uuid, p_generated_at timestamptz)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select p_user_id is not null
    and p_generated_at is not null
    and p_generated_at >= public.short_video_license_effective_from()
    and exists (
      select 1
        from public.terms_consents c
        join public.short_video_license_consent_versions() v
          on v.terms_version = c.terms_version and v.privacy_version = c.privacy_version
       where c.user_id = p_user_id
         and c.consented_at <= p_generated_at
    );
$$;

revoke execute on function public.short_video_license_effective_from() from public, anon, authenticated;
revoke execute on function public.short_video_license_consent_versions() from public, anon, authenticated;
revoke execute on function public.short_video_license_applies(uuid, timestamptz) from public, anon, authenticated;

commit;
