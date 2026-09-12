-- ツッコミボタンの定型文2つを変更する（司会コンソールではなく観客/回答者側の
-- ツッコミボタン、src/data/liveDemoData.tsのTSUKKOMI_TEMPLATES参照）。
--   「そうはならんやろ」→「アホか！」
--   「それは無理あるて」→「上手いこと言うな」
-- 「なんでやねん」「ちょっと待って」はそのまま変更しない。
--
-- public.send_tsukkomi(uuid, text, text)（現行本体は0066、0062はgrant/revokeのみで
-- body再定義なし）は、kind/textの組み合わせをDB側でも固定の許可リストと完全一致
-- 検証しており、フロント側の文言だけ変えてもこの許可リストを合わせて更新しない限り
-- 新しい文言の送信はINVALID_TSUKKOMIで拒否されてしまう。0066は本番適用済みのため
-- 書き換えず、この0069でCREATE OR REPLACEし、許可リストを更新する。
--
-- 移行期間対応：SQLの適用とフロントのデプロイは同時に完了するとは限らず、
-- 既にページを開いたまま古いフロントを表示し続けている参加者がいる可能性がある。
-- そのため、新しい2文言に加えて旧2文言（「そうはならんやろ」「それは無理あるて」）も
-- 許可リストに残し、しばらくの間はどちらの文言でも送信エラーにならないようにする。
-- 画面（TSUKKOMI_TEMPLATES）には新しい4文言だけを表示し、旧2文言をUIへ戻すことは
-- しない。旧2文言の許可リストからの削除は、全ての画面が更新された後に別途行う
-- 将来のマイグレーションに委ねる（今回は削除しない）。
-- 0066にあった以下の仕様はすべてそのまま維持する：
--   - kind/textのNULL明示拒否・許可リスト完全一致
--   - 対象ライブの存在確認・current_phase='answering'確認（lives行をfor updateで
--     ロックしたまま、フェーズ確認からINSERT完了までをアトミックにする）
--   - 参加者確認（kicked_at is null）・1秒レート制限（participants行をfor updateで
--     ロック）
--   - SECURITY DEFINER・search_path固定・PUBLIC/anonからのEXECUTE剥奪・
--     authenticatedのみEXECUTE許可
--   - ロック順序（lives→participants）
create or replace function public.send_tsukkomi(p_live_id uuid, p_kind text, p_text text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_live public.lives%rowtype;
  v_participant_id uuid;
  v_kicked_at timestamptz;
  v_last timestamptz;
begin
  -- kind/textの組み合わせは、実際に画面のボタンから送られる定型文と完全一致させる。
  -- NULLはどの組み合わせとも一致しない（`(NULL, NULL) not in (...)`はNULLになり
  -- if文はfalse扱いされて通ってしまう）ため、明示的に先に弾く。
  if p_kind is null or p_text is null then
    raise exception 'INVALID_TSUKKOMI';
  end if;

  -- 移行期間中は新旧どちらの文言も許可する（上記コメント参照）。
  if (p_kind, p_text) not in (
    ('stamp', 'なんでやねん'),
    ('stamp', 'そうはならんやろ'), -- 旧文言。移行期間中のみ許可（画面には表示しない）。
    ('stamp', 'アホか！'),
    ('stamp', 'ちょっと待って'),
    ('stamp', 'それは無理あるて'), -- 旧文言。移行期間中のみ許可（画面には表示しない）。
    ('stamp', '上手いこと言うな'),
    ('stamp', '爆笑'),
    ('clap', '👏')
  ) then
    raise exception 'INVALID_TSUKKOMI';
  end if;

  -- 対象ライブが存在し、回答受付中であること。for updateでロックし、この
  -- トランザクションがコミットするまで他のフェーズ変更（host_advance_*系、
  -- 0065参照）を待たせることで、フェーズ確認からINSERT完了までをアトミックにする
  -- （フェーズ確認直後に別トランザクションがanswering以外へ進めてしまい、
  -- 既にanswering中でなくなったライブへイベントがINSERTされる、という競合を防ぐ）。
  select * into v_live from public.lives where id = p_live_id for update;
  if not found then
    raise exception 'LIVE_NOT_FOUND';
  end if;
  if v_live.current_phase <> 'answering' then
    raise exception 'LIVE_NOT_SENDABLE';
  end if;

  select p.id, p.kicked_at, p.last_tsukkomi_at
    into v_participant_id, v_kicked_at, v_last
    from public.participants p
    where p.live_id = p_live_id and p.user_id = auth.uid()
    for update;

  if v_participant_id is null then
    raise exception 'NOT_A_PARTICIPANT';
  end if;

  if v_kicked_at is not null then
    raise exception 'NOT_A_PARTICIPANT';
  end if;

  if v_last is not null and now() - v_last < interval '1 second' then
    raise exception 'RATE_LIMITED';
  end if;

  update public.participants set last_tsukkomi_at = now() where id = v_participant_id;

  insert into public.live_tsukkomi_events (live_id, participant_id, kind, text)
    values (p_live_id, v_participant_id, p_kind, p_text);
end;
$$;

revoke execute on function public.send_tsukkomi(uuid, text, text) from public;
revoke execute on function public.send_tsukkomi(uuid, text, text) from anon;
grant execute on function public.send_tsukkomi(uuid, text, text) to authenticated;
