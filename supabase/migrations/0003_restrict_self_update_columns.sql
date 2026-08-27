-- 「自分の行」なら任意の列を書き換えられてしまう問題への対処。
-- RLSのUSING句は「どの行を触れるか」しか制限せず「どの列を触れるか」は制限しないため、
-- 本人の行に対してであっても is_banned（BAN解除）や participants.role/group_id
-- （見学者から演者への自己昇格・組の勝手な変更）を書き換えられてしまっていた。

-- profiles: 本人が自由に変えてよい列（表示名・表示名設定済みフラグ）だけに
-- UPDATE権限を絞る。is_banned・x_username・avatar_url・idは本人からは変更不可にする
-- （x_username/avatar_urlはXログイン時にhandle_new_user()がsecurity definerで設定する想定）。
revoke update on public.profiles from authenticated;
grant update (display_name, display_name_set) on public.profiles to authenticated;

-- participants: 現状「本人が参加登録後に自分でrole/group_idを書き換えてよい」という
-- 正当な用途が無いため、self-updateポリシー自体を削除する。
-- 組分け・役割（player/audience）の変更は運営操作（service_role経由）に限定する。
drop policy if exists "participants_update_self" on public.participants;
