"use client";

import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";
import type { LiveRow } from "@/lib/liveRoomTypes";

export interface LiveScheduleResult {
  previous: LiveRow | null;
  current: LiveRow | null;
  upcoming: LiveRow | null;
  loading: boolean;
}

// 運営者専用管理画面の追加（第2段階）：ホーム・次回ライブ画面・カレンダーが
// 参照する「前回・今回・次回」のライブを、src/data/liveScheduleData.tsの
// ハードコード定数ではなくlivesテーブルから動的に判定する。
//
// - 前回 = current_phase='closed'の中でscheduled_atが最も新しい1件
// - 今回 = current_phase<>'closed'の中でscheduled_atが最も近い1件
//   （＝準備中/受付中/開催中のいずれか）
// - 次回 = 今回より後にscheduled_atが来る、まだ準備中(current_phase='scheduled')の1件
//
// 2026-08-29の「ホーム画面滞在中もRealtimeが常時DBクエリを発行し続けて重くなる」
// 不具合対応（src/components/home/useLiveJoinFlow.ts参照）を踏襲し、ここでも
// Realtime購読はせず、マウント時の取得＋画面フォーカス復帰・オンライン復帰時の
// 再取得のみに留める（ライブ予定はそこまで高頻度に変わらないため、この粒度で十分）。
export function useLiveSchedule(): LiveScheduleResult {
  const [state, setState] = useState<LiveScheduleResult>({
    previous: null,
    current: null,
    upcoming: null,
    loading: true,
  });

  const load = useCallback(async () => {
    const [{ data: closedRows }, { data: activeRows }] = await Promise.all([
      supabase
        .from("lives")
        .select("*")
        .eq("current_phase", "closed")
        .order("scheduled_at", { ascending: false })
        .limit(1),
      supabase.from("lives").select("*").neq("current_phase", "closed").order("scheduled_at", { ascending: true }),
    ]);
    const previous = ((closedRows ?? [])[0] as LiveRow | undefined) ?? null;
    const activeSorted = (activeRows ?? []) as LiveRow[];
    const current = activeSorted[0] ?? null;
    const upcoming =
      activeSorted.find((l) => l.id !== current?.id && l.current_phase === "scheduled") ?? null;
    setState({ previous, current, upcoming, loading: false });
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
