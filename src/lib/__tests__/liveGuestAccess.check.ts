// resolveLiveScreenGate（src/lib/liveGuestAccess.ts）の検証。
// /live（src/app/live/page.tsx）が「認証済みゲストは本番ライブへ進めない」
// 「profile取得前は通常参加画面を一瞬でも出さない」を正しく判定できることを、
// 実際のコンポーネントをマウントせずに確認する。
import assert from "node:assert/strict";

import { resolveLiveScreenGate } from "../liveGuestAccess";

const base = {
  authLoading: false,
  isAuthenticated: true,
  profileLoading: false,
  liveLoading: false,
  liveMode: null as string | null,
  isGuest: false,
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

// 3: ログイン済みだがprofile取得前はprofile-loading
//    （isGuest/liveModeがまだ分からないため、official-guest-blockedより優先する）。
assert.equal(
  resolveLiveScreenGate({ ...base, profileLoading: true, liveMode: "official", isGuest: true }),
  "profile-loading",
);
console.log("PASS: profile取得前はprofile-loadingを返す（official-guest-blockedより優先）");

// 4: profile取得済みでもliveLoading中はlive-loading（live_modeが未確定のため）。
assert.equal(
  resolveLiveScreenGate({ ...base, liveLoading: true, isGuest: true }),
  "live-loading",
);
console.log("PASS: liveLoading中はlive-loadingを返す");

// 5: ゲスト（isGuest=true）が本番ライブ(live_mode==='official')を開いた場合は
//    official-guest-blocked。
assert.equal(
  resolveLiveScreenGate({ ...base, isGuest: true, liveMode: "official" }),
  "official-guest-blocked",
);
console.log("PASS: ゲスト×officialライブはofficial-guest-blockedを返す");

// 6: ゲストでもテストライブ(live_mode==='test')ならready（従来通り参加できる）。
assert.equal(resolveLiveScreenGate({ ...base, isGuest: true, liveMode: "test" }), "ready");
console.log("PASS: ゲスト×テストライブはreadyを返す（従来通り参加できる）");

// 7: ゲストでもliveがまだ無い(liveMode===null、ライブ未開催)ならready
//    （official/testどちらとも確定しないため、この時点ではブロックしない。
//    「!live」ケースの案内はlive/page.tsx側の既存分岐に任せる）。
assert.equal(resolveLiveScreenGate({ ...base, isGuest: true, liveMode: null }), "ready");
console.log("PASS: ゲスト×live未確定(liveMode=null)はreadyを返す");

// 8: 通常のXユーザー（isGuest=false）はofficialライブでもready（回帰確認）。
assert.equal(resolveLiveScreenGate({ ...base, isGuest: false, liveMode: "official" }), "ready");
console.log("PASS: 通常のXユーザーはofficialライブでもreadyを返す（回帰確認）");

console.log("ALL LIVE_GUEST_ACCESS CHECKS PASSED");
