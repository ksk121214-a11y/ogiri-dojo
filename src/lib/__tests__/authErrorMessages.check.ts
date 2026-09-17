// mapAuthErrorToMessage（複数プロバイダー対応で追加）の検証。
// Supabase Authの生のエラーコード・メッセージを画面へ絶対に漏らさず、
// 既知のcodeだけ個別の日本語文言へ、未知のcodeは一律の汎用文言へ変換することを確認する。
import assert from "node:assert/strict";

import { mapAuthErrorToMessage } from "../authErrorMessages";

function main() {
  // 既知のcode：identity_already_exists（重複連携）は専用の案内文になる。
  const dup = mapAuthErrorToMessage({ code: "identity_already_exists" });
  assert.ok(dup.includes("連携済み"), "identity_already_existsが専用文言に変換されていない");
  console.log("PASS: identity_already_existsは重複連携の案内文になる");

  // 既知のcode：single_identity_not_deletable（最後の1つは解除不可）。
  const last = mapAuthErrorToMessage({ code: "single_identity_not_deletable" });
  assert.ok(last.includes("最後のログイン方法"), "single_identity_not_deletableが専用文言に変換されていない");
  console.log("PASS: single_identity_not_deletableは最後のログイン方法の案内文になる");

  // 未知のcode・生のメッセージは汎用文言に丸められ、元の文字列が含まれない。
  const raw = { code: "some_never_seen_internal_code", message: "raw postgres detail xyz" } as {
    code?: string | null;
    message?: string;
  };
  const fallback = mapAuthErrorToMessage(raw);
  assert.ok(!fallback.includes("raw postgres detail"), "未知のcodeで生のメッセージが漏れている");
  assert.ok(!fallback.includes("some_never_seen_internal_code"), "未知のcodeがそのまま画面文言に出ている");
  console.log("PASS: 未知のcodeは生の文言を含まない汎用メッセージに丸められる");

  // codeが無い/nullの場合も汎用文言になる（例外を投げない）。
  assert.equal(typeof mapAuthErrorToMessage(null), "string");
  assert.equal(typeof mapAuthErrorToMessage(undefined), "string");
  assert.equal(typeof mapAuthErrorToMessage({ code: null }), "string");
  console.log("PASS: code無し/null/undefinedでも例外を投げず汎用メッセージを返す");

  console.log("ALL AUTH_ERROR_MESSAGES CHECKS PASSED");
}

main();
