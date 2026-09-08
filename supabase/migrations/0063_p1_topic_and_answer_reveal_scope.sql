-- セキュリティレビュー対応 P1（8・9番）：お題・回答の先読み防止。
--
-- ローカルPostgreSQLで実際に攻撃再現し、以下を確認した（本番でも同じ結果になる
-- はずだが、確定させるため後述の読み取り専用SQLを本番のSupabase SQL Editorで
-- 実行し、一致することを確認してほしい）。
--
-- 【P1-8：お題の先読み】
--   topic_bank_select_all（using(true)）・topics_select_all（using(true)）は
--   誰でも（一般の参加者はもちろんanonでも）全件SELECTできる状態だった。
--   実際に2組のライブでbegin_gameを実行したところ、
--   - topic_bank：このライブで使っていないお題も含め、お題バンク全件が読める
--   - topics：まだ登壇していない組2のお題本文が、組1の発表中から読める
--   ことを確認した。
--
--   原因：begin_game()はターンを1組ずつ発表時に作るのではなく、全周・全組ぶんの
--   turnsを開始時に一括作成し、使う予定の全topicsをまとめてlocked=trueにする
--   （supabase/migrations/0056等）。つまりtopics.lockedは「使用予定として
--   確定した」という意味であり、「参加者に発表済み」という意味ではない。
--   一方turns.statusは、begin_gameで最初の1件だけ'active'になり、残りは
--   'pending'のまま（advanceIfDue側のgroup_result→topic_reveal遷移で次の
--   turnが'active'になった時に初めて発表される、src/store/useLiveHostStore.ts
--   のadvanceIfDue参照）。よってturns.statusこそが「発表済みか」の基準になるが、
--   それだけでは不十分（下記の再レビュー指摘対応を参照）。
--
-- 【P1-9：回答の先読み】
--   answers_select_participant_host_or_published（0053）は
--   「is_host() OR そのライブの参加者である OR 公開済みライブ結果に含まれる」
--   だけを条件にしており、revealed_at（司会が実際に画面へ表示したか）を
--   一切見ていなかった。実際に、まだ登壇していない組の参加者（＝他の組の
--   回答を採点する審査員になる人）が、revealed_atがnullの（＝まだ画面に
--   出ていない）回答の本文をSELECTで直接読めることを確認した。
--
-- 【再レビュー指摘への対応（0063適用前、この版で反映済み）】
--
-- a) turns.status='active'だけでは早期公開の余地が残っていた。
--    advanceIfDue（src/store/useLiveHostStore.ts）は
--      1. turnsをstatus='active'へUPDATE
--      2. lives.current_turn_id / current_phaseをUPDATE
--    の2回の別々の呼び出しに分かれており、1と2の間、または2以降が何らかの
--    理由で失敗した場合、turns.status='active'だけが先に確定してしまい、
--    まだ画面へ発表されていない次のお題がAPIから直接読めてしまう窓が生じる。
--    対応：activeなturnのお題を公開する条件に
--      - turn.id = lives.current_turn_id（統一ずれの窓を閉じる）
--      - turn.live_id = topics.live_id
--      - 呼び出しユーザーがそのライブのparticipantsに登録されている
--      - participants.kicked_at is null（退場者除外、P1-9指摘cとも共通）
--    を追加した。doneなturnのお題も同じ条件（同ライブの非退場参加者限定）に
--    揃え、単にstatus in ('active','done')だけで無関係な認証済みユーザーや
--    anonへ公開しない設計にした。
--    公開済みライブ結果（sns_live_results.results_published）に含まれる
--    回答から参照されるお題だけは、参加者条件と無関係に別枠で公開する
--    （寄合帳のライブ結果ページがsrc/store/useSnsLiveResultsStore.tsで
--    answers→turns→topicsの順に辿って本文を取得している実装に基づく）。
--
-- b) 「未発表回答を本人以外へ返さない」設計にした結果、複数端末で以下の画面
--    回帰が起きる：
--      - StageAnsweringView/AudienceAnsweringViewのrevealPendingParticipantId
--        （次に光らせる回答席）は、turnAnswers（=answers全件、未発表含む）から
--        「最も古い未発表回答のparticipant_id」を求めていた
--      - StageAnsweringViewのbusyByTurnAnswers（送信ボタンの即時ロック）も
--        同じturnAnswersの未発表件数を見ていた
--    RLSで未発表answersが本人以外に返らなくなった結果、他端末ではこれらが
--    常に「該当なし」になり、回答席が光らない・送信ロックがhostの
--    500msポーリング（answering_paused）まで遅れる、という体感速度の劣化が
--    生じる。回答本文を再公開せずに解決するため、専用の安全なcueテーブル
--    （answering_cues）を新設し、pending_participant_id・busy・turn_idという
--    「回答本文を一切含まない最小限の情報」だけをanswers側のトリガーで
--    同期する。クライアントはturnAnswersではなくこのcueを見て演出を出す。
--    詳細はコード内コメント参照。
--
-- c) 退場済み(kicked_at is not null)の参加者は、answers・topics・
--    answering_cuesのいずれからも締め出す（上記a・bの条件に含めた）。
--    公開済みライブ結果は従来どおり誰でも閲覧できる（退場は変更しない）。
--
-- 【本migration作業中に判明した追加の問題（0062関連、要報告）】
-- 0062は「今後作成する関数はデフォルトでPUBLIC実行不可にする」ために
--   alter default privileges in schema public revoke execute on functions from public;
-- を実行していたが、ローカルPostgreSQL 16で実際に検証したところ、
-- 「in schema public」を付けたこの形は新規作成した関数に一切効かない
-- （新しい関数がPUBLIC実行可能なままになる）ことが判明した。
-- 「in schema」句を外したグローバルな形にすると正しく効く
-- （pg_default_aclにdefaclnamespace=0＝スキーマ非依存として記録され、
-- 以後作成する関数からPUBLICの実行権限が正しく外れる）ことも確認した。
-- 0062は既に本番適用済みのため書き換えないが、このmigration以降の関数から
-- 正しく効くよう、ここで改めて正しい構文で設定し直す。念のため、本migration
-- 自身が新設する関数にも個別に明示revokeを行い、デフォルトの挙動だけに
-- 頼らない多層防御にする。
--
-- 【再レビュー指摘（2回目）への対応（0063適用前、この版で反映済み）】
--
-- d) answering_cuesの新旧逆転：fetchAnsweringCue()による再取得と、
--    answering_cuesのRealtimeイベント受信は別々の非同期経路で同じ
--    pendingCue stateを更新しており、どちらが先に完了するかは保証されない
--    （古い再取得が新しいRealtimeイベントの後に完了して上書きする、または
--    その逆）。単調増加するrevision列を追加し、UPSERTのたびに+1する。
--    クライアント側はliveId・revisionの両方を見て「より新しい方（同値含む）」
--    だけを採用する（詳細はsrc/lib/answeringCue.ts参照）。
--
-- e) answers_select_own_revealed_host_or_publishedの公開済みライブ結果経由の
--    分岐も、topics同様にr.live_id = answers.live_idが抜けていた。無関係な
--    別ライブ（未公開）の回答が誤って公開済みライブのsns_live_result_answers
--    に紐付けられた場合、その回答本文自体が第三者に漏れる余地があったため、
--    r.live_id = answers.live_id / t.live_id = r.live_id を追加した。

begin;

-- 0062の「in schema public」付きだと効かなかった問題の是正
-- （global形、以後このロールが作成する関数に正しく適用される）。
alter default privileges revoke execute on functions from public;

-- ============================================================
-- 1) topic_bank：is_host()限定にする（再レビューでも変更なし）。
-- ============================================================
drop policy if exists "topic_bank_select_all" on public.topic_bank;
create policy "topic_bank_select_host"
  on public.topic_bank for select
  using (is_host());

-- ============================================================
-- 2) topics：is_host()、または
--    「同じライブの非退場参加者」かつ「turnがcurrent_turn_idと一致するactive、
--    またはdone」、または「公開済みライブ結果に含まれる回答から参照される」
--    ものだけに限定する。
-- ============================================================
drop policy if exists "topics_select_all" on public.topics;
drop policy if exists "topics_select_revealed_or_host" on public.topics;
create policy "topics_select_revealed_or_host"
  on public.topics for select
  using (
    is_host()
    or exists (
      select 1
      from public.turns t
      join public.lives l on l.id = t.live_id
      join public.participants p on p.live_id = l.id and p.user_id = auth.uid()
      where t.topic_id = topics.id
        and t.live_id = topics.live_id
        and p.kicked_at is null
        and (
          (t.status = 'active' and t.id = l.current_turn_id)
          or t.status = 'done'
        )
    )
    or exists (
      -- 公開済みライブ結果に含まれる回答から参照されるお題
      -- （src/store/useSnsLiveResultsStore.tsのanswers→turns→topicsの
      -- 取得経路と同じ辿り方。参加者条件は課さない＝退場者・無関係な
      -- 第三者でも通常どおり閲覧できる）。
      -- 【再レビュー指摘対応】t2.live_id = r.live_id / topics.live_id = r.live_id を
      -- 明示的に要求する。これが無いと、topics.idとanswers.turn_idの一致だけを
      -- 頼りに辿っており、万一別ライブのtopics行が同じidを再利用する経路や、
      -- turnとお題の紐付けがライブをまたいで壊れた場合に、無関係な別ライブの
      -- 公開結果を経由してお題が漏れる余地が理屈の上で残っていた。
      -- answers→turns（t2）→ライブ結果（r）→topicsのすべてが同じlive_idで
      -- 揃っていることを明示的に確認することで、その余地を閉じる。
      select 1
      from public.answers a
      join public.turns t2 on t2.id = a.turn_id
      join public.sns_live_result_answers sra on sra.answer_id = a.id
      join public.sns_live_results r on r.id = sra.live_result_id
      join public.lives l2 on l2.id = r.live_id
      where t2.topic_id = topics.id
        and sra.included
        and l2.results_published
        and t2.live_id = r.live_id
        and topics.live_id = r.live_id
    )
  );

-- ============================================================
-- 3) answers：本人の回答（未発表でも可）、is_host()、公開済みライブ結果、
--    または「同じライブの非退場参加者」かつ「revealed_atが設定済み」の
--    ものだけに限定する。
-- ============================================================
drop policy if exists "answers_select_participant_host_or_published" on public.answers;
drop policy if exists "answers_select_own_revealed_host_or_published" on public.answers;
create policy "answers_select_own_revealed_host_or_published"
  on public.answers for select
  using (
    is_host()
    or exists (
      -- 【再レビュー指摘（2回目）対応】r.live_id = answers.live_id を明示的に
      -- 要求する（さらにturns経由でも同じライブであることを二重に確認する）。
      -- これが無いと、topicsの公開判定と同様に、無関係な別ライブ（未公開）の
      -- 回答が誤って（あるいは悪意を持って）公開済みライブのsns_live_result_answers
      -- に紐付けられた場合、sra.included and l.results_publishedの条件だけを
      -- 満たしてしまい、その未公開の回答本文自体が第三者に漏れる余地が
      -- 理屈の上で残っていた。
      select 1
      from public.sns_live_result_answers sra
      join public.sns_live_results r on r.id = sra.live_result_id
      join public.lives l on l.id = r.live_id
      join public.turns t on t.id = answers.turn_id
      where sra.answer_id = answers.id
        and sra.included
        and l.results_published
        and r.live_id = answers.live_id
        and t.live_id = r.live_id
    )
    or exists (
      select 1 from public.participants p
      where p.live_id = answers.live_id
        and p.user_id = auth.uid()
        and p.kicked_at is null
        and (p.id = answers.participant_id or answers.revealed_at is not null)
    )
  );

-- ============================================================
-- 4) 安全な「発表待ち合図」テーブル（answering_cues）。
--    回答本文(body)を一切含まない、演出に必要な最小限の情報だけを持つ。
--    書き込みはSECURITY DEFINERのトリガー関数からのみ行い、クライアントからの
--    直接INSERT/UPDATE/DELETEを許可するポリシーは作らない（RLSはデフォルトで
--    「該当ポリシーが無いコマンドは拒否」のため、これだけで書き込みを塞げる）。
-- ============================================================
create table public.answering_cues (
  live_id uuid primary key references public.lives (id) on delete cascade,
  turn_id uuid not null references public.turns (id) on delete cascade,
  -- 次に画面へ表示予定の回答の投稿者（未発表回答のうち最も古いもの）。
  -- 該当が無ければnull。回答本文(body)は一切含まない。
  pending_participant_id uuid references public.participants (id) on delete set null,
  -- 未処理の回答（未発表、または発表済みだが未確定）が存在するかどうか。
  -- 送信ボタンの即時ロックに使う（answers本体を見なくても判定できる）。
  busy boolean not null default false,
  -- 【再レビュー指摘（2回目）対応】fetchAnsweringCue()による再取得と、
  -- answering_cuesのRealtimeイベント受信は別々の非同期経路であり、どちらが
  -- 先に完了するかは保証されない。単調増加するrevisionを持たせることで、
  -- クライアント側は「後から届いた方」ではなく「revisionが大きい（同じ場合を
  -- 含む）方」を採用でき、古い取得結果や遅延したRealtimeイベントによる
  -- 新旧逆転（回答席の点灯・送信ロック・送信音・pending状態のずれ）を防げる。
  -- 1ライブにつき1行(PK=live_id)なので、ターンが変わってもrevisionは
  -- リセットされず単調に増え続ける。
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

alter table public.answering_cues enable row level security;

-- 【再レビュー指摘対応】RLSだけに頼らず、テーブル権限自体も最小化する
-- （supabaseはデフォルトで新規テーブルにanon/authenticatedへの
-- select/insert/update/deleteを自動付与するため、それを前提にしない）。
-- SELECTだけをauthenticatedへ許可し、その範囲内をRLSでさらに絞る。
-- anonはSELECTすら不可。authenticatedもINSERT/UPDATE/DELETEは不可
-- （書き込みはSECURITY DEFINERのトリガー関数のみが行う。テーブル所有者相当の
-- 権限で動くため、この権限剥奪はトリガー経由の更新には影響しない）。
revoke all on table public.answering_cues from public, anon, authenticated;
grant select on table public.answering_cues to authenticated;

create policy "answering_cues_select_participant_or_host"
  on public.answering_cues for select
  using (
    is_host()
    or exists (
      select 1 from public.participants p
      where p.live_id = answering_cues.live_id
        and p.user_id = auth.uid()
        and p.kicked_at is null
    )
  );

-- 指定turnの現在の状態からanswering_cuesを再計算して反映する共通ロジック。
-- answers側のトリガー・lives側のトリガー両方から呼ぶ。
--
-- 【再レビュー指摘cへの対応】p_turn_idが「そのライブが今まさに表示している
-- ターン(lives.current_turn_id)」と一致する場合だけ更新する。これが無いと、
-- 司会が既に次のターンへ進めた後で、前のターンの回答へ何らかの理由で遅れて
-- UPDATE（採点確定処理の再送・リトライ等）が入った場合に、そのanswersトリガーが
-- 前のターンのp_turn_idでこの関数を呼び、既に新しいターンの情報で上書き済みの
-- answering_cues（PK=live_id なので1ライブにつき1行しか持てない）を、古い
-- （前のターンの）内容で再び上書きしてしまう。lives.current_turn_idとの一致を
-- 確認することで、過去ターンの更新が現在のcueを巻き戻さないようにする。
create function public.recompute_answering_cue_for_turn(p_turn_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_live_id uuid;
  v_current_turn_id uuid;
  v_pending uuid;
  v_busy boolean;
begin
  select t.live_id, l.current_turn_id into v_live_id, v_current_turn_id
    from public.turns t
    join public.lives l on l.id = t.live_id
    where t.id = p_turn_id;
  if v_live_id is null then
    return;
  end if;
  if v_current_turn_id is distinct from p_turn_id then
    -- 過去（または未来）のターン：現在表示中のターンではないため何もしない。
    return;
  end if;

  select participant_id into v_pending
    from public.answers
    where turn_id = p_turn_id and revealed_at is null
    order by created_at asc
    limit 1;

  select exists (
    select 1 from public.answers
    where turn_id = p_turn_id
      and (revealed_at is null or (revealed_at is not null and resolved = false))
  ) into v_busy;

  -- 新規行はrevision=1（列のdefault）から始まり、既存行を更新するたびに
  -- revisionを+1する（同一ライブ内でターンが変わっても、行はPK=live_idで
  -- 使い回されるため、リセットされず単調に増え続ける）。
  insert into public.answering_cues (live_id, turn_id, pending_participant_id, busy, updated_at)
  values (v_live_id, p_turn_id, v_pending, v_busy, now())
  on conflict (live_id) do update
    set turn_id = excluded.turn_id,
        pending_participant_id = excluded.pending_participant_id,
        busy = excluded.busy,
        revision = public.answering_cues.revision + 1,
        updated_at = now();
end;
$$;

-- answersのinsert/reveal/確定のたびに、そのターンのcueを再計算する。
create function public._answers_sync_answering_cue()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.recompute_answering_cue_for_turn(coalesce(new.turn_id, old.turn_id));
  return coalesce(new, old);
end;
$$;

create trigger answers_sync_answering_cue_ins
  after insert on public.answers
  for each row execute function public._answers_sync_answering_cue();

create trigger answers_sync_answering_cue_upd
  after update of revealed_at, resolved on public.answers
  for each row execute function public._answers_sync_answering_cue();

-- 司会が次のターンへ進めた瞬間（lives.current_turn_idの変更）にも、新しい
-- ターンぶんのcueへ切り替える（新ターンはまだ回答が無いのでpending=null・
-- busy=falseへ自然にリセットされる）。advanceIfDueの「turns.status更新→
-- lives更新」という2段階のうち後段（lives更新）に反応するため、cue自体は
-- 常にlives.current_turn_idと同期した状態になる。
create function public._lives_sync_answering_cue()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.current_turn_id is not null and new.current_turn_id is distinct from old.current_turn_id then
    perform public.recompute_answering_cue_for_turn(new.current_turn_id);
  end if;
  return new;
end;
$$;

create trigger lives_sync_answering_cue_upd
  after update of current_turn_id on public.lives
  for each row execute function public._lives_sync_answering_cue();

-- トリガー専用関数・内部ヘルパーはクライアントから直接呼ぶ用途が無いため、
-- デフォルトの挙動だけに頼らず明示的にEXECUTEを剥奪する（P1-7と同じ多層防御）。
revoke execute on function public.recompute_answering_cue_for_turn(uuid) from public, anon, authenticated;
revoke execute on function public._answers_sync_answering_cue() from public, anon, authenticated;
revoke execute on function public._lives_sync_answering_cue() from public, anon, authenticated;

-- ============================================================
-- 5) バックフィル：本migration適用時点で既に進行中のライブ（current_turn_idが
--    設定済み）がある場合、以後トリガーが発火するまでanswering_cuesが空の
--    ままになってしまう。既存の各ライブについて、現在表示中のターンぶんの
--    cueをこの場で1回だけ作っておく（過去ターンは対象にしない＝上の
--    recompute_answering_cue_for_turn自体がlives.current_turn_idとの一致を
--    要求するため、current_turn_id以外を渡しても無視されて安全）。
-- ============================================================
do $$
declare
  v_live record;
begin
  for v_live in select id, current_turn_id from public.lives where current_turn_id is not null loop
    perform public.recompute_answering_cue_for_turn(v_live.current_turn_id);
  end loop;
end $$;

-- Realtime配信対象に追加する（0007等と同様のパターン）。
alter publication supabase_realtime add table public.answering_cues;

commit;
