-- answers_insert_own_as_player のバグ修正。
-- 「同一ターン・同一参加者の既存回答数 < 5」を数えるサブクエリで、
-- answersテーブル自身をa2という別名で自己参照していたため、
-- 修飾なしのturn_id/participant_idがサブクエリ自身(a2)を指してしまい、
-- 常にtrueの自明な比較（a2.turn_id = a2.turn_id）になっていた。
-- 結果として「answersテーブル全体の行数 < 5」という意図しない条件になり、
-- テストが進んでテーブルの行数が5件を超えた時点で新規投稿が全て弾かれていた。
-- 新しく投稿する行（外側）を明示的にanswers.turn_id/answers.participant_idと
-- 書くことで、自己参照の別名(a2)と区別する。
drop policy if exists "answers_insert_own_as_player" on public.answers;

create policy "answers_insert_own_as_player"
  on public.answers for insert
  with check (
    seq between 1 and 5
    and exists (
      select 1
      from public.participants p
      join public.turns t on t.id = turn_id
      join public.lives l on l.id = t.live_id
      where p.id = participant_id
        and p.user_id = auth.uid()
        and p.role = 'player'
        and p.group_id = t.group_id
        and t.status = 'active'
        and l.current_phase = 'answering'
    )
    and (
      select count(*) from public.answers a2
      where a2.turn_id = answers.turn_id
        and a2.participant_id = answers.participant_id
    ) < 5
  );
