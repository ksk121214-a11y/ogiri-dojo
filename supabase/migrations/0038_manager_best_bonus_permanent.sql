-- 運営ベストの+50は「選ばれた事実」に対する一度きりの永続的な付与とし、
-- 後で選び直しても／「該当なし」に戻しても、既に付与した+50は取り消さないようにする。
-- そのため「今どの回答がmanager_best_answer_idか」ではなく、各回答ごとに
-- 「既に付与済みかどうか」をsns_live_result_answersに記録する方式に変更する。
alter table public.sns_live_result_answers
  add column if not exists manager_best_bonus_granted boolean not null default false;

drop function if exists public.set_sns_live_result_manager_best(uuid, uuid);
create function public.set_sns_live_result_manager_best(p_live_result_id uuid, p_answer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already_granted boolean;
  v_new_user_id uuid;
begin
  if not is_host() then
    raise exception 'not authorized';
  end if;

  if p_answer_id is not null then
    select manager_best_bonus_granted into v_already_granted
    from public.sns_live_result_answers
    where live_result_id = p_live_result_id and answer_id = p_answer_id
    for update;

    -- まだ付与していない回答だけ+50を付与する（同じ回答が後で選び直された場合の
    -- 二重付与を防ぐ。一度付与した相手からは選び直し・取り消しをしても取り消さない）。
    if v_already_granted is not true then
      select p.user_id into v_new_user_id
      from public.answers a join public.participants p on p.id = a.participant_id
      where a.id = p_answer_id;

      if v_new_user_id is not null then
        update public.profiles set
          mastery_meter = mastery_meter + 50,
          total_points = total_points + 50,
          points_balance = points_balance + 50,
          best_answer_count = best_answer_count + 1
        where id = v_new_user_id;

        insert into public.notifications (user_id, type, title, body)
        values (
          v_new_user_id,
          'manager_best',
          '運営ベストに選ばれました',
          '今回のライブの運営ベストに選ばれました。+50ポイント獲得しました。'
        );

        update public.sns_live_result_answers
          set manager_best_bonus_granted = true
          where live_result_id = p_live_result_id and answer_id = p_answer_id;
      end if;
    end if;
  end if;

  -- ポインタの更新のみ。以前の選出者への+50は取り消さない。
  update public.sns_live_results
    set manager_best_answer_id = p_answer_id, updated_at = now()
    where id = p_live_result_id;
end;
$$;

grant execute on function public.set_sns_live_result_manager_best(uuid, uuid) to authenticated;
