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
  /**
   * 取得開始時（gate.begin() 直後・fetch 前）に同期的に呼ぶ。省略可。
   * この瞬間、画面の表示データは「最新かどうか未確認」なので、進行に使う確認状態
   * だけを未確認へ落とす（表示データはそのまま維持する）。Realtimeの変更検知・
   * 再接続・focus復帰init・手動refreshなど「最新を取り直し始めた」全経路で使う。
   * gate.begin() の直後に呼ぶため、これより前に始まった古い取得は既に無効化
   * されており、古い completion がこの markPending を上書きすることはない。
   */
  markPending?: () => void;
}

export async function loadSnapshotSlice<TResult>(
  deps: SliceLoadDeps<TResult>,
): Promise<SliceLoadOutcome> {
  const token = deps.gate.begin();
  // 取得を「開始した」時点で、このスライスの表示データは最新か未確認。
  // 確認状態だけ未確認へ落とす（表示データは維持）。gate.begin() 済みなので、
  // これより前の古い取得は superseded 側に回り、この呼び出しを妨げない。
  deps.markPending?.();
  const result = await deps.fetch();
  // より新しい取得が始まっていれば、この（古い）結果は一切反映しない
  // （古いリクエストが後から完了して新しい状態を巻き戻す／未確認へ戻すのを防ぐ）。
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

// scoresは (liveId, turnId) だけでなく「今まさに表示・採点中の回答」まで一致して
// 初めて信頼できる。回答Aのscores取得中に回答Bへ切り替わったとき、Aの結果を
// Bへ反映しないための識別情報。
export interface ScoresSnapshotKey {
  liveId: string;
  turnId: string;
  answerId: string;
}

export function scoresSnapshotMatches(
  snapshot: ScoresSnapshotKey | null,
  liveId: string | null | undefined,
  turnId: string | null | undefined,
  answerId: string | null | undefined,
): boolean {
  return (
    !!snapshot &&
    !!liveId &&
    !!turnId &&
    !!answerId &&
    snapshot.liveId === liveId &&
    snapshot.turnId === turnId &&
    snapshot.answerId === answerId
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

// ===== 読み取り再試行の所有権（stop前の古いretryが新しいretryのフラグを解除しない）=====
//
// retry処理は開始時に共有boolean(XRetryInFlight)をtrueにし、finallyでfalseへ戻す。
// stopHostProgress()が進行世代(progressGeneration)を+1し、共有booleanも一旦falseへ
// 戻した後、新しいセッションのretryが始まって共有booleanを再びtrueにしていると、
// stop前に開始した古いretryのfinallyが無条件にfalseへ戻すことで single-flight が
// 壊れる（新旧2本のretryが同時に走れてしまう）。開始時に覚えた世代が、finally
// 時点でも現在の世代と一致するときだけ解除してよい（shouldReleaseInitInFlightと
// 同じ「自分が現行の所有者のときだけ後始末する」考え方）。
export function shouldReleaseRetryFlag(currentGeneration: number, myGeneration: number): boolean {
  return currentGeneration === myGeneration;
}

// ===== 取得失敗からの完全復旧オーケストレーション（live確定後の順序）=====
//
// 初回init()のlive取得が失敗し、その後の読み取り再試行で通信が回復した場合、
// 「live行を反映するだけ」では不十分で、children/answers/resolved/scoresの再取得・
// Realtime購読・answeringローカルタイマーの復元まで済ませないと、回答フェーズが
// 0秒で止まる／その後の回答・採点イベントを受信できない、という状態になる。
// init()本体とこの復旧処理で同じ順序を二重実装しないよう、live確定後の一連の
// 手順（各awaitの後のstop確認を含む）だけをここへ分離し、副作用は注入する。
// テストでは遅延Promiseを注入して「途中でstopされたらsubscribe/タイマー復元を
// 行わない」「復旧後は正しいliveIdでsubscribeする」等の順序を検証する。
export interface HostHydrationDeps {
  /** 開始時の進行世代。以後 currentGeneration() と一致しなければ stop 扱いで即中断。 */
  startGeneration: number;
  currentGeneration: () => number;
  /** children（participants/groups/topics/turns/profiles）の取得・反映。 */
  loadChildren: () => Promise<{ ok: boolean }>;
  /** 現在ターンの answers（＋scoresクリア）の取得・反映。 */
  loadAnswers: () => Promise<{ ok: boolean }>;
  /** 確定ログ resolvedAnswers/resolvedScoresByAnswer の取得・反映（表示専用）。 */
  loadResolved: () => Promise<{ ok: boolean }>;
  /** 現在表示中の回答があれば、その scores を取得・反映。 */
  loadScores: () => Promise<{ ok: boolean }>;
  /** answeringフェーズならローカル残り時間を復元、それ以外は破棄する。 */
  restoreAnsweringTimer: () => void;
  /** loading/error/lastRefreshedAt を確定させる。anyUnconfirmed=true なら注意文言。 */
  finishLoading: (anyUnconfirmed: boolean) => void;
  /** Realtime を対象 liveId で購読する（同期的に channel を作る前提）。 */
  subscribe: () => void;
}

export type HostHydrationOutcome = "stopped" | "ready";

export async function hydrateAfterLive(deps: HostHydrationDeps): Promise<HostHydrationOutcome> {
  const stopped = () => deps.currentGeneration() !== deps.startGeneration;

  const children = await deps.loadChildren();
  if (stopped()) return "stopped";
  const answers = await deps.loadAnswers();
  if (stopped()) return "stopped";
  const resolved = await deps.loadResolved();
  if (stopped()) return "stopped";
  const scores = await deps.loadScores();
  if (stopped()) return "stopped";

  // タイマー復元・loading確定は、購読の前に済ませる（購読直後にRealtimeの
  // SUBSCRIBEDで再取得が走っても、ローカルタイマーの初期値がある状態にする）。
  deps.restoreAnsweringTimer();
  deps.finishLoading(!children.ok || !answers.ok || !resolved.ok || !scores.ok);

  // subscribe直前に最後のstop確認。ここを通過したら subscribe は同期実行され、
  // その間に stopHostProgress が割り込む余地は無い（JSは単一スレッド）。
  if (stopped()) return "stopped";
  deps.subscribe();
  return "ready";
}
