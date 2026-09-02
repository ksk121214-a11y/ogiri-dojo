-- 0049で追加したturns.eligible_judge_countは、既存の（このマイグレーション適用前から
-- 存在する）turns行にはdefault 0が入る。0は「本物の審査員が0人」と区別が付かないため、
-- 現在進行中のライブがこのマイグレーション適用をまたいだ場合、ScoringPhysicsBoard側で
-- maxBalls=Math.max(3, 0*3)=3となり、実際には審査員が複数いるのに「1人が3点入れた
-- だけで満点」と誤認してしまう。
--
-- ゲーム開始時にプレイヤーの組分けが確定した後は、プレイヤーの人数・組分け自体は
-- 変わらない設計のため、現在のparticipants/groupsから逆算しても値は正しい
-- （0049と同じ計算式：そのターンの組以外のplayer数）。まだeligible_judge_countが
-- 未計算(=0)のまま残っている既存のturns行だけを対象に、現在の参加者データから
-- 埋め直す。
update public.turns t
set eligible_judge_count = (
  select count(*)
  from public.participants p
  where p.live_id = t.live_id
    and p.role = 'player'
    and p.group_id <> t.group_id
)
where t.eligible_judge_count = 0;
