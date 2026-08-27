-- 幕間の参加登録時に「プレイヤー希望」か「観客希望」かを本人が申告できるようにする。
-- 実際の判定（role列）・組分け（group_id列）は引き続き司会がconfirmGroupingAndBegin
-- で確定するまでは反映しない。preferred_roleはあくまで本人の希望を示すだけの列。
alter table public.participants
  add column preferred_role text not null default 'audience'
    check (preferred_role in ('player', 'audience'));

-- 参加登録(INSERT)には今までrole/group_idを含め全列への書き込み制限が無かった
-- (with_checkはauth.uid()=user_idのみ判定)。自分が演者だ・組はここだと偽って
-- 直接書き込めてしまう穴だったため、INSERTで指定できる列をここで絞る。
-- role/group_idは指定不可になり、常に列のデフォルト('audience'/null)から始まる。
revoke insert on public.participants from authenticated;
grant insert (live_id, user_id, preferred_role) on public.participants to authenticated;

-- 組分け前(group_id is null)に限り、本人がpreferred_roleを気持ちを変えて
-- 書き換えられるようにする。組分け確定後(group_idが入った後)は変更不可。
grant update (preferred_role) on public.participants to authenticated;

create policy "participants_update_own_preference"
  on public.participants for update
  using (auth.uid() = user_id and group_id is null)
  with check (auth.uid() = user_id and group_id is null);
