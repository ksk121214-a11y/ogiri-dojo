// consentVersionError.ts（record_terms_consent_v2のVERSION_MISMATCH・退役済み旧
// record_terms_consent()のCLIENT_UPDATE_REQUIREDを、再読み込みを促す専用の日本語
// 案内へ変換する純粋関数）の単体検証。
import assert from "node:assert/strict";

import { CONSENT_VERSION_RELOAD_MESSAGE, isConsentVersionMismatchError } from "../consentVersionError";

assert.ok(CONSENT_VERSION_RELOAD_MESSAGE.length > 0, "CONSENT_VERSION_RELOAD_MESSAGEが空文字になっている");
assert.ok(!/[A-Z_]{5,}/.test(CONSENT_VERSION_RELOAD_MESSAGE), "CONSENT_VERSION_RELOAD_MESSAGEに生のDBエラーコードらしき文字列が含まれている");

// 1: VERSION_MISMATCH・CLIENT_UPDATE_REQUIREDのいずれも検知する。
assert.equal(isConsentVersionMismatchError(new Error("VERSION_MISMATCH")), true);
assert.equal(isConsentVersionMismatchError({ message: "VERSION_MISMATCH" }), true);
assert.equal(isConsentVersionMismatchError({ message: "CLIENT_UPDATE_REQUIRED" }), true);
assert.equal(isConsentVersionMismatchError("VERSION_MISMATCH"), true);
// PostgrestError等、messageにSQL例外のコンテキスト文が前後に付く場合も部分一致で検知する。
assert.equal(
  isConsentVersionMismatchError({ message: "VERSION_MISMATCH", details: null, hint: null, code: "P0001" }),
  true,
);
console.log("PASS: VERSION_MISMATCH・CLIENT_UPDATE_REQUIREDのいずれも、Error/文字列/PostgrestError形式のいずれでも検知する");

// 2: 通信エラー・その他の一般的な失敗は誤検知しない。
for (const other of [
  new Error("network error"),
  { message: "rpc failed" },
  { message: "Failed to fetch" },
  "some other string",
  null,
  undefined,
  {},
  { message: 123 },
]) {
  assert.equal(isConsentVersionMismatchError(other), false, `誤検知: ${JSON.stringify(other)}`);
}
console.log("PASS: 通信エラー等の一般的な失敗はVERSION_MISMATCH/CLIENT_UPDATE_REQUIREDとして誤検知しない");

console.log("ALL CONSENT_VERSION_ERROR CHECKS PASSED");
