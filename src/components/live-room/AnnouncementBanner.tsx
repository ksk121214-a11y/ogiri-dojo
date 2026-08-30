"use client";

import { AnimatePresence, motion } from "framer-motion";

import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";

// 運営者専用管理画面の追加（第1段階）：管理画面から送信した運営メッセージを
// 参加者の画面最上部に表示する。回答入力・舞台演出を邪魔しない、細い固定バーに
// 留める（要件：「回答入力などの操作を邪魔しない位置と大きさにしてください」）。
// announcement_scope==='all'なら観客にも、'player'ならプレイヤーのみに表示する。
// 2026-08-30: 文字が小さく読みにくいとの声を受け、位置・固定バーである点は
// 変えないまま文字サイズ・余白だけ一段階大きくした。
export default function AnnouncementBanner() {
  const live = useLiveFollowerStore((s) => s.live);
  const myParticipant = useLiveFollowerStore((s) => s.myParticipant);

  const message = live?.announcement_message ?? null;
  const scope = live?.announcement_scope ?? null;
  if (!message) return null;

  // scope==='player'の間は、まだ役割未選択(myParticipant==null)の人にも一旦見せる
  // （参加登録前でも運営からの案内は届いてほしいため）。観客だけを明確に除外する。
  const isAudienceOnly = myParticipant?.role === "audience";
  if (scope === "player" && isAudienceOnly) return null;

  return (
    <AnimatePresence>
      <motion.div
        key={message}
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.25 }}
        role="status"
        className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))]"
      >
        <p className="pointer-events-auto max-w-[92vw] truncate rounded-full bg-black/70 px-5 py-2 text-center font-sans text-sm font-bold text-white shadow-lg backdrop-blur-sm">
          📣 {message}
        </p>
      </motion.div>
    </AnimatePresence>
  );
}
