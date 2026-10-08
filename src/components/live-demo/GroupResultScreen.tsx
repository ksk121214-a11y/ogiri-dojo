"use client";

import GroupResultView from "@/components/live-room/GroupResultView";
import { MY_PARTICIPANT_ID } from "@/data/liveDemoData";
import { buildGroupResultData, getCurrentTurn } from "@/lib/liveDemoSelectors";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";
import ScreenShell from "./ScreenShell";

// 組結果発表：実ライブの GroupResultView をそのまま使う（文言・同点の順位・効果音groupResultの
// 発火タイミングを実ライブと一致させるため、表示を複製しない）。データだけ体験版の状態から作る。
export default function GroupResultScreen() {
  const state = useLiveDemoStore((s) => s);
  const turn = getCurrentTurn(state);
  if (!turn) return null;
  return (
    <ScreenShell>
      <GroupResultView data={buildGroupResultData(state, turn.id)} myParticipantId={MY_PARTICIPANT_ID} />
    </ScreenShell>
  );
}
