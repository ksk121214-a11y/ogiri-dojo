// 称号管理画面（/admin/titles）の「対象ライブ」切替・再付与後の再読込を行う純粋ロジック。
// 対象ライブの一覧取得と到達記録の取得は非同期で、利用者がプルダウンを素早く切り替えると
// 古い取得が後から完了する。その結果で新しく選んだライブの画面を上書きしないよう、
// 読込ごとに世代番号を振り、最新の読込以外の結果は破棄する（status: "stale"）。
// 画面からはSupabaseの呼び出しを依存として注入し、テストでは遅延Promiseで順序を制御する。

export interface LimitedRewardLiveOption {
  id: string;
  title: string | null;
  official_sequence_number: number;
}

export interface LimitedRewardQueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export type LimitedRewardPresenceLoadResult<P> =
  | { status: "applied"; liveId: string | null; lives: LimitedRewardLiveOption[]; presence: P[] }
  | { status: "presence_failed"; liveId: string; lives: LimitedRewardLiveOption[] }
  | { status: "lives_failed" }
  | { status: "stale" };

export function createLimitedRewardPresenceLoader<P>(deps: {
  fetchLives: () => Promise<LimitedRewardQueryResult<LimitedRewardLiveOption[]>>;
  fetchPresence: (liveId: string) => Promise<LimitedRewardQueryResult<P[]>>;
}) {
  let latestToken = 0;

  // 通信例外（reject）も失敗として扱い、利用者へ生の例外文言を出さない。
  const settle = <T>(promise: Promise<LimitedRewardQueryResult<T>>): Promise<LimitedRewardQueryResult<T>> =>
    promise.catch(() => ({ data: null, error: { message: "network" } }));

  return {
    async load(preferredLiveId: string | null): Promise<LimitedRewardPresenceLoadResult<P>> {
      latestToken += 1;
      const token = latestToken;

      const livesResult = await settle(deps.fetchLives());
      if (token !== latestToken) return { status: "stale" };
      if (livesResult.error) return { status: "lives_failed" };

      const lives = livesResult.data ?? [];
      // 希望のライブが一覧に無ければ、最も新しい開催番号（一覧の末尾）を選ぶ。
      const liveId = lives.some((l) => l.id === preferredLiveId)
        ? preferredLiveId
        : (lives[lives.length - 1]?.id ?? null);
      if (!liveId) return { status: "applied", liveId: null, lives, presence: [] };

      const presenceResult = await settle(deps.fetchPresence(liveId));
      if (token !== latestToken) return { status: "stale" };
      if (presenceResult.error) return { status: "presence_failed", liveId, lives };
      return { status: "applied", liveId, lives, presence: presenceResult.data ?? [] };
    },
  };
}

// 称号管理画面の表示状態（対象ライブ一覧・選択中のライブ・到達記録）。画面はこの状態を
// 唯一の正として描画し、読み込み結果は必ずapplyPanelLoad経由で反映する。
export interface LimitedRewardPanelState<P> {
  lives: LimitedRewardLiveOption[];
  selectedLiveId: string | null;
  // nullは「読み込み中」。読み込みの成功・失敗のどちらでも必ず非nullへ戻す。
  presence: P[] | null;
  listFailed: boolean;
  presenceFailed: boolean;
}

export function initialPanelState<P>(): LimitedRewardPanelState<P> {
  return { lives: [], selectedLiveId: null, presence: null, listFailed: false, presenceFailed: false };
}

// プルダウン変更：選択したライブIDを直ちに反映し、通信完了までは読み込み中にする
// （完了まで旧ライブの表示へ戻らない）。
export function selectPanelLive<P>(prev: LimitedRewardPanelState<P>, liveId: string): LimitedRewardPanelState<P> {
  return { ...prev, selectedLiveId: liveId, presence: null, presenceFailed: false };
}

// 再試行・再読込の開始：読み込み中に戻す（失敗表示は結果が届くまで残す）。
export function startPanelReload<P>(prev: LimitedRewardPanelState<P>): LimitedRewardPanelState<P> {
  return { ...prev, presence: null, presenceFailed: false };
}

// 読み込み結果の反映。staleは最新表示を一切変えない（古い成功も古い失敗も無視）。
export function applyPanelLoad<P>(
  prev: LimitedRewardPanelState<P>,
  result: LimitedRewardPresenceLoadResult<P>,
): LimitedRewardPanelState<P> {
  switch (result.status) {
    case "applied":
      return { lives: result.lives, selectedLiveId: result.liveId, presence: result.presence, listFailed: false, presenceFailed: false };
    case "presence_failed":
      return { lives: result.lives, selectedLiveId: result.liveId, presence: [], listFailed: false, presenceFailed: true };
    case "lives_failed":
      // 一覧が取れない場合は読み込みを終え、再試行できる状態にする（無限の「読み込み中」にしない）。
      return { ...prev, presence: [], listFailed: true, presenceFailed: false };
    case "stale":
      return prev;
  }
}
