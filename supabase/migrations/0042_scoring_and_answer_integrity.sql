-- 初回ライブ実開催前レビュー対応（1・2）：
-- 採点(scores)・回答投稿(answers)のRLSが、画面上の操作フローを前提にした最小限の
-- チェックしかしておらず、Supabaseへ直接リクエストすれば「回答表示前の採点」
-- 「採点終了後の採点」「回答確定演出中の予約送信」等が理論上可能だった。
-- 既存の進行データ列（lives.phase_deadline / lives.answering_paused /
-- lives.reveal_sequence_until / lives.current_turn_id / answers.judging_ends_at）は
-- すべて0005/0013で既に用意済みで、RLS側がそれを見ていなかっただけなので、
-- 新しい列は追加せずポリシーの条件を足すだけで対応する。
--
-- 採点0〜3点の4段階（0001のcheck制約）は変更しない。

-- ============================================================
-- 1) 採点(scores)の不正防止
-- ============================================================
-- 採点締切のグレース（judgeGraceMs、src/data/liveRoomTiming.ts）と同じ400msを
-- DB側にも与える。ホスト側もこの猶予までは「まだ確定しない」判断をしているため、
-- ここで一致させないと、UI上は間に合っているのにDBだけ先に締め切ってしまう。
drop policy if exists "scores_insert_own_as_player" on public.scores;

create policy "scores_insert_own_as_player"
  on public.scores for insert
  with check (
    points between 0 and 3
    and exists (
      select 1
      from public.answers a
      join public.turns t on t.id = a.turn_id
      join public.lives l on l.id = t.live_id
      join public.participants p on p.id = judge_participant_id
      where a.id = answer_id
        and p.user_id = auth.uid()
        and p.role = 'player'
        and t.status = 'active'
        and t.id = l.current_turn_id              -- 対象ターンが現在進行中のターンであること
        and l.current_phase = 'answering'
        and a.participant_id <> judge_participant_id -- 自己採点不可
        and p.group_id <> t.group_id               -- 自分の組の出番中は採点不可
        and a.revealed_at is not null              -- 表示前は採点不可
        and a.resolved = false                     -- 確定後は採点不可
        and (
          a.judging_ends_at is null
          or now() <= a.judging_ends_at + interval '400 milliseconds'
        )
    )
  );

-- ============================================================
-- 2) 回答投稿(answers)の締め切り回避防止
-- ============================================================
-- ホストのポーリング間隔（最大500ms、0014のコメント参照）ぶんの猶予を持たせる。
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
        and t.status = 'active'
        and t.id = l.current_turn_id      -- 対象ターンが現在進行中のターンであること
        and l.current_phase = 'answering' -- ライブが回答受付フェーズであること
        and l.answering_paused = false    -- 審査サイクル中の一時停止中は不可
        and (
          l.phase_deadline is null
          or now() <= l.phase_deadline + interval '500 milliseconds'
        )
        and (
          l.reveal_sequence_until is null
          or now() >= l.reveal_sequence_until   -- 回答確定演出中の予約送信を防ぐ
        )
    )
    and (
      select count(*) from public.answers a2
      where a2.turn_id = answers.turn_id
        and a2.participant_id = answers.participant_id
    ) < 5 -- 同一ターンで既に5回投稿済みなら不可
  );
