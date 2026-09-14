// resolveLiveScreenGate（src/lib/liveGuestAccess.ts）の検証。
// /live（src/app/live/page.tsx）が「認証・profile取得・live取得の各段階を
// 正しく順序立てて待つ」ことを、実際のコンポーネントをマウントせずに確認する。
//
// 2026-09-13（再々レビュー2回目対応・ゲスト観客の最終仕様確定）：ゲストは
// 本番・テストどちらのライブも観客として視聴できる仕様になったため、
// 「認証済みゲストが本番ライブを開いた場合だけofficial-guest-blockedへ
// 分岐する」ロジック自体を関数から削除した。このテストもisAnonymous/isGuest/
// liveModeパラメータを廃止した新しいシグネチャに合わせて全面的に書き換える。
import assert from "node:assert/strict";

import { resolveLiveScreenGate } from "../liveGuestAccess";

const base = {
  authLoading: false,
  isAuthenticated: true,
  profileLoading: false,
  liveLoading: false,
};

// 1: authLoading中は他の状態に関わらずauth-loading。
assert.equal(
  resolveLiveScreenGate({ ...base, authLoading: true, isAuthenticated: false }),
  "auth-loading",
);
console.log("PASS: authLoading中はauth-loadingを返す");

// 2: 未ログインはnot-authenticated（profileLoading/liveLoadingの状態に関わらず）。
assert.equal(resolveLiveScreenGate({ ...base, isAuthenticated: false }), "not-authenticated");
console.log("PASS: 未ログインはnot-authenticatedを返す");

// 3: ログイン済みだがprofile取得前はprofile-loading。
assert.equal(resolveLiveScreenGate({ ...base, profileLoading: true }), "profile-loading");
console.log("PASS: profile取得前はprofile-loadingを返す");

// 4: profile取得済みでもliveLoading中はlive-loading。
assert.equal(resolveLiveScreenGate({ ...base, liveLoading: true }), "live-loading");
console.log("PASS: liveLoading中はlive-loadingを返す");

// 5（ゲスト観客対応の最終仕様確定）：認証・profile取得・live取得のすべてが
//    揃えばready。ゲストかどうか・本番/テストのどちらのライブかによって
//    この関数の戻り値は変わらない（最終仕様：ゲストは本番・テストどちらも
//    観客として視聴できるため、この段階でブロックする理由が無くなった）。
assert.equal(resolveLiveScreenGate({ ...base }), "ready");
console.log("PASS: 認証・profile取得・live取得が揃えばreadyを返す（ゲスト/本番テストの別なく判定は関数の外＝呼び出し元のUI分岐に委ねる）");

console.log("ALL LIVE_GUEST_ACCESS CHECKS PASSED");
