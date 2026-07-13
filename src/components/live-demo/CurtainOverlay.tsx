"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

// 寄席の開幕演出：閉じた緞帳(どんちょう)が左右にサッと開く。
// 画像素材は使わず、CSSグラデーション+box-shadowだけで布のドレープ(ひだ)の陰影を表現し、
// 開き切る直前に微細な逆揺れ(たわみ)を挟んで布の柔らかさを演出する。
// アニメーション完了後はDOMから完全に取り除く（非表示ではなくアンマウント）。
const CURTAIN_EASE = [0.4, 0, 0, 1] as const; // Out Quint的な急な立ち上がり→鋭い減速
const OPEN_DELAY_MS = 500;
const OPEN_DURATION_S = 1.3;

// 「完全に離れる直前に少したわんで戻る」揺れをkeyframesで表現。
// -100%(全開)の手前で一度-85%まで戻ってから最終位置へ収まる。
const LEFT_KEYFRAMES = ["0%", "-92%", "-85%", "-100%"];
const RIGHT_KEYFRAMES = ["0%", "92%", "85%", "100%"];
const SWAY_TIMES = [0, 0.7, 0.85, 1];

interface CurtainOverlayProps {
  onAnimationComplete?: () => void;
}

export default function CurtainOverlay({ onAnimationComplete }: CurtainOverlayProps) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const openTimer = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    return () => clearTimeout(openTimer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const unmountTimer = setTimeout(() => {
      setVisible(false);
      onAnimationComplete?.();
    }, OPEN_DURATION_S * 1000 + 100);
    return () => clearTimeout(unmountTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!visible) return null;

  const sharedTransition = open
    ? { duration: OPEN_DURATION_S, ease: CURTAIN_EASE, times: SWAY_TIMES }
    : { duration: 0 };

  return (
    <div className="fixed inset-0 z-50 flex" aria-hidden>
      {/* 左半分の幕 */}
      <motion.div
        initial={{ x: "0%" }}
        animate={{ x: open ? LEFT_KEYFRAMES : "0%" }}
        transition={sharedTransition}
        className="relative h-full w-1/2 overflow-hidden"
        style={{
          pointerEvents: open ? "none" : "auto",
          background: `
            radial-gradient(120% 100% at 100% 50%, rgba(255,140,120,0.35) 0%, rgba(139,0,0,0) 55%),
            linear-gradient(100deg, #380000 0%, #7a0000 35%, #8B0000 60%, #5c0000 85%, #4A0000 100%)
          `,
          boxShadow:
            "inset 22px 0 35px -18px rgba(0,0,0,0.75), inset -22px 0 35px -18px rgba(0,0,0,0.75)",
        }}
      >
        {/* ドレープの折り目(縦の縞) */}
        <div
          className="absolute inset-0 opacity-70 mix-blend-multiply"
          style={{
            background:
              "repeating-linear-gradient(90deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) 3px, transparent 3px, transparent 26px)",
          }}
        />
        <CurtainTassel side="left" />
      </motion.div>

      {/* 右半分の幕 */}
      <motion.div
        initial={{ x: "0%" }}
        animate={{ x: open ? RIGHT_KEYFRAMES : "0%" }}
        transition={sharedTransition}
        className="relative h-full w-1/2 overflow-hidden"
        style={{
          pointerEvents: open ? "none" : "auto",
          background: `
            radial-gradient(120% 100% at 0% 50%, rgba(255,140,120,0.35) 0%, rgba(139,0,0,0) 55%),
            linear-gradient(260deg, #380000 0%, #7a0000 35%, #8B0000 60%, #5c0000 85%, #4A0000 100%)
          `,
          boxShadow:
            "inset 22px 0 35px -18px rgba(0,0,0,0.75), inset -22px 0 35px -18px rgba(0,0,0,0.75)",
        }}
      >
        <div
          className="absolute inset-0 opacity-70 mix-blend-multiply"
          style={{
            background:
              "repeating-linear-gradient(90deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) 3px, transparent 3px, transparent 26px)",
          }}
        />
        <CurtainTassel side="right" />
      </motion.div>
    </div>
  );
}

// 幕の閉じ合わせ部分（中央）に配置する黄金色のタッセル(房)。
// 各幕のmotion.divの子要素にすることで、幕の開閉トランスフォームに自動で追従する。
function CurtainTassel({ side }: { side: "left" | "right" }) {
  return (
    <div
      className={`absolute top-1/2 -translate-y-1/2 ${
        side === "left" ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2"
      }`}
    >
      <svg width="28" height="72" viewBox="0 0 28 72" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* 吊り紐 */}
        <line x1="14" y1="0" x2="14" y2="16" stroke="#e8b84c" strokeWidth="2" />
        {/* 房の玉(結び目) */}
        <ellipse cx="14" cy="25" rx="10" ry="10" fill="url(#tasselKnotGradient)" stroke="#a8761f" strokeWidth="1" />
        {/* 房糸(フリンジ) */}
        {Array.from({ length: 7 }).map((_, i) => (
          <line
            key={i}
            x1={5 + i * 3}
            y1="34"
            x2={5 + i * 3}
            y2="70"
            stroke="#e8b84c"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        ))}
        <defs>
          <radialGradient id="tasselKnotGradient" cx="35%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#fbe38a" />
            <stop offset="60%" stopColor="#e8b84c" />
            <stop offset="100%" stopColor="#a8761f" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
}
