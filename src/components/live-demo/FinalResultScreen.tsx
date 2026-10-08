"use client";

import { useEffect, useRef } from "react";

import FinalResultView from "@/components/live-room/FinalResultView";
import { MY_PARTICIPANT_ID } from "@/data/liveDemoData";
import { buildFinalResultData } from "@/lib/liveDemoSelectors";
import { computePointBreakdown } from "@/lib/pointBreakdown";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";
import { useUserStore } from "@/store/useUserStore";
import ScreenShell from "./ScreenShell";

// 最終結果（表彰式）：実ライブの FinalResultView をそのまま使う（段階表示・順位・効果音rankReveal・
// 表彰ボーナスの文言を実ライブと一致させるため）。体験版だけの追加は2点：
// ①体験版の手元のユーザー（useUserStore）へ、実ライブと同じ式（computePointBreakdown）で獲得分を加算する
// ②「もう一度体験する」（体験版だけの操作。実ライブにはない）
export default function FinalResultScreen() {
  const state = useLiveDemoStore((s) => s);
  const resetLive = useLiveDemoStore((s) => s.resetLive);
  const addPoints = useUserStore((s) => s.addPoints);
  const addMastery = useUserStore((s) => s.addMastery);
  const data = buildFinalResultData(state);
  const myEntry = data.ranking.find((r) => r.participantId === MY_PARTICIPANT_ID);
  const breakdown = computePointBreakdown(myEntry?.total ?? 0, data.myRank);
  const appliedRef = useRef(false);
  // 動画撮影モードでは、ポイント・熟練度を端末に保存しない（撮り直しで何度でも同じ画面を出すため）
  const recording = useLiveDemoStore((s) => s.recording);

  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    if (recording) return;
    // 実ライブのapply_live_rank_rewardsと同じく、獲得ポイントと熟練度は同じ量だけ増える
    addPoints(breakdown.totalPoints);
    addMastery(breakdown.totalPoints);
    // 初回マウント時の一度だけ加算する（再描画で二重加算しない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScreenShell>
      {/* 最終結果の表示は実ライブの FinalResultView。liveId を渡さないため、初回ライブ特典の
          到達記録・付与（本番DBへの書き込み）は体験版では発生しない（静的検査で固定する） */}
      <FinalResultView data={data} myParticipantId={MY_PARTICIPANT_ID} liveMode="official" />
      {recording ? null : <button
        type="button"
        onClick={resetLive}
        className="mt-4 rounded-full border border-white/40 px-5 py-2 font-sans text-sm font-bold text-white/80 transition hover:bg-white/10"
      >
        もう一度体験する
      </button>}
    </ScreenShell>
  );
}
