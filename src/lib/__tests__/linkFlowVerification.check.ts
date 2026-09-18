// linkFlowVerification.ts（複数プロバイダー対応レビュー再修正・項目1）の検証。
// 「実際にidentityが追加されたことを確認できた場合だけ連携成功とする」判定の
// 核心ロジックを、文字列検索ではなく実際の入力→出力の状態遷移として検証する。
import assert from "node:assert/strict";
import type { UserIdentity } from "@supabase/supabase-js";

import type { LinkAttempt } from "../linkAttempt";
import { validateLinkAttempt, verifyIdentityWasAdded } from "../linkFlowVerification";

function makeAttempt(overrides: Partial<LinkAttempt> = {}): LinkAttempt {
  return {
    v: 1,
    userId: "user-1",
    provider: "google",
    startedAt: 1_000_000,
    priorIdentityIds: ["id-x"],
    ...overrides,
  };
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

function main() {
  // ==== validateLinkAttempt ====

  // 一時情報が無い（=/auth/callback/?flow=linkへ直接アクセスした等）場合は成功しない。
  assert.deepEqual(validateLinkAttempt(null, 2_000_000, "user-1"), { ok: false, reason: "no_attempt" });
  console.log("PASS: 一時情報が無い場合はno_attemptで拒否される（直接アクセスでは成功しない）");

  // 有効期限内（10分未満経過）はvalidateLinkAttempt自体は通す。
  const freshAttempt = makeAttempt({ startedAt: 1_000_000 });
  assert.deepEqual(
    validateLinkAttempt(freshAttempt, 1_000_000 + 9 * 60 * 1000, "user-1"),
    { ok: true },
  );
  console.log("PASS: 期限内（9分後）はvalidateLinkAttemptを通過する");

  // 期限切れ（10分超過）は成功しない。
  assert.deepEqual(
    validateLinkAttempt(freshAttempt, 1_000_000 + 11 * 60 * 1000, "user-1"),
    { ok: false, reason: "expired" },
  );
  console.log("PASS: 期限切れ（11分後）はexpiredで拒否される");

  // user ID不一致（連携開始時と別のアカウントで戻ってきた）は成功しない。
  assert.deepEqual(
    validateLinkAttempt(freshAttempt, 1_000_000, "user-2"),
    { ok: false, reason: "user_mismatch" },
  );
  console.log("PASS: user ID不一致はuser_mismatchで拒否される");

  // 現在ログインしていない（currentUserId=null）場合も同様に拒否される。
  assert.deepEqual(
    validateLinkAttempt(freshAttempt, 1_000_000, null),
    { ok: false, reason: "user_mismatch" },
  );
  console.log("PASS: 現在ログインしていない場合もuser_mismatchで拒否される");

  // ==== verifyIdentityWasAdded ====

  // identity取得自体が失敗した場合は成功しない。
  assert.deepEqual(
    verifyIdentityWasAdded(makeAttempt(), { ok: false }),
    { ok: false, reason: "identities_fetch_failed" },
  );
  console.log("PASS: identity取得失敗はidentities_fetch_failedで拒否される");

  // 開始前の一覧と全く変わっていない（identityが追加されていない）場合は成功しない。
  assert.deepEqual(
    verifyIdentityWasAdded(makeAttempt({ priorIdentityIds: ["id-x"] }), {
      ok: true,
      identities: [makeIdentity("id-x", "x")],
    }),
    { ok: false, reason: "identity_not_added" },
  );
  console.log("PASS: identityが増えていない場合はidentity_not_addedで拒否される（OAuthキャンセル等）");

  // 増えたidentityのproviderが、連携を開始したprovider（sessionStorageに
  // 保存された値）と異なる場合は成功しない。
  assert.deepEqual(
    verifyIdentityWasAdded(makeAttempt({ provider: "google", priorIdentityIds: ["id-x"] }), {
      ok: true,
      identities: [makeIdentity("id-x", "x"), makeIdentity("id-apple", "apple")],
    }),
    { ok: false, reason: "provider_mismatch" },
  );
  console.log("PASS: 増えたidentityのproviderが不一致の場合はprovider_mismatchで拒否される");

  // 正常系：開始前に無かったidentityが増えており、providerも一致する場合だけ成功する。
  assert.deepEqual(
    verifyIdentityWasAdded(makeAttempt({ provider: "google", priorIdentityIds: ["id-x"] }), {
      ok: true,
      identities: [makeIdentity("id-x", "x"), makeIdentity("id-google", "google")],
    }),
    { ok: true },
  );
  console.log("PASS: 開始前に無かった対象providerのidentityが実際に増えている場合だけ成功する");

  // ==== verifyIdentityWasAdded：複数タブ等で並行して連携が増えたケース
  //      （2026-09-19再々レビュー修正、配列順に依存しないことの検証） ====

  // 1. 開始前がXのみ、完了後がX・Google・Appleで対象はApple。
  //    新規identityの並びがGoogle→Apple（対象が配列の後ろ）でも成功する。
  assert.deepEqual(
    verifyIdentityWasAdded(makeAttempt({ provider: "apple", priorIdentityIds: ["id-x"] }), {
      ok: true,
      identities: [makeIdentity("id-x", "x"), makeIdentity("id-google", "google"), makeIdentity("id-apple", "apple")],
    }),
    { ok: true },
  );
  console.log("PASS: 新規identityがGoogle→Appleの並びでも、対象Appleが含まれていれば成功する");

  // 2. 同じ条件で、新規identityの並びがApple→Google（対象が配列の先頭）でも成功する。
  assert.deepEqual(
    verifyIdentityWasAdded(makeAttempt({ provider: "apple", priorIdentityIds: ["id-x"] }), {
      ok: true,
      identities: [makeIdentity("id-x", "x"), makeIdentity("id-apple", "apple"), makeIdentity("id-google", "google")],
    }),
    { ok: true },
  );
  console.log("PASS: 新規identityがApple→Googleの並びでも、対象Appleが含まれていれば成功する");

  // 3. 対象がGoogleで、完了後にGoogleとAppleの両方が増えていても成功する
  //    （並行連携そのものは咎めず、対象providerが含まれていれば成功でよい）。
  assert.deepEqual(
    verifyIdentityWasAdded(makeAttempt({ provider: "google", priorIdentityIds: ["id-x"] }), {
      ok: true,
      identities: [makeIdentity("id-x", "x"), makeIdentity("id-google", "google"), makeIdentity("id-apple", "apple")],
    }),
    { ok: true },
  );
  console.log("PASS: 対象がGoogleで、Google・Appleの両方が新規に増えていても成功する");

  // 4. 新しいidentityはAppleだけ、対象はGoogle → provider_mismatch。
  assert.deepEqual(
    verifyIdentityWasAdded(makeAttempt({ provider: "google", priorIdentityIds: ["id-x"] }), {
      ok: true,
      identities: [makeIdentity("id-x", "x"), makeIdentity("id-apple", "apple")],
    }),
    { ok: false, reason: "provider_mismatch" },
  );
  console.log("PASS: 新規identityがAppleのみで対象がGoogleの場合はprovider_mismatchになる");

  // 5. 新しいidentityが0件 → identity_not_added。
  assert.deepEqual(
    verifyIdentityWasAdded(makeAttempt({ provider: "google", priorIdentityIds: ["id-x", "id-google"] }), {
      ok: true,
      identities: [makeIdentity("id-x", "x"), makeIdentity("id-google", "google")],
    }),
    { ok: false, reason: "identity_not_added" },
  );
  console.log("PASS: 新規identityが0件の場合はidentity_not_addedになる");

  // 6. 元からGoogleが存在していて（priorIdentityIdsに含まれる）、新規追加は
  //    Appleだけ、対象はGoogle → 元から存在したGoogleを成功判定に使わず、
  //    provider_mismatchになる（新規に増えたものだけを対象に判定する）。
  assert.deepEqual(
    verifyIdentityWasAdded(makeAttempt({ provider: "google", priorIdentityIds: ["id-x", "id-google"] }), {
      ok: true,
      identities: [makeIdentity("id-x", "x"), makeIdentity("id-google", "google"), makeIdentity("id-apple", "apple")],
    }),
    { ok: false, reason: "provider_mismatch" },
  );
  console.log(
    "PASS: 元から存在していたGoogleは成功判定に使われず、新規追加がAppleだけなら対象Googleはprovider_mismatchになる",
  );

  // 7. identity取得失敗 → identities_fetch_failed（既存の分岐が壊れていないことの再確認）。
  assert.deepEqual(
    verifyIdentityWasAdded(makeAttempt({ provider: "apple" }), { ok: false }),
    { ok: false, reason: "identities_fetch_failed" },
  );
  console.log("PASS: identity取得失敗はidentities_fetch_failedになる（複数タブケースでも変わらない）");

  // 一連の状態遷移：validateLinkAttempt→verifyIdentityWasAddedの順で両方okの
  // 場合だけ「連携成功」と判断できることを、実際に両方呼んで確認する
  // （callbackページの実際の呼び出し順と同じ組み合わせ方）。
  {
    const attempt = makeAttempt({ userId: "user-1", provider: "apple", priorIdentityIds: ["id-x"] });
    const pre = validateLinkAttempt(attempt, attempt.startedAt + 60_000, "user-1");
    assert.equal(pre.ok, true);
    const post = verifyIdentityWasAdded(attempt, {
      ok: true,
      identities: [makeIdentity("id-x", "x"), makeIdentity("id-apple", "apple")],
    });
    assert.equal(post.ok, true);
    console.log("PASS: 事前チェック→事後チェックの組み合わせで正しく連携成功と判定できる");
  }

  console.log("ALL LINK_FLOW_VERIFICATION CHECKS PASSED");
}

main();
