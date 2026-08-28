// 「寄合券」：寄合帳（お題投稿・回答）に使うスタミナ的な消費リソース。
// 最大5枚、1枚消費するごとに1時間で1枚回復し、5枚を超えては回復しない。
// タイマーは持たず、「次に1枚回復する予定時刻」だけをlocalStorageに永続化しておき、
// 参照・消費のタイミングで現在時刻との差分から回復分をまとめて計算する
// （アプリを閉じている間も裏で正しく回復が進む設計。ブラウザのタイマーに頼らない）。
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const MAX_TICKETS = 5;
export const TICKET_RECOVERY_INTERVAL_MS = 60 * 60 * 1000; // 1時間で1枚回復

interface TicketState {
  count: number;
  // 次に1枚回復する予定時刻（epoch ms）。countがMAX_TICKETSのときはnull（回復待ちなし）。
  nextRecoveryAt: number | null;
  // 現在時刻をもとに回復分を計算し、必要なら状態を更新する。
  // 表示・消費どちらの前にも必ずこれを呼んでから最新のcountを読む。
  recalculate: () => void;
  // 1枚消費する。0枚のときは何もせずfalseを返す。
  consume: () => boolean;
}

function computeRecovery(
  count: number,
  nextRecoveryAt: number | null,
): { count: number; nextRecoveryAt: number | null } {
  if (nextRecoveryAt === null || count >= MAX_TICKETS) {
    return { count: Math.min(count, MAX_TICKETS), nextRecoveryAt: count >= MAX_TICKETS ? null : nextRecoveryAt };
  }
  const now = Date.now();
  if (now < nextRecoveryAt) {
    return { count, nextRecoveryAt };
  }
  const recoveredIntervals = Math.floor((now - nextRecoveryAt) / TICKET_RECOVERY_INTERVAL_MS) + 1;
  const newCount = Math.min(MAX_TICKETS, count + recoveredIntervals);
  const newNextRecoveryAt =
    newCount < MAX_TICKETS ? nextRecoveryAt + recoveredIntervals * TICKET_RECOVERY_INTERVAL_MS : null;
  return { count: newCount, nextRecoveryAt: newNextRecoveryAt };
}

export const useTicketStore = create<TicketState>()(
  persist(
    (set, get) => ({
      count: MAX_TICKETS,
      nextRecoveryAt: null,

      recalculate: () => {
        const { count, nextRecoveryAt } = get();
        const next = computeRecovery(count, nextRecoveryAt);
        if (next.count !== count || next.nextRecoveryAt !== nextRecoveryAt) {
          set(next);
        }
      },

      consume: () => {
        get().recalculate();
        const { count, nextRecoveryAt } = get();
        if (count <= 0) return false;
        const newCount = count - 1;
        set({
          count: newCount,
          // すでに回復待ちがあればそのまま、満タンから減った直後だけ新規に1時間後をセットする。
          nextRecoveryAt: nextRecoveryAt ?? Date.now() + TICKET_RECOVERY_INTERVAL_MS,
        });
        return true;
      },
    }),
    {
      name: "ogiri-dojo-ticket-v1",
      partialize: (state) => ({ count: state.count, nextRecoveryAt: state.nextRecoveryAt }),
    },
  ),
);
