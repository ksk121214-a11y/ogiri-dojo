-- 0056適用後、実際にSQL Editorから
--   select * from public.audit_rank_reward_mismatches();
-- を呼んだところ「not authorized」で拒否されることが判明した。
--
-- 原因：audit_rank_reward_mismatches()・fix_rank_reward_mismatches()は
-- どちらも「if not is_host() then raise exception」という無条件の
-- チェックだった。is_host()はauth.uid()に基づいて判定するが、Supabaseの
-- SQL Editorはpostgresロールで実行されauth.uid()がnullになるため、
-- どんな管理者アカウントでSQL Editorを開いていても必ずfalseになり、
-- 「まず一覧を確認する」という本来の使い方（コメントに明記済み）自体が
-- できなくなっていた。
--
-- apply_live_rank_rewards()は0034で全く同じ問題への対応として
-- 「auth.uid() is not null and not is_host()」（＝認証情報が無い場合は
-- チェックを素通りさせる）という書き方に既にしていたが、後から追加した
-- audit_rank_reward_mismatches()・fix_rank_reward_mismatches()には
-- この対応が漏れていた。同じパターンに揃える。
--
-- 安全性について：この2関数はどちらも既にPUBLIC/anonからEXECUTEを
-- revoke済み（0055）で、authenticatedロールにしかgrantされていない。
-- 一般の未ログインクライアント(anon key)からはそもそも呼び出せないため、
-- 「auth.uid()がnullの場合だけ素通りさせる」対応を追加しても、
-- 実質SQL Editor（postgresロール）からの保守実行だけがこの経路を通る
-- （apply_live_rank_rewardsと全く同じ安全性の理屈）。
create or replace function public.audit_rank_reward_mismatches()
returns table (
  out_live_id uuid,
  out_sequence_number int,
  out_user_id uuid,
  out_recorded_exists boolean,
  out_recorded_gain int,
  out_recorded_rank int,
  out_correct_exists boolean,
  out_correct_gain int,
  out_correct_rank int,
  out_gain_delta int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not is_host() then
    raise exception 'not authorized';
  end if;

  return query select * from public._compute_rank_reward_mismatches();
end;
$$;

grant execute on function public.audit_rank_reward_mismatches() to authenticated;
revoke execute on function public.audit_rank_reward_mismatches() from public;
revoke execute on function public.audit_rank_reward_mismatches() from anon;

create or replace function public.fix_rank_reward_mismatches(p_live_id uuid)
returns table (out_user_id uuid, out_delta int, out_live_count_delta int)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_live_count_delta int;
begin
  if auth.uid() is not null and not is_host() then
    raise exception 'not authorized';
  end if;

  perform 1 from public.lives where id = p_live_id for update;

  for rec in
    select * from public._compute_rank_reward_mismatches() where out_live_id = p_live_id
  loop
    if rec.out_gain_delta = 0 then
      continue;
    end if;

    v_live_count_delta := 0;
    if not rec.out_recorded_exists and rec.out_correct_exists then
      v_live_count_delta := 1;
    elsif rec.out_recorded_exists and not rec.out_correct_exists then
      v_live_count_delta := -1;
    end if;

    update public.profiles set
      mastery_meter = mastery_meter + rec.out_gain_delta,
      total_points = total_points + rec.out_gain_delta,
      points_balance = points_balance + rec.out_gain_delta,
      live_count = greatest(0, live_count + v_live_count_delta),
      award_count_first = award_count_first
        - (case when rec.out_recorded_rank = 1 then 1 else 0 end)
        + (case when rec.out_correct_rank = 1 then 1 else 0 end),
      award_count_second = award_count_second
        - (case when rec.out_recorded_rank = 2 then 1 else 0 end)
        + (case when rec.out_correct_rank = 2 then 1 else 0 end),
      award_count_third = award_count_third
        - (case when rec.out_recorded_rank = 3 then 1 else 0 end)
        + (case when rec.out_correct_rank = 3 then 1 else 0 end)
    where id = rec.out_user_id;

    insert into public.point_history (user_id, live_id, points, mastery, label)
    select rec.out_user_id, p_live_id, rec.out_gain_delta, rec.out_gain_delta,
      '第' || l.sequence_number || '回ライブ ライブ報酬訂正'
        || (case rec.out_correct_rank when 1 then '（1位）' when 2 then '（2位）' when 3 then '（3位）' else '' end)
    from public.lives l where l.id = p_live_id;

    insert into public.rank_reward_corrections (live_id, user_id, corrected_by, points_delta, live_count_delta)
    values (p_live_id, rec.out_user_id, auth.uid(), rec.out_gain_delta, v_live_count_delta);

    out_user_id := rec.out_user_id;
    out_delta := rec.out_gain_delta;
    out_live_count_delta := v_live_count_delta;
    return next;
  end loop;
end;
$$;

grant execute on function public.fix_rank_reward_mismatches(uuid) to authenticated;
revoke execute on function public.fix_rank_reward_mismatches(uuid) from public;
revoke execute on function public.fix_rank_reward_mismatches(uuid) from anon;
