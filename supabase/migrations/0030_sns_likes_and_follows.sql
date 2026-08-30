-- 寄合帳（SNS）のいいね・フォローを実データ化する。
-- これまではuseSnsStore.ts内のローカルstateのみで管理しており、リロードで消える・
-- 他ユーザーに反映されない状態だった（0021のコメントに明記されていた既知の制限）。
-- お題(sns_topics)へのいいねUIは現状存在しないため、回答(sns_answers)向けのみ新設する。
--
-- 直前の実行が途中で失敗した場合に備え、安全にやり直せるよう先頭でクリーンアップする
-- （0021の流儀を踏襲。この時点でsns_answer_likes/sns_followsにデータは無い前提）。
-- 初回実行時はテーブル自体が存在しないため、先にdrop table ... cascadeでテーブルごと
-- （依存するトリガーも道連れに）削除してから、テーブルに依存しない関数を単独でdropする
-- 順序にする（「drop trigger ... on 存在しないテーブル」は初回実行時にエラーになるため）。
drop table if exists public.sns_answer_likes cascade;
drop table if exists public.sns_follows cascade;
drop function if exists public.sns_answer_likes_sync() cascade;

-- ===== いいね =====
-- user_id/answer_idともにon delete cascade（本人のアカウント削除、または対象回答の
-- 完全削除のいずれでも、意味を失ういいね行は一緒に消えてよい。0021のsns_answersの
-- 削除方針＝運営操作のみと同じ考え方）。
create table public.sns_answer_likes (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references public.sns_answers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (answer_id, user_id)
);

alter table public.sns_answer_likes enable row level security;

-- 件数集計・「自分がいいねしたか」の判定を誰でもできるよう閲覧は開放する
-- （いいねの実在自体はSNSとして一般的な公開情報として扱う）。
create policy "sns_answer_likes_select" on public.sns_answer_likes for select
  using (true);

-- 追加は本人のみ、かつ0023と同じ利用停止チェック（永久停止・期限付き停止中は
-- 新規のSNSアクションをさせない）。
create policy "sns_answer_likes_insert_own" on public.sns_answer_likes for insert
  with check (
    auth.uid() = user_id
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_permanently_suspended or (p.suspended_until is not null and p.suspended_until > now()))
    )
  );

-- 解除（削除）は本人のみ。他人のいいねを勝手に削除できないようにする。
create policy "sns_answer_likes_delete_own" on public.sns_answer_likes for delete
  using (auth.uid() = user_id);

-- 「自分がいいねした回答一覧」取得用（answer_id側はunique制約のインデックスで足りる）。
create index sns_answer_likes_user_id_idx on public.sns_answer_likes (user_id);

-- sns_answers.likes（既存の非正規化カウンタ列）は、このテーブルへのinsert/delete時に
-- トリガーで自動更新する。sns_answers_write_hostポリシー（is_hostのみupdate可）は
-- そのまま維持されるため、一般ユーザーはこのトリガー経由でしかlikesを変えられず、
-- 連打・複数タブによる不整合（クライアントからの直接update）を防げる。
create function public.sns_answer_likes_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.sns_answers set likes = likes + 1 where id = new.answer_id;
  elsif tg_op = 'DELETE' then
    update public.sns_answers set likes = likes - 1 where id = old.answer_id;
  end if;
  return null;
end;
$$;

create trigger sns_answer_likes_after_change
  after insert or delete on public.sns_answer_likes
  for each row execute function public.sns_answer_likes_sync();

-- ===== フォロー =====
-- follower_id/following_idともにon delete cascade（どちらかのアカウントが削除されれば
-- そのフォロー関係自体が無意味になるため）。checkで自分自身のフォローを禁止する。
create table public.sns_follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_id, following_id),
  check (follower_id <> following_id)
);

alter table public.sns_follows enable row level security;

-- フォロー中一覧・フォロワー一覧・件数表示のため、閲覧は誰でも可能にする。
create policy "sns_follows_select" on public.sns_follows for select
  using (true);

create policy "sns_follows_insert_own" on public.sns_follows for insert
  with check (
    auth.uid() = follower_id
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_permanently_suspended or (p.suspended_until is not null and p.suspended_until > now()))
    )
  );

-- 他人のフォロー関係を勝手に解除できないようにする（本人＝follower本人のみ削除可）。
create policy "sns_follows_delete_own" on public.sns_follows for delete
  using (auth.uid() = follower_id);

-- フォロー中一覧（follower_idで検索）・フォロワー一覧＋フォロー中フィード
-- （following_idで検索）の両方向で使う。
create index sns_follows_follower_id_idx on public.sns_follows (follower_id);
create index sns_follows_following_id_idx on public.sns_follows (following_id);

-- ===== 既存テーブルへの一覧・ページネーション用インデックス追加 =====
-- 投稿一覧を「20件ずつ新着順」で取得するクエリ（order by created_at desc limit 20、
-- 2ページ目以降はcreated_at < カーソル）を高速化する。author_id/topic_id/answer_idは
-- プロフィールページの過去の投稿一覧・回答へのツッコミ一覧の絞り込みで使う。
create index if not exists sns_topics_created_at_idx on public.sns_topics (created_at desc);
create index if not exists sns_topics_author_id_idx on public.sns_topics (author_id);
create index if not exists sns_answers_created_at_idx on public.sns_answers (created_at desc);
create index if not exists sns_answers_author_id_idx on public.sns_answers (author_id);
create index if not exists sns_answers_topic_id_idx on public.sns_answers (topic_id);
create index if not exists sns_comments_answer_id_idx on public.sns_comments (answer_id);
