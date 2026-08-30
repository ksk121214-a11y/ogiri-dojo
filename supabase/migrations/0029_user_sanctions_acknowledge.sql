-- 「退場させられたらユーザー管理に要確認として出て、名前の横に赤い印がつき、
-- 詳細を確認したら消える」の要望対応。
-- user_sanctionsに確認済みかどうかの列を追加する（既存のwarning等の種別には
-- 影響しない。kicked種別だけをこの仕組みで扱う）。
alter table public.user_sanctions
  add column acknowledged_at timestamptz;

-- 運営者が確認済みにできるよう更新を許可する（既存のuser_sanctions_all_hostポリシー
-- はfor allなので追加の許可は不要、GRANT列も特に絞っていないため変更不要）。
