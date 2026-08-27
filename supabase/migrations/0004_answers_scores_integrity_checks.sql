-- answers/scoresへの投稿に、ゲームの進行状態と整合しているかのチェックを追加する。
-- これまでは「自分の参加者IDで、playerロールか」しか見ておらず、以下が可能だった:
--   - 自分の組の出番でなくても、任意のturn_idに回答を投稿できる
--   - ライブがanswering中でなくても投稿できる
--   - 1ターンに6回以上回答を投稿できる(§1でMAX_ANSWERS_PER_PLAYER=5と定義済み)
--   - 自分の組が舞台に立っている最中でも、その組のメンバーが採点できてしまう
-- これらをwith checkに追加する。ただし本格的な整合性担保は将来Edge Function側で
-- 行う想定（ファイル冒頭コメント参照）であり、これはその手前の防御層という位置づけ。

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
        and p.group_id = t.group_id       -- 自分の組の出番であること
        and t.status = 'active'           -- そのターンが進行中であること
        and l.current_phase = 'answering' -- ライブが回答受付フェーズであること
    )
    and (
      select count(*) from public.answers a2
      where a2.turn_id = turn_id
        and a2.participant_id = participant_id
    ) < 5 -- 同一ターンで既に5回投稿済みなら不可
  );

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
        and a.participant_id <> judge_participant_id -- 自分の回答への自己採点は不可
        and p.group_id <> t.group_id                 -- 自分の組が舞台中は採点できない（審査員は他組・見学側）
    )
  );
