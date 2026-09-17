// parseLoginMethodsReturnParams（複数プロバイダー対応レビュー修正・項目5）の検証。
// linkIdentity()完了後のマイページ復帰クエリを解析するだけの純粋関数であり、
// URL中の値を遷移先として使わないこと（真偽値2つしか返さないこと）を型面でも
// 保証しているが、ここでは実際の判定結果を検証する。
import assert from "node:assert/strict";

import { parseLoginMethodsReturnParams } from "../loginMethodsReturnFlow";

function main() {
  // 連携成功で戻ってきた場合：モーダルを開き、成功表示も出す。
  const success = parseLoginMethodsReturnParams("?loginMethods=1&link=success");
  assert.deepEqual(success, { shouldOpen: true, showLinkSuccess: true });
  console.log("PASS: loginMethods=1&link=successでshouldOpen/showLinkSuccessが両方trueになる");

  // モーダルは開くが、link=success以外（例：無し）は成功表示を出さない。
  const openOnly = parseLoginMethodsReturnParams("?loginMethods=1");
  assert.deepEqual(openOnly, { shouldOpen: true, showLinkSuccess: false });
  console.log("PASS: loginMethods=1のみではshowLinkSuccessはfalseのまま");

  // 通常のマイページ訪問（クエリ無し）では何も自動で開かない。
  const none = parseLoginMethodsReturnParams("");
  assert.deepEqual(none, { shouldOpen: false, showLinkSuccess: false });
  console.log("PASS: クエリが無い場合はshouldOpen/showLinkSuccessともにfalse");

  // loginMethods=1以外の値（改ざん・別機能の値）では開かない。
  const wrongValue = parseLoginMethodsReturnParams("?loginMethods=true&link=success");
  assert.deepEqual(wrongValue, { shouldOpen: false, showLinkSuccess: false });
  console.log("PASS: loginMethodsが\"1\"以外の値では自動で開かない");

  // link=success以外の値（失敗・キャンセル等を装った値）ではshowLinkSuccessをtrueにしない。
  const wrongLink = parseLoginMethodsReturnParams("?loginMethods=1&link=failed");
  assert.deepEqual(wrongLink, { shouldOpen: true, showLinkSuccess: false });
  console.log("PASS: link=success以外の値では成功表示をtrueにしない");

  console.log("ALL LOGIN_METHODS_RETURN_FLOW CHECKS PASSED");
}

main();
