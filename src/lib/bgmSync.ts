// フェーズBGMの開始位置・同期後補正の計画（5〜6回目レビュー対応）。純粋なロジック。
// - 時計がfreshでない間は絶対時刻からのシーク位置を決めない（待つ）。
// - 待ち続けた末(gaveUp)に鳴らす場合は、誤った端末時刻から途中位置を作らず、先頭からの暫定再生にする。
// - 補正はack方式：plan()は行動を返すだけで補正済みにしない。実行結果をack()で返し、
//   実際に完了した結果（corrected / within_tolerance / queued）の時だけそのrevisionを完了扱いにする。
//   not_ready・wrong_trackではrevisionを消費せず、次のplan()で再試行できる。
// - フェーズ（key）が変われば状態をリセットする。同一フェーズ内でdeadlineが変わった
//   （回答時間の一時停止/再開）後は、経過位置の逆算が成り立たないため補正しない。
import type { BgmCorrectionResult } from "./bgmCorrection";

export type BgmSyncAction =
  | { kind: "wait" }
  | { kind: "play"; startAtMs: number; revision: number; provisional: boolean }
  | { kind: "seek"; startAtMs: number; revision: number }
  | { kind: "none" };

export interface BgmSyncInput {
  key: string; // フェーズ＋ターン等。変わったら新しいフェーズとして状態をリセット
  deadline: string | null;
  fresh: boolean;
  revision: number;
  gaveUp: boolean;
  elapsedMs: number | null; // サーバー時計基準の経過時間。freshでなければnull
}

export function createBgmSyncPlanner() {
  let key: string | null = null;
  let deadlineAtStart: string | null = null;
  let started = false;
  let provisional = false;
  let correctedRevision = -1;

  return {
    plan(i: BgmSyncInput): BgmSyncAction {
      if (i.key !== key) {
        key = i.key;
        deadlineAtStart = i.deadline;
        started = false;
        provisional = false;
        correctedRevision = -1;
      }
      if (started && i.deadline !== deadlineAtStart) return { kind: "none" };
      if (!started) {
        if (i.fresh && i.elapsedMs !== null) {
          return { kind: "play", startAtMs: i.elapsedMs, revision: i.revision, provisional: false };
        }
        if (i.gaveUp) return { kind: "play", startAtMs: 0, revision: i.revision, provisional: true };
        return { kind: "wait" };
      }
      if (i.fresh && i.elapsedMs !== null && (provisional || i.revision !== correctedRevision)) {
        return { kind: "seek", startAtMs: i.elapsedMs, revision: i.revision };
      }
      return { kind: "none" };
    },
    // 実行結果を返す。playはplayBgmの呼び出し自体が完了なので常にok扱い。
    ack(action: BgmSyncAction, result?: BgmCorrectionResult) {
      if (action.kind === "play") {
        started = true;
        provisional = action.provisional;
        correctedRevision = action.provisional ? -1 : action.revision;
      } else if (action.kind === "seek") {
        if (result === "corrected" || result === "within_tolerance" || result === "queued") {
          provisional = false;
          correctedRevision = action.revision;
        }
      }
    },
  };
}
