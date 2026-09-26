-- 同じ利用者による同じ対象への通報を1件に制限する（reporter_id, target_type, target_id）。
--
-- ・別の利用者は同じ対象を通報できる。同じ利用者でも対象ID／対象種別が違えば通報できる。
-- ・reporter_idがNULLの記録（通報者のアカウント削除後）は制約の対象外（部分インデックス）。
-- ・既存の通報行は一切削除・統合・更新しない。既存に重複があれば、何も変更せず
--   分かりやすいエラーで停止する（トランザクション全体がロールバックされる）。
--
-- 【適用前に実行する読み取り専用の重複確認SQL】（結果が0行なら安全に適用できる）
--   select reporter_id, target_type, target_id,
--          count(*) as report_count,
--          min(created_at) as oldest_at,
--          max(created_at) as newest_at
--     from public.reports
--    where reporter_id is not null
--    group by reporter_id, target_type, target_id
--   having count(*) > 1
--    order by report_count desc, newest_at desc;

begin;

do $$
declare
  v_dup_groups integer;
begin
  select count(*) into v_dup_groups from (
    select 1
      from public.reports
     where reporter_id is not null
     group by reporter_id, target_type, target_id
    having count(*) > 1
  ) d;
  if v_dup_groups > 0 then
    raise exception
      'REPORTS_DUPLICATES_EXIST: 同じ通報者・対象種別・対象IDの通報が重複している組が % 組あります。0080は何も変更せず停止しました。本ファイル先頭の読み取り専用SQLで内容を確認し、運営が対応方針を決めてから再実行してください（自動削除は行いません）。',
      v_dup_groups;
  end if;
end $$;

create unique index reports_unique_per_reporter_target
  on public.reports (reporter_id, target_type, target_id)
  where reporter_id is not null;

commit;
