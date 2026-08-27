-- 0001ではlives/turns/answersだけをRealtime配信対象に追加していたため、
-- groups/topics/participants/scoresの変更がクライアントにリアルタイムで届かず、
-- 採点数が反映されない・参加者一覧が更新されない等の不具合が起きていた。
alter publication supabase_realtime add table public.groups;
alter publication supabase_realtime add table public.topics;
alter publication supabase_realtime add table public.participants;
alter publication supabase_realtime add table public.scores;
