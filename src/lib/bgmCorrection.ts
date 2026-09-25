// BGM再生位置の補正判断（6回目レビュー対応）。純粋なロジック。
// 補正APIの結果を理由つきで返し、planner側は「実際に完了した」結果の時だけrevisionを消費する。
export type BgmCorrectionResult =
  | "corrected" // 実際に再生位置を補正した
  | "within_tolerance" // 既に許容範囲内で補正不要
  | "queued" // OFF・読込中：正しい将来の開始位置を保存した（再生開始時に使われる）
  | "not_ready" // まだ補正も保存もできていない（再試行が必要）
  | "wrong_track"; // 予定曲が対象曲ではない（完了扱いにしない・別曲をシークしない）

export interface BgmCorrectionView {
  plannedName: string | null; // 意図(intent)上の予定曲
  enabled: boolean; // BGMがON
  currentName: string | null; // 現在の曲（activateBgm済み）
  loading: boolean; // 音源メタデータ未読込 / Web Audio未デコード
  position: { durationMs: number; currentPosMs: number } | null; // 再生位置を取得できる時
}

export type BgmCorrectionEffect = "seek" | "save_start" | "none";

export function decideBgmCorrection(
  view: BgmCorrectionView,
  name: string,
  targetMs: number,
  toleranceMs: number,
): { result: BgmCorrectionResult; effect: BgmCorrectionEffect } {
  if (view.plannedName !== name) return { result: "wrong_track", effect: "none" };
  if (!view.enabled) return { result: "queued", effect: "save_start" };
  if (view.currentName !== name) return { result: "not_ready", effect: "none" };
  if (view.loading || !view.position || view.position.durationMs <= 0) {
    return { result: "queued", effect: "save_start" };
  }
  const { durationMs, currentPosMs } = view.position;
  const target = ((targetMs % durationMs) + durationMs) % durationMs;
  const diff = Math.abs(target - currentPosMs);
  if (Math.min(diff, durationMs - diff) <= toleranceMs) {
    return { result: "within_tolerance", effect: "save_start" };
  }
  return { result: "corrected", effect: "seek" };
}
