-- 初回ライブ実開催前レビュー対応（6）：
-- share_click_events（0041で新設）のinsertポリシーが with check (true) のままで、
-- 匿名ユーザーでも任意のuser_id・任意のcontext文字列を挿入でき、分析データを
-- 偽装できた。
--
-- 対応方針：直接INSERTのRLSで頑張るのではなく、security definer RPC
-- （log_share_click）経由の1本に絞る。user_idはRPCが自分でauth.uid()から
-- 取得する（クライアントからは一切渡せない設計にする）ことで、そもそも
-- 「他人になりすます」余地自体を無くす。連打対策の重複チェックは、
-- 一般ユーザーが自分の行すらSELECTできない（一般ユーザーは分析データを
-- SELECTできない、という要件があるため）ことを踏まえ、security definer
-- 関数内でRLSをバイパスして判定する。

drop policy if exists "share_click_events_insert_any" on public.share_click_events;
-- 新しいinsertポリシーは作らない＝直接INSERTは誰にもできず、RPC経由のみになる。

alter table public.share_click_events
  add constraint share_click_events_context_check
  check (context in ('live_schedule', 'live_result', 'final_result'));

create function public.log_share_click(p_context text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if p_context not in ('live_schedule', 'live_result', 'final_result') then
    raise exception 'INVALID_CONTEXT';
  end if;

  -- ログイン中ユーザーの連打（同一context・2秒以内）は静かに無視する
  -- （エラーにしてUXを壊す必要は無い、分析データとして重複を残さなければ十分）。
  -- 匿名クリックは個人を識別できないため、この重複排除の対象にはできない
  -- （残るリスクとして報告する）。
  if v_user_id is not null and exists (
    select 1 from public.share_click_events e
    where e.user_id = v_user_id
      and e.context = p_context
      and e.created_at > now() - interval '2 seconds'
  ) then
    return;
  end if;

  insert into public.share_click_events (context, user_id) values (p_context, v_user_id);
end;
$$;

-- 未ログインでもシェアボタンは押せる（匿名クリックも計測対象のため）ので anon にも許可する。
grant execute on function public.log_share_click(text) to authenticated, anon;
