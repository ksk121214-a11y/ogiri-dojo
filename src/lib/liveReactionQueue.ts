"use client";

// 0068追加：ツッコミ/拍手/爆笑の同時表示（キュー方式）対応の共通フック。
// src/components/live-room/TsukkomiDanmakuOverlay.tsx・LaughMarkOverlay.tsx・
// TsukkomiFloatOverlay.tsxが、useLiveFollowerStoreの待機キュー(tsukkomiQueue)から
// 自分が担当する種別のイベントを取り出して画面に表示するために使う。
//
// 設計上のポイント（過負荷対策）：
// - 待機中の全イベントに対して個別にsetTimeoutを大量生成しない。1つの
//   setInterval（tickMs、既定100ms＝80〜120ms程度の間隔）だけで、キューから
//   1件ずつ順番に取り出す「単一の安全な処理ループ」にする。
// - 画面上に実際に表示される件数は maxConcurrent（8〜12件程度）で頭打ちにする。
//   表示中の1件ぶんの「表示終了後に消す」タイマーだけは個別に持つ（この件数は
//   maxConcurrentで必ず小さく抑えられているため、大量生成の問題にはならない）。
// - コンポーネントのアンマウント時に、setInterval・表示中アイテムぶんの
//   setTimeoutを全て破棄し、表示中アイテムも空にする。
// - このフック内の処理は try/catch で囲み、リアクション表示側の例外が
//   ライブ進行（フェーズタイマー・回答受付・採点等）に一切影響しないようにする
//   （store側のclaimReactionEvent・tsukkomiQueueもライブ進行のstateとは
//   完全に別のフィールドであり、参照すらしていない）。
//
// 2026-XX（Codexレビュー再対応・問題4）：TsukkomiDanmakuOverlay（danmaku、
// maxConcurrent=10・表示4.2秒）とLaughMarkOverlay（laugh、maxConcurrent=10・
// 表示0.9秒）は同じ画面に同時にマウントされるが、以前はそれぞれ独立した
// itemsCountRefで自分の同時表示数だけを見ており、「全リアクション種別を合計した
// 同時表示数」を頭打ちにする仕組みが無かった（理論上、瞬間的に最大20件が同時に
// 画面へ出うる状態だった）。
// - tick処理の本体（「共有カウンタを見てキューから1件claimする／表示終了で
//   減らす」ロジック）を、Reactに依存しない ReactionDisplayScheduler クラスへ
//   切り出した。useTsukkomiReactionQueueはこれをuseEffect内でラップするだけに
//   なる。src/lib/__tests__/store/useLiveFollowerStoreReactionQueue.check.tsから
//   直接importし、setInterval/setTimeoutの代わりに手動でtick(nowMs)を呼びながら
//   実時間を待たずに決定的に検証できるようにするための設計でもある。
// - 全インスタンス（danmaku用・laugh用など）が共有するモジュールスコープの
//   カウンタ（sharedReactionDisplayCounter）を新設し、各スケジューラのtickは
//   「自分のmaxConcurrent」と「共有カウンタの合計上限(TSUKKOMI_TOTAL_DISPLAY_MAX,
//   目安12件)」の両方を満たす場合だけclaimする。表示終了時（アニメーション完了・
//   フォールバックタイマーいずれか先着・アンマウント時のdispose含む）に必ず
//   共有カウンタをデクリメントし、増減が対称になる（リークしない）ようにする。
//   複数のライブ画面インスタンスが同時にマウントされることは無い前提のため、
//   既存のtsukkomiIdCounter等と同じ考え方でモジュールスコープの変数として持つ。
import { useEffect, useRef, useState } from "react";

import { useLiveFollowerStore, type TsukkomiEvent } from "@/store/useLiveFollowerStore";

const DEFAULT_TICK_MS = 100;

// 全リアクション種別（danmaku・laugh等）を合計した、画面上の同時表示数の安全な
// 上限。danmaku単体のmaxConcurrent(10)より少し余裕を持たせた値。
export const TSUKKOMI_TOTAL_DISPLAY_MAX = 12;

export interface SharedDisplayCounter {
  get(): number;
  increment(): void;
  decrement(): void;
  reset(): void;
}

function createSharedDisplayCounter(): SharedDisplayCounter {
  let count = 0;
  return {
    get: () => count,
    increment: () => {
      count += 1;
    },
    decrement: () => {
      count = Math.max(0, count - 1);
    },
    reset: () => {
      count = 0;
    },
  };
}

// 本番では、useTsukkomiReactionQueueの全インスタンス（danmaku担当・laugh担当）が
// このモジュール単位のシングルトンを共有する。テストからは独自のインスタンスを
// 注入できる（ReactionDisplaySchedulerOptions.sharedCounter）。
export const sharedReactionDisplayCounter: SharedDisplayCounter = createSharedDisplayCounter();

export interface ReactionDisplaySchedulerOptions {
  // 待機キューから、自分が担当する種別のイベントを1件だけ取り出す
  // （通常はuseLiveFollowerStore.getState().claimReactionEventをそのまま渡す）。
  claim: (predicate: (event: TsukkomiEvent) => boolean, now?: number) => TsukkomiEvent | null;
  predicate: (event: TsukkomiEvent) => boolean;
  // このインスタンス（danmaku担当・laugh担当それぞれ）単独の同時表示数の上限。
  maxConcurrent: number;
  // 全インスタンス合計の同時表示数の上限（既定TSUKKOMI_TOTAL_DISPLAY_MAX）。
  totalMax?: number;
  sharedCounter?: SharedDisplayCounter;
}

// Reactに依存しない純粋なスケジューラ本体。useTsukkomiReactionQueueはこれを
// useEffect内でラップするだけにする。src/lib/__tests__/store/
// useLiveFollowerStoreReactionQueue.check.tsから直接importし、setInterval/
// setTimeoutの代わりに手動でtick(nowMs)を呼びながら、実時間を待たずに
// 決定的に検証する。
export class ReactionDisplayScheduler {
  private readonly claim: ReactionDisplaySchedulerOptions["claim"];
  private readonly predicate: ReactionDisplaySchedulerOptions["predicate"];
  private readonly maxConcurrent: number;
  private readonly totalMax: number;
  private readonly sharedCounter: SharedDisplayCounter;
  // 表示中のid → 表示終了予定時刻(ms)。手動tick駆動のテストではcollectDueで
  // 期限超過分を検出し、本番のsetTimeoutベースの実装では個別タイマーで検出する
  // （どちらの経路で終了しても、必ずremove()を呼んで対称にデクリメントする）。
  private readonly pending = new Map<string, number>();

  constructor(options: ReactionDisplaySchedulerOptions) {
    this.claim = options.claim;
    this.predicate = options.predicate;
    this.maxConcurrent = options.maxConcurrent;
    this.totalMax = options.totalMax ?? TSUKKOMI_TOTAL_DISPLAY_MAX;
    this.sharedCounter = options.sharedCounter ?? sharedReactionDisplayCounter;
  }

  // 現在このスケジューラが表示中として保持している件数。
  get displayedCount(): number {
    return this.pending.size;
  }

  // 1tickぶんの処理。表示できる余地（自分の上限・全体共有の上限の両方）が
  // あればキューから1件取り出し、内部状態を更新して返す。無ければnullを返す。
  tick(nowMs: number, holdMs: number): TsukkomiEvent | null {
    if (this.pending.size >= this.maxConcurrent) return null;
    if (this.sharedCounter.get() >= this.totalMax) return null;
    const claimed = this.claim(this.predicate, nowMs);
    if (!claimed) return null;
    this.pending.set(claimed.id, nowMs + holdMs);
    this.sharedCounter.increment();
    return claimed;
  }

  // 表示終了時（アニメーション完了・フォールバックタイマーいずれか先着）に呼ぶ。
  // 表示中でないidが渡されても安全に無視する（多重呼び出しで二重減算しない）。
  remove(id: string): void {
    if (!this.pending.has(id)) return;
    this.pending.delete(id);
    this.sharedCounter.decrement();
  }

  // 手動tick駆動のテスト専用：nowMs時点で表示終了予定を過ぎているidの一覧を返す
  // （呼び出し元がそれぞれについてremove()を呼ぶ想定。本番のsetTimeoutと同じ
  // 「holdMs経過したら空ける」判定を、実時間を待たずに再現するために使う）。
  collectDue(nowMs: number): string[] {
    const due: string[] = [];
    for (const [id, dueAt] of this.pending) {
      if (nowMs >= dueAt) due.push(id);
    }
    return due;
  }

  // アンマウント相当：表示中の全アイテムを片付け、共有カウンタも正しく減算する
  // （増減の対称性を保ち、リークしないことをテストで確認する）。
  dispose(): void {
    for (const id of [...this.pending.keys()]) {
      this.remove(id);
    }
  }
}

export interface RunReactionQueueTickOptions<T extends { id: string }> {
  scheduler: ReactionDisplayScheduler;
  now: number;
  holdMs: number;
  mapToDisplay: (event: TsukkomiEvent, styleIndex: number) => T;
  getStyleIndex: () => number;
  advanceStyleIndex: () => void;
  // 表示開始時（claim成功＋mapToDisplay成功後）に呼ばれる。本番ではsetItemsで
  // 画面に追加する。schedulerIdはscheduler側の管理キー（＝claimed.id）そのもの。
  // mapToDisplayが返すitem.idがこれと異なる実装であっても、呼び出し元
  // （フック）がid対応表を保守できるように渡す。
  onDisplay: (item: T, schedulerId: string) => void;
  // 表示終了（fallbackタイマー発火）時に呼ばれる。schedulerの解放は、この
  // 呼び出しより前に必ずschedulerId（claimed.id）で行われている。呼び出し元は
  // 表示用item.idを使って画面・タイマーマップから取り除く。
  onFallbackExpire: (displayId: string) => void;
  // claim成功・onDisplayまで完了した後、scheduleTimerまたはregisterTimerが
  // 例外を投げた場合にだけ呼ばれる、表示のロールバック専用コールバック。
  // 「画面に追加済みのdisplayItemを取り除く」だけに責務を限定し、共有枠の
  // 解放・タイマー破棄はrunReactionQueueTick側が別途行う（正常系の
  // onFallbackExpireと混同しない）。
  onDisplayRollback: (displayId: string) => void;
  // 表示終了タイマーの生成・破棄・登録。本番ではsetTimeout/clearTimeout/
  // timers.setをそのまま渡す。テストからは実時間を待たない偽実装を注入できる。
  scheduleTimer: (run: () => void, ms: number) => unknown;
  cancelTimer: (timer: unknown) => void;
  registerTimer: (id: string, timer: unknown) => void;
  onError: (e: unknown) => void;
}

// onError自体が例外を投げても、その先の後始末（scheduler解放・タイマー破棄・
// 表示ロールバック）を止めないための保険。onErrorの失敗はこれ以上通知しようが
// ないため黙殺する。
function reportError(onError: (e: unknown) => void, e: unknown): void {
  try {
    onError(e);
  } catch {
    // 無視する：onError自体の失敗をさらに上へ伝播させない。
  }
}

// actionを実行し、例外が起きたらonErrorへ報告した上で握りつぶす（呼び出し元へ
// 再スローしない）。cleanup処理（scheduler解放・タイマー破棄・表示ロールバック）の
// どの1ステップが失敗しても、他のステップの実行や呼び出し元（tickループ）への
// 伝播を妨げないようにするための共通ヘルパー。
function safely(onError: (e: unknown) => void, action: () => void): void {
  try {
    action();
  } catch (e) {
    reportError(onError, e);
  }
}

// 1tickぶんの「claim→表示登録」処理の実体。useTsukkomiReactionQueueのuseEffect内
// のtick関数はこれを呼ぶだけにする（React非依存の関数として切り出すことで、
// src/lib/__tests__/store/useLiveFollowerStoreReactionQueue.check.tsから、本番と
// 全く同じ経路を、setInterval/setTimeoutの実時間待ちなしに決定的に検証できる）。
//
// schedulerの管理用ID（pendingへの登録・remove時の解放）は、常にclaimed.id
// （下記schedulerId）に統一する。mapToDisplayが元イベントと異なるIDを返す
// 実装であっても、schedulerへの登録・解放が食い違って共有枠がリークすることは
// ない（表示用item.idはあくまで画面・タイマーマップの管理にのみ使う）。
//
// claim成功後（＝共有枠を確保済みの状態）にmapToDisplay・onDisplay・
// scheduleTimer・registerTimerのいずれで例外が起きても、安全側に倒して
// 次の順序で必ず後始末する（各ステップは個別にtry/catchで囲み、途中の1つが
// 失敗しても残りのステップは実行される。cleanup中の例外がtickの呼び出し元
// ＝ライブ進行側へ伝播することは無い）：
//   1. scheduler.remove(schedulerId)で共有枠を最優先で解放する
//   2. onErrorへ例外を報告する
//   3. 生成済みのタイマーがあればcancelTimerで破棄する
//   4. mapToDisplayが成功していた（＝表示項目が生成されていた）場合、
//      onDisplayが実際に画面へ反映できたかどうかによらず、
//      onDisplayRollbackで画面から取り除く（onDisplayが例外の途中で
//      一部だけ処理していた可能性を考慮し、安全側に倒す）。
export function runReactionQueueTick<T extends { id: string }>(
  options: RunReactionQueueTickOptions<T>,
): void {
  const {
    scheduler,
    now,
    holdMs,
    mapToDisplay,
    getStyleIndex,
    advanceStyleIndex,
    onDisplay,
    onFallbackExpire,
    onDisplayRollback,
    scheduleTimer,
    cancelTimer,
    registerTimer,
    onError,
  } = options;

  // claim自体（scheduler.tick）で例外が起きた場合は共有枠を確保できていない
  // ため、remove()は呼ばずログだけ残して抜ける。
  let claimed: TsukkomiEvent | null = null;
  try {
    claimed = scheduler.tick(now, holdMs);
  } catch (e) {
    reportError(onError, e);
    return;
  }
  if (!claimed) return;
  // schedulerの管理用IDはこの1tick処理を通じて必ずこの値（claimed.id）を使う。
  const schedulerId = claimed.id;

  let displayItem: T | undefined;
  let timer: unknown;
  let timerCreated = false;
  try {
    const item = mapToDisplay(claimed, getStyleIndex());
    // mapToDisplayが成功した時点で「ロールバックが必要になりうる」対象とみなす。
    // この後onDisplay自体が例外を投げた場合でも、部分的に副作用（例：id対応表への
    // 登録）が発生している可能性があるため、安全側に倒してロールバック対象に含める。
    displayItem = item;
    advanceStyleIndex();
    onDisplay(item, schedulerId);
    timer = scheduleTimer(() => {
      // 正常なフォールバック終了時も、schedulerの解放（共有枠の解放）を
      // 最優先で必ず実行し、onFallbackExpire側の失敗がそれを妨げないように
      // 個別にtry/catchで囲む。schedulerの解放は必ずschedulerId（claimed.id）
      // で行う。item.idを使うと、mapToDisplayが元イベントと異なるIDを返す
      // ケースでpendingから削除できず、共有表示枠がリークする。
      safely(onError, () => scheduler.remove(schedulerId));
      safely(onError, () => onFallbackExpire(item.id));
    }, holdMs);
    timerCreated = true;
    registerTimer(item.id, timer);
  } catch (e) {
    // リアクション表示側の例外はここで握りつぶし、ライブ進行（フェーズ
    // タイマー・回答受付・採点等）には一切影響させない。各後始末ステップを
    // 個別にtry/catchで囲み、1つが失敗しても残りは必ず実行する。
    // 1) 共有枠の解放を最優先で実行する（remove()は多重呼び出しに対して
    //    安全なガード付きのため、後続のonAnimationComplete/fallback timeoutと
    //    競合しても二重減算されない）。
    safely(onError, () => scheduler.remove(schedulerId));
    // 2) 例外そのものを呼び出し元へ報告する。
    reportError(onError, e);
    // 3) 生成済みのタイマーがあれば破棄する。
    if (timerCreated) safely(onError, () => cancelTimer(timer));
    // 4) mapToDisplayが成功していた場合は、onDisplayの成否によらず画面から
    //    ロールバックする（安全側に倒す）。
    if (displayItem) safely(onError, () => onDisplayRollback(displayItem!.id));
  }
}

export interface UseTsukkomiReactionQueueOptions<T extends { id: string }> {
  // このオーバーレイが表示を担当するイベントかどうか（例：爆笑だけ、爆笑以外）。
  predicate: (event: TsukkomiEvent) => boolean;
  // 画面上の同時表示数の上限（8〜12件程度を推奨）。全種別合計の上限は別途
  // TSUKKOMI_TOTAL_DISPLAY_MAXで頭打ちにされる。
  maxConcurrent: number;
  // 表示開始からこのミリ秒後に自動的にDOMから取り除く（アニメーション完了時の
  // onAnimationCompleteと合わせて、確実に消えるようにする保険。スケジューラの
  // 「表示終了」判定にも使う）。
  removeFallbackMs: number;
  // キューから取り出したイベント＋表示用の通し番号(styleIndex)から、実際に画面へ
  // 積む表示アイテム（座標・軌道等、呼び出し元ごとの演出情報を含む）を組み立てる。
  mapToDisplay: (event: TsukkomiEvent, styleIndex: number) => T;
  // 取り出す間隔（ミリ秒）。既定は80〜120ms程度を狙った100ms。
  tickMs?: number;
}

export function useTsukkomiReactionQueue<T extends { id: string }>(
  options: UseTsukkomiReactionQueueOptions<T>,
): { items: T[]; remove: (id: string) => void } {
  const { predicate, maxConcurrent, removeFallbackMs, mapToDisplay, tickMs = DEFAULT_TICK_MS } = options;
  const [items, setItems] = useState<T[]>([]);
  const styleIndexRef = useRef(0);
  // predicate/mapToDisplayは呼び出し側でインラインのアロー関数として渡されることが
  // 多く、毎レンダーで参照が変わる。intervalを毎回作り直さずに済むようrefで持つ
  // （refの更新自体はuseEffect内で行い、レンダー中に直接書き換えない）。
  const predicateRef = useRef(predicate);
  const mapRef = useRef(mapToDisplay);
  const fallbackTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const schedulerRef = useRef<ReactionDisplayScheduler | null>(null);
  // 表示用item.id → scheduler管理用id(claimed.id)の対応表。mapToDisplayが
  // 元イベントと異なるIDを返す実装であっても、外部（onAnimationComplete等）
  // からdisplayItem.idでremove()された時にscheduler側を正しいIDで解放できる
  // ようにする（本番のmapToDisplayはevent.idをそのまま使うため通常は同じ値に
  // なるが、共通処理としてこの前提に依存しない）。
  const schedulerIdByDisplayIdRef = useRef(new Map<string, string>());

  useEffect(() => {
    predicateRef.current = predicate;
  }, [predicate]);

  useEffect(() => {
    mapRef.current = mapToDisplay;
  }, [mapToDisplay]);

  const remove = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    const schedulerId = schedulerIdByDisplayIdRef.current.get(id) ?? id;
    schedulerIdByDisplayIdRef.current.delete(id);
    schedulerRef.current?.remove(schedulerId);
    const timer = fallbackTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      fallbackTimersRef.current.delete(id);
    }
  };

  useEffect(() => {
    let disposed = false;
    const timers = fallbackTimersRef.current;
    const schedulerIdByDisplayId = schedulerIdByDisplayIdRef.current;
    // このインスタンス（danmaku担当・laugh担当それぞれ）専用のスケジューラを
    // 1つ作る。sharedCounterは省略してモジュール単位のシングルトンを使う
    // （＝他のuseTsukkomiReactionQueueインスタンスと合計上限を共有する）。
    const scheduler = new ReactionDisplayScheduler({
      claim: (p, now) => useLiveFollowerStore.getState().claimReactionEvent(p, now),
      predicate: (event) => predicateRef.current(event),
      maxConcurrent,
    });
    schedulerRef.current = scheduler;

    const tick = () => {
      if (disposed) return;
      runReactionQueueTick({
        scheduler,
        now: Date.now(),
        holdMs: removeFallbackMs,
        mapToDisplay: (event, styleIndex) => mapRef.current(event, styleIndex),
        getStyleIndex: () => styleIndexRef.current,
        advanceStyleIndex: () => {
          styleIndexRef.current += 1;
        },
        onDisplay: (item, schedulerId) => {
          schedulerIdByDisplayId.set(item.id, schedulerId);
          setItems((prev) => [...prev, item]);
        },
        onFallbackExpire: (id) => {
          schedulerIdByDisplayId.delete(id);
          timers.delete(id);
          if (disposed) return;
          setItems((prev) => prev.filter((it) => it.id !== id));
        },
        onDisplayRollback: (id) => {
          schedulerIdByDisplayId.delete(id);
          // 通常はここに到達する時点でタイマーはまだ登録されていない
          // （registerTimer自体が失敗した場合はtimers.set前に例外が飛ぶため）が、
          // 「該当するタイマーマップの情報も削除する」という安全側の要件に
          // 沿って、念のため明示的に消しておく（無ければ何もしない）。
          const timer = timers.get(id);
          if (timer) {
            clearTimeout(timer);
            timers.delete(id);
          }
          if (disposed) return;
          setItems((prev) => prev.filter((it) => it.id !== id));
        },
        scheduleTimer: (run, ms) => setTimeout(run, ms),
        cancelTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
        registerTimer: (id, timer) => timers.set(id, timer as ReturnType<typeof setTimeout>),
        onError: (e) => {
          // リアクション表示側の例外はここで握りつぶし、ライブ進行（フェーズ
          // タイマー・回答受付・採点等）には一切影響させない。
          console.warn("[tsukkomi] リアクション表示処理でエラーが発生しました", e);
        },
      });
    };

    const interval = setInterval(tick, tickMs);
    return () => {
      // コンポーネントのアンマウント時：待機キューを処理するタイマー・表示中
      // アイテムぶんのタイマーを全て破棄し、表示中アイテムも空にする。
      // scheduler.dispose()で共有カウンタも正しく（増減対称に）戻す。
      disposed = true;
      clearInterval(interval);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      schedulerIdByDisplayId.clear();
      scheduler.dispose();
      schedulerRef.current = null;
      setItems([]);
    };
  }, [maxConcurrent, removeFallbackMs, tickMs]);

  return { items, remove };
}
