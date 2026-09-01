// 寄合券の「次の回復まで◯分」表示用フォーマット。
// 0分表示になって「もう回復してそうなのに」と誤解されないよう、最低でも1分と表示する
// （実際に0分を切った瞬間はcomputeDisplayedTickets、src/lib/ticketRecovery.tsが枚数を
// 進めるため、この関数が呼ばれるのはまだ回復前の状態のときだけ）。
export function formatMinutesUntil(targetMs: number, nowMs: number = Date.now()): number {
  return Math.max(1, Math.ceil((targetMs - nowMs) / 60000));
}
