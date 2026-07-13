"use client";

import { motion } from "framer-motion";

import { MY_PARTICIPANT_ID } from "@/data/liveDemoData";
import { getParticipantName } from "@/lib/liveDemoSelectors";
import type { LiveDemoState } from "@/store/useLiveDemoStore";

// キャラクターの仮アバター配色ローテーション（本実装のガチャキャラ導入までのプレースホルダー）
const AVATAR_GRADIENTS = [
  "from-dojo-curtain-red to-dojo-deep-crimson",
  "from-dojo-curtain-gold to-dojo-spotlight-orange",
  "from-dojo-cheer-pink to-dojo-deep-crimson",
  "from-dojo-spotlight-orange to-dojo-curtain-gold",
  "from-dojo-gray-purple to-dojo-backstage-navy",
];

// 中央の「舞台」ビジュアルエリア：組の回答者を横並びに配置し、
// 審査サイクルに乗っている1人だけスポットライトを浴びて前に出る（デザイン方針§4.3）。
// 舞台（回答者）画面・客席（観客）画面のどちらからも共通で使う。
// compact：審査サイクル中はJudgingCardが同じ縦領域を取り合うため、キャラ列自体を小さく畳んで
// 高さの取り合い（見切れ）を構造的に避ける（審査中は名前・バッジもJudgingCard側に既に出ているため省略）。
export default function StageCharacters({
  state,
  memberIds,
  activeParticipantId,
  compact = false,
}: {
  state: LiveDemoState;
  memberIds: string[];
  activeParticipantId: string | null;
  compact?: boolean;
}) {
  return (
    <div
      className={`relative flex w-full max-w-2xl flex-wrap items-end justify-center rounded-3xl border border-dojo-curtain-gold/25 bg-gradient-to-b from-dojo-backstage-navy/50 to-dojo-stage-dark ${
        compact
          ? "gap-x-2 gap-y-1 px-3 pb-2 pt-3 sm:gap-x-3"
          : "gap-x-2 gap-y-2 px-3 pb-4 pt-6 sm:gap-x-5 sm:px-10"
      }`}
    >
      {/*
        メンバー数が多い組・幅の狭いスマホ画面では、横一列に収まりきらない場合は
        flex-wrapで折り返す（横はみ出し・見切れを構造的に避ける。名前ラベルもモバイルでは短く絞る）。
      */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-[radial-gradient(ellipse_at_bottom,rgba(255,138,61,0.22),transparent_70%)]" />
      {memberIds.map((id, idx) => {
        const isActive = id === activeParticipantId;
        const isMe = id === MY_PARTICIPANT_ID;
        const name = getParticipantName(state, id);
        return (
          <motion.div
            key={id}
            className="relative flex flex-col items-center"
            animate={{ y: isActive && !compact ? -14 : 0, scale: isActive ? 1.12 : 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
            style={{ zIndex: isActive ? 10 : 1 }}
          >
            {isActive && (
              <motion.div
                className="pointer-events-none absolute -inset-3 -z-10 rounded-full"
                style={{
                  background:
                    "radial-gradient(circle, rgba(255,217,142,0.55), transparent 70%)",
                }}
                animate={{ opacity: [0.5, 0.95, 0.5] }}
                transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
            <div
              className={`flex items-center justify-center rounded-full border-2 bg-gradient-to-br font-brush text-dojo-washi-white shadow-lg ${
                compact
                  ? "h-8 w-8 text-sm sm:h-10 sm:w-10 sm:text-base"
                  : "h-12 w-12 text-base sm:h-16 sm:w-16 sm:text-xl"
              } ${
                AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length]
              } ${
                isActive
                  ? "border-dojo-curtain-gold shadow-[0_0_25px_rgba(232,184,76,0.7)]"
                  : isMe
                    ? "border-dojo-curtain-gold/70"
                    : "border-dojo-washi-white/20"
              }`}
            >
              {name.slice(0, 1)}
            </div>
            {!compact && (
              <p
                className={`mt-2 max-w-[3.25rem] truncate font-sans text-[10px] sm:max-w-[4.5rem] ${
                  isActive
                    ? "font-bold text-dojo-curtain-gold"
                    : "text-dojo-washi-white/70"
                }`}
              >
                {name}
                {isMe ? "（あなた）" : ""}
              </p>
            )}
            {isActive && !compact && (
              <motion.span
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute -top-6 whitespace-nowrap rounded-full bg-dojo-curtain-gold px-2 py-0.5 font-sans text-[9px] font-bold text-dojo-stage-dark"
              >
                審査中
              </motion.span>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
