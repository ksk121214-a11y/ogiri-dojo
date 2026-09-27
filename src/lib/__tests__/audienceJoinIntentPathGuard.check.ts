// 本番テストライブで確認した回帰：ConsentRequiredGateは同意確認中(checking)の間、配下の
// children（/liveページ本体）を一時的にアンマウントする。ゲスト観客ボタン押下→匿名認証成功の
// 直後はauthUserのid変化によりこの一時アンマウントが起きるため、意図の破棄を/live側の
// コンポーネントのアンマウントに結びつけると、同意・匿名認証が成功していてもjoin_liveが
// 一度も呼ばれない（本番で確認・修正済み）。
//
// この検証は実際にpathname遷移をシミュレートして、意図が正しく保持/破棄されることを確認する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isLiveParticipantPath } from "../liveParticipantPath";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

// 1) パス判定：/live・/live/だけが対象。司会コンソール・デモ・予定ページ等は対象外。
assert.equal(isLiveParticipantPath("/live"), true);
assert.equal(isLiveParticipantPath("/live/"), true);
for (const p of ["/live/host", "/live/host/", "/live-demo", "/live-demo/", "/live/design-preview", "/live/design-preview/", "/live-schedule", "/live-schedule/", "/", "/mypage"]) {
  assert.equal(isLiveParticipantPath(p), false, `${p} を/live本体と誤判定している`);
}

// 2) ガード本体：pathnameが/liveのまま変わらない限り（=ConsentRequiredGateの一時アンマウントの
//    ような、実際には離脱していない再レンダー相当）discard()を呼ばない。実際に離れた時だけ
//    discard()・ゲスト同意モーダルのcancel()を呼ぶ。ロジックをここで再現して検証する
//    （実DOM無しでReactコンポーネントの再マウントは再現できないため、同じ判定ロジックを
//    guard関数として抽出し、それをここと本体コンポーネントの両方で使う形にはせず、コンポーネント
//    側の実装が同じ条件式であることをソースで確認する形にする）。
{
  let discardCalls = 0;
  let cancelCalls = 0;
  const pendingKind: "guest" | "x-login" | null = "guest";
  const simulate = (() => {
    let wasOnLive = isLiveParticipantPath("/live/");
    return (pathname: string) => {
      const onLiveNow = isLiveParticipantPath(pathname);
      if (wasOnLive && !onLiveNow) {
        discardCalls += 1;
        if (pendingKind === "guest") cancelCalls += 1;
      }
      wasOnLive = onLiveNow;
    };
  })();
  simulate("/live/"); // 同じページ内の再レンダー・一時アンマウント相当：離脱していない
  assert.equal(discardCalls, 0, "同一ページ内の変化なしでdiscardが呼ばれた");
  simulate("/live/"); // ConsentRequiredGateのchecking→accepted相当（pathnameは変わらない）
  assert.equal(discardCalls, 0, "pathname不変（一時アンマウント相当）でdiscardが呼ばれた");
  simulate("/"); // 実際にホームへ離脱
  assert.equal(discardCalls, 1, "実際のページ離脱でdiscardが呼ばれない");
  assert.equal(cancelCalls, 1, "ページ離脱時にゲスト同意モーダルがキャンセルされない");
  simulate("/mypage"); // 既に/liveにいないので、離脱扱いを繰り返さない
  assert.equal(discardCalls, 1, "既に離脱済みなのに再度discardが呼ばれた");
}

// 3) 配線確認：破棄はAudienceJoinIntentPathGuard（layout.tsx、ConsentRequiredGateの外側）が
//    行い、/live/page.tsx自身はアンマウント時に破棄しない（同じ不具合の再発を防ぐ）。
const livePage = read("src", "app", "live", "page.tsx");
assert.ok(
  !/return \(\) => \{\s*useAudienceJoinIntentStore\.getState\(\)\.discard\(\)/.test(livePage),
  "/live/page.tsx がアンマウント時に意図を破棄している（ConsentRequiredGateの一時アンマウントで誤発火する）",
);
const guard = read("src", "components", "app", "AudienceJoinIntentPathGuard.tsx");
assert.ok(/isLiveParticipantPath\(pathname\)/.test(guard) && /useAudienceJoinIntentStore\.getState\(\)\.discard\(\)/.test(guard), "AudienceJoinIntentPathGuardが意図の破棄を行っていない");
assert.ok(/wasOnLiveRef\.current && !onLiveNow/.test(guard), "実際のページ離脱（true→false）だけで破棄する条件になっていない");

const layout = read("src", "app", "layout.tsx");
const gateIdx = layout.indexOf("<ConsentRequiredGate>");
const guardIdx = layout.indexOf("<AudienceJoinIntentPathGuard");
assert.ok(gateIdx >= 0 && guardIdx > gateIdx, "AudienceJoinIntentPathGuardがConsentRequiredGateより後（＝外側の兄弟要素）に配置されていない");
const gateCloseIdx = layout.indexOf("</ConsentRequiredGate>");
assert.ok(guardIdx > gateCloseIdx, "AudienceJoinIntentPathGuardがConsentRequiredGateの内側（children側）に置かれている（同じ一時アンマウントの影響を受ける）");

console.log("PASS: 観客参加の意図の破棄はConsentRequiredGateの一時アンマウントでは発火せず、実際のページ離脱でのみ発火する");
