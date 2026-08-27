-- 「予約送信」を完全に無くす：1ターンにつき「まだ確定していない(resolved=false)」回答は、
-- 表示前(revealed_at is null)の段階も含めて常に最大1件までに制限する。
-- 0005で追加したanswers_one_active_per_turn（表示中(revealed_at is not null)かつ未確定の
-- みが対象）は、未表示の回答が複数同時に積まれること自体は防げていなかった。これにより、
-- 複数人（本人・ボット含む）がほぼ同じタイミングで送信した場合や、確定直後の一連の演出
-- （回答席が光る→回答が出る→評価→玉が落ちる→フリップが消える→玉が消える→点数が出る→
-- 点数が消える）の途中で次の人が送信できてしまうことがあった。クライアント側のロック表示
-- (lives.answering_paused)はホストのポーリング(最大500ms間隔)を経由するため、伝搬に
-- 遅れが生じうる。DBレベルのこの制約により、伝搬が遅れているタイミングで送信が
-- 試みられても、後から来た方のINSERTは一意制約違反で確実に失敗する。
drop index if exists public.answers_one_active_per_turn;

create unique index answers_one_unresolved_per_turn
  on public.answers (turn_id)
  where resolved = false;
