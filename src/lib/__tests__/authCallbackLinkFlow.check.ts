// 配線確認（複数プロバイダー対応レビュー修正・項目5）：src/app/auth/callback/page.tsx
// が、連携(flow=link)完了後にマイページのログイン方法自動オープン用クエリへ
// 遷移すること、連携失敗時も内部エラーを露出せずマイページへ戻せることを、
// ソースの静的検査で確認する。実際のクエリ解析ロジック自体は
// loginMethodsReturnFlow.check.tsが検証する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const callbackPage = readFileSync(
  join(process.cwd(), "src", "app", "auth", "callback", "page.tsx"),
  "utf8",
);

{
  assert.ok(
    callbackPage.includes('isLinkFlow() ? "/mypage?loginMethods=1&link=success" : "/"'),
    "連携成功時の戻り先が/mypage?loginMethods=1&link=successになっていない",
  );
  console.log("PASS: 連携成功時はマイページのログイン方法自動オープン用クエリへ遷移する");
}

{
  // 外部から渡された値をそのまま遷移先に使っていない（isLinkFlow()は真偽値しか
  // 返さず、window.location.search中のerror/error_code等の値をrouter.replaceへ
  // 直接渡している箇所が無いことを確認する）。
  assert.ok(
    !/router\.(replace|push)\([^)]*params\.get/.test(callbackPage),
    "router.replace/pushへURLクエリの値を直接渡している箇所がある（オープンリダイレクトの懸念）",
  );
  console.log("PASS: router.replace/pushの遷移先にURLクエリの値を直接使っていない");
}

{
  assert.ok(
    callbackPage.includes('mapAuthErrorToMessage'),
    "auth/callbackがmapAuthErrorToMessageを使っていない（生のエラーが漏れる可能性）",
  );
  assert.ok(
    !/\{rawError\}|\{error\}|\{errorMessage\.code\}/.test(callbackPage),
    "画面表示に生のエラーオブジェクト・codeをそのまま出している可能性がある",
  );
  console.log("PASS: auth/callbackは生のエラーを画面へ出さず、mapAuthErrorToMessage経由の文言だけを表示する");
}

{
  assert.ok(
    callbackPage.includes('router.replace(isLinkFlow() ? "/mypage" : "/")'),
    "連携失敗時（エラー画面のボタン）がマイページへ戻る導線になっていない",
  );
  console.log("PASS: 連携失敗時のボタンはマイページへ戻る（ホームではなく、元の操作へ迷わず戻れる）");
}

console.log("ALL AUTH_CALLBACK_LINK_FLOW CHECKS PASSED");
