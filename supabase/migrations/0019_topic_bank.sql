-- 運営者専用管理画面の追加（第1段階）。
-- お題管理用のマスターテーブル。既存のtopicsは「あるライブで実際に使われたお題」の
-- インスタンス行であり、運営者が事前に登録・編集・使用停止するための一覧管理には
-- 向かないため、別テーブルとして新設する。
create table public.topic_bank (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  format text not null default 'text' check (format in ('text', 'image_caption')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  -- 追加した運営者が後日アカウント削除されても、お題自体は残す。
  created_by uuid references public.profiles (id) on delete set null
);

alter table public.topic_bank enable row level security;

create policy "topic_bank_select_all"
  on public.topic_bank for select
  using (true);

create policy "topic_bank_write_host"
  on public.topic_bank for all
  using (is_host())
  with check (is_host());

-- topics（ライブでの使用実績）から、どのマスターお題を使ったか・
-- 参加者に公開済み（変更に確認が必要）かどうかを追跡できるようにする。
alter table public.topics
  add column topic_bank_id uuid references public.topic_bank (id),
  add column locked boolean not null default false;

-- 既存のsrc/data/liveDemoData.tsのTOPIC_POOL(8件)をそのままシードする。
insert into public.topic_bank (body) values
  ('こんな寄席の司会は嫌だ、どんなの？'),
  ('新装開店した激安ラーメン屋『激安』。値段以外にヤバいところがあるとしたら？'),
  ('宇宙人が地球に来て、一番最初に驚いたこととは？'),
  ('『ここが道場じゃなかったら通報してた』と思った瞬間とは？'),
  ('AIに『大喜利やって』と頼んだら、こんな回答が返ってきて微妙な空気になった。なんて返ってきた？'),
  ('実は幽霊だった落語家。バレたきっかけは？'),
  ('新しい必殺技『座布団投げ』。どんな技？'),
  ('師匠に弟子入りしたら、まさかの修行内容だった。何をさせられた？');
