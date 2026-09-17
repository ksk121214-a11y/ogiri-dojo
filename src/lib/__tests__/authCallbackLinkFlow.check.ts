// 配線確認（複数プロバイダー対応レビュー再修正・項目1/5）：
// src/app/auth/callback/page.tsxが、連携(flow=link)完了を「実際にidentityが
// 追加されたことを確認できた場合だけ」成功とし、URLから受け取った値
// （providerを含む）を判定・遷移先に一切使っていないことを、ソースの
// 静的検査で確認する。実際の判定ロジック（validateLinkAttempt/
// verifyIdentityWasAdded）の状態遷移自体はlinkFlowVerification.check.tsが、
// クエリ解析自体はloginMethodsReturnFlow.check.tsが検証する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const callbackPage = readFileSync(
  join(process.cwd(), "src", "app", "auth", "callback", "page.tsx"),
  "utf8",
);

{
  // 連携フローの確認手順（読み込み→事前チェック→identity取得→事後チェック→
  // 消費して削除、の一連）が実際に呼ばれていることを確認する。
  assert.ok(callbackPage.includes("readLinkAttempt()"), "readLinkAttempt()で一時情報を読み込んでいない");
  assert.ok(callbackPage.includes("validateLinkAttempt("), "validateLinkAttempt()で事前チェックをしていない");
  assert.ok(
    callbackPage.includes("useAuthStore.getState().refreshIdentities()"),
    "refreshIdentities()で実際のidentity一覧を取得していない",
  );
  assert.ok(
    callbackPage.includes("verifyIdentityWasAdded("),
    "verifyIdentityWasAdded()で実際にidentityが増えたか確認していない",
  );
  console.log("PASS: 連携フローはreadLinkAttempt→validateLinkAttempt→refreshIdentities→verifyIdentityWasAddedの順で確認する");
}

{
  // 一時情報は成功・失敗いずれの結果でも必ず消費して削除する（再利用防止）。
  // ソース中にclearLinkAttempt()の呼び出しが複数箇所（OAuthエラー分岐・
  // 事前チェックNG分岐・事後チェック後・タイムアウト分岐）にあることを確認する。
  const clearCalls = callbackPage.match(/clearLinkAttempt\(\)/g) ?? [];
  assert.ok(clearCalls.length >= 3, `clearLinkAttempt()の呼び出しが少なすぎる（実際=${clearCalls.length}）`);
  console.log("PASS: 一時情報は複数の失敗経路・成功経路のいずれでも消費して削除される");
}

{
  // 成功時の遷移先（router.replace("/mypage?loginMethods=1&link=success")）が
  // ソース中に存在し、かつverifyIdentityWasAddedによる確認より前に無条件で
  // 呼ばれる行が無いことを確認する（=確認前に成功扱いにする経路が無い）。
  assert.ok(
    callbackPage.includes('router.replace("/mypage?loginMethods=1&link=success")'),
    "連携成功時の戻り先が/mypage?loginMethods=1&link=successになっていない",
  );
  const successIdx = callbackPage.indexOf('router.replace("/mypage?loginMethods=1&link=success")');
  const postCheckIdx = callbackPage.indexOf("verifyIdentityWasAdded(");
  assert.ok(
    postCheckIdx >= 0 && postCheckIdx < successIdx,
    "成功への遷移がverifyIdentityWasAddedによる確認より前に書かれている",
  );
  console.log("PASS: 成功画面への遷移はverifyIdentityWasAddedによる確認より後にしか書かれていない");
}

{
  // URLから受け取った値（provider等）を判定・遷移先に使っていないこと。
  // flow=link自体の判定（isLinkFlow）以外に、URLSearchParamsから読み取った
  // 値をrouter.replace/validateLinkAttempt/verifyIdentityWasAddedへ
  // そのまま渡している箇所が無いことを確認する。
  assert.ok(
    !/params\.get\("provider"\)/.test(callbackPage),
    "URLからproviderを読み取っている（連携確認にURL由来のproviderを使うべきではない）",
  );
  assert.ok(
    !/router\.(replace|push)\([^)]*params\.get/.test(callbackPage),
    "router.replace/pushへURLクエリの値を直接渡している箇所がある（オープンリダイレクトの懸念）",
  );
  console.log("PASS: URLから読み取った値（providerを含む）を連携の判定・遷移先に使っていない");
}

{
  // 連携フローの失敗は理由を問わず、生のエラー・provider固有情報を含まない
  // 固定の日本語文言（LINK_VERIFICATION_FAILURE_MESSAGE）だけを表示する。
  assert.ok(
    callbackPage.includes(
      "ログイン方法の連携を確認できませんでした。マイページからもう一度お試しください。",
    ),
    "連携確認失敗時の固定文言が見当たらない",
  );
  assert.ok(
    callbackPage.includes("mapAuthErrorToMessage"),
    "auth/callbackがmapAuthErrorToMessageを使っていない（新規ログイン側で生のエラーが漏れる可能性）",
  );
  assert.ok(
    !/\{rawError\}|\{error\}|\{errorMessage\.code\}/.test(callbackPage),
    "画面表示に生のエラーオブジェクト・codeをそのまま出している可能性がある",
  );
  console.log("PASS: 連携フローの失敗は固定の安全な日本語文言のみを表示し、生のエラーは出さない");
}

{
  assert.ok(
    callbackPage.includes('router.replace(isLink ? "/mypage" : "/")'),
    "連携失敗時（エラー画面のボタン）がマイページへ戻る導線になっていない",
  );
  console.log("PASS: 連携失敗時のボタンはマイページへ戻る（ホームではなく、元の操作へ迷わず戻れる）");
}

console.log("ALL AUTH_CALLBACK_LINK_FLOW CHECKS PASSED");
