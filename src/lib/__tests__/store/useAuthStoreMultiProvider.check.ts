// useAuthStore.ts の複数プロバイダー対応（2026-09-16、linkProvider/unlinkProvider/
// refreshIdentities/signInWithProvider）を「本番と同じ実装のまま」呼び出して検証する
// スクリプト。実行方法はrun.sh参照（useAuthStoreXSwitch.check.tsと同様、専用tsconfig経由）。
//   - signInWithProviderは指定したプロバイダーでsignInWithOAuthを呼ぶ（xに限らない）。
//   - linkProviderは未ログイン時、linkIdentityを一切呼ばずに失敗を返す。
//   - linkProviderはlinkIdentityへ「?flow=link」付きのredirectToを渡す。
//   - linkProvider失敗時（重複連携等）は生のエラーを含まない日本語文言を返す。
//   - unlinkProviderは識別情報が1つしかない場合、unlinkIdentityを呼ばずに拒否する。
//   - unlinkProviderは識別情報が2つ以上ある場合はunlinkIdentityを呼び、
//     成功後にrefreshIdentities（getUserIdentities）でキャッシュを更新する。
//   - refreshIdentitiesは未ログイン時、getUserIdentitiesを呼ばずidentitiesをnullにする。
import assert from "node:assert/strict";
import type { UserIdentity } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

let oauthCalls: { provider: string; redirectTo?: string }[] = [];
let linkIdentityCalls: { provider: string; redirectTo?: string }[] = [];
let unlinkIdentityCalls: UserIdentity[] = [];
let getUserIdentitiesCalls = 0;
let nextLinkIdentityError: { code: string; message: string } | null = null;
let nextUnlinkIdentityError: { code: string; message: string } | null = null;
let nextIdentities: UserIdentity[] = [];

(
  supabase.auth as unknown as {
    signInWithOAuth: (args: { provider: string; options?: { redirectTo?: string } }) => Promise<{
      data: unknown;
      error: unknown;
    }>;
  }
).signInWithOAuth = async (args) => {
  oauthCalls.push({ provider: args.provider, redirectTo: args.options?.redirectTo });
  return { data: {}, error: null };
};

(
  supabase.auth as unknown as {
    linkIdentity: (args: { provider: string; options?: { redirectTo?: string } }) => Promise<{
      data: unknown;
      error: unknown;
    }>;
  }
).linkIdentity = async (args) => {
  linkIdentityCalls.push({ provider: args.provider, redirectTo: args.options?.redirectTo });
  return { data: {}, error: nextLinkIdentityError };
};

(
  supabase.auth as unknown as {
    unlinkIdentity: (identity: UserIdentity) => Promise<{ data: unknown; error: unknown }>;
  }
).unlinkIdentity = async (identity) => {
  unlinkIdentityCalls.push(identity);
  return { data: {}, error: nextUnlinkIdentityError };
};

(
  supabase.auth as unknown as {
    getUserIdentities: () => Promise<{ data: { identities: UserIdentity[] } | null; error: unknown }>;
  }
).getUserIdentities = async () => {
  getUserIdentitiesCalls += 1;
  return { data: { identities: nextIdentities }, error: null };
};

(global as unknown as { window: unknown }).window = {
  confirm: () => true,
  location: { origin: "http://localhost:3000" },
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
  // ---- テスト1: signInWithProviderはプロバイダーを引数どおりsignInWithOAuthへ渡す。 ----
  oauthCalls = [];
  useAuthStore.setState({ user: null });
  const r1 = await useAuthStore.getState().signInWithProvider("google");
  assert.deepEqual(r1, { ok: true });
  assert.equal(oauthCalls.length, 1);
  assert.equal(oauthCalls[0].provider, "google", "signInWithProviderがgoogleをそのままsignInWithOAuthへ渡していない");
  console.log("PASS: signInWithProvider(\"google\")はsignInWithOAuthへprovider:\"google\"を渡す");

  // ---- テスト2: linkProviderは未ログイン時、linkIdentityを一切呼ばずに失敗を返す。 ----
  linkIdentityCalls = [];
  useAuthStore.setState({ user: null });
  const r2 = await useAuthStore.getState().linkProvider("google");
  assert.equal(r2.ok, false, "未ログインなのにlinkProviderが成功扱いになっている");
  assert.equal(linkIdentityCalls.length, 0, "未ログインなのにlinkIdentityが呼ばれている");
  console.log("PASS: 未ログイン時のlinkProviderはlinkIdentityを呼ばずに失敗する");

  // ---- テスト3: ログイン中はlinkProviderが「?flow=link」付きredirectToでlinkIdentityを呼ぶ。 ----
  linkIdentityCalls = [];
  nextLinkIdentityError = null;
  useAuthStore.setState({
    user: { id: "user-1", is_anonymous: false } as unknown as ReturnType<typeof useAuthStore.getState>["user"],
  });
  const r3 = await useAuthStore.getState().linkProvider("apple");
  assert.deepEqual(r3, { ok: true });
  assert.equal(linkIdentityCalls.length, 1);
  assert.equal(linkIdentityCalls[0].provider, "apple");
  assert.ok(
    linkIdentityCalls[0].redirectTo?.includes("flow=link"),
    "linkProviderのredirectToに?flow=linkが含まれていない",
  );
  console.log("PASS: ログイン中のlinkProviderは?flow=link付きredirectToでlinkIdentityを呼ぶ");

  // ---- テスト4: linkProvider失敗（重複連携）時は生のエラーを含まない日本語文言を返す。 ----
  nextLinkIdentityError = { code: "identity_already_exists", message: "raw supabase detail" };
  const r4 = await useAuthStore.getState().linkProvider("google");
  assert.equal(r4.ok, false);
  if (!r4.ok) {
    assert.ok(!r4.reason?.includes("raw supabase detail"), "linkProvider失敗時に生のエラーが漏れている");
    assert.ok(r4.reason?.includes("連携済み"), "identity_already_existsの案内文になっていない");
  }
  nextLinkIdentityError = null;
  console.log("PASS: linkProviderの重複連携エラーは生のエラーを含まない専用の日本語文言になる");

  // ---- テスト5: unlinkProviderは識別情報が1つしかない場合、unlinkIdentityを呼ばずに拒否する。 ----
  unlinkIdentityCalls = [];
  useAuthStore.setState({ identities: [makeIdentity("id-x", "x")], identitiesStatus: "loaded" });
  const only = makeIdentity("id-x", "x");
  const r5 = await useAuthStore.getState().unlinkProvider(only);
  assert.equal(r5.ok, false, "最後の1つなのにunlinkProviderが成功扱いになっている");
  assert.equal(unlinkIdentityCalls.length, 0, "最後の1つなのにunlinkIdentityが呼ばれている");
  console.log("PASS: 識別情報が1つしかない場合、unlinkProviderはunlinkIdentityを呼ばずに拒否する");

  // ---- テスト6: 識別情報が2つ以上ある場合、unlinkProviderはunlinkIdentityを呼び、
  //      成功後にrefreshIdentities（getUserIdentities）でキャッシュを更新する。 ----
  unlinkIdentityCalls = [];
  getUserIdentitiesCalls = 0;
  nextUnlinkIdentityError = null;
  const idX = makeIdentity("id-x", "x");
  const idGoogle = makeIdentity("id-google", "google");
  nextIdentities = [idX];
  useAuthStore.setState({
    identities: [idX, idGoogle],
    identitiesStatus: "loaded",
    user: { id: "user-1" } as unknown as ReturnType<typeof useAuthStore.getState>["user"],
  });
  const r6 = await useAuthStore.getState().unlinkProvider(idGoogle);
  assert.deepEqual(r6, { ok: true });
  assert.equal(unlinkIdentityCalls.length, 1);
  assert.equal(getUserIdentitiesCalls, 1, "unlinkProvider成功後にrefreshIdentitiesが呼ばれていない");
  assert.deepEqual(useAuthStore.getState().identities, [idX], "unlink成功後にidentitiesが更新されていない");
  console.log("PASS: 識別情報が2つ以上ある場合、unlinkProviderはunlinkIdentity後にidentitiesを更新する");

  // ---- テスト7: refreshIdentitiesは未ログイン時、getUserIdentitiesを呼ばずidentitiesをnullにする。 ----
  getUserIdentitiesCalls = 0;
  useAuthStore.setState({ user: null, identities: [idX] });
  await useAuthStore.getState().refreshIdentities();
  assert.equal(getUserIdentitiesCalls, 0, "未ログインなのにgetUserIdentitiesが呼ばれている");
  assert.equal(useAuthStore.getState().identities, null, "未ログイン時にidentitiesがnullになっていない");
  console.log("PASS: 未ログイン時のrefreshIdentitiesはgetUserIdentitiesを呼ばずidentitiesをnullにする");

  console.log("ALL USE_AUTH_STORE_MULTI_PROVIDER CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
