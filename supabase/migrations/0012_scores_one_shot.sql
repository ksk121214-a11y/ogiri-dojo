-- 採点を「一発勝負」にする：一度投票したら本人でも変更できないようにする。
-- これまではscores_update_own_as_playerで締切前の採点変更を許可していたが、
-- 演出（玉が落ちてくる採点ボード）と挙動を合わせるため、投票は取り消し不可にする。
-- INSERTはprimary key(answer_id, judge_participant_id)により二重投票そのものが
-- 既にDBレベルで弾かれる（クライアントはupsertではなくinsertのみを呼ぶように変更）。
drop policy if exists "scores_update_own_as_player" on public.scores;
revoke update on public.scores from authenticated;
