-- 運営者専用「ライブ予定」画面に追加する「全体アンケート集計」用のRPC。
--
-- 【ライブ単位の集計との違い（重要）】
-- 既存のライブ単位の流入アンケート集計（司会コンソール・終了ライブの
-- 「結果を見る」欄、src/lib/referralSurveySummary.ts）は、そのライブに参加した
-- 時点で記録された participants.referral_source（0074）を集計している。
-- 同じ人が複数のライブへ参加すれば、その回数だけ複数のparticipants行に
-- 同じ値が記録される（0074のjoin_liveが毎回引き継いでinsertするため）。
--
-- 今回追加する「全体アンケート集計」は、それとは目的が異なり「サービス全体で
-- 何人がどれに回答したか」を1アカウント＝1票で数えたいものなので、
-- participantsではなく、1アカウントにつき一度だけ確定するprofiles.referral_source
-- （0074でauthenticatedロールへのUPDATE権限を意図的にgrantしておらず、
-- join_live経由の初回回答でしか書き換わらない列）を基準に集計する。
-- participantsから集計すると、複数ライブに参加した人を二重・三重に数えて
-- しまうため、意図的に別のテーブル・別の集計方法にしている。
--
-- 【未回答人数を出さない理由】
-- 現在のボットアカウント（14件）はis_guest=falseの通常プロフィールとして
-- 扱われており、正式なis_bot列や判定手段が無い。ボットはアンケート自体を
-- 一度も見ていないが、referral_sourceがnullのまま（=見た目上は「未回答」）
-- になるため、これを「未回答人数」として表示すると実態と異なる数字になる。
-- 表示名・メールアドレスからボットを推測して除外することもしない（今回の
-- 対応範囲外、将来is_bot列を正式に追加してから対応する）。そのため、この
-- RPC・画面表示のどちらにも未回答人数・対象人数は含めない（回答済みの
-- 内訳と回答済み合計だけを返す）。
--
-- 【権限設計】
-- SECURITY DEFINERで、公開してよいのは「選択肢ごとの件数」と「回答済み合計」
-- だけ（誰が何を回答したかを一切含まない集計値のみ）。関数内部で
-- auth.uid()・is_host()の両方を確認し、未ログイン・一般会員・ゲストは
-- 実行できないようにする。PUBLIC・anonからは明示的にEXECUTEを剥奪し、
-- authenticatedにはEXECUTEを許可した上で、実際の権限判定は関数内部の
-- is_host()にだけ委ねる（0071のadmin_apply_user_sanction等と同じ方針）。
--
-- 0001〜0074は一切書き換えない。
begin;

create or replace function public.admin_referral_survey_summary()
returns table (
  x_count int,
  friend_count int,
  app_count int,
  other_count int,
  answered_total int
)
language plpgsql
security definer set search_path = public
stable
as $$
begin
  -- 未ログイン（auth.uid()が確定しない）を明示的に拒否する。実運用では
  -- anon（EXECUTE権限自体を剥奪済み）が先に弾かれるが、authenticatedロール
  -- なのにuid未確定という想定外の状態でも安全側に倒す。
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;

  -- 運営者（role='admin'）以外は一般会員・ゲストの別を問わず全て拒否する。
  if not is_host() then
    raise exception 'not authorized';
  end if;

  return query
    select
      count(*) filter (where p.referral_source = 'x')::int as x_count,
      count(*) filter (where p.referral_source = 'friend')::int as friend_count,
      count(*) filter (where p.referral_source = 'app')::int as app_count,
      count(*) filter (where p.referral_source = 'other')::int as other_count,
      count(*)::int as answered_total
    from public.profiles p
    where p.is_guest = false
      and p.role <> 'admin'
      and p.referral_source in ('x', 'friend', 'app', 'other');
end;
$$;

grant execute on function public.admin_referral_survey_summary() to authenticated;
revoke execute on function public.admin_referral_survey_summary() from public;
revoke execute on function public.admin_referral_survey_summary() from anon;

commit;
