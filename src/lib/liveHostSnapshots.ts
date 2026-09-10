// useLiveHostStore.ts（司会ストア）の非同期取得まわりの並行制御を、副作用のない
// 純粋関数へ分離したもの。
//
// 解決する問題：
// 1. 取得失敗時に「確認済み」状態まで維持してしまい、advanceIfDueの再取得が
//    作動せず、切断中に追加された回答/組情報を知らないまま自動進行しうる。
//    → 取得失敗時は画面表示データは維持しつつ、確認状態は必ず未確認へ戻す。
// 2. 同じライブ・同じターンでも複数の取得が並行すると、古いリクエストが後から
//    完了して新しい状態を巻き戻せる（liveId/turnIdの一致確認だけでは不十分）。
//    → スライスごとの取得世代番号（SliceGate）で、より新しい取得が始まった後の
//      古い結果を一切反映しない。
// 3. ライブ本体の最新状態を確認できない間も500msタイマーで自動進行してしまう。
//    → liveSnapshotConfirmed が false の間は読み取り再試行だけを行い凍結する。

// ===== スライスごとの取得世代ゲート（並行取得の新旧判定）=====

export interface SliceGate {
  /** 新しい取得を開始する。返り値のトークンを、反映時に isCurrent へ渡す。 */
  begin: () => number;
  /** そのトークンが今も最新（＝これより後に begin されていない）か。 */
  isCurrent: (token: number) => boolean;
  /** 現在の世代番号（テスト・診断用）。 */
  current: () => number;
}

export function createSliceGate(): SliceGate {
  let seq = 0;
  return {
    begin: () => (seq += 1),
    isCurrent: (token: number) => token === seq,
    current: () => seq,
  };
}

// ===== 1スライスの「取得 → 新旧判定 → 反映 / 未確認化」の共通フロー =====

export type SliceLoadOutcome = "applied" | "unconfirmed" | "superseded" | "target-changed";

export interface SliceLoadDeps<TResult> {
  gate: SliceGate;
  /** DBからの取得。{ ok:false } は通信失敗。 */
  fetch: () => Promise<{ ok: boolean; data: TResult }>;
  /** この取得が対象としていたライブ／ターンが、今も現在の対象か。 */
  stillCurrent: () => boolean;
  /** 取得成功かつ最新かつ対象一致のときだけ呼ぶ：画面データを差し替え、確認済みにする。 */
  applyFresh: (data: TResult) => void;
  /** 取得失敗かつ最新かつ対象一致のときだけ呼ぶ：画面データは維持し、確認状態だけ未確認へ戻す。 */
  markUnconfirmed: () => void;
}

export async function loadSnapshotSlice<TResult>(
  deps: SliceLoadDeps<TResult>,
): Promise<SliceLoadOutcome> {
  const token = deps.gate.begin();
  const result = await deps.fetch();
  // より新しい取得が始まっていれば、この（古い）結果は一切反映しない
  // （古いリクエストが後から完了して新しい状態を巻き戻すのを防ぐ）。
  if (!deps.gate.isCurrent(token)) return "superseded";
  // 取得中にライブ／ターンが切り替わっていれば、この結果は今の対象のものではない。
  if (!deps.stillCurrent()) return "target-changed";
  if (result.ok) {
    deps.applyFresh(result.data);
    return "applied";
  }
  deps.markUnconfirmed();
  return "unconfirmed";
}

// ===== 確認済み判定 =====

export function childrenSnapshotReady(
  snapshotLiveId: string | null,
  liveId: string | null | undefined,
): boolean {
  return !!liveId && snapshotLiveId === liveId;
}

export interface AnswersSnapshotKey {
  liveId: string;
  turnId: string;
}

export function answersSnapshotMatches(
  snapshot: AnswersSnapshotKey | null,
  liveId: string | null | undefined,
  turnId: string | null | undefined,
): boolean {
  return (
    !!snapshot && !!liveId && !!turnId && snapshot.liveId === liveId && snapshot.turnId === turnId
  );
}

// ===== 読み取り再試行の間隔制御（single-flight ＋ 最小間隔）=====

export function shouldRetryNow(
  inFlight: boolean,
  lastAttemptAt: number,
  now: number,
  minIntervalMs: number,
): boolean {
  return !inFlight && now - lastAttemptAt >= minIntervalMs;
}

// ===== init()の並行実行制御（initInFlightの所有権）=====

export function shouldReleaseInitInFlight<T>(current: T | null, mine: T): boolean {
  return current === mine;
}
