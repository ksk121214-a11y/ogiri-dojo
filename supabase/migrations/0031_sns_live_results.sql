-- 寄合帳（SNS）に「ライブ結果」を追加する。
-- 終了済み(current_phase='closed')かつ運営がSNS公開したライブについて、1〜3位の
-- 最高得点回答（同点はすべて）・満点回答・運営ベストを寄合帳に掲載する。
--
-- 設計方針：
-- - ライブ進行系テーブル(lives/groups/topics/turns/participants/answers/scores)は
--   一切ALTER/DROPしない（読み取り専用で参照するのみ）。順位・満点は保存せず、
--   運営画面を開くたびに動的に再計算する（0001の採点方式＝0〜3点・審査対象は
--   別組プレイヤー全員、をそのまま使う。固定の満点定数は持たない）。
-- - 公開フラグは新設せず、既存のlives.results_published（0017で追加済み、
--   これまで参照箇所が無かった「死んでいたトグル」）をそのままSNS公開フラグとして使う。
-- - ライブの回答(answers)はsns_answersとは別テーブル・別FKのため、いいね・コメントは
--   sns_answer_likes/sns_commentsを流用せず、同じ設計パターンの専用テーブルを新設する。
--
-- 直前の実行が途中で失敗した場合に備え、安全にやり直せるよう先頭でクリーンアップする
-- （0021/0030の流儀）。依存が深い順（コメント→いいね→回答管理→本体）にdropする。
drop table if exists public.sns_live_result_comments cascade;
drop table if exists public.sns_live_result_likes cascade;
drop table if exists public.sns_live_result_answers cascade;
drop table if exists public.sns_live_results cascade;
drop function if exists public.sns_live_result_likes_sync() cascade;

-- ============================================================
-- sns_live_results: ライブ結果1件＝1ライブ（unique(live_id)で二重作成防止）。
-- ============================================================
create table public.sns_live_results (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null unique references public.lives (id) on delete cascade,
  manager_best_answer_id uuid references public.answers (id) on delete set null,
  manager_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.sns_live_results enable row level security;

-- 一般ユーザーは公開済み(lives.results_published=true)のライブの分だけ閲覧可。
-- 運営は下書き段階から全部見える（掲載内容の確認・プレビュー用）。
create policy "sns_live_results_select" on public.sns_live_results for select
  using (
    is_host()
    or exists (select 1 from public.lives l where l.id = live_id and l.results_published)
  );

create policy "sns_live_results_all_host" on public.sns_live_results for all
  using (is_host())
  with check (is_host());

-- ============================================================
-- sns_live_result_answers: 掲載回答の管理（自動抽出候補＋運営の掲載/除外/差し替え状態）。
-- rank: 1〜3位代表ならその順位、代表ではない満点候補ならnull。
-- 「満点」は列を持たず、answers.judge_count>0 and top_score_votes=judge_countで都度判定する。
-- ============================================================
create table public.sns_live_result_answers (
  id uuid primary key default gen_random_uuid(),
  live_result_id uuid not null references public.sns_live_results (id) on delete cascade,
  answer_id uuid not null references public.answers (id) on delete cascade,
  rank smallint check (rank in (1, 2, 3)),
  included boolean not null default true,
  source text not null default 'auto' check (source in ('auto', 'manual')),
  likes int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (live_result_id, answer_id)
);

alter table public.sns_live_result_answers enable row level security;

create index sns_live_result_answers_live_result_id_idx on public.sns_live_result_answers (live_result_id);
create index sns_live_result_answers_answer_id_idx on public.sns_live_result_answers (answer_id);

create policy "sns_live_result_answers_select" on public.sns_live_result_answers for select
  using (
    is_host()
    or (
      included
      and exists (
        select 1 from public.sns_live_results r
        join public.lives l on l.id = r.live_id
        where r.id = live_result_id and l.results_published
      )
    )
  );

create policy "sns_live_result_answers_all_host" on public.sns_live_result_answers for all
  using (is_host())
  with check (is_host());

-- ============================================================
-- sns_live_result_likes: いいね（sns_answer_likesと同型・ライブ回答向けの別テーブル）。
-- ============================================================
create table public.sns_live_result_likes (
  id uuid primary key default gen_random_uuid(),
  result_answer_id uuid not null references public.sns_live_result_answers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (result_answer_id, user_id)
);

alter table public.sns_live_result_likes enable row level security;

create index sns_live_result_likes_user_id_idx on public.sns_live_result_likes (user_id);

create policy "sns_live_result_likes_select" on public.sns_live_result_likes for select
  using (true);

create policy "sns_live_result_likes_insert_own" on public.sns_live_result_likes for insert
  with check (
    auth.uid() = user_id
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_permanently_suspended or (p.suspended_until is not null and p.suspended_until > now()))
    )
    and exists (
      select 1 from public.sns_live_result_answers ra
      join public.sns_live_results r on r.id = ra.live_result_id
      join public.lives l on l.id = r.live_id
      where ra.id = result_answer_id and ra.included and l.results_published
    )
  );

create policy "sns_live_result_likes_delete_own" on public.sns_live_result_likes for delete
  using (auth.uid() = user_id);

-- sns_live_result_answers.likesをinsert/delete時にトリガーで自動更新する
-- （sns_answer_likes_sync()と同じ設計。クライアントからlikesを直接updateさせない）。
create function public.sns_live_result_likes_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.sns_live_result_answers set likes = likes + 1 where id = new.result_answer_id;
  elsif tg_op = 'DELETE' then
    update public.sns_live_result_answers set likes = likes - 1 where id = old.result_answer_id;
  end if;
  return null;
end;
$$;

create trigger sns_live_result_likes_after_change
  after insert or delete on public.sns_live_result_likes
  for each row execute function public.sns_live_result_likes_sync();

-- ============================================================
-- sns_live_result_comments: コメント（sns_commentsと同型・ライブ回答向けの別テーブル）。
-- 本人による編集は不可、非表示・削除は運営のみ（既存のsns_commentsと同じ方針）。
-- ============================================================
create table public.sns_live_result_comments (
  id uuid primary key default gen_random_uuid(),
  result_answer_id uuid not null references public.sns_live_result_answers (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  is_hidden boolean not null default false,
  hidden_reason text,
  hidden_by uuid references public.profiles (id) on delete set null,
  hidden_at timestamptz
);

alter table public.sns_live_result_comments enable row level security;

create index sns_live_result_comments_result_answer_id_idx on public.sns_live_result_comments (result_answer_id);

create policy "sns_live_result_comments_select" on public.sns_live_result_comments for select
  using (
    is_host()
    or (
      not is_hidden
      and exists (
        select 1 from public.sns_live_result_answers ra
        join public.sns_live_results r on r.id = ra.live_result_id
        join public.lives l on l.id = r.live_id
        where ra.id = result_answer_id and ra.included and l.results_published
      )
    )
  );

create policy "sns_live_result_comments_insert_own" on public.sns_live_result_comments for insert
  with check (
    auth.uid() = author_id
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.is_permanently_suspended or (p.suspended_until is not null and p.suspended_until > now()))
    )
    and exists (
      select 1 from public.sns_live_result_answers ra
      join public.sns_live_results r on r.id = ra.live_result_id
      join public.lives l on l.id = r.live_id
      where ra.id = result_answer_id and ra.included and l.results_published
    )
  );

create policy "sns_live_result_comments_write_host" on public.sns_live_result_comments for update
  using (is_host())
  with check (is_host());

create policy "sns_live_result_comments_delete_host" on public.sns_live_result_comments for delete
  using (is_host());

-- ============================================================
-- reports.target_typeにライブ結果コメントの通報種別を追加する（既存の制約を差し替えるのみ）。
-- 回答カード自体（1〜3位代表・満点・運営ベスト）は運営が公開前に精査済みのため通報対象にしない。
-- ============================================================
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('sns_topic', 'sns_answer', 'sns_comment', 'live_result_comment'));
