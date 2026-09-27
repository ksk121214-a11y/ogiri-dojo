// 観客参加の意図（純粋な状態遷移）と、join_live実行の駆動（1回だけ・必ず解除）の検証。
import assert from "node:assert/strict";

import { driveAudienceJoin } from "../audienceJoinDrive";
import { pressGuestAudienceButton, resolveLiveIdWithTimeout } from "../audienceGuestButton";
import {
  AUDIENCE_INTENT_TTL_MS,
  beginIntent,
  bindIntentLive,
  discardIntent,
  evaluateIntent,
  finishJoinIntent,
  initialIntentState,
  settleIntent,
  type IntentContext,
  type IntentState,
} from "../audienceJoinIntent";

const G = "guest-1";
const ctx = (o: Partial<IntentContext> = {}): IntentContext => ({
  authUserId: G,
  authIsAnonymous: true,
  liveLoading: false,
  live: { id: "live-1", phase: "answering" },
  alreadyParticipant: false,
  kicked: false,
  ...o,
});
function armed(userId: string | null = G, now = 1000, liveId: string | null = "live-1"): IntentState {
  const b = beginIntent(initialIntentState);
  const bound = bindIntentLive(b.state, b.token!, liveId);
  return settleIntent(bound, b.token!, { status: "started", userId }, now);
}

async function main() {
  // 開始：連打は2回目を開始しない。成立前(starting)はjoinしない。
  const b1 = beginIntent(initialIntentState);
  assert.equal(b1.token, 1);
  assert.equal(beginIntent(b1.state).token, null, "連打で意図が二重に開始された");
  assert.equal(evaluateIntent(b1.state, ctx(), 1000).action.kind, "none", "認証前(starting)にjoinしてはいけない");

  // 押した時点のライブIDを取得できなかった場合は、認証が成功しても自動参加意図を成立させない
  {
    const nb = beginIntent(initialIntentState);
    const bound = bindIntentLive(nb.state, nb.token!, null);
    assert.equal(settleIntent(bound, nb.token!, { status: "started", userId: G }, 0).status, "idle", "ライブID不明で意図が成立した");
    assert.equal(settleIntent(nb.state, nb.token!, { status: "started", userId: G }, 0).status, "idle", "ライブ未束縛で意図が成立した");
    assert.equal(bindIntentLive(nb.state, 99, "x").status, "starting");
    assert.equal((bindIntentLive(nb.state, nb.token!, "live-1") as { liveId: string | null }).liveId, "live-1");
  }
  // キャンセル・失敗・古いtokenは意図を成立させない
  assert.equal(settleIntent(bindIntentLive(b1.state, 1, "live-1"), 1, { status: "cancelled" }, 0).status, "idle");
  assert.equal(settleIntent(b1.state, 1, { status: "failed" }, 0).status, "idle");
  assert.equal(settleIntent(bindIntentLive(b1.state, 1, "live-1"), 99, { status: "started", userId: G }, 0).status, "starting", "別tokenの結果で成立した");
  assert.equal(settleIntent(initialIntentState, 1, { status: "started", userId: G }, 0).status, "idle", "意図なしで成立した");

  // 成立→joinは1回だけ（同じ状況で何度評価しても）
  {
    let s = armed();
    const r1 = evaluateIntent(s, ctx(), 2000);
    assert.equal(r1.action.kind, "join");
    s = r1.state;
    assert.equal(s.status, "joining");
    assert.equal(evaluateIntent(s, ctx(), 2001).action.kind, "none", "joining中に2回目のjoinが返った（Strict Mode/再描画）");
    assert.equal(finishJoinIntent(s, 1).status, "idle", "完了後に意図が残っている");
    assert.equal(evaluateIntent(finishJoinIntent(s, 1), ctx(), 2002).action.kind, "none", "完了後に再度joinした");
  }
  // 認証反映の遅れは待つ（joinしない・破棄しない）
  {
    const r = evaluateIntent(armed(), ctx({ authUserId: null }), 1500);
    assert.equal(r.action.kind, "none");
    assert.equal(r.state.status, "armed");
    assert.equal(evaluateIntent(armed(null), ctx(), 1500).action.kind, "join", "userId未確定でもゲスト本人なら参加できる");
  }
  // Xログイン（非匿名）・別ユーザーでは消費せず破棄
  assert.equal(evaluateIntent(armed(), ctx({ authIsAnonymous: false, authUserId: "x-user" }), 1500).state.status, "idle");
  assert.equal(evaluateIntent(armed(), ctx({ authIsAnonymous: false, authUserId: "x-user" }), 1500).action.kind, "none");
  assert.equal(evaluateIntent(armed(), ctx({ authUserId: "other-guest" }), 1500).state.status, "idle", "別のゲストで消費された");
  // ライブ読み込み中・未取得は待つ／別ライブ・終了・参加済み・退場は破棄
  assert.equal(evaluateIntent(armed(), ctx({ liveLoading: true }), 1500).state.status, "armed");
  assert.equal(evaluateIntent(armed(), ctx({ live: null }), 1500).state.status, "idle", "押した時点のライブが終了した（現在のライブなし）のに残った");
  {
    const bound = evaluateIntent(armed(), ctx({ live: { id: "live-1", phase: "scheduled" } }), 1500);
    assert.equal(bound.action.kind, "none");
    assert.equal(bound.state.status, "armed", "scheduledでは待機する");
    const other = evaluateIntent(bound.state, ctx({ live: { id: "live-2", phase: "answering" } }), 1600);
    assert.equal(other.action.kind, "none");
    assert.equal(other.state.status, "idle", "別ライブへ持ち越された");
    // ライブAで押下→認証中にライブBへ切り替わっていた場合、最初からjoin_liveしない
    const a2b = evaluateIntent(armed(G, 1000, "live-A"), ctx({ live: { id: "live-B", phase: "answering" } }), 1500);
    assert.equal(a2b.action.kind, "none", "ライブAで押した意図がライブBへ参加した");
    assert.equal(a2b.state.status, "idle");
    assert.equal(evaluateIntent(armed(G, 1000, "live-A"), ctx({ live: { id: "live-A", phase: "answering" } }), 1500).action.kind, "join");
  }
  assert.equal(evaluateIntent(armed(), ctx({ live: { id: "live-1", phase: "closed" } }), 1500).state.status, "idle", "終了ライブで残った");
  {
    const r = evaluateIntent(armed(), ctx({ alreadyParticipant: true }), 1500);
    assert.equal(r.action.kind, "none", "参加済みなのにjoin_liveを呼ぼうとした");
    assert.equal(r.state.status, "idle");
  }
  assert.equal(evaluateIntent(armed(), ctx({ kicked: true }), 1500).action.kind, "none");
  // interlude：受付前なので待つ（TTLの間）→ openingでjoin
  {
    const w = evaluateIntent(armed(), ctx({ live: { id: "live-1", phase: "interlude" } }), 1500);
    assert.equal(w.action.kind, "none");
    assert.equal(w.state.status, "armed");
    assert.equal(evaluateIntent(w.state, ctx({ live: { id: "live-1", phase: "opening" } }), 1600).action.kind, "join");
  }
  // 各フェーズで直接join
  for (const phase of ["opening", "topic_reveal", "answering", "group_result", "final_result"]) {
    assert.equal(evaluateIntent(armed(), ctx({ live: { id: "live-1", phase } }), 1500).action.kind, "join", `${phase}でjoinされない`);
  }
  // 期限切れ
  assert.equal(evaluateIntent(armed(G, 0), ctx(), AUDIENCE_INTENT_TTL_MS + 1).state.status, "idle", "期限切れの意図が残った");
  assert.equal(evaluateIntent(armed(G, 0), ctx(), AUDIENCE_INTENT_TTL_MS).action.kind, "join");
  // ページ離脱（discard）後は発火しない
  assert.equal(evaluateIntent(discardIntent(armed()), ctx(), 1500).action.kind, "none");

  // 駆動：joinは1回・失敗/例外でも意図が終わる
  {
    let s: IntentState = armed();
    let joins = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const deps = {
      evaluate: (c: IntentContext) => {
        const r = evaluateIntent(s, c, 2000);
        s = r.state;
        return r.action;
      },
      finishJoin: (t: number) => (s = finishJoinIntent(s, t)),
      joinAudience: async () => {
        joins += 1;
        await gate;
      },
    };
    const p1 = driveAudienceJoin(ctx(), deps);
    assert.ok(p1);
    assert.equal(driveAudienceJoin(ctx(), deps), null, "実行中に2回目のjoinが始まった");
    assert.equal(driveAudienceJoin(ctx(), deps), null);
    release();
    await p1;
    assert.equal(joins, 1, "join_liveが複数回呼ばれた");
    assert.equal(s.status, "idle");
    assert.equal(driveAudienceJoin(ctx(), deps), null, "完了後に再度実行された");
  }
  {
    // 参加失敗（例外）でもロックが解除され、意図は終わる（以後は中央の再試行ボタンで手動再試行）
    let s: IntentState = armed();
    const deps = {
      evaluate: (c: IntentContext) => {
        const r = evaluateIntent(s, c, 2000);
        s = r.state;
        return r.action;
      },
      finishJoin: (t: number) => (s = finishJoinIntent(s, t)),
      joinAudience: async () => {
        throw new Error("network");
      },
    };
    await driveAudienceJoin(ctx(), deps);
    assert.equal(s.status, "idle", "失敗後に意図/ロックが残った");
  }

  // ボタン処理：連打はbeginで弾かれ、同意/認証の要求は1回だけ。押した時点のライブIDが意図に固定される
  {
    let s: IntentState = initialIntentState;
    let requests = 0;
    let liveIdNow: string | null = "live-A";
    const mk = (request: (o: { onSettled: (r: Parameters<typeof settleIntent>[2]) => void }) => Promise<{ ok: boolean; reason?: string }>) => ({
      begin: () => {
        const r = beginIntent(s);
        s = r.state;
        return r.token;
      },
      isCurrent: (t: number) => s.status !== "idle" && s.token === t,
      bindLive: (t: number, l: string | null) => (s = bindIntentLive(s, t, l)),
      resolveLiveId: async () => liveIdNow,
      settle: (t: number, r: Parameters<typeof settleIntent>[2]) => (s = settleIntent(s, t, r, 5)),
      requestGuestStart: request,
    });
    const deps = mk(async (o) => {
      requests += 1;
      liveIdNow = "live-B"; // 認証・同意の間にライブが切り替わる
      o.onSettled({ status: "started", userId: G });
      return { ok: true };
    });
    const first = pressGuestAudienceButton(deps);
    const second = await pressGuestAudienceButton(deps);
    assert.equal(second.pressed, false, "連打が2回目として処理された");
    assert.equal((await first).pressed, true);
    assert.equal(requests, 1, "認証/同意の要求が複数回呼ばれた");
    assert.equal(s.status, "armed");
    assert.equal((s as { liveId: string }).liveId, "live-A", "押した時点のライブIDに固定されていない");
    assert.equal(evaluateIntent(s, ctx({ live: { id: "live-B", phase: "answering" } }), 10).action.kind, "none", "切り替え後のライブBへ参加した");

    // ライブID取得が失敗（例外）：認証は進むが意図は成立しない
    s = initialIntentState;
    liveIdNow = "x";
    const failing = { ...mk(async (o) => (o.onSettled({ status: "started", userId: G }), { ok: true })), resolveLiveId: async () => { throw new Error("net"); } };
    const r1 = await pressGuestAudienceButton(failing);
    assert.equal(r1.pressed, true);
    assert.equal(s.status, "idle", "ライブID不明なのに意図が成立した");

    // 匿名認証（requestGuestStart）が例外：外へ漏らさず意図を破棄し、日本語エラーを返す。次の押下は可能
    s = initialIntentState;
    const throwing = mk(async () => {
      throw new Error("boom");
    });
    const r2 = await pressGuestAudienceButton(throwing); // rejectしない
    assert.ok(r2.pressed && !r2.result.ok && /失敗しました/.test((r2.result as { reason: string }).reason), "日本語エラーが返っていない");
    assert.equal(s.status, "idle", "例外後に意図/ロックが残った");
    assert.equal((await pressGuestAudienceButton(mk(async (o) => (o.onSettled({ status: "started", userId: G }), { ok: true })))).pressed, true, "例外後に再度押せない");
  }
  // ライブID取得の時間制限：遅い→null（タイマーは残らない）、失敗/同期例外→null、成功→値
  assert.equal(await resolveLiveIdWithTimeout(() => new Promise(() => {}), 20), null, "遅い取得でnullにならない");
  assert.equal(await resolveLiveIdWithTimeout(async () => "live-1", 1000), "live-1");
  assert.equal(await resolveLiveIdWithTimeout(async () => { throw new Error("x"); }, 1000), null);
  assert.equal(await resolveLiveIdWithTimeout(() => { throw new Error("sync"); }, 1000), null);
  console.log("PASS: 観客参加の意図（開始・成立・キャンセル・失敗・Xログイン・別ライブ・終了・参加済み・期限・離脱・連打・join1回・失敗後の解除）");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
