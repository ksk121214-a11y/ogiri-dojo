"use client";

import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";
import type { LiveScheduleEntry } from "@/lib/liveSchedulePlan";

export interface LiveSchedulePlanResult {
  previous: LiveScheduleEntry | null;
  current: LiveScheduleEntry | null;
  upcoming: LiveScheduleEntry | null;
  homeUpcoming: LiveScheduleEntry | null;
  loading: boolean;
}

// 運営者専用管理画面の追加：ホーム・次回ライブ画面・カレンダーが参照する
// 「前回・今回・次回・ホームの次回ライブ」を、livesテーブルからの自動判定
// (旧useLiveSchedule.ts)ではなく、運営が/admin/scheduleで手動割り当てた
// live_schedule_entries.display_roleからそのまま取得する。
//
// 2026-08-29の「ホーム画面滞在中もRealtimeが常時DBクエリを発行し続けて重くなる」
// 不具合対応（src/components/home/useLiveJoinFlow.ts参照）を踏襲し、ここでも
// Realtime購読はせず、マウント時の取得＋画面フォーカス復帰・オンライン復帰時の
// 再取得のみに留める。
//
// 2026-08-30:「ホームから/liveに行く時などの画面転換で、チケットの形が一瞬
// 変わって戻る」ちらつき対策。/liveから戻る等でこのフックが再マウントされる
// たびにloading:true・homeUpcoming:nullから始まっていたため、取得が終わるまでの
// 一瞬だけNextLiveTicketが「準備中」の形で表示され、データが揃うと本来のチケット
// 形に切り替わる、という2段階の見た目変化が毎回の画面遷移で見えていた。
// モジュールスコープに前回の取得結果をキャッシュし、次回以降のマウント時は
// それを初期値として使うことで、同一セッション内での再訪問時は最初から正しい
// 見た目で表示できるようにする（キャッシュが無い初回訪問時だけは従来どおり）。
let cachedPlan: LiveSchedulePlanResult | null = null;

export function useLiveSchedulePlan(): LiveSchedulePlanResult {
  const [state, setState] = useState<LiveSchedulePlanResult>(
    () =>
      cachedPlan ?? {
        previous: null,
        current: null,
        upcoming: null,
        homeUpcoming: null,
        loading: true,
      },
  );

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("live_schedule_entries")
      .select("*")
      .in("display_role", ["previous", "current", "upcoming", "home_upcoming"]);
    const rows = (data ?? []) as LiveScheduleEntry[];
    const byRole = (role: string) => rows.find((r) => r.display_role === role) ?? null;
    const next: LiveSchedulePlanResult = {
      previous: byRole("previous"),
      current: byRole("current"),
      upcoming: byRole("upcoming"),
      homeUpcoming: byRole("home_upcoming"),
      loading: false,
    };
    cachedPlan = next;
    setState(next);
  }, []);

  useEffect(() => {
    // マウント時に1回だけ取得する（外部システム=Supabaseとの同期）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", load);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", load);
    };
  }, [load]);

  return state;
}
