-- 運営画面の事故防止：使用済み（topics.topic_bank_idから参照されている）お題は
-- 過去のライブ履歴を守るため完全削除できないようにする。編集・使用停止・使用再開は
-- 引き続き可能。未使用のお題は今まで通り削除できる。
-- 既存のtopic_bank_write_host（insert/update/delete全部をis_host()だけで許可するfor all
-- ポリシー）をinsert/update用とdelete用に分割し、delete用にだけ「使用されていないこと」を
-- 条件として追加する。

drop policy if exists "topic_bank_write_host" on public.topic_bank;

create policy "topic_bank_insert_host"
  on public.topic_bank for insert
  with check (is_host());

create policy "topic_bank_update_host"
  on public.topic_bank for update
  using (is_host())
  with check (is_host());

create policy "topic_bank_delete_unused_host"
  on public.topic_bank for delete
  using (
    is_host()
    and not exists (
      select 1 from public.topics t where t.topic_bank_id = topic_bank.id
    )
  );
