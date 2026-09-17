// authProviders.ts（複数プロバイダー対応で追加）の検証。
// 「未設定のプロバイダーを本番に表示しない」要件の核となる機能フラグが、
// 環境変数未設定時に安全側（false=無効）へ倒れることを確認する。
// このプロセスにNEXT_PUBLIC_ENABLE_GOOGLE_LOGIN/NEXT_PUBLIC_ENABLE_APPLE_LOGINを
// 意図的に設定していないため、run.sh実行時の既定状態を検証できる。
import assert from "node:assert/strict";

import { AUTH_PROVIDER_ENABLED, listEnabledAuthProviders } from "../authProviders";

function main() {
  assert.equal(AUTH_PROVIDER_ENABLED.x, true, "Xは常に有効であるべき");
  assert.equal(
    AUTH_PROVIDER_ENABLED.google,
    false,
    "NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN未設定時はGoogleが無効であるべき",
  );
  assert.equal(
    AUTH_PROVIDER_ENABLED.apple,
    false,
    "NEXT_PUBLIC_ENABLE_APPLE_LOGIN未設定時はAppleが無効であるべき",
  );
  console.log("PASS: 環境変数未設定時、X以外のプロバイダーは無効（安全側）になっている");

  const enabled = listEnabledAuthProviders();
  assert.deepEqual(enabled, ["x"], "未設定時に有効なプロバイダー一覧が[\"x\"]以外になっている");
  console.log("PASS: 未設定時の有効プロバイダー一覧は[\"x\"]だけになる");

  console.log("ALL AUTH_PROVIDERS CHECKS PASSED");
}

main();
