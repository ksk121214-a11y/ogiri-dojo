-- これまでanswers（各回答）・scores（各採点）は、0001から一度も見直されないまま
-- for select using (true) のまま＝ログインさえしていれば、参加した覚えのない
-- 過去の他人のライブも含めて、Supabaseのanon/authenticatedキーを直接叩くだけで
-- 全ライブ・全参加者の生スコア・回答を丸ごと読めてしまう状態だった。
-- 「見られない方がいい」という指示を受け、以下の3者だけに読み取りを絞る。
--   1) 運営(is_host())
--   2) そのライブに実際に参加した本人（player/audienceどちらでも、join_live経由で
--      participants行ができている）。ライブ中の進行・採点・自分のライブの振り返りは
--      これで従来どおり動く。
--   3) （answersのみ）寄合帳の「ライブ結果」に運営が掲載・公開した回答
--      （sns_live_result_answers.included=trueかつlives.results_published=true）。
--      これはsns_live_result_answers_select（0031）が一般公開している条件と
--      全く同じにしてあり、寄合帳のライブ結果機能で今まで見えていたものが
--      見えなくなることはない。scoresは寄合帳のライブ結果機能から一切参照されて
--      いないため、こちらは1)2)のみで絞る。

drop policy if exists "answers_select_all" on public.answers;

create policy "answers_select_participant_host_or_published" on public.answers for select
  using (
    is_host()
    or exists (
      select 1 from public.participants p
      where p.live_id = answers.live_id and p.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.sns_live_result_answers sra
      join public.sns_live_results r on r.id = sra.live_result_id
      join public.lives l on l.id = r.live_id
      where sra.answer_id = answers.id
        and sra.included
        and l.results_published
    )
  );

drop policy if exists "scores_select_all" on public.scores;

create policy "scores_select_participant_or_host" on public.scores for select
  using (
    is_host()
    or exists (
      select 1
      from public.answers a
      join public.participants p on p.live_id = a.live_id
      where a.id = scores.answer_id and p.user_id = auth.uid()
    )
  );
