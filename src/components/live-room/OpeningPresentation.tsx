"use client";

import { motion } from "framer-motion";

import CurtainOverlay from "@/components/live-demo/CurtainOverlay";
import ScreenShell from "@/components/live-demo/ScreenShell";
import { REFERRAL_SOURCE_ANSWER_OPTIONS } from "@/lib/referralSurveySummary";

// 開幕（参加登録受付中）フェーズの表示だけを担う共用部品。本番(OpeningView)・体験版/撮影モード
// (OpeningScreen)はどちらもこれへpropsを渡すだけで、Supabase・本番ストア・デモストアには
// 依存しない。本番かデモかをここで判定して別のJSXを出すことはしない（違いはすべてpropsで表現する）。

export interface OpeningRosterPerson {
  id: string;
  name: string;
  isMe: boolean;
  roleLabel: string;
}

export interface OpeningMyRegistration {
  roleLabel: string;
  // 観客希望で登録済みの人を、人数に空きがあればプレイヤーへ変更できる操作（本番のみ使う）。
  canSwitchToPlayer: boolean;
}

export interface OpeningReferralSurvey {
  value: string;
  onChange: (value: string) => void;
}

export interface OpeningPresentationProps {
  // 本番限定の案内（初回ライブ限定特典等）をヘッダー直下に差し込むスロット。デモ側は渡さない。
  headerExtra?: React.ReactNode;
  showCurtain: boolean;
  errorMessage: string | null;
  // null = まだ参加登録していない（選択ボタンを出す）
  myRegistration: OpeningMyRegistration | null;
  canChoosePlayer: boolean;
  isPlayerFull: boolean;
  joining: boolean;
  isGuest: boolean;
  referralSurvey: OpeningReferralSurvey | null;
  onJoin: (role: "player" | "audience") => void;
  players: OpeningRosterPerson[];
  audience: OpeningRosterPerson[];
}

export default function OpeningPresentation({
  headerExtra,
  showCurtain,
  errorMessage,
  myRegistration,
  canChoosePlayer,
  isPlayerFull,
  joining,
  isGuest,
  referralSurvey,
  onJoin,
  players,
  audience,
}: OpeningPresentationProps) {
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
      {headerExtra}

      {!myRegistration ? (
        <div className="mt-6 flex flex-col items-center gap-2">
          {referralSurvey && (
            <label className="flex flex-col items-center gap-1 text-center">
              <span className="font-sans text-[11px] text-white/50">
                どこでこのライブを知りましたか？（任意）
              </span>
              <select
                value={referralSurvey.value}
                onChange={(e) => referralSurvey.onChange(e.target.value)}
                className="rounded-full border border-white/30 bg-transparent px-3 py-1.5 font-sans text-xs text-white [&>option]:bg-[#12101a]"
              >
                <option value="">選択しない</option>
                {REFERRAL_SOURCE_ANSWER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap justify-center gap-3">
            {canChoosePlayer && (
              <button
                type="button"
                disabled={joining || isPlayerFull}
                onClick={() => onJoin("player")}
                title={isPlayerFull ? "参加人数が上限に達しました" : undefined}
                className="rounded-full bg-[#ff3b5b] px-6 py-3 font-sans text-sm font-bold text-white transition hover:bg-[#e02040] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {joining ? "参加処理中…" : isPlayerFull ? "満員です" : "プレイヤーとして参加する"}
              </button>
            )}
            <button
              type="button"
              disabled={joining}
              onClick={() => onJoin("audience")}
              className="rounded-full border border-white/40 px-6 py-3 font-sans text-sm font-bold text-white transition hover:border-[#ffcf4a] hover:text-[#ffcf4a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {joining ? "参加処理中…" : "観客として参加する"}
            </button>
          </div>
          {canChoosePlayer && isPlayerFull && (
            <p className="font-sans text-xs text-[#ffcf4a]">
              参加人数が上限に達しました。観客として参加できます。
            </p>
          )}
          <p className="mt-1 max-w-xs text-center font-sans text-[11px] text-white/50">
            {isGuest
              ? "観客：採点はできませんが、爆笑・ツッコミ・拍手でいつでも盛り上げられます。"
              : "プレイヤー：舞台に立って回答し、自分の組の出番以外は採点も担当します。観客：採点はできませんが、人数制限なくいつでも観戦できます。"}
          </p>
        </div>
      ) : myRegistration.canSwitchToPlayer ? (
        <div className="mt-6 flex flex-col items-center gap-2">
          <p className="font-sans text-sm text-[#ffcf4a]">観客希望で参加登録済みです</p>
          <button
            type="button"
            disabled={joining || isPlayerFull}
            onClick={() => onJoin("player")}
            title={isPlayerFull ? "参加人数が上限に達しました" : undefined}
            className="rounded-full bg-[#ff3b5b] px-6 py-2.5 font-sans text-xs font-bold text-white transition hover:bg-[#e02040] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {joining ? "変更処理中…" : isPlayerFull ? "満員です" : "プレイヤーに変更する"}
          </button>
          {isPlayerFull && (
            <p className="font-sans text-xs text-[#ffcf4a]">参加人数が上限に達しています。</p>
          )}
        </div>
      ) : (
        <p className="mt-6 font-sans text-sm text-[#ffcf4a]">{myRegistration.roleLabel}で参加登録済みです</p>
      )}
      {errorMessage && <p className="mt-2 font-sans text-xs text-[#ff3b5b]">{errorMessage}</p>}

      <div className="mt-10 w-full max-w-xl min-w-0">
        <div className="flex flex-col gap-5">
          {[
            { label: "現在のプレイヤー", list: players },
            { label: "現在の観客", list: audience },
          ].map((g) => (
            <div key={g.label} className="min-w-0">
              <p className="font-sans text-xs tracking-widest text-white/60">
                {g.label}：{g.list.length}人
              </p>
              {g.list.length === 0 ? (
                <p className="mt-3 font-sans text-xs text-white/40">まだいません</p>
              ) : (
                <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
                  {g.list.map((p, idx) => (
                    <motion.div
                      key={p.id}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(idx, 20) * 0.03 }}
                      className={`flex min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
                        p.isMe ? "border-[#3b5bff] bg-white/10" : "border-white/10 bg-white/[0.03]"
                      }`}
                    >
                      <span className="min-w-0 break-words font-sans text-white/90">{p.name}</span>
                      <span className="shrink-0 font-sans text-xs text-white/60">{p.roleLabel}</span>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </ScreenShell>
  );
}
