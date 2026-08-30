-- 運営者専用管理画面の追加（第3段階）。
-- 寄合帳（SNS）の投稿・回答・コメントの本体データをSupabaseへ移行する
-- （フォロー数・いいねの重複防止等の集計機能までは含めない最小限のDB化）。
-- 既存の「author-xxx」ダミー投稿（src/data/snsData.ts）は表示用にそのまま残し、
-- 新規投稿からここへ実データとして保存する。
-- author_idはon delete cascadeにする（アカウント削除時、要件どおり本人の投稿も
-- 一緒に削除される。hidden_byは非表示操作をした運営者が後日削除されても
-- 投稿自体の非表示状態は残したいのでset nullにする）。
-- 直前の実行が途中のポリシー作成でエラーになり中断した場合に備え、
-- 安全にやり直せるよう先頭でクリーンアップする（この時点でデータは無い前提）。
drop function if exists public.sns_author_names(uuid[]);
drop table if exists public.sns_comments cascade;
drop table if exists public.sns_answers cascade;
drop table if exists public.sns_topics cascade;

create table public.sns_topics (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  is_hidden boolean not null default false,
  hidden_reason text,
  hidden_by uuid references public.profiles (id) on delete set null,
  hidden_at timestamptz
);

create table public.sns_answers (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.sns_topics (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  likes int not null default 0,
  created_at timestamptz not null default now(),
  is_hidden boolean not null default false,
  hidden_reason text,
  hidden_by uuid references public.profiles (id) on delete set null,
  hidden_at timestamptz
);

create table public.sns_comments (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references public.sns_answers (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  is_hidden boolean not null default false,
  hidden_reason text,
  hidden_by uuid references public.profiles (id) on delete set null,
  hidden_at timestamptz
);

alter table public.sns_topics enable row level security;
alter table public.sns_answers enable row level security;
alter table public.sns_comments enable row level security;

-- 非表示以外は誰でも閲覧可、運営者（is_host）は非表示分も含めて全件閲覧可
-- （管理画面での確認用）。
create policy "sns_topics_select" on public.sns_topics for select
  using (not is_hidden or is_host());
create policy "sns_answers_select" on public.sns_answers for select
  using (not is_hidden or is_host());
create policy "sns_comments_select" on public.sns_comments for select
  using (not is_hidden or is_host());

-- 投稿は本人のみ。利用停止中(is_permanently_suspended/suspended_until)の
-- アカウントを投稿できなくする制限は、その列を追加する0023側でこのポリシーを
-- drop&createし直して追加する（この時点ではまだ列が存在せず、ポリシー作成時に
-- 列の存在チェックでエラーになるため、ここでは基本形のみ定義する）。
create policy "sns_topics_insert_own" on public.sns_topics for insert
  with check (auth.uid() = author_id);
create policy "sns_answers_insert_own" on public.sns_answers for insert
  with check (auth.uid() = author_id);
create policy "sns_comments_insert_own" on public.sns_comments for insert
  with check (auth.uid() = author_id);

-- 非表示切替・完全削除は運営操作のみ（本人による編集・削除は今回のスコープ外）。
create policy "sns_topics_write_host" on public.sns_topics for update using (is_host()) with check (is_host());
create policy "sns_topics_delete_host" on public.sns_topics for delete using (is_host());
create policy "sns_answers_write_host" on public.sns_answers for update using (is_host()) with check (is_host());
create policy "sns_answers_delete_host" on public.sns_answers for delete using (is_host());
create policy "sns_comments_write_host" on public.sns_comments for update using (is_host()) with check (is_host());
create policy "sns_comments_delete_host" on public.sns_comments for delete using (is_host());

-- 他ユーザーの投稿者名・アイコンを表示するための安全な経路
-- （生のprofilesは本人の行しか読めないため。既存のparticipant_display_namesと同じパターン）。
create function public.sns_author_names(p_ids uuid[])
returns table (id uuid, display_name text, avatar_icon text, avatar_color text)
language sql
security definer set search_path = public
as $$
  select pr.id, pr.display_name, pr.avatar_icon, pr.avatar_color
  from public.profiles pr
  where pr.id = any(p_ids);
$$;

grant execute on function public.sns_author_names(uuid[]) to authenticated, anon;
