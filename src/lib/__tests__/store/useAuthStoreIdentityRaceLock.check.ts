// useAuthStore.ts の複数プロバイダー対応レビュー修正（2026-09-17）を
// 「本番と同じ実装のまま」呼び出して検証するスクリプト。実行方法はrun.sh参照。
//
// 検証すること（レビュー指摘の項目1〜3）：
//   - 項目1：refreshIdentitiesがA取得中にBへ切り替わっても、遅れて届いたAの
//     結果がBのstateへ混ざらない（取得順が逆転しても最新ユーザーの結果だけが残る）。
//     サインアウト後に古い結果が返ってもidentitiesが復元されない。
//   - 項目2：getUserIdentities失敗時はidentitiesStatusが"error"になり、
//     identitiesがnullのまま（＝取得失敗と未連携を区別できる）。
//   - 項目3：link/unlinkはstore側の共通ロック(identityMutationInProgress)により
//     同時に1つしか実行されない（連打・同時クリックでもSupabase呼び出しは1回）。
//     unlinkProviderはfail-closed（未取得・別アカウントの一覧・最新一覧に無い
//     identity・最後の1件のいずれでも解除させない）。
import assert from "node:assert/strict";
import type { UserIdentity } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

type IdentitiesResult = {
  data: { identities: UserIdentity[] } | null;
  error: { code?: string; message: string } | null;
};

let identitiesQueue: { resolve: (v: IdentitiesResult) => void }[] = [];
// デフォルトは即座に空配列で解決する（項目3のlink/unlockテストはunlinkProvider内部の
// refreshIdentities呼び出しの結果自体には関心が無いため）。項目1の競合テストの間だけ
// queue版に差し替え、テスト後にこのデフォルトへ戻す。
let getUserIdentitiesImpl: () => Promise<IdentitiesResult> = () =>
  Promise.resolve({ data: { identities: [] }, error: null });
(
  supabase.auth as unknown as { getUserIdentities: () => Promise<IdentitiesResult> }
).getUserIdentities = () => getUserIdentitiesImpl();

function installQueuedIdentitiesMock() {
  identitiesQueue = [];
  getUserIdentitiesImpl = () => new Promise<IdentitiesResult>((resolve) => identitiesQueue.push({ resolve }));
}

function installAutoResolvingIdentitiesMock() {
  getUserIdentitiesImpl = () => Promise.resolve({ data: { identities: [] }, error: null });
}

let linkIdentityCalls = 0;
let linkIdentityDeferred: { promise: Promise<void>; resolve: () => void } | null = null;
(
  supabase.auth as unknown as {
    linkIdentity: (args: unknown) => Promise<{ data: unknown; error: unknown }>;
  }
).linkIdentity = async () => {
  linkIdentityCalls += 1;
  if (linkIdentityDeferred) await linkIdentityDeferred.promise;
  return { data: {}, error: null };
};

let unlinkIdentityCalls: UserIdentity[] = [];
let unlinkIdentityDeferred: { promise: Promise<void>; resolve: () => void } | null = null;
(
  supabase.auth as unknown as {
    unlinkIdentity: (identity: UserIdentity) => Promise<{ data: unknown; error: unknown }>;
  }
).unlinkIdentity = async (identity) => {
  unlinkIdentityCalls.push(identity);
  if (unlinkIdentityDeferred) await unlinkIdentityDeferred.promise;
  return { data: {}, error: null };
};

// 2026-09-18（レビュー再修正・項目1）：linkProviderは連携開始時にsessionStorageへ
// 一時情報を保存するようになったため、最小限のin-memoryモックを用意する。
const memorySessionStorage = new Map<string, string>();
(global as unknown as { window: unknown }).window = {
  confirm: () => true,
  location: { origin: "http://localhost:3000" },
  sessionStorage: {
    getItem: (key: string) => memorySessionStorage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memorySessionStorage.set(key, value);
    },
    removeItem: (key: string) => {
      memorySessionStorage.delete(key);
    },
  },
};

function makeDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

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

function setUser(id: string | null) {
  useAuthStore.setState({
    user: id ? ({ id, is_anonymous: false } as unknown as ReturnType<typeof useAuthStore.getState>["user"]) : null,
  });
}

async function main() {
  installQueuedIdentitiesMock();
  // ---- 項目1-テスト1: Aの取得中にBへ切り替えても、遅れて届いたAの結果がBへ混ざらない ----
  identitiesQueue = [];
  setUser("user-a");
  const pA = useAuthStore.getState().refreshIdentities();
  assert.equal(identitiesQueue.length, 1, "Aのidentities取得が呼ばれていない");

  setUser("user-b");
  const pB = useAuthStore.getState().refreshIdentities();
  assert.equal(identitiesQueue.length, 2, "Bのidentities取得が呼ばれていない");
  assert.equal(useAuthStore.getState().identities, null, "Bへ切り替えた直後にidentitiesが即座にnullへ戻っていない");

  const idA = makeIdentity("id-a", "x");
  const idB = makeIdentity("id-b", "google");
  identitiesQueue[0].resolve({ data: { identities: [idA] }, error: null }); // 古いAの結果が遅れて届く
  await pA;
  assert.deepEqual(
    useAuthStore.getState().identities,
    null,
    "遅れて届いた古いユーザーAの結果がBのstateへ反映されてしまっている",
  );

  identitiesQueue[1].resolve({ data: { identities: [idB] }, error: null }); // 最新のBの結果
  await pB;
  assert.deepEqual(useAuthStore.getState().identities, [idB], "最新ユーザーBの結果が反映されていない");
  assert.equal(useAuthStore.getState().identitiesStatus, "loaded");
  console.log("PASS: A取得中にBへ切り替えても、遅れて届いたAの結果はBのstateへ混ざらない");

  // ---- 項目1-テスト2: 取得順が逆転（B→Aの順で応答）しても、最新ユーザー(B)の結果だけが残る ----
  identitiesQueue = [];
  setUser("user-a");
  const p2A = useAuthStore.getState().refreshIdentities();
  setUser("user-b");
  const p2B = useAuthStore.getState().refreshIdentities();

  // 先にB（最新）の応答が届く
  identitiesQueue[1].resolve({ data: { identities: [idB] }, error: null });
  await p2B;
  assert.deepEqual(useAuthStore.getState().identities, [idB]);

  // 後からA（古い）の応答が届いても上書きしない
  identitiesQueue[0].resolve({ data: { identities: [idA] }, error: null });
  await p2A;
  assert.deepEqual(
    useAuthStore.getState().identities,
    [idB],
    "取得順が逆転した場合、後から届いた古いユーザーAの結果がBを上書きしてしまっている",
  );
  console.log("PASS: 取得順が逆転しても、最新ユーザーの結果だけが残る");

  // ---- 項目1-テスト3: サインアウト後に古い結果が返ってもidentitiesが復元されない ----
  identitiesQueue = [];
  setUser("user-a");
  const p3A = useAuthStore.getState().refreshIdentities();
  setUser(null); // サインアウト
  assert.equal(useAuthStore.getState().identities, null);
  assert.equal(useAuthStore.getState().identitiesStatus, "idle");

  identitiesQueue[0].resolve({ data: { identities: [idA] }, error: null });
  await p3A;
  assert.equal(
    useAuthStore.getState().identities,
    null,
    "サインアウト後に古いリクエストの結果が届いてもidentitiesは復元されないはず",
  );
  assert.equal(useAuthStore.getState().identitiesStatus, "idle");
  console.log("PASS: サインアウト後に古い結果が返ってもidentity情報は復元されない");

  // ---- 項目1-テスト4: 古いリクエストのfinallyが、新しいリクエストのloadingをfalseにしない ----
  identitiesQueue = [];
  setUser("user-a");
  const p4A = useAuthStore.getState().refreshIdentities();
  setUser("user-b");
  const p4B = useAuthStore.getState().refreshIdentities();
  assert.equal(useAuthStore.getState().identitiesLoading, true, "Bの取得中にidentitiesLoadingがtrueになっていない");

  // 古いAのリクエストのfinallyが先に走っても、Bがまだloading中ならfalseにしない
  identitiesQueue[0].resolve({ data: { identities: [idA] }, error: null });
  await p4A;
  assert.equal(
    useAuthStore.getState().identitiesLoading,
    true,
    "古いリクエストのfinallyが新しいリクエストのloadingをfalseに戻してしまっている",
  );
  identitiesQueue[1].resolve({ data: { identities: [idB] }, error: null });
  await p4B;
  assert.equal(useAuthStore.getState().identitiesLoading, false, "最新リクエスト完了後もloadingがfalseに戻らない");
  console.log("PASS: 古いリクエストのfinallyは新しいリクエストのloading状態を書き換えない");

  // ---- 項目2-テスト: 取得失敗時はidentitiesStatusが"error"になり、identitiesはnullのまま ----
  identitiesQueue = [];
  setUser("user-error-check");
  const pErr = useAuthStore.getState().refreshIdentities();
  identitiesQueue[0].resolve({ data: null, error: { code: "unexpected_failure", message: "raw detail" } });
  await pErr;
  assert.equal(useAuthStore.getState().identitiesStatus, "error", "取得失敗時にidentitiesStatusが\"error\"になっていない");
  assert.equal(useAuthStore.getState().identities, null, "取得失敗時に古い/別の一覧が代替表示として残ってしまっている");
  console.log("PASS: 取得失敗時はidentitiesStatusが\"error\"になり、identitiesはnullのまま（未連携と誤認しない）");

  // 項目3のテストはunlinkProvider内部のrefreshIdentities呼び出しが即座に解決されれば
  // よく、その中身自体は検証対象ではないため、以降は自動解決モックへ戻す
  // （queueのまま進めると誰にも解決されないPromiseが残りテストがハングするため）。
  installAutoResolvingIdentitiesMock();

  // ---- 項目3-テスト1: linkとunlinkを同時に実行しても、片方しかSupabaseへ要求されない ----
  linkIdentityCalls = 0;
  unlinkIdentityCalls = [];
  linkIdentityDeferred = makeDeferred();
  const idX = makeIdentity("id-x", "x");
  const idGoogle = makeIdentity("id-google", "google");
  setUser("user-1");
  useAuthStore.setState({ identities: [idX, idGoogle], identitiesStatus: "loaded" });

  const linkPromise = useAuthStore.getState().linkProvider("apple");
  assert.equal(useAuthStore.getState().identityMutationInProgress, true, "link開始直後にロックが立っていない");
  const unlinkPromise = useAuthStore.getState().unlinkProvider(idGoogle);
  linkIdentityDeferred.resolve();
  const [linkResult, unlinkResult] = await Promise.all([linkPromise, unlinkPromise]);
  assert.equal(linkIdentityCalls, 1, "linkIdentityが1回呼ばれていない");
  assert.equal(unlinkIdentityCalls.length, 0, "ロック中のunlinkIdentityが呼ばれてしまっている");
  assert.equal(linkResult.ok, true);
  assert.equal(unlinkResult.ok, false, "ロック中のunlinkProviderがok:trueを返してしまっている");
  assert.equal(useAuthStore.getState().identityMutationInProgress, false, "完了後もロックが解放されていない");
  linkIdentityDeferred = null;
  console.log("PASS: link実行中はunlinkを受け付けず、Supabaseへの要求は1回だけになる");

  // ---- 項目3-テスト2: 同じidentityへのunlink連打でも、Supabaseへの要求は1回だけ ----
  unlinkIdentityCalls = [];
  unlinkIdentityDeferred = makeDeferred();
  useAuthStore.setState({ identities: [idX, idGoogle], identitiesStatus: "loaded" });
  const u1 = useAuthStore.getState().unlinkProvider(idGoogle);
  const u2 = useAuthStore.getState().unlinkProvider(idGoogle);
  const u3 = useAuthStore.getState().unlinkProvider(idGoogle);
  unlinkIdentityDeferred.resolve();
  const [r1, r2, r3] = await Promise.all([u1, u2, u3]);
  assert.equal(unlinkIdentityCalls.length, 1, `unlink連打はSupabaseへ1回だけのはずが${unlinkIdentityCalls.length}回呼ばれた`);
  const okCount = [r1, r2, r3].filter((r) => r.ok).length;
  assert.equal(okCount, 1, "連打のうち成功扱いになったのが1件以外になっている");
  unlinkIdentityDeferred = null;
  console.log("PASS: 同一identityへのunlink連打でも、Supabaseへの要求は1回だけになる");

  // ---- 項目3-テスト3（fail-closed）: identitiesStatusが"loaded"でない間は解除させない ----
  unlinkIdentityCalls = [];
  useAuthStore.setState({ identities: null, identitiesStatus: "error" });
  const failStatusResult = await useAuthStore.getState().unlinkProvider(idGoogle);
  assert.equal(failStatusResult.ok, false, "identities未取得/失敗中なのにunlinkProviderが成功扱いになっている");
  assert.equal(unlinkIdentityCalls.length, 0, "identities未取得/失敗中なのにunlinkIdentityが呼ばれている");
  console.log("PASS（fail-closed）: identitiesStatusが\"loaded\"でない間はunlinkProviderが解除を拒否する");

  // ---- 項目3-テスト4（fail-closed）: 解除対象が最新一覧に存在しない場合は解除させない ----
  unlinkIdentityCalls = [];
  const idApple = makeIdentity("id-apple", "apple");
  useAuthStore.setState({ identities: [idX, idGoogle], identitiesStatus: "loaded" });
  const notInListResult = await useAuthStore.getState().unlinkProvider(idApple);
  assert.equal(notInListResult.ok, false, "最新一覧に存在しないidentityの解除が成功扱いになっている");
  assert.equal(unlinkIdentityCalls.length, 0, "最新一覧に存在しないidentityでunlinkIdentityが呼ばれている");
  console.log("PASS（fail-closed）: 最新の取得済み一覧に存在しないidentityは解除できない");

  // ---- 項目3-テスト5（fail-closed）: identityが1個しかない場合は解除させない ----
  unlinkIdentityCalls = [];
  useAuthStore.setState({ identities: [idX], identitiesStatus: "loaded" });
  const lastOneResult = await useAuthStore.getState().unlinkProvider(idX);
  assert.equal(lastOneResult.ok, false, "最後の1個のidentityの解除が成功扱いになっている");
  assert.equal(unlinkIdentityCalls.length, 0, "最後の1個なのにunlinkIdentityが呼ばれている");
  console.log("PASS（fail-closed）: identityが1個しかない場合は解除できない");

  console.log("ALL USE_AUTH_STORE_IDENTITY_RACE_LOCK CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
