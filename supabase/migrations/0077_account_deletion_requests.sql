-- アプリ内から安全にアカウント削除を申請できるようにする専用テーブル＋RPC。
--
-- 背景：これまでの「メール本文に高座名とXの@IDを書く」方式は、いずれも公開
-- 情報のため、他人になりすまして削除依頼を送れてしまう。またゲストにはXの
-- @IDが無い。今回、ログイン中の本会員・ゲストがアプリ内から申請すると、
-- 現在の認証済みユーザーID（auth.uid()）にDB側で結び付いた申請番号が発行され、
-- メールで問い合わせる場合もその番号だけを本文に載せれば済むようにする
-- （パスワード等の認証情報は一切書かせない）。
--
-- 設計方針：
-- - user_idはon delete set null（reports.reporter_idと同じ流儀）。実際にアカウントが
--   削除された後も、申請記録自体は運営の監査のために残す（0078のトリガーが、
--   アカウント削除時にpendingの申請をcompletedへ自動更新する）。
-- - 申請の作成はcreate_account_deletion_request()経由のみ。auth.uid()を関数内で
--   取得するため、クライアントから任意のuser_idを指定できない。
--
-- 2026-09-25（本番未適用のため0077自体を再監査対応で修正。0078以降は作らない）：
-- 【問題1】SELECTしてからINSERTする実装だったため、複数タブ・複数端末から
-- 同時実行されるとpending申請が複数作られ得た（TOCTOU競合）。
-- 【対応1】user_idにpending状態だけを対象にした部分一意インデックスを設け、
-- INSERT ... ON CONFLICT ... DO NOTHINGで原子的に「無ければ作る、あれば何もしない」
-- を1文で行う競合安全な実装にする。
-- 【問題2】管理者向けのFOR ALL is_host()ポリシーでは、監査記録であるにも
-- かかわらずuser_id・request_number・requested_at・processed_by・行そのものを
-- 運営者が直接改ざん・削除できてしまった。
-- 【対応2】FOR ALLポリシーを廃止し、運営者にはSELECTのみ許可する。
-- INSERT/UPDATE/DELETEの直接操作はanon/authenticatedから明示的にrevokeし、
-- 状態変更（status・admin_memoのみ）はis_host()を検証する専用のsecurity
-- definer RPC（admin_update_account_deletion_request）経由に限定する。
-- completedは0078の削除トリガーだけが設定し、このRPCではcompletedへの遷移を
-- 拒否する。completed済みの行はstatusを一切変更できない（admin_memoの追記・
-- 修正のみ許可する）。rejected→pendingへ戻す操作は、user_idが残っている場合
-- （＝アカウントがまだ削除されていない場合）だけ許可する。状態変更は
-- admin_action_logsへの記録も含めて同一トランザクションで行う。
--
-- 2026-09-25（再々監査対応）：以下を追加で修正した。
-- 【問題3】pendingへ戻す操作（rejected→pending）でもprocessed_at=now()・
-- processed_by=auth.uid()を設定していたため、「未対応」なのに処理日時・
-- 処理者が表示されてしまっていた。また、同じstatusへの変更（pending→pending
-- 等）でも処理日時が書き換わり、無意味な監査ログが増え得た。
-- 【対応3】rejected→pendingでは逆にprocessed_at・processed_byをNULLへ戻す。
-- 同じstatusへの変更は状態・処理日時・処理者を一切更新せず、監査ログも
-- 増やさない（admin_memoだけの更新は許可する）。あわせて、completed済みの
-- 行でもadmin_memoの追記・修正は可能という方針を明記し、以前の「completed
-- 済みの行はこのRPCで一切変更できない」という不正確なコメントを修正した。

begin;

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  request_number text not null unique,
  status text not null default 'pending' check (status in ('pending', 'completed', 'rejected')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references public.profiles (id) on delete set null,
  admin_memo text
);

create index account_deletion_requests_user_id_idx on public.account_deletion_requests (user_id);
create index account_deletion_requests_status_idx on public.account_deletion_requests (status);

-- 同一ユーザーがpending中の申請を複数持てないようにするDB制約（部分一意
-- インデックス）。TOCTOU競合（複数タブ・複数端末からの同時申請）でも、DBが
-- 必ず1件しか許さない。user_id is not nullを条件に含めるのは、削除実行後
-- （user_idがset nullでNULL化された後）の申請行を対象から除外するため。
create unique index account_deletion_requests_one_pending_per_user
  on public.account_deletion_requests (user_id)
  where status = 'pending' and user_id is not null;

alter table public.account_deletion_requests enable row level security;

create policy "account_deletion_requests_select_own" on public.account_deletion_requests for select
  using (auth.uid() = user_id);

-- 運営者にはSELECTのみ許可する（監査記録のため、直接UPDATE/DELETEはRLSでも
-- 許可しない。状態変更は下記のadmin_update_account_deletion_request経由のみ）。
create policy "account_deletion_requests_select_host" on public.account_deletion_requests for select
  using (is_host());

-- 一般ロールへのINSERT/UPDATE/DELETEは明示的にrevokeする（運営者を含め、
-- テーブルへの直接書き込みは一切許可しない。書き込みは全てsecurity definer
-- 関数経由に限定する）。
revoke insert, update, delete on public.account_deletion_requests from anon, authenticated;

create function public.create_account_deletion_request()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_number text;
  v_inserted_number text;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  v_number := to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  -- account_deletion_requests_one_pending_per_userと同じ条件をON CONFLICTの
  -- ターゲットに指定することで、「pending中の申請が無ければ作る、既にあれば
  -- 何もしない」を1つのINSERT文で原子的に行う（SELECT→INSERTの間に競合が
  -- 入り込む隙が無い）。
  insert into public.account_deletion_requests (user_id, request_number)
    values (auth.uid(), v_number)
    on conflict (user_id) where status = 'pending' and user_id is not null
    do nothing
    returning request_number into v_inserted_number;

  if v_inserted_number is not null then
    return v_inserted_number;
  end if;

  -- 競合により何も挿入されなかった（＝既にpending中の申請がある）ため、
  -- その申請番号をそのまま返す。
  select request_number into v_inserted_number
    from public.account_deletion_requests
    where user_id = auth.uid() and status = 'pending'
    order by requested_at desc
    limit 1;

  return v_inserted_number;
end;
$$;

revoke execute on function public.create_account_deletion_request() from public;
revoke execute on function public.create_account_deletion_request() from anon;
grant execute on function public.create_account_deletion_request() to authenticated;

-- 運営者向けの状態変更・運営メモ保存RPC。変更可能列をstatus・admin_memoに
-- 限定し、completedへの遷移とcompleted済み行のstatus変更を拒否する。
-- 【方針の確定（2026-09-25再々監査対応）】completed済みの行でも、admin_memo
-- （運営メモ）の追記・修正だけは可能とする（statusは一切変更できない）。
-- 「completed済みの行はこのRPCで一切変更できない」という以前のコメントは
-- 不正確だった（memo更新はstatus変更のif分岐の外にあり、実際には常に許可
-- されていた）ため、コード・コメント・テストをこの方針に統一する。
-- status変更はadmin_action_logsへの記録も含めて同一トランザクションで行う。
-- 【状態遷移の確定（2026-09-25再々監査対応）】
--   - pending→rejected：processed_at=now()・processed_by=auth.uid()を設定し、
--     ログを1件記録する。
--   - rejected→pending：「未対応に戻す」操作であり、運営が処理した記録ではない
--     ため、processed_at・processed_byはNULLへ戻す（now()/auth.uid()を
--     設定しない）。再開の事実自体はログへ記録する。
--   - 同じstatusへの変更（pending→pending・rejected→rejected）：何もしない
--     （status・processed_at・processed_byを更新せず、監査ログも増やさない）。
--     同時にadmin_memoが渡された場合は、メモの更新だけ行ってよい。
create function public.admin_update_account_deletion_request(
  p_request_id uuid,
  p_status text default null,
  p_admin_memo text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.account_deletion_requests%rowtype;
begin
  if not is_host() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_row from public.account_deletion_requests where id = p_request_id for update;
  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if p_status is not null then
    -- completedは0078の削除トリガー（handle_profile_pre_deletion）だけが
    -- 設定する。運営者はcompletedへ直接変更できず、completed済みの行の
    -- statusもこのRPCでは一切変更できない（admin_memoの更新は下記の通り
    -- status変更とは独立に許可される）。
    if p_status not in ('pending', 'rejected') then
      raise exception 'INVALID_STATUS';
    end if;
    if v_row.status = 'completed' then
      raise exception 'CANNOT_MODIFY_COMPLETED';
    end if;
    -- rejected等からpendingへ戻す場合、既にアカウントが削除され
    -- user_idがNULL化されている行は本人性の確認ができないため戻せない。
    if p_status = 'pending' and v_row.user_id is null then
      raise exception 'USER_ID_MISSING';
    end if;

    if p_status <> v_row.status then
      update public.account_deletion_requests
        set status = p_status,
            -- pendingへ戻す＝未対応へ戻すだけの操作であり、運営が「処理した」
            -- 記録ではないためprocessed_at/processed_byはNULLへ戻す。
            -- rejectedへ進める場合だけ、実際に処理した日時・運営者を記録する。
            processed_at = case when p_status = 'pending' then null else now() end,
            processed_by = case when p_status = 'pending' then null else auth.uid() end
        where id = p_request_id;

      insert into public.admin_action_logs (actor_id, action, target_type, target_id, detail)
        values (
          auth.uid(),
          'account_deletion_request_status_changed',
          'account_deletion_requests',
          p_request_id::text,
          jsonb_build_object('request_number', v_row.request_number, 'from_status', v_row.status, 'to_status', p_status)
        );
    end if;
    -- p_status = v_row.status（実質的な変更なし）の場合はここで何もしない
    -- （状態・処理日時・処理者を更新せず、監査ログも増やさない。無意味な
    -- 同一状態への変更で処理日時だけが書き換わることを防ぐ）。
  end if;

  -- admin_memoの更新はstatus変更の成否と独立しており、completed済みの行に
  -- 対しても常に許可する（運営メモは監査記録そのものではなく、運営内部の
  -- 注記であるため）。
  if p_admin_memo is not null then
    update public.account_deletion_requests set admin_memo = p_admin_memo where id = p_request_id;
  end if;
end;
$$;

revoke execute on function public.admin_update_account_deletion_request(uuid, text, text) from public;
revoke execute on function public.admin_update_account_deletion_request(uuid, text, text) from anon;
grant execute on function public.admin_update_account_deletion_request(uuid, text, text) to authenticated;

commit;
