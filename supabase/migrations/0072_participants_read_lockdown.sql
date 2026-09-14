-- participantsテーブルの重大な読み取り範囲問題への対応（3回目レビュー対応）。
--
-- 【問題】0001のparticipants_select_all（using true）が今も残っており、
-- authenticated（匿名ゲストを含む）であれば誰でも、別ライブ・別ユーザーの
-- participants行を直接SELECTできてしまう。participantsには非公開情報として
-- host_message（本人だけに見せる個別警告メッセージ）・host_message_sent_at・
-- kicked_at（退場状態）・user_id（内部識別子）が含まれており、UIで隠すだけでは
-- REST API直叩きでの取得を防げない。
--
-- 【方針】
-- - 0001は書き換えず、このファイル（0072）でparticipants_select_allを削除し、
--   本人の行・司会/運営(is_host())の行だけを直接SELECTできるようにする。
-- - ライブ画面（一般参加者・観客・ゲスト問わず全員）が必要とする「他参加者の
--   表示用情報」は、新設のSECURITY DEFINER RPC public.participants_for_live()
--   経由に一本化する。host_message/host_message_sent_at/kicked_at/user_idは
--   本人の行だけそのまま返し、他人の行ではnullにマスクする（列だけを隠す＝
--   RLSの行単位の仕組みでは実現できないため、マスク済みの値を返すRPCで対応する）。
--   表示に使う残りの列（group_id/role/preferred_role/joined_at/is_guest/
--   guest_number）は全員分そのまま返す（座席表示・組結果・ランキング計算・
--   ゲスト表示名の採番に必須で、いずれも非公開情報ではない）。
-- - SNS公開結果（sns_live_results、掲載確定済みのみ）でparticipant_id→user_id
--   を解決する2箇所（useSnsLiveResultsStore.ts）も、生のparticipants直接取得
--   から新設RPC public.sns_result_participant_user_ids()へ切り替える。こちらは
--   「掲載確定済み(included=true)・結果公開済み(results_published=true)・
--   本番(live_mode='official')」の回答に紐づく参加者に限定して返す（既に一般
--   公開されている結果の著者情報の解決であり、set_sns_live_result_manager_best
--   （0071）と同じ検証パターンを踏襲する）。
-- - Supabase RealtimeのPostgres Changesは、購読者のRLS SELECT権限に基づいて
--   配信可否を判定するため、participants_select_allを削除すると「自分以外の
--   参加者の入退場・組移動」が一般参加者のchannelに届かなくなり、ライブ画面の
--   自動更新が止まってしまう（実害の大きい退行）。そこで、参加者の実データを
--   一切含まない「変更があった合図（live_id + 最終更新時刻のみ）」用の新テーブル
--   participants_change_pingsを追加し、participants本体へのトリガーで自動的に
--   upsertする。中身が完全に無害（誰が・何をどう変えたかを一切含まない）なため、
--   lives_select_all等と同じ「using (true)」で全員に公開してよい。フロント側
--   （useLiveFollowerStore.ts）はparticipantsテーブルへの直接購読をこのpingsテーブル
--   への購読に差し替え、受信時に同じrefetchAll()を呼ぶ（「何か変わったので全部
--   取り直す」という既存の使い方自体は変えない）。
--
-- 【再レビュー対応】上記のpingsテーブルについて、以下2点の見落としがあった。
--   (a) 新規テーブルはSupabase Realtimeのpublication(supabase_realtime)に自動では
--       入らない（0007/0044/0063と同じく、テーブル作成のたびに明示的な
--       `alter publication supabase_realtime add table ...`が必要）。これが
--       無いと本番ではpostgres_changesイベントが一切配信されない。
--   (b) 「変更のたびに1行INSERT」する設計だと、長期運用でこのテーブルが無制限に
--       増え続けてしまう。ライブ1件につきping行を1行だけ保持する構造
--       （live_idをPRIMARY KEY化し、トリガーはINSERT ... ON CONFLICT (live_id)
--       DO UPDATE SET changed_at = ...で最終更新時刻だけを更新する）に変更する。
--       これに伴い、useLiveFollowerStore.tsの購読イベントもINSERT限定ではなく
--       INSERT/UPDATEの両方を拾うように変更する（該当ファイル参照）。
--       また、live削除時：lives→participants_change_pingsのON DELETE CASCADEと
--       lives→participants（さらにそのAFTER DELETEトリガー経由でのping upsert）の
--       ON DELETE CASCADEが同一トランザクション内で競合し、削除中のlive_idへ
--       pingを再作成しようとしてFK違反になりうる。トリガー内で「対象のlivesが
--       まだ存在する場合だけupsertする」ガードを入れることで、この競合を安全側
--       （何もしない）へ倒す。
--
-- 0001〜0071は一切書き換えない。begin/commitで1トランザクションにまとめる。

begin;

-- ============================================================
-- 1) participants_select_all（0001）を削除し、本人・司会/運営限定にする。
-- ============================================================
drop policy if exists "participants_select_all" on public.participants;

create policy "participants_select_own"
  on public.participants for select
  using (auth.uid() = user_id);

create policy "participants_select_host"
  on public.participants for select
  using (is_host());

-- ============================================================
-- 2) participants_for_live：ライブ画面向けの安全な参加者一覧RPC。
-- ============================================================
-- host_message/host_message_sent_at/kicked_at/user_idは、呼び出し本人の行
-- （p.user_id = auth.uid()）または司会/運営(is_host())が見ている場合だけそのまま
-- 返し、それ以外の行ではnullにマスクする。マスクしない列（group_id/role/
-- preferred_role/joined_at/is_guest/guest_number）は座席表示・組結果・
-- ランキング計算・「ゲストNN」表示名の採番に必須で非公開情報ではないため、
-- 全参加者ぶんそのまま返す。戻り値の列構成はpublic.participants本体と完全に
-- 一致させ、フロント側の型（src/lib/liveRoomTypes.ts ParticipantRow）の変更を
-- 不要にする。
create or replace function public.participants_for_live(p_live_id uuid)
returns table (
  id uuid,
  live_id uuid,
  user_id uuid,
  group_id uuid,
  role text,
  preferred_role text,
  joined_at timestamptz,
  host_message text,
  host_message_sent_at timestamptz,
  kicked_at timestamptz,
  is_guest boolean,
  guest_number int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.live_id,
    case when p.user_id = auth.uid() or is_host() then p.user_id else null end,
    p.group_id,
    p.role,
    p.preferred_role,
    p.joined_at,
    case when p.user_id = auth.uid() or is_host() then p.host_message else null end,
    case when p.user_id = auth.uid() or is_host() then p.host_message_sent_at else null end,
    case when p.user_id = auth.uid() or is_host() then p.kicked_at else null end,
    p.is_guest,
    p.guest_number
  from public.participants p
  where p.live_id = p_live_id;
$$;

grant execute on function public.participants_for_live(uuid) to authenticated;
revoke execute on function public.participants_for_live(uuid) from public;
revoke execute on function public.participants_for_live(uuid) from anon;

-- ============================================================
-- 3) sns_result_participant_user_ids：SNS公開結果の著者解決用の安全なRPC。
-- ============================================================
-- 任意のparticipant_idを渡されても、「掲載確定済み(included=true)・
-- 結果公開済み(results_published=true)・本番(live_mode='official')」の回答に
-- 紐づく参加者以外はuser_idを返さない（set_sns_live_result_manager_best、
-- 0071と同じ検証パターン）。まだ公開されていない結果・テストライブの参加者の
-- user_idは一切返らない。
create or replace function public.sns_result_participant_user_ids(p_participant_ids uuid[])
returns table (participant_id uuid, user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct p.id, p.user_id
  from public.participants p
  join public.answers a on a.participant_id = p.id
  join public.sns_live_result_answers ra on ra.answer_id = a.id
  join public.sns_live_results r on r.id = ra.live_result_id
  join public.lives l on l.id = r.live_id
  where p.id = any(p_participant_ids)
    and ra.included = true
    and l.results_published = true
    and l.live_mode = 'official';
$$;

-- SNSの寄合帳フィード・ライブ結果は0033/0070のsns_author_names等と同じく
-- 未ログインでも閲覧できる設計のため、anonにも実行を許可する（掲載確定済みの
-- 公開結果に限定しているため、未ログイン閲覧に許可しても非公開情報は増えない）。
grant execute on function public.sns_result_participant_user_ids(uuid[]) to authenticated, anon;
revoke execute on function public.sns_result_participant_user_ids(uuid[]) from public;

-- ============================================================
-- 4) participants_change_pings：Realtime購読維持用の無害な変更合図テーブル。
-- ============================================================
-- 中身はlive_idと最終更新時刻のみ（誰が・どの参加者が・何を変更したかは
-- 一切含まない）。live_tsukkomi_events（0044）と異なり演出内容を持たないため、
-- lives_select_all等と同じ「using (true)」で全員に公開しても非公開情報は
-- 一切漏れない。live_idをPRIMARY KEYにして「ライブ1件につき1行」だけ保持し、
-- 変更のたびに増え続けないようにする（トリガーはINSERTではなくupsert）。
create table public.participants_change_pings (
  live_id uuid primary key references public.lives (id) on delete cascade,
  changed_at timestamptz not null default now()
);

alter table public.participants_change_pings enable row level security;

create policy "participants_change_pings_select_all"
  on public.participants_change_pings for select
  using (true);

-- 直接INSERT/UPDATE/DELETEは禁止（トリガー経由のみ）。ポリシーを作らないことで
-- 直接操作を拒否する。

create or replace function public._ping_participants_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_live_id uuid := coalesce(new.live_id, old.live_id);
begin
  -- 対象のlivesがまだ存在する場合だけupsertする。live削除時、participantsの
  -- ON DELETE CASCADEで発火するこのトリガーと、lives→participants_change_pings
  -- 自体のON DELETE CASCADEが同一トランザクション内で競合し、削除中のlive_idへ
  -- ping行を再作成しようとしてFK違反になりうるため、その場合は何もしない
  -- （どのみち削除されるliveの変更合図は誰にも必要ない）。
  if exists (select 1 from public.lives l where l.id = v_live_id) then
    insert into public.participants_change_pings (live_id, changed_at)
    values (v_live_id, now())
    on conflict (live_id) do update set changed_at = excluded.changed_at;
  end if;
  return null;
end;
$$;

create trigger participants_ping_on_change
  after insert or update or delete on public.participants
  for each row execute function public._ping_participants_change();

revoke execute on function public._ping_participants_change() from public, anon, authenticated;

-- postgres_changes購読でクライアントに届くよう、Realtime配信対象に追加する
-- （0007/0044/0063と同様。新規テーブルは自動では入らない）。
alter publication supabase_realtime add table public.participants_change_pings;

commit;
