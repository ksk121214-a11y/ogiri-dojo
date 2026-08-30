-- 司会コンソール（/live/host）から、ライブ中の参加者に個別メッセージ（警告用）を
-- 送る機能と、問題行動があった参加者をライブから退場させる機能を追加する。
--
-- 全員向けメッセージ(lives.announcement_message、既存)とは別に、参加者ごとの
-- host_message列を持たせ、本人の画面（AnnouncementBanner）にだけ表示する。
-- kicked_atが入っている間は、本人がそのライブに参加できないようにする
-- （/live/page.tsx側でブロック画面を表示する）。

alter table public.participants
  add column host_message text,
  add column host_message_sent_at timestamptz,
  add column kicked_at timestamptz;

-- 0006_host_write_policiesで「group_id, roleのみ司会が更新できる」に絞っていた
-- 列許可を、今回追加した3列ぶん拡張する。
-- participants_update_hostポリシー（is_host()判定）自体は変更不要。
revoke update on public.participants from authenticated;
grant update (group_id, role, host_message, host_message_sent_at, kicked_at)
  on public.participants to authenticated;
