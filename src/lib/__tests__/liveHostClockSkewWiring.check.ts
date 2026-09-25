// 配線確認（3回目レビュー対応・項目1〜3）：
//  - 司会tickが端末時計(Date.now())で「まだ期限前」と判断してRPCを呼ばない処理が
//    残っていない（端末時計±30/60秒ずれても、早送りも0秒停止も起きない）
//  - openReceptionがクライアント時刻からの締切生成・生UPDATEをやめ、open_reception RPCだけを呼ぶ
//  - 画面表示・進行がlives.timing_profile（DB）由来の時間を使う
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const hostSrc = read("src", "store", "useLiveHostStore.ts");

const bodyOf = (src: string, startRe: RegExp): string => {
  const m = startRe.exec(src);
  assert.ok(m, `関数が見つからない: ${startRe}`);
  const start = m!.index;
  const next = src.indexOf("\nasync function ", start + 10);
  const nextFn = src.indexOf("\nfunction ", start + 10);
  const ends = [next, nextFn].filter((n) => n > 0);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined).replace(/\/\/.*$/gm, "");
};

// 1: advanceIfDueに phase_deadline との Date.now() 比較が残っていない
{
  const body = bodyOf(hostSrc, /async function advanceIfDue\(\)/);
  assert.ok(
    !/Date\.now\(\)\s*<\s*new Date\(latest\.phase_deadline\)/.test(body),
    "advanceIfDueにクライアント時計でphase_deadline前を判定してRPCを止める処理が残っている",
  );
  assert.ok(!/if \(!latest\.phase_deadline\) return/.test(body), "phase_deadline無しでRPCを止める処理が残っている");
  console.log("PASS: advanceIfDueは端末時計でphase_deadline前を判定してRPCを止めない（DBが最終判断）");
}

// 2: processRevealQueueにreveal_sequence_untilとのDate.now()比較が残っていない
{
  const body = bodyOf(hostSrc, /async function processRevealQueue\(/);
  assert.ok(!/Date\.now\(\)/.test(body), "processRevealQueueにDate.now()が残っている");
  assert.ok(/reveal_next_answer_if_due/.test(body), "processRevealQueueがreveal_next_answer_if_dueを呼んでいない");
  console.log("PASS: processRevealQueueは端末時計に依存せずreveal RPCを呼ぶ");
}

// 3: resolveIfDueにjudging_ends_atとのDate.now()比較が残っていない
{
  const body = bodyOf(hostSrc, /async function resolveIfDue\(/);
  assert.ok(!/Date\.now\(\)/.test(body), "resolveIfDueにDate.now()が残っている");
  assert.ok(!/deadlinePassed/.test(body), "resolveIfDueにdeadlinePassed判定が残っている");
  assert.ok(/resolve_answer_if_due/.test(body), "resolveIfDueがresolve_answer_if_dueを呼んでいない");
  console.log("PASS: resolveIfDueは端末時計に依存せずresolve RPCを呼ぶ");
}

// 4: openReceptionはRPCのみ。Date.now()・生UPDATEが無い
{
  const m = /openReception: async \(\) => \{[\s\S]*?\n  \},\n/.exec(hostSrc);
  assert.ok(m, "openReceptionが見つからない");
  const body = m![0];
  assert.ok(/\.rpc\("open_reception"/.test(body), "open_receptionを呼んでいない");
  assert.ok(!/Date\.now\(\)/.test(body), "openReceptionにDate.now()が残っている");
  assert.ok(!/\.from\("lives"\)/.test(body), "openReceptionに生のlives更新が残っている");
  assert.ok(!/phase_deadline/.test(body.replace(/\/\/.*$/gm, "")), "openReceptionがphase_deadlineをクライアントで作っている");
  console.log("PASS: openReceptionはopen_reception RPCのみを呼び、クライアント時刻・生UPDATEを使わない");
}

// 5: 実バックエンド版ライブ画面・ストアがビルド時フラグ由来のLIVE_ROOM_TIMINGを直接使わない
{
  for (const f of [
    ["src", "store", "useLiveHostStore.ts"],
    ["src", "components", "live-room", "AudienceAnsweringView.tsx"],
    ["src", "components", "live-room", "StageAnsweringView.tsx"],
    ["src", "components", "live-room", "AudienceJoinPrompt.tsx"],
    ["src", "components", "live-room", "TopicRevealView.tsx"],
    ["src", "app", "live", "page.tsx"],
  ]) {
    const src = read(...f);
    assert.ok(!/\bLIVE_ROOM_TIMING\b/.test(src), `${f.join("/")}が LIVE_ROOM_TIMING を直接使っている`);
    if (!f.includes("TopicRevealView.tsx")) {
      assert.ok(/getLiveRoomTiming/.test(src), `${f.join("/")}が getLiveRoomTiming を使っていない`);
    }
  }
  console.log("PASS: ライブ画面・司会ストアはlives.timing_profileからgetLiveRoomTimingで時間を解決する");
}

// 6: 司会準備画面が本番ライブにshort_testを渡さない
{
  const src = read("src", "app", "live", "host", "page.tsx");
  assert.ok(
    /liveMode === "test" && IS_SHORT_TEST_BUILD \? "short_test" : "standard"/.test(src),
    "timingProfileがtestライブ限定でshort_testになる形になっていない",
  );
  console.log("PASS: timingProfileはtestライブかつ通し稽古ビルドの時だけshort_test");
}


// 7: 4回目レビュー：ローカル残り時間による進行RPC停止が無く、ライブ進行画面が端末時計を使わない
{
  assert.ok(!/answeringRemainingMsTrue\s*(=|<|>)/.test(hostSrc.replace(/\/\/.*$/gm, "")), "ローカル残り時間カウンタが残っている");
  assert.ok(/tryAdvanceAnswering\(/.test(hostSrc), "回答終了の進行がtryAdvanceAnsweringを経由していない");
  for (const f of [
    ["src", "app", "live", "page.tsx"],
    ["src", "app", "live", "host", "page.tsx"],
    ["src", "components", "live-room", "AudienceJoinPrompt.tsx"],
    ["src", "components", "live-room", "AudienceAnsweringView.tsx"],
    ["src", "components", "live-room", "StageAnsweringView.tsx"],
    ["src", "components", "live-room", "TopicRevealView.tsx"],
  ]) {
    const src = read(...f).replace(/\/\/.*$/gm, "");
    assert.ok(!/Date\.now\(\)/.test(src), `${f.join("/")}が端末のDate.now()を使っている`);
    assert.ok(!/useTickingNow/.test(src), `${f.join("/")}がuseTickingNowを使っている`);
  }
  console.log("PASS: ローカルタイマーによる進行停止・画面のDate.now()利用が無い（実際の時刻ずれ挙動はserverClock.check.tsで検証）");
}

// 8: 5回目レビュー：表示画面は同期前に誤った秒数を出さない共通の経路を使い、進行RPCは時計同期を待たない
{
  for (const f of [
    ["src", "app", "live", "page.tsx"],
    ["src", "app", "live", "host", "page.tsx"],
    ["src", "components", "live-room", "AudienceJoinPrompt.tsx"],
    ["src", "components", "live-room", "AudienceAnsweringView.tsx"],
    ["src", "components", "live-room", "StageAnsweringView.tsx"],
  ]) {
    const src = read(...f);
    assert.ok(/useServerClockState/.test(src), `${f.join("/")}が useServerClockState を使っていない`);
    assert.ok(!/\buseServerNow\(/.test(src), `${f.join("/")}が旧useServerNowを使っている`);
  }
  const tick = hostSrc.slice(hostSrc.indexOf("tryAdvanceAnswering({"), hostSrc.indexOf("tryAdvanceAnswering({") + 900);
  assert.ok(!/serverClock|isSynced|useServerClock/.test(tick), "回答終了の進行がサーバー時計の同期に依存している");
  console.log("PASS: 表示は共通のserverClock状態を使い、進行RPCは時計同期に依存しない");
}

console.log("ALL LIVE_HOST_CLOCK_SKEW_WIRING CHECKS PASSED");
