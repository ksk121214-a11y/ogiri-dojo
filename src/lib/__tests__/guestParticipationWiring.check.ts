// 配線確認：ゲスト（匿名）参加（0070）のフロント側配線を、ソースの静的検査で
// 確認する。実際のsingle-flightガード（signInAnonymouslyの連打防止）は
// src/lib/__tests__/store/useAuthStoreGuest.check.ts が本番実装を直接呼び出して
// 検証する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const livePage = readFileSync(join(process.cwd(), "src", "app", "live", "page.tsx"), "utf8");
const displayNameModal = readFileSync(
  join(process.cwd(), "src", "components", "app", "DisplayNameSetupModal.tsx"),
  "utf8",
);
const authStore = readFileSync(join(process.cwd(), "src", "store", "useAuthStore.ts"), "utf8");

// 1: /live は、未ログイン時のブロック内で live?.live_mode === "test" の場合だけ
//    ゲスト参加ボタンを出す（公式ライブでは出さない）。
{
  const guardIdx = livePage.indexOf('if (!authUser) {');
  assert.ok(guardIdx >= 0, "/live に !authUser の未ログイン分岐が見つからない");
  const block = livePage.slice(guardIdx, guardIdx + 2000);

  assert.ok(
    /const isTestLive = live\?\.live_mode === "test";/.test(block),
    "/live の未ログイン分岐がlive?.live_mode==='test'でゲスト参加可否を判定していない",
  );
  assert.ok(
    /\{isTestLive && \(/.test(block),
    "/live のゲスト参加ボタンがisTestLiveで分岐していない（公式ライブでも出てしまう可能性）",
  );
  assert.ok(
    /ゲストとして参加/.test(block),
    "/live にゲスト参加ボタンの文言が見当たらない",
  );
  // Xログインボタン自体はisTestLive分岐の外（常に表示）にあること。
  const xLoginIdx = block.indexOf("Xでログイン");
  const isTestLiveGuardIdx = block.indexOf("isTestLive && (");
  assert.ok(xLoginIdx >= 0 && xLoginIdx < isTestLiveGuardIdx, "Xでログインボタンがゲスト分岐より後（常時表示ではない可能性）にある");

  console.log("PASS: /live は公式ライブではゲスト参加ボタンを出さず、テストライブでのみ出す");
}

// 2: /live のゲスト参加ボタンは連打防止のためguestSigningIn中disabledになっており、
//    single-flightガードを持つuseAuthStore.signInAsGuestを呼んでいる。
{
  const isTestLiveBlockIdx = livePage.indexOf("isTestLive && (");
  assert.ok(isTestLiveBlockIdx >= 0, "isTestLive分岐のブロックが見つからない");
  const block = livePage.slice(isTestLiveBlockIdx, isTestLiveBlockIdx + 1000);
  assert.ok(/disabled=\{guestSigningIn\}/.test(block), "ゲスト参加ボタンがguestSigningIn中disabledになっていない");
  assert.ok(/signInAsGuest\(\)/.test(block), "ゲスト参加ボタンがuseAuthStore.signInAsGuest()を呼んでいない");
  assert.ok(/"ゲストとして参加"/.test(block), "ゲスト参加ボタンのラベル文言が見当たらない");
  console.log("PASS: ゲスト参加ボタンの連打防止（disabled=guestSigningIn）とsignInAsGuest呼び出しを確認");
}

// 3: useAuthStore.signInAsGuest自体がguestSigningInによるsingle-flightガードを持つ
//    （実際の呼び出し回数の検証はuseAuthStoreGuest.check.ts側で行う）。
{
  const storeBodyIdx = authStore.indexOf("export const useAuthStore = create");
  assert.ok(storeBodyIdx >= 0, "useAuthStoreの実装本体が見つからない");
  const fnIdx = authStore.indexOf("signInAsGuest:", storeBodyIdx);
  assert.ok(fnIdx >= 0, "useAuthStoreの実装本体にsignInAsGuestが定義されていない");
  const fnBlock = authStore.slice(fnIdx, fnIdx + 800);
  assert.ok(/if \(get\(\)\.guestSigningIn\) return/.test(fnBlock), "signInAsGuestの先頭にguestSigningInによる連打防止ガードが無い");
  assert.ok(/signInAnonymously\(\)/.test(fnBlock), "signInAsGuestがsupabase.auth.signInAnonymously()を呼んでいない");
  console.log("PASS: useAuthStore.signInAsGuestはguestSigningInによるsingle-flightガードを持つ");
}

// 4: useAuthStore.signInWithXは、匿名セッションとの意図しないアップグレードを
//    避けるため、signInWithOAuthより先にsignOut()を呼んでいる。
{
  const storeBodyIdx = authStore.indexOf("export const useAuthStore = create");
  assert.ok(storeBodyIdx >= 0, "useAuthStoreの実装本体が見つからない");
  const fnIdx = authStore.indexOf("signInWithX:", storeBodyIdx);
  assert.ok(fnIdx >= 0, "useAuthStoreの実装本体にsignInWithXが定義されていない");
  const fnBlock = authStore.slice(fnIdx, fnIdx + 800);
  const signOutIdx = fnBlock.indexOf("supabase.auth.signOut()");
  const oauthIdx = fnBlock.indexOf("supabase.auth.signInWithOAuth(");
  assert.ok(signOutIdx >= 0 && oauthIdx > signOutIdx, "signInWithXがsignInWithOAuthより前にsignOut()を呼んでいない");
  console.log("PASS: useAuthStore.signInWithXは匿名セッションとのリンクを避けるため必ず先にsignOut()する");
}

// 5: DisplayNameSetupModalはゲスト（profile.isGuest）には一切表示しない。
{
  assert.ok(
    /if \(!profile \|\| profile\.displayNameSet \|\| profile\.isGuest\) return null;/.test(displayNameModal),
    "DisplayNameSetupModalがprofile.isGuestで早期returnしていない（ゲストにも名前設定モーダルが出てしまう）",
  );
  console.log("PASS: DisplayNameSetupModalはゲストには表示されない");
}

console.log("ALL GUEST_PARTICIPATION WIRING CHECKS PASSED");
