-- 本番リハに向けた実バックエンド接続（フェーズA・つづき）。
-- 司会役(is_host)だけがlives/groups/topics/turnsへの進行の書き込みと、
-- answersの「表示・確定」を行えるようにする。回答者・審査員本人の書き込みは
-- 0001/0004のポリシーのまま（対象の列だけ広げる/条件を足す）。

-- is_hostかどうかを判定するヘルパー（あちこちのポリシーで使い回すため）。
create function public.is_host()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce((select is_host from public.profiles where id = auth.uid()), false);
$$;

-- lives/groups/topics/turns: 既存のselect_all(using true)はSELECTには残したまま、
-- INSERT/UPDATE/DELETEはis_hostのみ許可する（forallだがSELECTはselect_allとOR結合されるため
-- 引き続き誰でも閲覧可）。
create policy "lives_write_host" on public.lives for all
  using (public.is_host()) with check (public.is_host());

create policy "groups_write_host" on public.groups for all
  using (public.is_host()) with check (public.is_host());

create policy "topics_write_host" on public.topics for all
  using (public.is_host()) with check (public.is_host());

create policy "turns_write_host" on public.turns for all
  using (public.is_host()) with check (public.is_host());

-- participants: 0003でself-updateポリシーを削除済み（role/group_idの自己書き換え防止）。
-- 組分け・役割の割り当ては司会だけが行えるようにし、列もgroup_id/roleだけに絞る。
revoke update on public.participants from authenticated;
grant update (group_id, role) on public.participants to authenticated;

create policy "participants_update_host" on public.participants for update
  using (public.is_host())
  with check (public.is_host());

-- answers: 投稿(INSERT)は本人限定のまま列を絞り、審査対象への昇格(revealed_at等)は
-- 司会だけがUPDATEできるようにする。
revoke insert on public.answers from authenticated;
grant insert (turn_id, participant_id, seq, body) on public.answers to authenticated;

revoke update on public.answers from authenticated;
grant update (revealed_at, judging_ends_at, resolved, judge_count, score_total, top_score_votes, laugh_triggered)
  on public.answers to authenticated;

create policy "answers_update_host" on public.answers for update
  using (public.is_host())
  with check (public.is_host());

-- scores: 「今まさに表示・審査中の回答であること」を投稿条件に追加し、
-- 採点の変更(UPDATE)も同条件で許可する（審査員が締切前に採点を変更できるように）。
drop policy if exists "scores_insert_own_as_player" on public.scores;

create policy "scores_insert_own_as_player"
  on public.scores for insert
  with check (
    exists (
      select 1
      from public.answers a
      join public.turns t on t.id = a.turn_id
      join public.lives l on l.id = t.live_id
      join public.participants p on p.id = judge_participant_id
      where a.id = answer_id
        and p.user_id = auth.uid()
        and p.role = 'player'
        and t.status = 'active'
        and l.current_phase = 'answering'
        and a.participant_id <> judge_participant_id
        and p.group_id <> t.group_id
        and a.revealed_at is not null
        and a.resolved = false
    )
  );

create policy "scores_update_own_as_player"
  on public.scores for update
  using (
    exists (
      select 1 from public.participants p
      where p.id = judge_participant_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.answers a
      join public.turns t on t.id = a.turn_id
      join public.lives l on l.id = t.live_id
      join public.participants p on p.id = judge_participant_id
      where a.id = answer_id
        and p.user_id = auth.uid()
        and p.role = 'player'
        and t.status = 'active'
        and l.current_phase = 'answering'
        and a.participant_id <> judge_participant_id
        and p.group_id <> t.group_id
        and a.revealed_at is not null
        and a.resolved = false
    )
  );
