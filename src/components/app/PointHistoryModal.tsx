"use client";

import { POINT_HISTORY } from "@/data/pointHistoryData";
import { useUserStore } from "@/store/useUserStore";

// ヘッダーの「段位・名前・ポイント」バッジを押すと開く獲得履歴モーダル。
export default function PointHistoryModal({ onClose }: { onClose: () => void }) {
  const points = useUserStore((s) => s.user.points);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-4 rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-sans text-base font-bold text-dojo-ink">獲得履歴</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-full px-2 py-1 font-sans text-sm text-dojo-dark-brown hover:bg-black/5"
          >
            ✕
          </button>
        </div>

        <div className="rounded-2xl bg-dojo-tatami-cream p-4 text-center">
          <p className="font-sans text-[11px] text-dojo-dark-brown/70">現在のポイント残高</p>
          <p className="mt-1 font-sans text-2xl font-bold tabular-nums text-dojo-ink">
            {points.toLocaleString()}
            <span className="ml-1 text-sm font-normal text-dojo-dark-brown/70">pt</span>
          </p>
        </div>

        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {POINT_HISTORY.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between gap-3 rounded-xl bg-dojo-tatami-cream/60 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-sans text-xs font-bold text-dojo-ink">
                  {entry.label}
                </p>
                <p className="font-sans text-[10px] text-dojo-dark-brown/60">
                  {entry.dateLabel}
                </p>
              </div>
              <span
                className={`shrink-0 font-sans text-sm font-bold tabular-nums ${
                  entry.amount >= 0 ? "text-dojo-tatami-green" : "text-dojo-deep-crimson"
                }`}
              >
                {entry.amount >= 0 ? "+" : ""}
                {entry.amount.toLocaleString()}pt
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
