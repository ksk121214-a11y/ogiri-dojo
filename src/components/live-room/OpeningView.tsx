"use client";

import { useEffect, useRef, useState } from "react";

import OpeningPresentation from "@/components/live-room/OpeningPresentation";
import FirstLiveRewardAnnouncement from "@/components/live-room/FirstLiveRewardAnnouncement";
import { hasSeenCurtain } from "@/lib/curtainSeen";
import { isGuestUser } from "@/lib/guestStatus";
import type { ParticipantRole } from "@/lib/liveRoomTypes";
import { splitParticipantsByPreferredRole } from "@/lib/participantRoleSplit";
import { playSfx } from "@/lib/sfx";
import { useAuthStore } from "@/store/useAuthStore";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";
import { useProfileStore } from "@/store/useProfileStore";

const ROLE_LABEL: Record<ParticipantRole, string> = {
  player: "プレイヤー希望",
  audience: "観客希望",
};

// 開幕（参加登録受付中）フェーズの実バックエンド版adapter。表示そのものは
// src/components/live-room/OpeningPresentation.tsx（本番・体験版/撮影モード共用）に委ね、
// ここでは実データ（useLiveFollowerStore・Supabase経由のjoinLive）からpropsを組み立てる。
export default function OpeningView() {
  const live = useLiveFollowerStore((s) => s.live);
  const myParticipant = useLiveFollowerStore((s) => s.myParticipant);
  const participants = useLiveFollowerStore((s) => s.participants);
  const participantNames = useLiveFollowerStore((s) => s.participantNames);
  const followerError = useLiveFollowerStore((s) => s.error);
  const joinLive = useLiveFollowerStore((s) => s.joinLive);
  const authUser = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  // 2026-09-13（ゲスト観客対応の最終仕様確定）：ゲストは観客(audience)としてのみ
  // 参加でき、プレイヤー希望を選ぶ・プレイヤーへ役割変更する・組に所属することは
  // 一切できない（DB側はjoin_live/_guard_participants_guest_audience_onlyが
  // 最終防御）。UI側もプレイヤー関連のボタン・案内文をゲストには表示しない。
  const isGuest = isGuestUser(authUser, profile);
  const profileLoading = useProfileStore((s) => s.loading);
  const [joining, setJoining] = useState(false);
  // 2026-09-01: 集客施策の効果測定のため、参加登録時に「どこで知ったか」を
  // 任意で選んでもらう（未選択のままでも参加はできる、選択必須にはしない）。
  const [referralSource, setReferralSource] = useState("");
  const showReferralSurvey =
    !isGuest && !profileLoading && !!profile && profile.referralSource == null && profile.referralSourceAnsweredAt == null;
  // interlude(幕間)を経由せず、いきなりopeningから見始めた人にも一度は必ずカーテンが
  // 開く演出・音・BGMを体験してもらうため、このタブでまだ見ていなければここで見せる。
  const [showCurtain] = useState(() => !hasSeenCurtain());

  // 参加者一覧に新しい名前が増えるたびに1回鳴らす（マウント時点で既にいる人数ぶんは対象外、
  // その後リアルタイムで増えた分だけ鳴らしたいので初期値をnullにして初回は基準を記録するだけにする）。
  const prevCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevCountRef.current !== null && participants.length > prevCountRef.current) {
      playSfx("participantJoined");
    }
    prevCountRef.current = participants.length;
  }, [participants.length]);

  if (!live) return null;

  const playerCount = participants.filter((p) => p.preferred_role === "player").length;
  const isPlayerFull = live.max_players != null && playerCount >= live.max_players;

  const handleJoin = async (role: ParticipantRole) => {
    const confirmed = window.confirm(
      role === "player"
        ? "プレイヤーとして参加しますか？あとから観客に変更することはできません。"
        : isGuest
          ? "観客として参加しますか？"
          : "観客として参加しますか？（人数に空きがあれば、あとからプレイヤーへ変更できます）",
    );
    if (!confirmed) return;
    if (role === "player") playSfx("joinAsPlayer");
    setJoining(true);
    try {
      await joinLive(role, referralSource || null);
    } finally {
      setJoining(false);
    }
  };

  const { players, audience } = splitParticipantsByPreferredRole(participants);
  const toRosterPerson = (p: (typeof participants)[number]) => ({
    id: p.id,
    name: participantNames[p.id] ?? "（名前未設定）",
    isMe: p.id === myParticipant?.id,
    roleLabel: ROLE_LABEL[p.preferred_role],
  });

  return (
    <OpeningPresentation
      headerExtra={
        <FirstLiveRewardAnnouncement
          liveMode={live.live_mode}
          officialSequenceNumber={live.official_sequence_number}
          emergencyClosed={live.emergency_closed}
          className="mt-2 max-w-xs text-center font-sans text-[11px] text-[#ffcf4a]"
        />
      }
      showCurtain={showCurtain}
      errorMessage={followerError}
      myRegistration={
        myParticipant
          ? {
              roleLabel: ROLE_LABEL[myParticipant.preferred_role],
              canSwitchToPlayer: myParticipant.preferred_role === "audience" && !isGuest,
            }
          : null
      }
      canChoosePlayer={!isGuest}
      isPlayerFull={isPlayerFull}
      joining={joining}
      isGuest={isGuest}
      referralSurvey={showReferralSurvey ? { value: referralSource, onChange: setReferralSource } : null}
      onJoin={handleJoin}
      players={players.map(toRosterPerson)}
      audience={audience.map(toRosterPerson)}
    />
  );
}
