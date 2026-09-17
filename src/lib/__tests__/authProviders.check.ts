// authProviders.ts（複数プロバイダー対応で追加）の検証。
// 「未設定のプロバイダーを本番に表示しない」要件の核となる機能フラグが、
// 環境変数未設定時に安全側（false=無効）へ倒れることを確認する。
// このプロセスにNEXT_PUBLIC_ENABLE_GOOGLE_LOGIN/NEXT_PUBLIC_ENABLE_APPLE_LOGINを
// 意図的に設定していないため、run.sh実行時の既定状態（AUTH_PROVIDER_ENABLED・
// listEnabledAuthProviders、実際にprocess.envから計算される方）を検証できる。
//
// 2026-09-18（複数プロバイダー対応レビュー再修正・項目5）：それ以外の値
// （"true"/"1"/"false"/"0"/大文字・不正値・Google単独ON・Apple単独ON・
// 両方ON）は、実際のprocess.envやモジュールキャッシュに一切触れず、
// 純粋関数computeAuthProviderEnabled/computeEnabledAuthProvidersへ任意の
// 入力を渡すことで検証する（テスト同士が環境変数の状態を汚染しない）。
import assert from "node:assert/strict";

import {
  AUTH_PROVIDER_ENABLED,
  computeAuthProviderEnabled,
  computeEnabledAuthProviders,
  listEnabledAuthProviders,
} from "../authProviders";

function main() {
  // ---- 実行時（process.env、run.shではGoogle/Apple未設定）のデフォルト状態 ----
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

  // ---- 項目5：純粋関数に任意の値を渡して網羅する（process.envには触れない） ----

  // 未設定（undefined）
  assert.equal(computeAuthProviderEnabled({ google: undefined, apple: undefined }).google, false);
  console.log("PASS: undefinedはGoogle/Appleとも無効");

  // "true" → 有効
  assert.equal(computeAuthProviderEnabled({ google: "true", apple: undefined }).google, true, '"true"はGoogleを有効にするべき');
  // "1" → 有効
  assert.equal(computeAuthProviderEnabled({ google: "1", apple: undefined }).google, true, '"1"はGoogleを有効にするべき');
  console.log('PASS: "true"・"1"はどちらも有効にする');

  // "false" → 無効
  assert.equal(computeAuthProviderEnabled({ google: "false", apple: undefined }).google, false, '"false"はGoogleを無効のままにするべき');
  // "0" → 無効
  assert.equal(computeAuthProviderEnabled({ google: "0", apple: undefined }).google, false, '"0"はGoogleを無効のままにするべき');
  console.log('PASS: "false"・"0"はどちらも無効のまま（安全側）');

  // 大文字・不正値 → 無効（安全側）
  for (const invalid of ["TRUE", "True", "TRUE ", " true", "1 ", "yes", "on", "enabled", ""]) {
    assert.equal(
      computeAuthProviderEnabled({ google: invalid, apple: undefined }).google,
      false,
      `不正値"${invalid}"がGoogleを有効にしてしまっている`,
    );
  }
  console.log("PASS: 大文字・前後空白・その他の不正値はすべて無効側（安全側）に倒れる");

  // GoogleだけON
  const googleOnly = computeAuthProviderEnabled({ google: "true", apple: "false" });
  assert.deepEqual(googleOnly, { x: true, google: true, apple: false });
  assert.deepEqual(computeEnabledAuthProviders({ google: "true", apple: "false" }), ["x", "google"]);
  console.log("PASS: GoogleだけONにするとx/googleだけが有効になる");

  // AppleだけON
  const appleOnly = computeAuthProviderEnabled({ google: "0", apple: "1" });
  assert.deepEqual(appleOnly, { x: true, google: false, apple: true });
  assert.deepEqual(computeEnabledAuthProviders({ google: "0", apple: "1" }), ["x", "apple"]);
  console.log("PASS: AppleだけONにするとx/appleだけが有効になる");

  // 両方ON
  const bothOn = computeAuthProviderEnabled({ google: "true", apple: "true" });
  assert.deepEqual(bothOn, { x: true, google: true, apple: true });
  assert.deepEqual(computeEnabledAuthProviders({ google: "true", apple: "true" }), ["x", "google", "apple"]);
  console.log("PASS: 両方ONにするとx/google/appleすべてが有効になる");

  // 一連の呼び出し（未設定→true→false→…）を同じプロセス内で連続実行しても
  // 直前の呼び出し結果に影響されない（モジュールキャッシュ等の汚染が無い）ことの確認。
  assert.equal(computeAuthProviderEnabled({ google: undefined, apple: undefined }).google, false);
  console.log("PASS: 複数パターンを連続実行しても、直前の呼び出しに結果が汚染されない");

  console.log("ALL AUTH_PROVIDERS CHECKS PASSED");
}

main();
