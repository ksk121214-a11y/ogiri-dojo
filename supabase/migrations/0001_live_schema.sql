-- 爆笑スタジアム ライブ進行スキーマ (MVP: ライブ進行 + ログイン)
-- src/types/liveDemo.ts のダミー版データモデル(LivePhase/DemoGroup/DemoTurn/DemoAnswer/DemoScore等)を
-- そのままDBスキーマに寄せたもの。ガチャ/寄合帳/楽屋/段位/ポイント経済はフェーズ2送りのため対象外。
--
-- 運用方針:
-- - lives/groups/topics/turns の作成・進行(フェーズ遷移)は運営操作のみを想定し、
--   一般ユーザーにはSELECTのみ許可する(書き込みはSupabase Edge Function等のservice_role経由で行う想定)。
-- - participants(参加登録)/answers(回答)/scores(採点)はユーザー自身の行動なので、
--   本人に限定したINSERTを許可する。

-- ============================================================
-- profiles: auth.usersと1:1のプロフィール。演者名・段位等の本格運用はフェーズ2で拡張。
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '名無しの弟子',
  -- ユーザー自身が演者名を決めるまではfalse。falseの間はアプリ側で名前設定モーダルを出す想定。
  display_name_set boolean not null default false,
  x_username text,
  avatar_url text,
  is_banned boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_all"
  on public.profiles for select
  using (true);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- Xログイン等でauth.usersに新規登録された瞬間、profilesの行を自動生成する。
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, x_username, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'user_name', '名無しの弟子'),
    new.raw_user_meta_data ->> 'user_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- lives: 1回のライブ開催。current_phaseはsrc/types/liveDemo.ts の LivePhase に対応
-- (scheduledは開催前の予告状態として追加)。
-- ============================================================
create table public.lives (
  id uuid primary key default gen_random_uuid(),
  scheduled_at timestamptz not null,
  rounds_per_live int not null default 2,
  current_phase text not null default 'scheduled'
    check (current_phase in (
      'scheduled', 'interlude', 'opening', 'topic_reveal',
      'answering', 'group_result', 'final_result', 'closed'
    )),
  current_turn_id uuid,
  created_at timestamptz not null default now()
);

alter table public.lives enable row level security;

create policy "lives_select_all"
  on public.lives for select
  using (true);

-- ============================================================
-- groups: 組(出番順)。DemoGroup相当。
-- ============================================================
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null references public.lives (id) on delete cascade,
  group_order int not null,
  unique (live_id, group_order)
);

alter table public.groups enable row level security;

create policy "groups_select_all"
  on public.groups for select
  using (true);

-- ============================================================
-- topics: お題。DemoTopic相当。formatは仕様書のTopic.format(将来image_caption等へ拡張)。
-- ============================================================
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null references public.lives (id) on delete cascade,
  body text not null,
  format text not null default 'text' check (format in ('text', 'image_caption')),
  created_at timestamptz not null default now()
);

alter table public.topics enable row level security;

create policy "topics_select_all"
  on public.topics for select
  using (true);

-- ============================================================
-- participants: ライブへの参加登録。DemoParticipant相当。
-- role: 'player'=舞台参加, 'audience'=見学のみ(仕様書§7.3: 見学者は採点不可・母数にも含めない)。
-- ============================================================
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null references public.lives (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid references public.groups (id) on delete set null,
  role text not null default 'audience' check (role in ('player', 'audience')),
  joined_at timestamptz not null default now(),
  unique (live_id, user_id)
);

alter table public.participants enable row level security;

create policy "participants_select_all"
  on public.participants for select
  using (true);

create policy "participants_insert_self"
  on public.participants for insert
  with check (auth.uid() = user_id);

create policy "participants_update_self"
  on public.participants for update
  using (auth.uid() = user_id);

-- ============================================================
-- turns: 組×周の1登壇。DemoTurn相当。
-- ============================================================
create table public.turns (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null references public.lives (id) on delete cascade,
  round int not null,
  group_id uuid not null references public.groups (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'active', 'done')),
  unique (live_id, round, group_id)
);

alter table public.turns enable row level security;

create policy "turns_select_all"
  on public.turns for select
  using (true);

-- lives.current_turn_id は turns作成後に外部キーを付ける(循環参照回避)。
alter table public.lives
  add constraint lives_current_turn_fk
  foreign key (current_turn_id) references public.turns (id) on delete set null;

-- ============================================================
-- answers: 回答。DemoAnswer相当。score_total/top_score_votes/judge_countは
-- 審査確定後にEdge Function側で集計・更新する想定(スケーラビリティ方針: バッチ書き込み)。
-- ============================================================
create table public.answers (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null references public.turns (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  seq int not null,
  body text not null,
  score_total int not null default 0,
  top_score_votes int not null default 0,
  judge_count int not null default 0,
  laugh_triggered boolean not null default false,
  created_at timestamptz not null default now(),
  unique (turn_id, participant_id, seq)
);

alter table public.answers enable row level security;

create policy "answers_select_all"
  on public.answers for select
  using (true);

create policy "answers_insert_own_as_player"
  on public.answers for insert
  with check (
    exists (
      select 1 from public.participants p
      where p.id = participant_id
        and p.user_id = auth.uid()
        and p.role = 'player'
    )
  );

-- ============================================================
-- scores: 採点。DemoScore相当。見学者(audience)は採点不可(§7.3)、
-- 自分の回答への自己採点も不可。0〜3点の4段階(2026-07-14改訂)。
-- ============================================================
create table public.scores (
  answer_id uuid not null references public.answers (id) on delete cascade,
  judge_participant_id uuid not null references public.participants (id) on delete cascade,
  points smallint not null check (points between 0 and 3),
  created_at timestamptz not null default now(),
  primary key (answer_id, judge_participant_id)
);

alter table public.scores enable row level security;

create policy "scores_select_all"
  on public.scores for select
  using (true);

create policy "scores_insert_own_as_player"
  on public.scores for insert
  with check (
    exists (
      select 1 from public.participants p
      where p.id = judge_participant_id
        and p.user_id = auth.uid()
        and p.role = 'player'
    )
    and not exists (
      select 1 from public.answers a
      where a.id = answer_id
        and a.participant_id = judge_participant_id
    )
  );

-- ============================================================
-- Realtime配信対象に追加(クライアントがpostgres_changesで購読する)。
-- ============================================================
alter publication supabase_realtime add table public.lives;
alter publication supabase_realtime add table public.turns;
alter publication supabase_realtime add table public.answers;
