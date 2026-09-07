-- セキュリティレビュー対応 P1（7番）：
-- ローカルPostgreSQLで、publicスキーマの全関数についてPUBLICロールの実行権限
-- （has_function_privilege('public', ...)）を実際に確認したところ、以下の
-- パターンの消し忘れが体系的に見つかった。
--
--   select p.proname, p.proacl, has_function_privilege('public', p.oid, 'EXECUTE')
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public';
--
-- 【重要な実例】0046_share_click_events_require_login.sqlは
--   revoke execute on function public.log_share_click(text) from anon;
-- という「anon対策」のつもりの1文だけで完結していたが、この関数を作った
-- 0045側でPUBLICからのrevokeが行われておらず、PostgreSQLのGRANT/REVOKEは
-- 「特定ロールから外す」だけでは効かず、PUBLICが持っている限りどのロールも
-- 実行できてしまう（REVOKEに「特定ロールだけ拒否する」という否定の意味は無い）。
-- 実際にローカルで`set role anon; select log_share_click('live_schedule');`が
-- 成功してしまうことを確認した＝0046の対策は当時から一度も効いていなかった。
-- 同じ理由で、submit_sns_topic/submit_sns_answer（0043）・submit_sns_comment
-- （0058）・participant_display_names（0011）・send_tsukkomi（0044）・
-- set_live_schedule_role（0024）・set_sns_live_result_manager_best（0037）・
-- sns_author_names（0021、こちらはauthenticated/anon個別に明示グラント済みだが
-- PUBLIC自体も残っていた）も同様にPUBLICの実行権限が残ったままだった。
-- いずれも関数内部でauth.uid()やis_host()を検証しているため直接の悪用は
-- 防がれていたが、多層防御として塞ぐ。
--
-- また、handle_new_user・set_answer_live_id・sns_answer_likes_sync・
-- sns_live_result_likes_syncの4つはトリガー専用関数で、クライアントから直接
-- 呼び出す用途は無いにもかかわらずPUBLICの実行権限が残ったままだった
-- （トリガーの発火自体はDML実行者のEXECUTE権限を必要としないPostgreSQLの
-- 仕様のため、これらのrevokeを行ってもトリガーの動作には一切影響しない）。
--
-- 【対応】
-- 1) ALTER DEFAULT PRIVILEGESで、今後このロールが作成する関数は
--    デフォルトでPUBLICに実行権限を与えないようにする（今回のような
--    「grantはしたがrevokeを書き忘れる」というヒューマンエラーの再発を、
--    今後は「明示的にgrantしない限り誰も呼べない」という安全な既定値で防ぐ）。
--    注意：ALTER DEFAULT PRIVILEGESはこれを実行するロール自身が以後作成する
--    オブジェクトにしか効かない。本番Supabaseで全migrationsを適用している
--    ロール（通常はpostgres、または管理者アカウント）で本migrationを適用する
--    限り、以後の新しい関数はこの既定値の対象になる。
-- 2) 既存の関数のうち、is_host()は例外として残す（PUBLIC実行可のまま）。
--    RLSポリシーの条件式の中で使われており、ポリシーを評価するロール自身が
--    その関数へのEXECUTE権限を持っていないと、意図したRLS拒否の代わりに
--    「関数の実行権限が無い」という紛らわしいエラーになりかねない。
--    副作用の無い読み取り専用関数で、公開しても実害が無いため除外する。
-- 3) それ以外の「PUBLICの実行権限が残っている」関数は、個別にPUBLICから
--    revokeする（authenticated/anonへの既存の明示的なgrantには影響しない）。
-- 4) トリガー専用の4関数は、authenticated/anon/PUBLICすべてから明示的に
--    revokeする（完全に外部から直接呼べない状態にする）。
--
-- 【レビュー指摘対応（0062適用前）】
-- answer_count_for_turn(uuid, uuid)は当初is_host()と同様にPUBLIC実行可の
-- まま残す方針にしていたが、この関数はSECURITY DEFINERであり、かつ
-- クライアントから直接呼ぶ用途が無い（RLSポリシーの内部でしか使われない）
-- ため、「PUBLIC/anonのまま残す実益」が無い一方、匿名ユーザーが任意の
-- turn_id・participant_idの組み合わせで「何件回答したか」を照会できてしまう
-- 情報推測のリスクがあった。authenticatedにだけ許可し、さらに関数内部でも
-- 「呼び出し本人の参加者行、またはis_host()」だけに絞る（answers_insert_
-- own_as_playerポリシーが実際に呼ぶ時は常に呼び出し本人の参加者IDが渡される
-- ため、この制限はRLSの正規経路には影響しない）。

begin;

-- ============================================================
-- 1) 今後の関数のデフォルトを「非公開」にする。
-- ============================================================
alter default privileges in schema public
  revoke execute on functions from public;

-- ============================================================
-- 2a) 既存関数のうち、RLSポリシーから参照されるため意図的に除外するもの：
--     is_host() → 何もしない（コメントのみ）。
-- ============================================================

-- ============================================================
-- 2b) answer_count_for_turnはPUBLIC/anonから完全に外し、authenticatedにのみ
--     許可した上で、関数内部でも「呼び出し本人の参加者行、またはis_host()」
--     だけに絞る（レビュー指摘対応）。ロジック（回答数のカウント）自体は
--     変更しない。
-- ============================================================
create or replace function public.answer_count_for_turn(p_turn_id uuid, p_participant_id uuid)
returns int
language plpgsql
security definer set search_path = public
stable
as $$
declare
  v_count int;
begin
  if not (
    is_host()
    or exists (
      select 1 from public.participants p
      where p.id = p_participant_id and p.user_id = auth.uid()
    )
  ) then
    raise exception 'not authorized';
  end if;

  select count(*)::int into v_count
  from public.answers
  where turn_id = p_turn_id and participant_id = p_participant_id;

  return v_count;
end;
$$;

revoke execute on function public.answer_count_for_turn(uuid, uuid) from public, anon;
grant execute on function public.answer_count_for_turn(uuid, uuid) to authenticated;

-- ============================================================
-- 3) PUBLICの実行権限が残っている既存RPCから、PUBLICだけを外す
--    （authenticated/anonへの既存grantはそのまま維持）。
-- ============================================================
revoke execute on function public.log_share_click(text) from public;
revoke execute on function public.participant_display_names(uuid) from public;
revoke execute on function public.send_tsukkomi(uuid, text, text) from public;
revoke execute on function public.set_live_schedule_role(uuid, text) from public;
revoke execute on function public.set_sns_live_result_manager_best(uuid, uuid) from public;
revoke execute on function public.sns_author_names(uuid[]) from public;
revoke execute on function public.submit_sns_answer(uuid, text) from public;
revoke execute on function public.submit_sns_comment(uuid, text) from public;
revoke execute on function public.submit_sns_topic(text) from public;

-- ============================================================
-- 4) トリガー専用関数を完全に非公開にする（クライアントから直接呼ぶ用途が
--    無いことをpg_proc.prorettype='trigger'で確認済み）。
--    レビュー指摘対応：これら4関数はpublic/anon/authenticatedいずれも
--    元々個別のEXECUTE grantを持たず、PUBLICの既定権限だけに乗っていたため
--    「PUBLICからのrevoke」だけでも実質的にauthenticated/anonも道連れで
--    到達不能になっていた。ただし、この効果はPUBLICの権限状態に暗黙に
--    依存しており、将来anon/authenticatedへ個別のEXECUTE grantが誤って
--    追加された場合には塞がらない。誤解を招かないよう、コメント通りに
--    3ロールすべてから明示的にrevokeする。
-- ============================================================
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.set_answer_live_id() from public, anon, authenticated;
revoke execute on function public.sns_answer_likes_sync() from public, anon, authenticated;
revoke execute on function public.sns_live_result_likes_sync() from public, anon, authenticated;

commit;
