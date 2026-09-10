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

// ===== Realtime 購読の接続状態集約（実際の SUBSCRIBED を待つ）=====
//
// supabase の channel.subscribe() は「購読を開始する」だけで、実際の接続完了は
// 後から status コールバックで SUBSCRIBED が届く。CHANNEL_ERROR / TIMED_OUT /
// CLOSED も届く。進行に必要な複数チャンネルの接続状態を1つに集約し、
// 「全て SUBSCRIBED になったか」「いずれかが異常か」を判定する。
export type ChannelSubscribeStatus =
  | "SUBSCRIBED"
  | "CHANNEL_ERROR"
  | "TIMED_OUT"
  | "CLOSED"
  | (string & {});

export type ChannelSubscribeOutcome = "subscribed" | "error" | "timeout" | "aborted";

export interface ChannelSubscriptionTracker {
  /** チャンネルの status 変化を記録する（必須チャンネル以外は無視）。 */
  note: (channel: string, status: ChannelSubscribeStatus) => void;
  /** 全必須チャンネルが SUBSCRIBED 済みか。 */
  allSubscribed: () => boolean;
  /** いずれかの必須チャンネルが異常（CHANNEL_ERROR / TIMED_OUT / CLOSED）か。 */
  hasFailure: () => boolean;
  /** 現状のスナップショット（テスト・診断用）。 */
  state: () => { subscribed: string[]; failed: string[]; required: string[] };
}

export function createChannelSubscriptionTracker(required: string[]): ChannelSubscriptionTracker {
  const req = [...new Set(required)];
  const subscribed = new Set<string>();
  const failed = new Set<string>();
  return {
    note(channel, status) {
      if (!req.includes(channel)) return;
      if (status === "SUBSCRIBED") {
        subscribed.add(channel);
        failed.delete(channel);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        failed.add(channel);
        subscribed.delete(channel);
      }
    },
    allSubscribed: () => req.every((c) => subscribed.has(c)),
    hasFailure: () => failed.size > 0,
    state: () => ({ subscribed: [...subscribed], failed: [...failed], required: [...req] }),
  };
}

export interface AwaitChannelsDeps {
  tracker: ChannelSubscriptionTracker;
  /** 中断すべきか（stop / 進行世代変更 / 対象liveId変更 / 購読世代の入れ替わり）。 */
  aborted: () => boolean;
  timeoutMs: number;
  pollMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

// 必須チャンネルが全て SUBSCRIBED になるまで待つ。異常・タイムアウト・中断を区別して返す。
// ポーリング方式（pollMs 間隔）。待機中の stop / 世代変更 / 対象liveId変更は
// aborted() で検知して即座に "aborted" を返す（遅れて届く SUBSCRIBED を無視できる）。
export async function awaitChannelsSubscribed(deps: AwaitChannelsDeps): Promise<ChannelSubscribeOutcome> {
  const start = deps.now();
  for (;;) {
    if (deps.aborted()) return "aborted";
    if (deps.tracker.hasFailure()) return "error";
    if (deps.tracker.allSubscribed()) return "subscribed";
    if (deps.now() - start >= deps.timeoutMs) return "timeout";
    await deps.sleep(deps.pollMs);
    // sleep 明けにも中断確認（stop 直後に allSubscribed へ滑り込まないように）。
    if (deps.aborted()) return "aborted";
  }
}

// ===== 取得失敗からの完全復旧オーケストレーション（live確定後の順序）=====
//
// 初回init()のlive取得が失敗し、その後の読み取り再試行で通信が回復した場合、
// 「live行を反映するだけ」では不十分で、children/answers/resolved/scoresの再取得・
// Realtime購読・answeringローカルタイマーの復元まで済ませないと、回答フェーズが
// 0秒で止まる／その後の回答・採点イベントを受信できない、という状態になる。
// init()本体・retry・未初期化状態での手動refresh でこの順序を二重実装しないよう、
// live確定後の一連の手順（各awaitの後の再確認を含む）だけをここへ分離し、副作用は
// 注入する。テストでは遅延Promiseを注入して「途中でstop／別ライブへ切り替わったら
// subscribe/タイマー復元を行わない」「applied以外を ready 扱いしない」等を検証する。
export interface HostHydrationDeps {
  /** 開始時の進行世代。以後 currentGeneration() と一致しなければ stop 扱いで即中断。 */
  startGeneration: number;
  currentGeneration: () => number;
  /** hydrate を開始したときの対象 liveId。 */
  targetLiveId: string;
  /** 現在 state に入っている live.id（取得中に別ライブへ変わったら不一致になる）。 */
  currentLiveId: () => string | null;
  /** この hydrate が今も完全復旧の所有者か（stop や新しい復旧開始で false へ）。 */
  ownsRecovery: () => boolean;
  /** 各スライスの取得。SliceLoadOutcome をそのまま返す（applied のみ正常完了）。 */
  loadChildren: () => Promise<SliceLoadOutcome>;
  loadAnswers: () => Promise<SliceLoadOutcome>;
  /** 確定ログ（表示専用。ready 判定には含めない）。 */
  loadResolved: () => Promise<SliceLoadOutcome>;
  loadScores: () => Promise<SliceLoadOutcome>;
  /** answeringフェーズならローカル残り時間を復元、それ以外は破棄する。 */
  restoreAnsweringTimer: () => void;
  /** loading/error/lastRefreshedAt を確定させる。anyUnconfirmed=true なら注意文言。 */
  finishLoading: (anyUnconfirmed: boolean) => void;
  /**
   * Realtime を対象 liveId で購読し、**必須チャンネルが全て SUBSCRIBED になるまで待つ**。
   * .subscribe() を呼んだだけでは接続完了ではないため、実際の SUBSCRIBED 通知の集約を
   * 待ってから解決する。待機中の stop / 世代変更 / 対象liveId変更 / タイムアウト /
   * 接続異常(CHANNEL_ERROR等) を区別して返す。
   */
  subscribeAndWait: () => Promise<ChannelSubscribeOutcome>;
  /** 全必須チャンネルが SUBSCRIBED 済み ＋ 進行critical スライスが揃った＝完全 ready を記録する。 */
  markRuntimeReady: () => void;
}

// stopped        : 世代が変わった／所有権を失った（何も作らない）
// target-changed : 取得中に別ライブへ切り替わった（古いliveIdでは購読しない）
// not-ready      : 購読はしたが進行critical スライスが未確認／追い越された（凍結して再試行）
// ready          : 全て applied ＋ 購読済み ＋ タイマー復元済み
export type HostHydrationOutcome = "stopped" | "target-changed" | "not-ready" | "ready";

export async function hydrateAfterLive(deps: HostHydrationDeps): Promise<HostHydrationOutcome> {
  // 各awaitの直後・副作用の直前に呼ぶ共通の中断判定。
  const abort = (): HostHydrationOutcome | null => {
    if (deps.currentGeneration() !== deps.startGeneration) return "stopped";
    if (!deps.ownsRecovery()) return "stopped";
    if (deps.currentLiveId() !== deps.targetLiveId) return "target-changed";
    return null;
  };

  let a = abort();
  if (a) return a;
  const children = await deps.loadChildren();
  a = abort();
  if (a) return a;
  const answers = await deps.loadAnswers();
  a = abort();
  if (a) return a;
  const resolved = await deps.loadResolved();
  a = abort();
  if (a) return a;
  const scores = await deps.loadScores();
  a = abort();
  if (a) return a;

  // タイマー復元・loading確定は、購読の前に済ませる（購読直後にRealtimeの
  // SUBSCRIBEDで再取得が走っても、ローカルタイマーの初期値がある状態にする）。
  deps.restoreAnsweringTimer();
  a = abort();
  if (a) return a;

  const anyUnconfirmed =
    children === "unconfirmed" ||
    answers === "unconfirmed" ||
    resolved === "unconfirmed" ||
    scores === "unconfirmed";
  deps.finishLoading(anyUnconfirmed);

  // 購読直前に最後の再確認（progressGeneration・所有権・currentLiveId===targetLiveId）。
  // 古いliveIdでは絶対に購読しない。
  a = abort();
  if (a) return a;
  // .subscribe() を呼ぶだけでなく、必須チャンネルが実際に SUBSCRIBED になるまで待つ。
  const sub = await deps.subscribeAndWait();
  // 待機中に stop / 世代変更 / 対象liveId変更 が起きていないか再確認。
  a = abort();
  if (a) return a;
  if (sub === "aborted") return "stopped";
  if (sub !== "subscribed") {
    // error / timeout：runtime確立しない。呼び出し側（ensureHostRecovery 経由）が
    // 完全復旧を再試行する（advanceIfDue は isHostRuntimeEstablished=false を見て凍結）。
    return "not-ready";
  }

  // ここに来た＝全必須チャンネル SUBSCRIBED 確認済み。
  // markRuntimeReady（＝司会進行環境の「構造」が確立できた）は、進行critical の
  // children/answers/scores が applied または unconfirmed のときに行う。
  // - applied     ：この hydrate が最新データを反映した
  // - unconfirmed ：取得失敗だが購読は張った。以降は per-tick の軽量再試行
  //                 （retryChildrenSnapshot 等）で追いつく＝毎回 full recovery を
  //                 走らせ直す必要はない。
  // superseded / target-changed（別の取得が責任を持つ）が混じっていたら markReady
  // せず「not-ready」で戻す（呼び出し側は凍結を続け、完全復旧を再試行する）。
  const settled = (o: SliceLoadOutcome) => o === "applied" || o === "unconfirmed";
  const structureOk = settled(children) && settled(answers) && settled(scores);
  const progressionReady =
    children === "applied" && answers === "applied" && scores === "applied";
  if (structureOk) deps.markRuntimeReady();
  return progressionReady ? "ready" : "not-ready";
}

// ===== 完全復旧の所有権コーディネータ（init / retry / 未初期化refresh を1本化）=====
//
// 完全復旧の最中に別経路（手動refresh 等）が走ると、liveGate だけ進めて hydrate を
// 中途半端に superseded で終わらせ、しかし liveSnapshotConfirmed=true にしてしまい、
// 購読もタイマー復元もされないまま放置される、という穴があった。
// このコーディネータは「同じ世代の完全復旧が進行中なら、その Promise へ合流する」
// ことを保証する（新しく並行して走らせない）。stop 時は invalidate() で所有権
// トークンを進め、進行中の hydrate の ownsRecovery() を false にする。
export interface RecoveryCoordinator {
  /** 完全復旧を（必要なら開始して）返す。同一世代の進行中があればそれへ合流する。 */
  run: (
    generation: number,
    task: (generation: number, token: number) => Promise<HostHydrationOutcome>,
  ) => Promise<HostHydrationOutcome>;
  /** 進行中トークンを無効化する（stopHostProgress から呼ぶ）。 */
  invalidate: () => void;
  /** そのトークンが今も所有者か（hydrate 内の再確認用）。 */
  owns: (token: number) => boolean;
  /** 現在進行中か（診断・テスト用）。 */
  inFlight: () => boolean;
}

export function createRecoveryCoordinator(): RecoveryCoordinator {
  let inFlight: Promise<HostHydrationOutcome> | null = null;
  let inFlightGeneration = Number.NaN;
  let token = 0;
  return {
    run(generation, task) {
      if (inFlight && inFlightGeneration === generation) return inFlight;
      const myToken = ++token;
      inFlightGeneration = generation;
      const p = task(generation, myToken).finally(() => {
        // 自分がまだ現行トークンのときだけ後始末する（invalidate や新しい run に
        // 追い越されていたら触らない）。
        if (token === myToken) {
          inFlight = null;
          inFlightGeneration = Number.NaN;
        }
      });
      inFlight = p;
      return p;
    },
    invalidate() {
      token += 1;
      inFlight = null;
      inFlightGeneration = Number.NaN;
    },
    owns(t) {
      return t === token;
    },
    inFlight() {
      return inFlight !== null;
    },
  };
}

// ===== 自動進行の凍結判定（await をまたいだ後の再確認に使う純粋述語）=====

export interface ProgressGuardState {
  /** advanceIfDue に入った時点で捕捉した世代。 */
  tickGeneration: number;
  /** 現在の進行世代（stopHostProgress で +1）。 */
  currentGeneration: number;
  liveSnapshotConfirmed: boolean;
  /** 現在 state の live.id。 */
  liveId: string | null;
  /** この tick が対象としている live.id（await をまたいで変わっていないか）。 */
  tickLiveId: string | null;
  /** 司会進行環境（購読・tickTimer・answeringタイマー）が確立済みか。 */
  runtimeEstablished: boolean;
  /** children のスナップショット対象 liveId。 */
  childrenSnapshotLiveId: string | null;
  answersSnapshot: AnswersSnapshotKey | null;
  /** 現在 state の live.current_turn_id。 */
  turnId: string | null;
}

export function progressionFrozen(s: ProgressGuardState, requireAnswers: boolean): boolean {
  if (s.tickGeneration !== s.currentGeneration) return true; // stopHostProgressされた
  if (!s.liveSnapshotConfirmed) return true; // live同期中／未確認
  if (!s.liveId || s.liveId !== s.tickLiveId) return true; // await中に対象ライブが変わった
  if (!s.runtimeEstablished) return true; // 購読／タイマー未確立
  if (!childrenSnapshotReady(s.childrenSnapshotLiveId, s.liveId)) return true; // children同期中
  if (requireAnswers && !answersSnapshotMatches(s.answersSnapshot, s.liveId, s.turnId)) return true;
  return false;
}

// ボット採点insertの可否：凍結していない かつ 表示中の回答がある かつ その回答の
// scoresSnapshot が確認済み（古いscoresで採点しない）のときだけ true。
export function botScoringAllowed(
  frozen: boolean,
  scoresSnapshot: ScoresSnapshotKey | null,
  liveId: string | null,
  turnId: string | null,
  activeAnswerId: string | null,
): boolean {
  if (frozen) return false;
  if (!activeAnswerId) return false;
  return scoresSnapshotMatches(scoresSnapshot, liveId, turnId, activeAnswerId);
}

// Promise.all 内の各ボットが insert する直前の最終確認：凍結していない かつ
// await 前と同じ live.id / current_turn_id のまま のときだけ true。
export function insertGuardPasses(deps: {
  frozen: () => boolean;
  currentLiveId: () => string | null;
  currentTurnId: () => string | null;
  expectedLiveId: string;
  expectedTurnId: string;
}): boolean {
  if (deps.frozen()) return false;
  if (deps.currentLiveId() !== deps.expectedLiveId) return false;
  if (deps.currentTurnId() !== deps.expectedTurnId) return false;
  return true;
}

// ===== advanceIfDue の「await ごとに凍結を再確認しながら順に実行」する共通フロー =====
//
// 各ステップの実行「前」に frozen() を確認し、凍結していれば以降のステップを実行
// しない（processRevealQueue の await 中に未確認になったら runBotBehavior を呼ばない、
// など）。最後のステップの後にも確認し、そのまま次（フェーズ遷移RPC）へ進んでよいかを返す。
export interface GuardedStep {
  name: string;
  run: () => Promise<void>;
}

export async function runGuardedSteps(
  frozen: () => boolean,
  steps: GuardedStep[],
): Promise<{ ran: string[]; blockedAt: string | null }> {
  const ran: string[] = [];
  for (const step of steps) {
    if (frozen()) return { ran, blockedAt: step.name };
    await step.run();
    ran.push(step.name);
  }
  if (frozen()) return { ran, blockedAt: "after-last" };
  return { ran, blockedAt: null };
}
