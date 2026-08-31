-- セキュリティ棚卸し（部署横断会議後、初回ライブ実開催前の総点検）で見つかった、
-- 直すべき/直しておいた方がよい3点を対応する。RLS自体の重大な欠陥（過去に何度も
-- あったself-join列名衝突・自己昇格系）は今回の点検では新たには見つからなかった
-- （既存の対策がそのまま効いている）。

-- ============================================================
-- 1) ユーザー投稿テキストの長さ上限をDB側にも設ける。
-- 現状、お題80文字・回答80文字・ツッコミ60文字・一言コメント80文字・表示名10文字などは
-- すべてフロントエンドのUI側（maxLength・JSでの文字数チェック）でしか制限しておらず、
-- Supabaseのanon/authenticatedキーを使って直接REST/RPCを叩けば、アプリのUIを経由せず
-- 任意の長さ（極端な話、数MBの文字列）を投稿できてしまう。これによりストレージの
-- 浪費・表示崩れ・パフォーマンス低下につながりうるため、DB側にも上限を設ける。
-- UIの上限そのものではなく、既存データを壊さないよう十分に余裕を持たせた上限
-- （UIの上限の3〜4倍程度）にしている。UIの文字数表示・制限自体は変更しない。
alter table public.profiles
  add constraint profiles_display_name_length check (char_length(display_name) <= 50);
alter table public.profiles
  add constraint profiles_bio_length check (bio is null or char_length(bio) <= 300);

alter table public.sns_topics
  add constraint sns_topics_body_length check (char_length(body) <= 300);
alter table public.sns_answers
  add constraint sns_answers_body_length check (char_length(body) <= 300);
alter table public.sns_comments
  add constraint sns_comments_body_length check (char_length(body) <= 300);
alter table public.sns_live_result_comments
  add constraint sns_live_result_comments_body_length check (char_length(body) <= 300);

-- ============================================================
-- 2) 利用停止中のアカウントが新しいライブに参加登録できてしまう問題を修正。
-- 0023で「利用停止による制限はSNS投稿のみに適用し、ライブ参加・回答・採点には
-- 適用しない」と意図的に決めたが、これは「進行中のライブから途中で締め出さない」
-- ことが目的であり、「永久停止・一時停止中のアカウントが新しいライブに何度でも
-- 参加登録できる」ことまでは意図していなかった（見直し漏れ）。
-- 今回、join_live（新規のライブ参加登録）だけに制限を追加する。既にどこかのライブに
-- 参加登録済みの行や、進行中のライブへの影響は一切ない（0023の方針は維持する）。
create or replace function public.join_live(p_live_id uuid, p_preferred_role text)
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
  v_row public.participants;
begin
  if p_preferred_role not in ('player', 'audience') then
    raise exception 'INVALID_ROLE';
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

  select kicked_at into v_kicked
    from public.participants
    where live_id = p_live_id and user_id = auth.uid();
  if v_kicked is not null then
    raise exception 'PARTICIPANT_KICKED';
  end if;

  if p_preferred_role = 'player' and v_phase not in ('interlude', 'opening') then
    raise exception 'PLAYER_JOIN_CLOSED';
  end if;

  if v_max is not null and p_preferred_role = 'player' then
    select count(*) into v_count
      from public.participants
      where live_id = p_live_id and preferred_role = 'player';
    if v_count >= v_max then
      raise exception 'PLAYER_LIMIT_REACHED';
    end if;
  end if;

  insert into public.participants (live_id, user_id, preferred_role)
  values (p_live_id, auth.uid(), p_preferred_role)
  on conflict (live_id, user_id) do update set preferred_role = excluded.preferred_role
  returning * into v_row;

  return v_row;
end;
$$;

-- ============================================================
-- 3) 運営操作履歴(admin_action_logs)の改ざん防止。
-- 従来は for all using(is_host()) with check(is_host()) の1本のポリシーだったため、
-- 「運営者であること」しか見ておらず、運営者が複数人になった場合に
-- 「自分以外の運営者が行ったことにして」ログを偽造できてしまう構造だった
-- （src/lib/adminActionLog.tsは常に自分のuidをactor_idにしているため、
-- 正規のアプリ操作では問題は起きていなかったが、RLSとしては穴だった）。
-- 参照・更新・削除は引き続き運営者なら誰でも可能なまま、新規作成(insert)だけ
-- actor_idが自分自身（またはnull）であることを追加で要求する。
drop policy if exists "admin_action_logs_all_host" on public.admin_action_logs;

create policy "admin_action_logs_select_host"
  on public.admin_action_logs for select
  using (is_host());

create policy "admin_action_logs_insert_host"
  on public.admin_action_logs for insert
  with check (is_host() and (actor_id is null or actor_id = auth.uid()));

create policy "admin_action_logs_update_host"
  on public.admin_action_logs for update
  using (is_host())
  with check (is_host());

create policy "admin_action_logs_delete_host"
  on public.admin_action_logs for delete
  using (is_host());
