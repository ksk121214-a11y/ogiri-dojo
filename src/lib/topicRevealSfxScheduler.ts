// お題発表の拍手音スケジューラ（5回目レビュー対応）。「予約済み(タイマー)」と
// 「再生済み(played)」を別の状態として持つ。
// - update()：サーバー時計のrevisionが変わった・タブが表示に戻った等のたびに呼ぶと、
//   未再生の予約を一度取り消して、その瞬間のサーバー時刻でplanTopicRevealSfxを再計算する。
// - タイマー発火時も無条件に先頭再生せず、その瞬間のサーバー時刻で再計算する
//   （まだ早ければ再予約、少し遅れていれば途中から、尺以上に遅れていれば再生しない）。
// - 一度再生（またはskipで確定）したら、同じdeadline（同じお題発表）では二度と再生しない。
// - deadlineが変わったら新しいお題として予約・再生状態をリセットする。
// - サーバー時計がfreshでない（未同期・同期中・スリープ復帰後のstale）間はnowIfFresh()=nullで、
//   予約・再生・skip確定を一切しない。タイマーが発火してもnullなら何も確定しない
//   （freshへ戻った通知＝revision変化を受けたupdateで改めて予約する）。
import { planTopicRevealSfx } from "./topicRevealSfx";

export interface TopicRevealSfxSchedulerDeps {
  nowIfFresh: () => number | null;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  play: (offsetSec: number) => void;
  seMs: number;
  overlapMs: number;
}

export function createTopicRevealSfxScheduler(deps: TopicRevealSfxSchedulerDeps) {
  let key: string | null = null;
  let played = false;
  let timer: unknown = null;
  let disposed = false;

  const cancel = () => {
    if (timer !== null) deps.clearTimeout(timer);
    timer = null;
  };

  const evaluate = () => {
    if (disposed || played || key === null) return;
    const now = deps.nowIfFresh();
    if (now === null) return;
    const plan = planTopicRevealSfx({
      deadlineMs: new Date(key).getTime(),
      serverNowMs: now,
      seMs: deps.seMs,
      overlapMs: deps.overlapMs,
    });
    if (plan.kind === "wait") {
      timer = deps.setTimeout(() => {
        timer = null;
        evaluate(); // 発火時点でも再判定する（遅延発火で先頭再生しない）
      }, plan.delayMs);
    } else if (plan.kind === "offset") {
      played = true;
      deps.play(plan.offsetSec);
    } else {
      played = true; // skip：再生せず確定
    }
  };

  return {
    update(deadline: string | null) {
      if (disposed) return;
      if (deadline !== key) {
        cancel();
        key = deadline;
        played = false;
      }
      if (played || key === null) return;
      cancel();
      evaluate();
    },
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
