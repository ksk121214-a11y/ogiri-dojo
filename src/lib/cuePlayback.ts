// 回答の合図（cueId）ごとに効果音を1回だけ鳴らすための記録。
// 同じ合図を、送信ボタンのクリック（自分の回答）と回答席の点灯（全員の回答）の両方から呼んでも、
// 1回しか鳴らさない。Strict Modeの二重実行や再描画でも二重に鳴らない。
export interface CueTracker {
  // 初めて見た合図なら fn を呼び、true を返す。見たことがある合図は何もせず false。
  once(cueId: string, fn: () => void): boolean;
}

const MAX_REMEMBERED_CUES = 200;

export function createCueTracker(): CueTracker {
  const seen = new Set<string>();
  return {
    once(cueId, fn) {
      if (seen.has(cueId)) return false;
      seen.add(cueId);
      if (seen.size > MAX_REMEMBERED_CUES) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      fn();
      return true;
    },
  };
}

// 体験版の画面が共有する合図の記録（画面を開き直しても、同じ合図は二重に鳴らさない）
export const sfxCueTracker = createCueTracker();
