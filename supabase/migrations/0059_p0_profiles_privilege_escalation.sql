-- セキュリティレビュー対応 P0（1〜4）：
-- ローカルPostgreSQLで0001〜0058を実際に再生し、pg_policies・
-- information_schema.column_privilegesを直接確認したところ、次の致命的な脆弱性が
-- 実在することを確認した（本番でも同じ結果になるはずだが、確定させるため下記の
-- 読み取り専用SQLを本番のSupabase SQL Editorで実行し、一致することを確認してほしい）。
--
--   select table_name, column_name, grantee
--   from information_schema.column_privileges
--   where table_schema='public' and table_name='profiles'
--     and privilege_type='UPDATE' and grantee='authenticated';
--
-- 【原因】0023_user_sanctions.sqlが
--   grant update (role, suspended_until, is_permanently_suspended, admin_memo)
--     on public.profiles to authenticated;
-- を実行していた。コメントには「運営者だけに」という意図が書かれているが、
-- PostgreSQLの列GRANTはロール単位（authenticated＝ログイン中の全員）にしか
-- 効かず、「is_host()なら」という条件は付けられない。一方RLSの
-- profiles_update_own（auth.uid()=id）とprofiles_update_host（is_host()）は
-- 許可（permissive）ポリシー同士でOR結合されるため、"本人の行を更新する"だけで
-- profiles_update_ownのUSING/CHECKを満たしてしまい、列GRANTが許す列（今回の
-- 4列を含む）を本人が自由に書き換えられてしまっていた。
-- 実際に本人のJWTで
--   update profiles set role='admin' where id=auth.uid();
-- を叩けば管理者に自己昇格でき、is_host()に依存する全てのRLS・関数の
-- ガードが無効化される（最も深刻な权限昇格）。
--
-- 【対応方針】
-- 1) authenticatedからこの4列のUPDATE権限を剥奪する（列GRANTを削除するだけで、
--    profiles_update_own/profiles_update_hostというRLSポリシー自体は変更しない
--    ＝他の自己編集可能列(display_name/display_name_set/bio/avatar_*)への影響なし）。
-- 2) 剥奪した4列を書き換える唯一の経路として、is_host()をDB内で検証する
--    SECURITY DEFINER RPCを新設する。管理画面(admin_memo保存・警告・利用停止・
--    永久停止・解除)は、直接のprofiles.update()呼び出しからこのRPC呼び出しに
--    差し替える（アプリ側の対応は別コミットのsrc/app/admin/users/[id]/page.tsx参照）。
-- 3) role列は現状アプリ内に自己昇格の手段が存在しない設計
--    （仕様書§5「DBから手動で立てる必要があり、アプリ内に自己昇格の手段はない」）
--    のため、置き換え用のRPCは設けない。authenticatedからの直接UPDATE経路を
--    塞ぐだけでよい（founderがSupabase側でservice_role相当から直接更新する
--    運用は変わらない）。
--
-- 【レビュー指摘対応（0059適用前）】
-- a) 警告(warning)時のnotifications作成をadmin_apply_user_sanction内の同一
--    トランザクションに含めた。以前はクライアント側で
--    「RPC呼び出し→notifications直接insert」の2回に分かれており、後者が
--    失敗しても呼び出し元は気づかず「警告を送りました」と表示され得た
--    （notifications_insert_hostポリシー自体は元々is_host()限定で安全だったが、
--    "同一トランザクションで記録する"という一貫性の観点での指摘）。
-- b) admin_set_profile_memoの監査ログ(admin_action_logs.detail)には運営メモの
--    全文を保存せず、{"changed": true}という事実だけを記録するようにした
--    （メモ本文はprofiles.admin_memoに既に保存されており、監査ログへの複製は
--    個人情報・機微情報の重複保持を増やすだけで得るものが無いため）。

begin;

-- ============================================================
-- 0) 事前チェック：想定と異なる状態から始まっていないかを確認する。
--    0023以降、この4列のgrantを追加・変更した形跡が無いことを前提にしているため、
--    念のため「今まさにgrantされている」ことを確認してから剥奪する
--    （grantされていない環境で実行しても実害は無いが、想定外の状態に気づけるように
--    しておく）。
-- ============================================================
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'profiles'
    and privilege_type = 'UPDATE' and grantee = 'authenticated'
    and column_name in ('role', 'suspended_until', 'is_permanently_suspended', 'admin_memo');
  if v_count = 0 then
    raise notice '既にauthenticatedはprofiles.role/suspended_until/is_permanently_suspended/admin_memoへのUPDATE権限を持っていません（想定と異なりますが、これから行うrevokeは冪等なので処理は続行します）。';
  end if;
end $$;

-- ============================================================
-- 1) 脆弱性の直接原因を塞ぐ：authenticatedから4列のUPDATE権限を剥奪する。
--    display_name/display_name_set(0003)・bio(0033)・avatar_color/avatar_icon
--    (0007等)は別の列GRANTで独立して許可されているため、この操作では失われない。
-- ============================================================
revoke update (role, suspended_until, is_permanently_suspended, admin_memo)
  on public.profiles from authenticated;

-- ============================================================
-- 2) 管理者専用SECURITY DEFINER RPC。auth.uid()・is_host()をDB内で検証し、
--    通らなければ例外を投げる（PUBLIC/anonからのEXECUTEは明示的に禁止）。
-- ============================================================

-- 運営メモの保存（/admin/users/[id]の「運営メモ」欄）。
create function public.admin_set_profile_memo(p_user_id uuid, p_memo text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'USER_NOT_FOUND';
  end if;

  update public.profiles set admin_memo = p_memo where id = p_user_id;

  -- レビュー指摘：監査ログにメモ本文を複製しない。変更した事実だけを記録する
  -- （本文はprofiles.admin_memoに既に保存されている）。
  insert into public.admin_action_logs (actor_id, action, target_type, target_id, detail)
  values (auth.uid(), 'user_memo_updated', 'profiles', p_user_id::text, jsonb_build_object('changed', true));
end;
$$;

grant execute on function public.admin_set_profile_memo(uuid, text) to authenticated;
revoke execute on function public.admin_set_profile_memo(uuid, text) from public;
revoke execute on function public.admin_set_profile_memo(uuid, text) from anon;

-- 警告・期限付き/永久停止・解除（/admin/users/[id]）。user_sanctions・
-- admin_action_logsへの記録も同一関数内（＝同一トランザクション）で行う
-- （P1の14番「重要な管理操作は処理と同一トランザクションで記録する」に
-- 先取りで対応。以前はprofiles更新→user_sanctions insert→admin_action_logs
-- insertの3回の別々のクライアント呼び出しで、途中で失敗すると記録が
-- 不完全になり得た）。
create function public.admin_apply_user_sanction(
  p_user_id uuid,
  p_type text,
  p_reason text,
  p_detail text default null,
  p_target_ref text default null,
  p_suspend_days int default null,
  -- レビュー指摘対応：warning時にnotificationsへ送る本文。空/null時はp_reasonで
  -- 代用する（クライアント側の従来ロジック"body || reason"と同じ）。
  p_notification_body text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_detail text;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'USER_NOT_FOUND';
  end if;
  if p_type not in ('warning', 'suspend_temporary', 'suspend_permanent', 'lift') then
    raise exception 'INVALID_TYPE';
  end if;
  -- reasonの空文字許容は既存の管理画面の挙動（window.prompt()が空文字を返しても
  -- そのまま記録していた）を変えないための意図的な措置。user_sanctions.reasonは
  -- not nullのため、nullそのものを渡した場合はDBの制約で自然に弾かれる。

  v_detail := p_detail;

  if p_type = 'suspend_temporary' then
    if p_suspend_days is null or p_suspend_days <= 0 then
      raise exception 'INVALID_DAYS';
    end if;
    update public.profiles
      set suspended_until = now() + (p_suspend_days || ' days')::interval
      where id = p_user_id;
    v_detail := coalesce(v_detail, p_suspend_days || '日間');
  elsif p_type = 'suspend_permanent' then
    update public.profiles set is_permanently_suspended = true where id = p_user_id;
  elsif p_type = 'lift' then
    update public.profiles
      set is_permanently_suspended = false, suspended_until = null
      where id = p_user_id;
  elsif p_type = 'warning' then
    -- warningはprofilesの停止列を書き換えず、本人の通知ベルにだけ送る。
    -- レビュー指摘対応：以前はクライアント側で別呼び出しとしてnotificationsへ
    -- insertしており、こちらが失敗しても「警告を送りました」と表示され得た。
    -- user_sanctions/admin_action_logsと同じトランザクションに含め、
    -- どれか1つでも失敗すれば全体がロールバックされ、失敗を必ず呼び出し元に返す。
    insert into public.notifications (user_id, type, title, body)
    values (p_user_id, 'warning', '運営からの警告', coalesce(nullif(p_notification_body, ''), p_reason));
  end if;

  insert into public.user_sanctions (user_id, type, reason, detail, target_ref, created_by)
  values (p_user_id, p_type, p_reason, v_detail, p_target_ref, auth.uid());

  insert into public.admin_action_logs (actor_id, action, target_type, target_id, reason, detail)
  values (
    auth.uid(), 'user_' || p_type, 'profiles', p_user_id::text, p_reason,
    jsonb_build_object('detail', v_detail, 'targetRef', p_target_ref, 'suspendDays', p_suspend_days)
  );
end;
$$;

grant execute on function public.admin_apply_user_sanction(uuid, text, text, text, text, int, text) to authenticated;
revoke execute on function public.admin_apply_user_sanction(uuid, text, text, text, text, int, text) from public;
revoke execute on function public.admin_apply_user_sanction(uuid, text, text, text, text, int, text) from anon;

commit;
