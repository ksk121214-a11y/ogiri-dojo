// 「同じ非同期処理が同時に複数走らないようにする」ための、フレームワーク非依存の
// single-flightガード。
//
// 背景：Reactのstate（useState）は更新してもそのtickの中では古い値のまま
// （次の再描画まで反映されない）。そのため「if (loading) return;」のように
// stateだけをロックに使うと、同じ再描画が起きる前にハンドラが2回呼ばれた場合、
// 両方とも古い loading=false を見てしまい、RPC等が2回実行されてしまう
// （React Strict Modeの開発時二重effect実行や、ボタン連打・初回自動取得と
// 手動再読み込みの競合で実際に起こり得る）。
//
// 対して、このモジュールが受け取るlock（例：Reactのuseref(false)がそのまま
// 満たす{ current: boolean }という形）は、代入した瞬間に同期的に読み書きできる
// ため、「2回呼ばれた場合に片方だけがtaskを実行する」という排他制御を
// 確実に保証できる。
export interface SingleFlightLock {
  current: boolean;
}

// task()を呼ばずにスキップした場合の戻り値。呼び出し側の正常な戻り値
// （null・undefined・空文字等を含むどんな値）と衝突しないよう、一意な
// Symbolにしている。
export const SINGLE_FLIGHT_SKIPPED: unique symbol = Symbol("single-flight-skipped");

// lock.currentが既にtrue（実行中）なら、taskを一切呼ばずSINGLE_FLIGHT_SKIPPEDを
// 返す。lock.currentがfalseなら、同期的にtrueへ立ててからtaskを実行し、
// 成功・失敗（例外・reject）を問わずfinallyでlock.currentをfalseへ戻す
// （次の呼び出しが必ず再試行できるようにするため）。
//
// 「lock.currentがfalseなら同期的にtrueへ立てる」処理は、この関数がasyncで
// あっても最初のawaitより前（＝呼び出し直後、呼び出し元の次の行が実行される前）
// に同期的に走る。そのため、同じタイミングで連続してrunSingleFlight(lock, ...)
// を呼んでも、2回目の呼び出しが1回目のtask()実行を追い越して二重実行される
// ことはない。
export async function runSingleFlight<T>(
  lock: SingleFlightLock,
  task: () => Promise<T>,
): Promise<T | typeof SINGLE_FLIGHT_SKIPPED> {
  if (lock.current) return SINGLE_FLIGHT_SKIPPED;
  lock.current = true;
  try {
    return await task();
  } finally {
    lock.current = false;
  }
}
