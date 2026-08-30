"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import CurtainOverlay from "@/components/live-demo/CurtainOverlay";
import ScreenShell from "@/components/live-demo/ScreenShell";
import { hasSeenCurtain } from "@/lib/curtainSeen";
import type { ParticipantRole } from "@/lib/liveRoomTypes";
import { truncateLiveDisplayName } from "@/lib/liveRoomSelectors";
import { playSfx } from "@/lib/sfx";
import type { LiveAssetPreloadState } from "@/lib/useLiveAssetPreload";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";

const ROLE_LABEL: Record<ParticipantRole, string> = {
  player: "プレイヤー希望",
  audience: "観客希望",
};

// 開幕（参加登録受付中）フェーズの実バックエンド版。src/components/live-demo/OpeningScreen.tsxは
// 「組分け発表」の演出だが、実バックエンドのopeningフェーズはまだ組分け前の登録受付そのものなので、
// デモ版をそのまま移植せず、実際の登録状況に合わせた専用の画面として作る。
export default function OpeningView({
  assetPreload,
}: {
  assetPreload?: LiveAssetPreloadState;
}) {
  const live = useLiveFollowerStore((s) => s.live);
  const myParticipant = useLiveFollowerStore((s) => s.myParticipant);
  const participants = useLiveFollowerStore((s) => s.participants);
  const participantNames = useLiveFollowerStore((s) => s.participantNames);
  const followerError = useLiveFollowerStore((s) => s.error);
  const joinLive = useLiveFollowerStore((s) => s.joinLive);
  const [joining, setJoining] = useState(false);
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

  // 運営者専用管理画面の追加（第1段階）：最大参加人数はプレイヤーのみに適用し、
  // 観客には適用しない。上限判定はUIの見た目を早く更新するための表示用であり、
  // 実際の安全な上限チェックはjoinLive内のRPC(join_live)がSupabase側で行う。
  const playerCount = participants.filter((p) => p.preferred_role === "player").length;
  const isPlayerFull = live.max_players != null && playerCount >= live.max_players;

  const handleJoin = async (role: ParticipantRole) => {
    if (role === "player") playSfx("joinAsPlayer");
    setJoining(true);
    await joinLive(role);
    setJoining(false);
  };

  return (
    <ScreenShell>
      {showCurtain && <CurtainOverlay />}
      <p className="font-sans text-xs tracking-widest text-white/60">開幕</p>
      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mt-2 font-sans text-3xl font-black text-[#ffcf4a] sm:text-4xl"
      >
        参加登録受付中
      </motion.h2>
      <p className="mt-2 font-sans text-sm text-white/80">
        まもなく組分けが発表されます。参加方法を選んでください。
      </p>

      {!myParticipant ? (
        <div className="mt-6 flex flex-col items-center gap-2">
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              disabled={joining || isPlayerFull}
              onClick={() => handleJoin("player")}
              title={isPlayerFull ? "参加人数が上限に達しました" : undefined}
              className="rounded-full bg-[#ff3b5b] px-6 py-3 font-sans text-sm font-bold text-white transition hover:bg-[#e02040] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {joining ? "参加処理中…" : isPlayerFull ? "満員です" : "プレイヤーとして参加する"}
            </button>
            <button
              type="button"
              disabled={joining}
              onClick={() => handleJoin("audience")}
              className="rounded-full border border-white/40 px-6 py-3 font-sans text-sm font-bold text-white transition hover:border-[#ffcf4a] hover:text-[#ffcf4a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {joining ? "参加処理中…" : "観客として参加する"}
            </button>
          </div>
          {isPlayerFull && (
            <p className="font-sans text-xs text-[#ffcf4a]">
              参加人数が上限に達しました。観客として参加できます。
            </p>
          )}
        </div>
      ) : (
        <p className="mt-6 font-sans text-sm text-[#ffcf4a]">
          {ROLE_LABEL[myParticipant.preferred_role]}で参加登録済みです
        </p>
      )}
      {followerError && (
        <p className="mt-2 font-sans text-xs text-[#ff3b5b]">{followerError}</p>
      )}

      {assetPreload && <LiveAssetPreloadStatus state={assetPreload} />}

      <div className="mt-10 w-full max-w-xl">
        <p className="font-sans text-xs tracking-widest text-white/60">
          現在の参加者：{participants.length}人
        </p>
        <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
          {participants.map((p, idx) => {
            const isMe = p.id === myParticipant?.id;
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(idx, 20) * 0.03 }}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                  isMe ? "border-[#3b5bff] bg-white/10" : "border-white/10 bg-white/[0.03]"
                }`}
              >
                <span className="truncate font-sans text-white/90">
                  {truncateLiveDisplayName(participantNames[p.id] ?? "（名前未設定）")}
                </span>
                <span className="shrink-0 font-sans text-xs text-white/60">
                  {ROLE_LABEL[p.preferred_role]}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </ScreenShell>
  );
}

// お題発表・回答・審査で使う必須素材（画像・BGM・SE）の事前読み込み進捗表示。
// 「準備中 12/15」→「準備完了」、失敗が残った場合は再読み込みボタンを出す。
function LiveAssetPreloadStatus({ state }: { state: LiveAssetPreloadState }) {
  const { total, loaded, status, failedItems, retryFailed } = state;
  return (
    <div className="mt-4 flex flex-col items-center gap-1.5">
      <p className="font-sans text-xs text-white/60">
        {status === "ready"
          ? "ライブ素材の準備完了"
          : status === "error"
            ? `ライブ素材を準備中 ${loaded}/${total}（一部読み込めていません）`
            : `ライブ素材を準備中 ${loaded}/${total}`}
      </p>
      {status === "error" && (
        <button
          type="button"
          onClick={retryFailed}
          className="rounded-full border border-[#ff3b5b]/60 px-4 py-1.5 font-sans text-xs font-bold text-[#ff3b5b] transition hover:bg-[#ff3b5b]/10"
        >
          再読み込み（{failedItems.length}件）
        </button>
      )}
    </div>
  );
}
