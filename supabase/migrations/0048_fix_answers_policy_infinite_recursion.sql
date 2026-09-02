-- 実機ライブで新たに発覚した「回答を送信すると
-- infinite recursion detected in policy for relation "answers" エラーになる」不具合の修正。
--
-- 原因：answers_insert_own_as_player（0008で内容を確定させて以来ずっと同じ形）は、
-- 「同一ターン・同一参加者の既存回答が5件未満か」を、answersテーブル自身への
-- 自己参照サブクエリ（select count(*) from public.answers a2 where ...）で
-- チェックしていた。この自己参照自体は0008時点から存在し、当時のanswersの
-- SELECTポリシーが単純な using (true)（0001）だったため何の問題も起きなかった。
-- しかし0040で、answersのSELECTポリシーを「運営／そのライブの参加者／寄合帳に
-- 掲載された回答」だけに絞る複雑な条件（他テーブルへのexistsサブクエリを含む）に
-- 変更したことで、この自己参照サブクエリ（a2の行を読む際に適用される）と、今まさに
-- 評価中のINSERTポリシー自身が、PostgreSQL側から見て「answersのポリシー評価が
-- answers自身のポリシー評価を必要としている」循環と判定され、
-- infinite recursion detected in policy for relation "answers" エラーになっていた
-- （0040がリリースされて以降、実際に参加者が回答を送信する場面が今回の実機ライブが
-- 初めてだったため、これまで顕在化していなかったと考えられる）。
--
-- 対処：「同一ターン・同一参加者の既存回答数」の集計をsecurity definer関数に切り出す。
-- security definer関数はテーブル所有者(postgres)の権限で実行されRLSをバイパスするため、
-- ポリシー式の中にanswersへの生の自己参照が残らず、上記の循環が起きなくなる
-- （このプロジェクトで既に採用しているconsume_ticket_for_user等と同じ手法）。
-- 集計結果を使って5件未満かどうか判定するだけの読み取り専用処理であり、
-- 判定条件そのものは変更しない。
create or replace function public.answer_count_for_turn(p_turn_id uuid, p_participant_id uuid)
returns int
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::int
  from public.answers
  where turn_id = p_turn_id
    and participant_id = p_participant_id;
$$;

grant execute on function public.answer_count_for_turn(uuid, uuid) to authenticated;

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
    and public.answer_count_for_turn(turn_id, participant_id) < 5
  );
