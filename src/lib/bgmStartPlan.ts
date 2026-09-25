// BGMの実際の再生開始時の判断（7回目レビュー対応）。純粋なロジック。
// audioManagerの「デコード/メタデータ読込完了時」「同じ曲のOFF→ON再開時」が使う。
export type BgmStartDecision = "start" | "skip_stale" | "skip_off" | "skip_already_playing";

// 読込完了時に再生を始めてよいか。世代が古い/別の曲なら開始しない（既存の世代管理）。
// 読込中にOFFにされていた場合は、最新のbgmEnabledを再確認して開始しない
// （デコード済みの状態と希望位置は保持され、ONにした時に初めて再生される）。
export function decideBgmStart(p: {
  intentCurrent: boolean;
  nameMatches: boolean;
  enabled: boolean;
  alreadyPlaying: boolean;
}): BgmStartDecision {
  if (!p.intentCurrent || !p.nameMatches) return "skip_stale";
  if (!p.enabled) return "skip_off";
  if (p.alreadyPlaying) return "skip_already_playing";
  return "start";
}

// 再生開始位置(秒)。intentの「今この瞬間の有効な位置」(startAtMs)があればそれを曲の長さで
// modulo して使い、無ければfallbackSec（従来どおりの停止位置・0秒）を使う。
export function resolveBgmOffsetSec(
  startAtMs: number | undefined,
  durationSec: number,
  fallbackSec: number,
): number {
  if (startAtMs == null || !Number.isFinite(startAtMs) || startAtMs < 0) return fallbackSec;
  if (!(durationSec > 0)) return fallbackSec;
  return (startAtMs / 1000) % durationSec;
}

// 8回目レビュー対応：HTMLAudioElementフォールバックでcurrentTimeへ反映する位置(秒)。
// durationが未取得（メタデータ未読込）なら null（loadedmetadata後に再計算する）。
// 負数・NaN・Infinityは0に丸め、durationでmoduloする。
export function resolveFallbackSeekSec(offsetSec: number, durationSec: number): number | null {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;
  const safe = Number.isFinite(offsetSec) && offsetSec > 0 ? offsetSec : 0;
  return safe % durationSec;
}

// ユーザー操作(タップ/「BGMを再開」)による再開の要否。
// - OFF・曲なしは再生しない。
// - 正常に再生中（HTMLAudio: 再生中、Web Audio: 再生中かつAudioContextがrunning）は再スタートしない。
// - 停止中、または「sourceは作成済み(isPlaying)だがAudioContextがsuspendedで時間が進んでいない」
//   場合は、最新位置から作り直して再開する。
export function decideBgmRetry(p: {
  enabled: boolean;
  hasCurrent: boolean;
  paused: boolean; // isBgmPaused
  webAudioStalled: boolean; // Web Audioで、isPlayingだがctxがrunningでない
}): "skip" | "restart" {
  if (!p.enabled || !p.hasCurrent) return "skip";
  if (p.paused || p.webAudioStalled) return "restart";
  return "skip";
}

// 10回目レビュー対応：loadedmetadataリスナーの重複登録防止。待機フラグの確認とtrueへの設定を
// 必ずリスナー登録の「前」に行い、発火時にfalseへ戻す。登録処理が同期例外を投げた場合は
// フラグをtrueのまま残さない。登録した場合だけtrueを返す（待機中はfalse＝登録しない）。
// audioManagerと（テストの）偽Playerが同じこの関数を使う。
export function registerMetadataListenerOnce(
  holder: { metadataWaiting?: boolean },
  add: (onLoaded: () => void) => void,
  handler: () => void,
): boolean {
  if (holder.metadataWaiting) return false;
  holder.metadataWaiting = true;
  try {
    add(() => {
      holder.metadataWaiting = false;
      handler();
    });
  } catch {
    holder.metadataWaiting = false;
    return false;
  }
  return true;
}
