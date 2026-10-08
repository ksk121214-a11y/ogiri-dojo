"use client";

import OpeningPresentation from "@/components/live-room/OpeningPresentation";
import { MY_PARTICIPANT_ID } from "@/data/liveDemoData";
import { getParticipantName } from "@/lib/liveDemoSelectors";
import { useLiveDemoStore } from "@/store/useLiveDemoStore";

// 開幕（参加登録受付中）：実ライブと同じ共用表示部品(OpeningPresentation)を使う。
// 体験版の参加者は全員プレイヤー希望として登録済みの状態から始まるため、参加登録の
// 選択UIは出さない（myRegistrationを常に埋めて渡す）。組分けの発表は、実ライブでは
// 開幕ではなく次のお題発表（TopicRevealScreen）で示されるため、ここでは組を出さない。
export default function OpeningScreen() {
  const state = useLiveDemoStore((s) => s);
  const players = state.participants;

  return (
    <OpeningPresentation
      showCurtain={false}
      errorMessage={null}
      myRegistration={{ roleLabel: "プレイヤー希望", canSwitchToPlayer: false }}
      canChoosePlayer={false}
      isPlayerFull={false}
      joining={false}
      isGuest={false}
      referralSurvey={null}
      onJoin={() => {}}
      players={players.map((p) => ({
        id: p.id,
        name: getParticipantName(state, p.id),
        isMe: p.id === MY_PARTICIPANT_ID,
        roleLabel: "プレイヤー希望",
      }))}
      audience={[]}
    />
  );
}
