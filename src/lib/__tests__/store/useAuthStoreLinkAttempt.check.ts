// useAuthStore.ts の linkProvider（2026-09-18、複数プロバイダー対応レビュー
// 再修正・項目1）が、sessionStorageへの一時情報保存を正しく行うことを
// 「本番と同じ実装のまま」呼び出して検証するスクリプト。実行方法はrun.sh参照。
//
// 検証すること：
//   - identities一覧を正常取得済み（"loaded"）でなければ連携を開始しない
//     （linkIdentity・sessionStorageへの保存のどちらも行わない）。
//   - 対象providerが既に連携済みなら開始しない。
//   - 正常時：sessionStorageへ保存してからlinkIdentity()を呼ぶ（保存が先）。
//   - 保存するuserId/providerは、linkProvider()の呼び出し引数・現在のuserを
//     使う（URL等の外部入力を経由しない）。
//   - linkIdentity()の開始自体が失敗した場合は一時情報を削除する。
//   - 開始に成功した場合（この後リダイレクトされる可能性がある）は
//     一時情報を消さずに残す（callback側が消費する）。
//   - sessionStorageへの保存自体が失敗する場合は、linkIdentity()を呼ばずに
//     安全な日本語エラーを返す。
import assert from "node:assert/strict";
import type { UserIdentity } from "@supabase/supabase-js";

import { readLinkAttempt } from "@/lib/linkAttempt";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

let linkIdentityCalls: { provider: string }[] = [];
let nextLinkIdentityError: { code: string; message: string } | null = null;
(
  supabase.auth as unknown as {
    linkIdentity: (args: { provider: string }) => Promise<{ data: unknown; error: unknown }>;
  }
).linkIdentity = async (args) => {
  linkIdentityCalls.push({ provider: args.provider });
  return { data: {}, error: nextLinkIdentityError };
};

const memorySessionStorage = new Map<string, string>();
let throwOnSetItem = false;
(global as unknown as { window: unknown }).window = {
  confirm: () => true,
  location: { origin: "http://localhost:3000" },
  sessionStorage: {
    getItem: (key: string) => memorySessionStorage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (throwOnSetItem) throw new Error("quota exceeded (test)");
      memorySessionStorage.set(key, value);
    },
    removeItem: (key: string) => {
      memorySessionStorage.delete(key);
    },
  },
};

function makeIdentity(id: string, provider: string): UserIdentity {
  return {
    identity_id: id,
    id,
    user_id: "user-1",
    identity_data: {},
    provider,
    created_at: "2026-01-01T00:00:00Z",
    last_sign_in_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  } as unknown as UserIdentity;
}

async function main() {
  useAuthStore.setState({
    user: { id: "user-1", is_anonymous: false } as unknown as ReturnType<typeof useAuthStore.getState>["user"],
  });

  // ---- テスト1: identities未取得（"idle"）の間は開始しない ----
  linkIdentityCalls = [];
  memorySessionStorage.clear();
  useAuthStore.setState({ identities: null, identitiesStatus: "idle" });
  const r1 = await useAuthStore.getState().linkProvider("google");
  assert.equal(r1.ok, false, "identities未取得なのにlinkProviderが成功扱いになっている");
  assert.equal(linkIdentityCalls.length, 0, "identities未取得なのにlinkIdentityが呼ばれている");
  assert.equal(readLinkAttempt(), null, "identities未取得なのに一時情報が保存されている");
  console.log("PASS: identities未取得（idle）の間はlinkProviderが開始しない");

  // ---- テスト2: identities取得失敗（"error"）の間も開始しない ----
  linkIdentityCalls = [];
  useAuthStore.setState({ identities: null, identitiesStatus: "error" });
  const r2 = await useAuthStore.getState().linkProvider("google");
  assert.equal(r2.ok, false, "identities取得失敗中なのにlinkProviderが成功扱いになっている");
  assert.equal(linkIdentityCalls.length, 0);
  console.log("PASS: identities取得失敗（error）の間もlinkProviderが開始しない");

  // ---- テスト3: 対象providerが既に連携済みなら開始しない ----
  linkIdentityCalls = [];
  const idGoogle = makeIdentity("id-google", "google");
  useAuthStore.setState({ identities: [makeIdentity("id-x", "x"), idGoogle], identitiesStatus: "loaded" });
  const r3 = await useAuthStore.getState().linkProvider("google");
  assert.equal(r3.ok, false, "既に連携済みのproviderなのにlinkProviderが成功扱いになっている");
  assert.equal(linkIdentityCalls.length, 0, "既に連携済みなのにlinkIdentityが呼ばれている");
  assert.equal(readLinkAttempt(), null, "既に連携済みなのに一時情報が保存されている");
  console.log("PASS: 対象providerが既に連携済みの場合はlinkProviderが開始しない");

  // ---- テスト4: 正常時、sessionStorageへ保存してからlinkIdentity()を呼ぶ ----
  linkIdentityCalls = [];
  nextLinkIdentityError = null;
  memorySessionStorage.clear();
  useAuthStore.setState({ identities: [makeIdentity("id-x", "x")], identitiesStatus: "loaded" });
  const r4 = await useAuthStore.getState().linkProvider("apple");
  assert.deepEqual(r4, { ok: true });
  assert.equal(linkIdentityCalls.length, 1);
  const savedAfterSuccess = readLinkAttempt();
  assert.ok(savedAfterSuccess, "成功時にsessionStorageへ一時情報が保存されていない");
  assert.equal(savedAfterSuccess?.userId, "user-1", "保存したuserIdが現在ログイン中のuserと一致しない");
  assert.equal(savedAfterSuccess?.provider, "apple", "保存したproviderがlinkProvider()の呼び出し引数と一致しない");
  assert.deepEqual(savedAfterSuccess?.priorIdentityIds, ["id-x"], "保存したpriorIdentityIdsが開始前の一覧と一致しない");
  console.log("PASS: 正常時はuserId・provider・開始前のidentity一覧をsessionStorageへ保存してからlinkIdentity()を呼ぶ");

  // ---- テスト5: 開始成功時（この後リダイレクトの可能性がある）は一時情報を消さない ----
  // （テスト4の直後の状態がそのまま該当。finallyでロックだけ解除され、
  //   sessionStorageの一時情報自体は残っていることを再確認する。）
  assert.equal(useAuthStore.getState().identityMutationInProgress, false, "成功後もロックが解放されていない");
  assert.ok(readLinkAttempt(), "成功直後に一時情報が消えてしまっている（callback側が消費する前に消してはいけない）");
  console.log("PASS: linkIdentity()の開始に成功した場合、一時情報はfinallyで消されずに残る");

  // ---- テスト6: linkIdentity()の開始自体が失敗した場合は一時情報を削除する ----
  linkIdentityCalls = [];
  nextLinkIdentityError = { code: "identity_already_exists", message: "raw detail" };
  memorySessionStorage.clear();
  useAuthStore.setState({ identities: [makeIdentity("id-x", "x")], identitiesStatus: "loaded" });
  const r6 = await useAuthStore.getState().linkProvider("google");
  assert.equal(r6.ok, false);
  assert.equal(linkIdentityCalls.length, 1, "linkIdentityが呼ばれていない");
  assert.equal(readLinkAttempt(), null, "linkIdentity()失敗後も一時情報が残ってしまっている");
  nextLinkIdentityError = null;
  console.log("PASS: linkIdentity()の開始自体が失敗した場合は一時情報を削除する");

  // ---- テスト7: sessionStorageへの保存自体が失敗する場合はlinkIdentity()を呼ばない ----
  linkIdentityCalls = [];
  memorySessionStorage.clear();
  throwOnSetItem = true;
  useAuthStore.setState({ identities: [makeIdentity("id-x", "x")], identitiesStatus: "loaded" });
  const r7 = await useAuthStore.getState().linkProvider("google");
  assert.equal(r7.ok, false, "保存失敗なのにlinkProviderが成功扱いになっている");
  if (!r7.ok) {
    assert.ok(r7.reason, "保存失敗時に理由が返っていない");
    assert.ok(!r7.reason?.includes("quota exceeded"), "保存失敗時に生の例外メッセージが漏れている");
  }
  assert.equal(linkIdentityCalls.length, 0, "sessionStorageへの保存に失敗したのにlinkIdentityが呼ばれている");
  throwOnSetItem = false;
  console.log("PASS: sessionStorageへの保存に失敗した場合はlinkIdentity()を呼ばず、安全な日本語エラーを返す");

  console.log("ALL USE_AUTH_STORE_LINK_ATTEMPT CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
