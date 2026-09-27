-- 称号システム＋初回本番ライブ(#0001)限定特典（限定称号「最初の目撃者」・限定アイコン）。
--
-- 【対象】0001〜0080は一切書き換えない。本ファイルのみ新規追加（begin/commitで1トランザクション、
-- 0068・0071・0073・0076〜0079と同じ流儀）。
--
-- 【設計方針】
-- 1) 通常称号（5種）は全Xログイン通常会員が最初から選べるため、所有権テーブルは持たず
--    titles.kind='normal'であること自体を所有条件とする（利用者ごとの所有行を作らない）。
-- 2) 限定称号「最初の目撃者」・限定アイコンは、初回本番ライブ(#0001)の最終結果画面に
--    実際に接続していたことをDBで検証できた利用者だけに、user_titles/user_limited_icons
--    という別テーブルの所有行として記録する（titles.slugは不変の内部IDとして扱い、
--    表示名等を後から編集しても所有行はslugで紐づいたまま残る）。
-- 3) 「最終結果への到達」と「特典の付与」を2段階に分離する：
--    a. mark_final_result_presence(uuid)：現在のフェーズがfinal_resultであることを
--       DB側で検証し、到達記録（final_result_presence、live×userで一意）を保存する。
--       ライブがclosedになった後は新規に到達記録を作れない（current_phase判定のため）。
--    b. grant_first_live_reward(uuid)：既存の到達記録が無ければ何もしない（＝
--       参加登録があるだけの一括付与を構造的に禁止する）。到達記録さえあれば、
--       ライブがclosedになった後で呼んでも付与できる（再試行・復旧のため）。
--    どちらも「on conflict do nothing returning ...」で複数タブ・再試行・同時押しに対して
--    冪等（1回だけ実際に効果を発生させる）。
-- 4) ボット対策：このプロジェクトのボットはメール+パスワードの実アカウント
--    （src/store/useLiveBotStore.ts、supabase.auth.signInWithPassword）で、
--    profiles.is_guest=false・auth.users.is_anonymous=falseとなり、既存の
--    「ゲスト除外」チェックだけでは弾けない。一方、実際のXログイン会員は
--    signInWithOAuth({ provider: "x" })でログインしており、Supabase Authが
--    auth.users.raw_app_meta_data->>'provider'に使用したプロバイダのスラッグを
--    そのまま記録する（GoTrueの標準挙動）。この値が'x'であることをDB側で直接検証する
--    _is_x_login_identity()を新設し、mark_final_result_presence/grant_first_live_reward
--    の両方で必須条件にする。表示名・メールアドレス等の推測ベースの判定は行わない。
--    これにより、ボット用クライアント（司会コンソールのuseLiveBotStore.ts）が
--    どのRPCを呼んでも（呼ぶコードは存在しないが、仮に呼んでも）DB側で必ず拒否される。
-- 5) 称号・限定アイコンの「装備」はprofiles.equipped_title_slug/equipped_limited_icon_slugに
--    保存するが、この2列はauthenticatedへのUPDATE権限を一切grantしない
--    （このプロジェクトのデフォルト権限はalter default privilegesでanon/authenticatedに
--    insert/update/deleteが自動付与されるため、既存のprofiles全体は0003で
--    revoke update on public.profiles from authenticated 済み。以後の列は明示的に
--    grantしない限り誰も直接UPDATEできない）。装備の変更は必ずset_equipped_title/
--    set_equipped_limited_icon（SECURITY DEFINER、所有権をDB内で検証）経由にする。
-- 6) アカウント削除時の整合性：user_titles/user_limited_icons/final_result_presenceは
--    いずれもuser_id references public.profiles(id) on delete cascadeのため、
--    プロフィール削除（0078のトリガー・auth.admin.deleteUserからのcascade）で
--    自動的に消える。profiles.equipped_title_slug/equipped_limited_icon_slugは
--    行自体が削除されるため矛盾は生じない。titles.slug自体は削除しない
--    （利用中の称号の物理削除禁止、9番admin_update_titleはis_activeのみ変更）。

begin;

-- ============================================================
-- 0) _is_x_login_identity：Xログイン（signInWithOAuth({provider:"x"})）であることを
--    多層で確認する。「匿名でない」だけではXログイン扱いにしない（email/passwordの
--    ボットを確実に拒否するため）。確認する順序：
--      a. auth.identities.provider = 'x' の行が存在するか（実際のSupabase構造では
--         1ユーザーが複数プロバイダのアイデンティティを持ちうるため、最も直接的な
--         確認方法）。
--      b. auth.users.raw_app_meta_data->>'provider' = 'x'（最後に使われたプロバイダ、
--         GoTrueの標準挙動）。
--      c. auth.users.raw_app_meta_data->'providers'配列に'x'が含まれるか（複数
--         プロバイダを紐付けている場合の予備確認）。
--    いずれにも該当しなければfalse（provider情報が無い・不明な場合もfalseとし、
--    「非匿名だから」という推測では絶対にtrueにしない）。ボット（email/password）・
--    匿名ゲスト（anonymous）はいずれもここでfalseになる。
-- ============================================================
create or replace function public._is_x_login_identity(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from auth.identities i where i.user_id = p_user_id and i.provider = 'x'
    )
    or coalesce(
      (select u.raw_app_meta_data ->> 'provider' from auth.users u where u.id = p_user_id) = 'x',
      false
    )
    or coalesce(
      (select u.raw_app_meta_data -> 'providers' ? 'x' from auth.users u where u.id = p_user_id),
      false
    );
$$;

revoke execute on function public._is_x_login_identity(uuid) from public, anon, authenticated;

-- ============================================================
-- 1) titles：称号カタログ（通常5種＋限定1種）。slugは不変の内部ID（主キー）。
-- ============================================================
create table public.titles (
  slug text primary key,
  display_name text not null,
  description text,
  kind text not null check (kind in ('normal', 'limited')),
  sort_order int not null default 0,
  is_active boolean not null default true,
  -- 2番「自動装備：しない」・「譲渡：不可」の記録用（運営画面での編集対象ではない、
  -- 付与ロジック自体はこの列の値を読まず、常に自動装備しない設計で固定している）。
  auto_equip boolean not null default false,
  transferable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.titles enable row level security;

-- 称号カタログ自体は表示名・説明文を含め機微情報を持たないため、profiles等と違い
-- 誰でもSELECT可（マイページの称号選択モーダル・寄合帳等での表示に使う）。
create policy "titles_select_all"
  on public.titles for select
  using (true);

-- 直接のINSERT/UPDATE/DELETEは一般ロールへ一切grantしない（このプロジェクトの
-- デフォルト権限はテーブル作成時にanon/authenticatedへinsert/update/deleteを
-- 自動付与するため、明示的にrevokeする。変更はadmin_update_title経由のみ）。
revoke insert, update, delete on public.titles from anon, authenticated;

insert into public.titles (slug, display_name, description, kind, sort_order, auto_equip, transferable) values
  ('rookie-laugh', '笑いのルーキー', null, 'normal', 10, false, true),
  ('wannabe-boke', 'ボケたがり', null, 'normal', 20, false, true),
  ('laugh-standby', '爆笑待機中', null, 'normal', 30, false, true),
  ('mood-maker', '盛り上げ担当', null, 'normal', 40, false, true),
  ('tsukkomi-man', 'ツッコミマン', null, 'normal', 50, false, true),
  ('first-witness', '最初の目撃者', '初回本番ライブ「#0001」の最終結果まで参加した記念の限定称号です。', 'limited', 0, false, false);

-- ============================================================
-- 2) user_titles：限定称号の所有権（通常称号は所有行を持たず、titles.kind='normal'
--    であること自体が全通常会員の所有条件）。
-- ============================================================
create table public.user_titles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  title_slug text not null references public.titles (slug) on delete restrict,
  granted_at timestamptz not null default now(),
  granted_reason text,
  primary key (user_id, title_slug)
);

alter table public.user_titles enable row level security;

create policy "user_titles_select_own"
  on public.user_titles for select
  using (auth.uid() = user_id);

create policy "user_titles_select_host"
  on public.user_titles for select
  using (is_host());

-- 一般ロールへのINSERT/UPDATE/DELETEは明示的にrevokeする（付与は
-- _apply_first_live_reward経由のみ、SECURITY DEFINERがRLS/GRANTをバイパスして書き込む）。
revoke insert, update, delete on public.user_titles from anon, authenticated;

-- ============================================================
-- 3) user_limited_icons：限定アイコンの所有権。専用カタログテーブルは設けず
--    （現状アイコンは1種類のみで、運営画面からの編集対象にも含まれていない）、
--    icon_slugは'first-witness'（称号と同じ、対の特典のため共有）固定で運用する。
-- ============================================================
create table public.user_limited_icons (
  user_id uuid not null references public.profiles (id) on delete cascade,
  icon_slug text not null,
  granted_at timestamptz not null default now(),
  granted_reason text,
  primary key (user_id, icon_slug)
);

alter table public.user_limited_icons enable row level security;

create policy "user_limited_icons_select_own"
  on public.user_limited_icons for select
  using (auth.uid() = user_id);

create policy "user_limited_icons_select_host"
  on public.user_limited_icons for select
  using (is_host());

revoke insert, update, delete on public.user_limited_icons from anon, authenticated;

-- ============================================================
-- 4) final_result_presence：最終結果画面への到達記録（DBで検証可能な唯一の証拠）。
-- ============================================================
create table public.final_result_presence (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null references public.lives (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  seen_at timestamptz not null default now(),
  unique (live_id, user_id)
);

alter table public.final_result_presence enable row level security;

create policy "final_result_presence_select_own"
  on public.final_result_presence for select
  using (auth.uid() = user_id);

create policy "final_result_presence_select_host"
  on public.final_result_presence for select
  using (is_host());

revoke insert, update, delete on public.final_result_presence from anon, authenticated;

-- ============================================================
-- 5) profiles：装備中の称号・限定アイコン。列レベルのUPDATE権限は一切grantしない
--    （authenticatedへのUPDATEはprofiles全体が0003で既にrevoke済みのため、
--    新しく追加するこの2列も、下記のset_equipped_*関数を経由しない限り
--    直接UPDATEできない）。
-- ============================================================
alter table public.profiles
  add column equipped_title_slug text references public.titles (slug) on delete set null,
  add column equipped_limited_icon_slug text;

-- 限定アイコンは現状'first-witness'のみのため、DB側でも許容値を固定する
-- （多層防御。実際のガードはset_equipped_limited_icon内の所有権チェックが主）。
alter table public.profiles
  add constraint profiles_equipped_limited_icon_slug_check
  check (equipped_limited_icon_slug is null or equipped_limited_icon_slug = 'first-witness');

-- ============================================================
-- 5.5) first_live_reward_result：grant_first_live_reward/_apply_first_live_reward/
--      admin_regrant_first_live_rewardの戻り値型。newly_granted（このコールで
--      新規に付与したか）に加え、付与時点のtitles.display_name（運営が改称した
--      場合も、その時点の最新表示名）をtitle_display_nameとして返す。これにより
--      獲得モーダル・通知本文が常に現在の表示名を使える（内部ID自体は変更しない、
--      既存の所有行・過去に作成済みの通知本文は書き換えない）。
-- ============================================================
create type public.first_live_reward_result as (
  newly_granted boolean,
  title_display_name text
);

-- ============================================================
-- 6) mark_final_result_presence：最終結果画面への到達記録。
--    lives→participantsの順でFOR UPDATEロックを取得してから状態を確認する。
--    close_live（現行本体は0068、lives行を直接UPDATE）・kick_participant（現行本体は
--    0071、participants行をFOR UPDATEしてからUPDATE）と同じ行に対する排他ロックの
--    ため、「確認してからINSERTするまでの間にフェーズや退場状態が変わってしまう」
--    競合を防げる（PostgreSQLの行ロックにより、どちらか一方の完了を待ってから
--    最新のコミット済み状態を読むことになる）。ロック順序はlives→participantsに
--    統一し、join_live等の既存RPCと同じ順序にすることでデッドロックを避ける。
-- ============================================================
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
  if v_live.live_mode <> 'official' or v_live.official_sequence_number <> 1 then
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
  if v_live.live_mode <> 'official' or v_live.official_sequence_number <> 1 then
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
    values (p_user_id, 'first-witness', 'official_0001_final_result')
    on conflict (user_id, title_slug) do nothing
    returning true into v_title_inserted;

  insert into public.user_limited_icons (user_id, icon_slug, granted_reason)
    values (p_user_id, 'first-witness', 'official_0001_final_result')
    on conflict (user_id, icon_slug) do nothing
    returning true into v_icon_inserted;

  v_newly_granted := coalesce(v_title_inserted, false) or coalesce(v_icon_inserted, false);

  -- 通知も一件だけ（title/iconのどちらかを実際にこのコールで新規挿入できた場合のみ、
  -- かつ既に同種の通知が無い場合だけ挿入する二重ガード）。
  if v_newly_granted then
    insert into public.notifications (user_id, type, title, body)
    select p_user_id, 'first_live_reward', '初回ライブ限定特典を獲得しました',
      '限定称号「' || v_title_name || '」と初回ライブ限定アイコンを獲得しました。マイページで選択できます。'
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

-- ============================================================
-- 8) grant_first_live_reward：本人経由の付与（FinalResultViewから呼ぶ）。
-- ============================================================
create or replace function public.grant_first_live_reward(p_live_id uuid, p_expected_user_id uuid)
returns public.first_live_reward_result
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_LOGGED_IN';
  end if;
  -- 2026-09-28（レビュー対応・世代ガード）：mark_final_result_presenceと同じ理由で、
  -- クライアントが意図した利用者と実行時点のauth.uid()が一致するかを確認する。
  if p_expected_user_id is null or p_expected_user_id <> v_uid then
    raise exception 'USER_MISMATCH';
  end if;
  return public._apply_first_live_reward(v_uid, p_live_id);
end;
$$;

grant execute on function public.grant_first_live_reward(uuid, uuid) to authenticated;
revoke execute on function public.grant_first_live_reward(uuid, uuid) from public, anon;

-- ============================================================
-- 9) set_equipped_title / set_equipped_limited_icon：装備の変更（本人のみ、
--    所有していないものは装備できない）。p_*_slugにnullを渡すと解除する。
--    通常称号・限定称号・限定アイコンのいずれも、Xログイン会員だけが装備できる
--    （メール+パスワードのボットアカウントは、ゲストではないがここで拒否される。
--    UIの非表示だけに依存せず、DB側で必ず検証する）。
-- ============================================================
create or replace function public.set_equipped_title(p_title_slug text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_kind text;
  v_is_active boolean;
begin
  if v_uid is null then
    raise exception 'NOT_LOGGED_IN';
  end if;
  if public._is_guest_identity(v_uid, false) then
    raise exception 'GUEST_NOT_ELIGIBLE';
  end if;
  if not public._is_x_login_identity(v_uid) then
    raise exception 'NOT_X_LOGIN';
  end if;

  if p_title_slug is null then
    update public.profiles set equipped_title_slug = null where id = v_uid;
    return;
  end if;

  select kind, is_active into v_kind, v_is_active from public.titles where slug = p_title_slug;
  if v_kind is null then
    raise exception 'TITLE_NOT_FOUND';
  end if;
  if not v_is_active then
    raise exception 'TITLE_NOT_ACTIVE';
  end if;

  if v_kind = 'limited' then
    if not exists (
      select 1 from public.user_titles where user_id = v_uid and title_slug = p_title_slug
    ) then
      raise exception 'TITLE_NOT_OWNED';
    end if;
  end if;
  -- kind='normal'は全通常会員が所有扱いのため、所有権チェックは不要
  -- （ここまで到達している時点でGUEST_NOT_ELIGIBLEを通過済み＝通常会員）。

  update public.profiles set equipped_title_slug = p_title_slug where id = v_uid;
end;
$$;

grant execute on function public.set_equipped_title(text) to authenticated;
revoke execute on function public.set_equipped_title(text) from public, anon;

create or replace function public.set_equipped_limited_icon(p_icon_slug text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_LOGGED_IN';
  end if;
  if public._is_guest_identity(v_uid, false) then
    raise exception 'GUEST_NOT_ELIGIBLE';
  end if;
  if not public._is_x_login_identity(v_uid) then
    raise exception 'NOT_X_LOGIN';
  end if;

  if p_icon_slug is null then
    update public.profiles set equipped_limited_icon_slug = null where id = v_uid;
    return;
  end if;

  if not exists (
    select 1 from public.user_limited_icons where user_id = v_uid and icon_slug = p_icon_slug
  ) then
    raise exception 'ICON_NOT_OWNED';
  end if;

  update public.profiles set equipped_limited_icon_slug = p_icon_slug where id = v_uid;
end;
$$;

grant execute on function public.set_equipped_limited_icon(text) to authenticated;
revoke execute on function public.set_equipped_limited_icon(text) from public, anon;

-- ============================================================
-- 10) participant_display_names / sns_author_names：他の参加者・投稿者の
--     限定アイコン装備状況も見えるよう、戻り値にequipped_limited_icon_slugを
--     追加する（戻り値の型が変わるためdrop&create）。称号(equipped_title_slug)は
--     今回マイページ本人表示のみが要件のため、ここには含めない（他人の称号を
--     公開する仕様変更は行わない）。
--     参照した現行本体：
--       - participant_display_names：0070（ゲストは固定の表示名"ゲスト"+guest_number
--         2桁ゼロ埋め・アイコン"default"・色"#171513"を返すcase文。この分岐は
--         一切変更せず、equipped_limited_icon_slugの列を追加するだけ。
--         なお、ゲストはequipped_limited_icon_slugを持ち得ない（限定特典は
--         Xログイン会員限定）ため、ゲストの場合もpr.equipped_limited_icon_slug
--         （常にnull）をそのまま返してよく、caseによる固定化は不要。
--       - sns_author_names：0071（"and not pr.is_guest"でゲストの投稿者情報自体を
--         返さない仕様。ゲストは寄合帳に投稿できないため元々表示対象にならないが、
--         念のためこの除外条件も引き続き維持する）。
-- ============================================================
drop function if exists public.participant_display_names(uuid);

create function public.participant_display_names(p_live_id uuid)
returns table (
  participant_id uuid,
  display_name text,
  avatar_icon text,
  avatar_color text,
  equipped_limited_icon_slug text
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    case when p.is_guest then 'ゲスト' || lpad(p.guest_number::text, 2, '0') else pr.display_name end,
    case when p.is_guest then 'default' else pr.avatar_icon end,
    case when p.is_guest then '#171513' else pr.avatar_color end,
    pr.equipped_limited_icon_slug
  from public.participants p
  join public.profiles pr on pr.id = p.user_id
  where p.live_id = p_live_id;
$$;

grant execute on function public.participant_display_names(uuid) to authenticated;
revoke execute on function public.participant_display_names(uuid) from public;
revoke execute on function public.participant_display_names(uuid) from anon;

drop function if exists public.sns_author_names(uuid[]);

create function public.sns_author_names(p_ids uuid[])
returns table (
  id uuid,
  display_name text,
  avatar_icon text,
  avatar_color text,
  mastery_meter int,
  bio text,
  equipped_limited_icon_slug text
)
language sql
security definer set search_path = public
as $$
  select pr.id, pr.display_name, pr.avatar_icon, pr.avatar_color, pr.mastery_meter, pr.bio,
    pr.equipped_limited_icon_slug
  from public.profiles pr
  where pr.id = any(p_ids)
    and not pr.is_guest;
$$;

grant execute on function public.sns_author_names(uuid[]) to authenticated, anon;
revoke execute on function public.sns_author_names(uuid[]) from public;

-- ============================================================
-- 11) 管理画面(/admin/titles)向けRPC。いずれもis_host()必須、
--     admin_action_logsへ監査記録する。
-- ============================================================

-- 表示名・説明文・並び順・公開状態の編集。slug（内部ID）は引数に取らず変更不可。
create or replace function public.admin_update_title(
  p_slug text,
  p_display_name text,
  p_description text,
  p_sort_order int,
  p_is_active boolean
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.titles where slug = p_slug) then
    raise exception 'TITLE_NOT_FOUND';
  end if;
  if p_display_name is null or length(trim(p_display_name)) = 0 then
    raise exception 'INVALID_DISPLAY_NAME';
  end if;

  update public.titles
    set display_name = p_display_name,
        description = p_description,
        sort_order = p_sort_order,
        is_active = p_is_active,
        updated_at = now()
    where slug = p_slug;

  -- 2026-09-28（レビュー対応）：非公開にした称号は、既に装備中の利用者からも
  -- 解除する（所有記録(user_titles)は削除しない。再公開後は利用者が自分で
  -- 再装備できる）。通常称号・限定称号のどちらも同じ扱い。
  if not p_is_active then
    update public.profiles set equipped_title_slug = null where equipped_title_slug = p_slug;
  end if;

  insert into public.admin_action_logs (actor_id, action, target_type, target_id, detail)
  values (
    auth.uid(), 'title_updated', 'titles', p_slug,
    jsonb_build_object('displayName', p_display_name, 'sortOrder', p_sort_order, 'isActive', p_is_active)
  );
end;
$$;

grant execute on function public.admin_update_title(text, text, text, int, boolean) to authenticated;
revoke execute on function public.admin_update_title(text, text, text, int, boolean) from public, anon;

-- 初回ライブ#0001の到達記録一覧（利用者名・プレイヤー/観客・seen_at・称号/アイコンの付与状況）。
create or replace function public.admin_list_final_result_presence(p_live_id uuid)
returns table (
  user_id uuid,
  display_name text,
  role text,
  seen_at timestamptz,
  has_title boolean,
  has_icon boolean
)
language plpgsql
security definer set search_path = public
as $$
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  return query
  select
    fp.user_id,
    pr.display_name,
    part.role,
    fp.seen_at,
    exists(select 1 from public.user_titles ut where ut.user_id = fp.user_id and ut.title_slug = 'first-witness'),
    exists(select 1 from public.user_limited_icons ui where ui.user_id = fp.user_id and ui.icon_slug = 'first-witness')
  from public.final_result_presence fp
  join public.profiles pr on pr.id = fp.user_id
  join public.participants part on part.id = fp.participant_id
  where fp.live_id = p_live_id
  order by fp.seen_at asc;
end;
$$;

grant execute on function public.admin_list_final_result_presence(uuid) to authenticated;
revoke execute on function public.admin_list_final_result_presence(uuid) from public, anon;

-- 未付与者への再付与。到達記録が無い利用者には'NO_PRESENCE_RECORD'で失敗する
-- （_apply_first_live_reward自体がガードするため、参加者全員への一括付与はできない）。
-- 戻り値はgrant_first_live_rewardと同じfirst_live_reward_result型
-- （newly_granted・title_display_name）。
create or replace function public.admin_regrant_first_live_reward(p_user_id uuid, p_live_id uuid)
returns public.first_live_reward_result
language plpgsql
security definer set search_path = public
as $$
declare
  v_result public.first_live_reward_result;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  v_result := public._apply_first_live_reward(p_user_id, p_live_id);

  insert into public.admin_action_logs (actor_id, action, target_type, target_id, detail)
  values (
    auth.uid(), 'first_live_reward_regranted', 'profiles', p_user_id::text,
    jsonb_build_object('liveId', p_live_id, 'newlyGranted', v_result.newly_granted)
  );

  return v_result;
end;
$$;

grant execute on function public.admin_regrant_first_live_reward(uuid, uuid) to authenticated;
revoke execute on function public.admin_regrant_first_live_reward(uuid, uuid) from public, anon;

-- 通常称号の「所有者数」＝実際にXログインしている通常会員数（ゲスト・ボットは
-- 除外）。一般クライアントからauth.users/auth.identitiesを直接読ませないため、
-- 運営専用のSECURITY DEFINER RPCとして提供する（/admin/titlesから呼ぶ）。
create or replace function public.admin_count_x_login_members()
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
  v_count bigint;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  select count(*) into v_count from public.profiles p
    where not p.is_guest and public._is_x_login_identity(p.id);

  return v_count;
end;
$$;

grant execute on function public.admin_count_x_login_members() to authenticated;
revoke execute on function public.admin_count_x_login_members() from public, anon;

-- ============================================================
-- 12) current_legal_document_versions：本サイトは既に本番公開済みで、
--     terms_consentsにも実際の同意記録がある。今回プライバシーポリシー本文へ
--     「選択中の称号」「限定アイコン」を追加したため、改定なし扱いにはせず、
--     0076で定義された現在バージョン判定関数をここでcreate or replaceする
--     （0076自体は編集しない）。利用規約は今回改定していないためterms_versionは
--     0076と同じ値のまま据え置き、privacy_versionだけを更新する。
--     src/lib/legalInfo.tsのTERMS_VERSION/PRIVACY_VERSIONと必ず同じ値にする
--     （src/lib/__tests__/legalPagesWiring.check.tsが一致を検査する）。
--     これにより、既存利用者（旧privacy_versionでterms_consentsに同意記録済み）は
--     ConsentRequiredGateが「現在のバージョンに一致する同意記録が無い」と判定し、
--     新しいプライバシーポリシーへの再同意ゲートが表示される。
-- ============================================================
create or replace function public.current_legal_document_versions()
returns table (terms_version text, privacy_version text)
language sql
stable
as $$
  select '2026-09-25-v1'::text, '2026-09-28-v2'::text;
$$;

commit;
