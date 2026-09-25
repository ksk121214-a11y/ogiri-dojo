-- アカウント削除で他人の投稿を物理削除しないようにする。
--
-- 問題：sns_topics/sns_answers/sns_commentsのauthor_idはいずれもon delete cascade
-- （0021）。アカウント削除（auth.admin.deleteUser→auth.users削除→profilesが
-- on delete cascadeで連鎖）は、削除された本人の投稿だけでなく、「本人が他人の
-- お題に付けた回答」「本人が他人の回答に付けたツッコミ」まで、行そのものを
-- 物理的に削除してしまう。例：Aのお題にBが回答し、Cがツッコミを付けている状態で
-- Aのアカウントを削除すると、Aのお題が消えることでtopic_idのon delete cascadeが
-- 発生し、B・Cが所有する行まで一緒に消える。
--
-- 対応：
-- 1. author_idをnullable化し、FKをon delete cascade → on delete set nullへ変更する
--    （行そのものは残す。実際の制約名はローカルテストDBの\dで確認済み＝
--    sns_topics_author_id_fkey/sns_answers_author_id_fkey/sns_comments_author_id_fkey）。
-- 2. profilesへのBEFORE DELETEトリガーで、削除される本人が投稿した行
--    （author_id = 削除されるprofiles.id）だけを、既存の論理削除の仕組み
--    （is_hidden/hidden_reason/hidden_at、0021・0067）に沿って非表示化する。
--    他人が所有する行のauthor_idやis_hiddenには一切触れない。
-- 3. 可視性については、0067で追加済みのRLS（sns_answers_select/sns_comments_select
--    が「親のお題/回答が非表示なら子も一般利用者には見えない」という条件に
--    なっている）をそのまま利用する。Aのお題が非表示になれば、B・Cの行は物理的
--    には無傷のまま、一般利用者からは見えなくなる（「親のお題が削除されたため
--    表示できない場合は非表示又は匿名化してよい」という要件を、既存の可視性
--    ロジックの再利用だけで満たす。新しい可視性ロジックは追加しない）。
-- 4. トリガーはprofiles行の削除（auth.usersからのcascade）と同一トランザクション
--    内で実行されるため、「一部の投稿だけ非表示になった」という半端な状態には
--    ならない（cascade自体がPostgresの1トランザクションで完結するため）。
-- 5. ついでに、pending中のaccount_deletion_requests（0077）があれば
--    completedへ更新し、削除処理と申請状態の整合性を保つ。
--
-- 変更しないもの：
-- - sns_answer_likes/sns_follows（0030）のuser_id/follower_id/following_idは
--   on delete cascadeのまま維持する。いいね・フォロー関係の行は「いいねした
--   本人だけが所有するデータ」であり、削除されても相手（いいねされた側の回答・
--   フォローされた側のユーザー）の行には一切影響しないため、変更の必要が無い。
-- - share_click_events.user_id（0041）は既にon delete set nullのため変更不要。

begin;

alter table public.sns_topics alter column author_id drop not null;
alter table public.sns_topics drop constraint sns_topics_author_id_fkey;
alter table public.sns_topics add constraint sns_topics_author_id_fkey
  foreign key (author_id) references public.profiles (id) on delete set null;

alter table public.sns_answers alter column author_id drop not null;
alter table public.sns_answers drop constraint sns_answers_author_id_fkey;
alter table public.sns_answers add constraint sns_answers_author_id_fkey
  foreign key (author_id) references public.profiles (id) on delete set null;

alter table public.sns_comments alter column author_id drop not null;
alter table public.sns_comments drop constraint sns_comments_author_id_fkey;
alter table public.sns_comments add constraint sns_comments_author_id_fkey
  foreign key (author_id) references public.profiles (id) on delete set null;

create function public.handle_profile_pre_deletion()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.sns_topics
    set is_hidden = true, hidden_reason = 'account_deleted', hidden_at = now()
    where author_id = old.id and not is_hidden;

  update public.sns_answers
    set is_hidden = true, hidden_reason = 'account_deleted', hidden_at = now()
    where author_id = old.id and not is_hidden;

  update public.sns_comments
    set is_hidden = true, hidden_reason = 'account_deleted', hidden_at = now()
    where author_id = old.id and not is_hidden;

  update public.account_deletion_requests
    set status = 'completed', processed_at = now()
    where user_id = old.id and status = 'pending';

  return old;
end;
$$;

create trigger profiles_before_delete_hide_content
  before delete on public.profiles
  for each row execute function public.handle_profile_pre_deletion();

commit;
