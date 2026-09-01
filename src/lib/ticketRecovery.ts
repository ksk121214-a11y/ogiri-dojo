// 寄合券の「表示用」の残数計算。
// 2026-09-02: 寄合券はSupabase側（profiles.tickets_count/tickets_next_recovery_at、
// RPC内のconsume_ticket_for_user）で原子的に管理するようになったため、ここでの計算は
// あくまで「最後に取得したprofileのスナップショット＋経過時間」から見た目上の残数を
// 概算するだけの表示用ロジックであり、実際に投稿できるかどうかの判定はサーバー側
// （RPCのNO_TICKETSエラー）が最終的な正となる。ロジック自体は旧useTicketStore.ts の
// computeRecoveryと同一にしてある（1時間で1枚回復、最大5枚）。
export const MAX_TICKETS = 5;
const TICKET_RECOVERY_INTERVAL_MS = 60 * 60 * 1000;

export function computeDisplayedTickets(
  count: number,
  nextRecoveryAtIso: string | null,
): { count: number; nextRecoveryAt: number | null } {
  const nextRecoveryAt = nextRecoveryAtIso ? new Date(nextRecoveryAtIso).getTime() : null;
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
