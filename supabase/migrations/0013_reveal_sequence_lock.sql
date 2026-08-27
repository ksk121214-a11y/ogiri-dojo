-- 採点確定後の演出シーケンス（回答フリップが消える→間を置く→採点ボードの玉が消える→
-- 回答席に得点をデジタル表示→しばらく見せる→間を置く→次の人が送信できるようになる）の間、
-- 全クライアントで送信をロックし続けるための締切時刻。
-- useLiveHostStore.ts の resolveIfDue() が採点確定と同時にセットし、
-- isAnsweringBusy()/processRevealQueue() がこの列を見てロック・次のreveal抑止を判断する。
-- RLSポリシーは既存の lives 用ポリシー（is_hostのみ更新可）がそのまま適用されるため追加不要。
alter table public.lives
  add column reveal_sequence_until timestamptz;
