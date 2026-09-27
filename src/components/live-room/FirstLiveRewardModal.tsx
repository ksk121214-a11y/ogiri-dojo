"use client";

import { motion } from "framer-motion";

import { BASE_PATH } from "@/lib/basePath";
import { getLimitedIconSrc } from "@/lib/limitedIcons";

// 初回本番ライブ(#0001)の限定特典を初めて獲得した時だけ、最終結果画面から一度だけ
// 呼ばれるモーダル（useFirstLiveRewardStore.attempt()のnewlyGranted=trueの時のみ表示、
// supabase/migrations/0081参照）。複数タブ・再読込・再接続で何度も出ないことの保証は
// 呼び出し元（FinalResultView）とストア側のDB冪等性に委ねており、このモーダル自体は
// 単に「出す/出さない」の見た目だけを持つ。
// 2026-09-27（レビュー対応）：称号の表示名は運営が管理画面から後から変更できるため、
// ここでハードコードせず、grant_first_live_rewardの戻り値(titleDisplayName、付与時点の
// titles.display_name)をそのまま表示する。取得できなかった場合（通信断等）は、
// 生のDBエラーを出さず一般的な文言へフォールバックする。
export default function FirstLiveRewardModal({
  onClose,
  titleDisplayName,
}: {
  onClose: () => void;
  titleDisplayName?: string | null;
}) {
  const iconSrc = getLimitedIconSrc("first-witness");

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 20 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-live-reward-title"
        className="w-full max-w-sm rounded-[24px] border-[3px] border-[#ffcf4a] bg-[#12101a] p-6 text-center text-white shadow-[0_0_50px_rgba(255,207,74,0.35)]"
      >
        <p className="font-sans text-xs font-bold tracking-widest text-[#ffcf4a]">
          初回ライブ限定特典を獲得しました
        </p>

        {iconSrc && (
          <span className="mx-auto mt-4 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-[#ffcf4a]/70">
            {/* eslint-disable-next-line @next/next/no-img-element -- フルカラーPNGをそのまま表示する */}
            <img src={`${BASE_PATH}${iconSrc}`} alt="" className="h-full w-full object-contain" draggable={false} />
          </span>
        )}

        <p className="mt-4 font-sans text-lg font-black">
          {titleDisplayName ? `限定称号「${titleDisplayName}」` : "限定称号を獲得しました"}
        </p>
        <p className="mt-1 font-sans text-sm text-white/80">初回ライブ限定アイコン</p>
        <p className="mt-4 font-sans text-xs text-white/60">マイページで選択できます</p>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-full bg-[#ffcf4a] px-5 py-2.5 font-sans text-sm font-bold text-[#12101a] transition hover:opacity-90"
        >
          閉じる
        </button>
      </motion.div>
    </div>
  );
}
