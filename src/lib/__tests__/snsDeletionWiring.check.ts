// 配線確認：寄合帳の自分の投稿削除（DeleteButton・useSnsStore・0067）が、
// お題・回答・ツッコミが表示される全箇所（SnsFeedSection・SnsTopicDetail・
// SnsAnswerDetail）に正しく組み込まれていること、DeleteButtonが確認ダイアログを
// 経ないと削除しないこと・失敗時に生のエラーを出さないこと、遊び方ページの
// お題提供者リンクが安全な属性で組まれていることを、ソースの静的検査で確認する。
// 実際のstate遷移（成功時のカスケード削除・連打防止・失敗時の非破壊）は
// src/lib/__tests__/store/useSnsStoreDelete.check.ts が本番実装を直接呼び出して検証する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const feed = readFileSync(join(process.cwd(), "src", "components", "sns", "SnsFeedSection.tsx"), "utf8");
const topicDetail = readFileSync(join(process.cwd(), "src", "components", "sns", "SnsTopicDetail.tsx"), "utf8");
const answerDetail = readFileSync(join(process.cwd(), "src", "components", "sns", "SnsAnswerDetail.tsx"), "utf8");
const deleteButton = readFileSync(join(process.cwd(), "src", "components", "app", "DeleteButton.tsx"), "utf8");
const howToPlay = readFileSync(
  join(process.cwd(), "src", "app", "(main)", "how-to-play", "page.tsx"),
  "utf8",
);

// 1: お題・回答・ツッコミが表示される3ファイルすべてで、自分の投稿は
//    DeleteButton、他人の投稿はReportButtonが出る三項分岐になっている
//    （SnsFeedSection: お題カード・回答カードの2箇所、SnsTopicDetail: お題本体・
//    回答一覧の2箇所、SnsAnswerDetail: 回答本体・ツッコミ一覧の2箇所＝計6箇所）。
{
  const pattern = /authorId === "me" \? \(\s*<DeleteButton[\s\S]*?\) : \(\s*<ReportButton/g;

  const feedMatches = feed.match(pattern) ?? [];
  assert.equal(feedMatches.length, 2, `SnsFeedSectionのDelete/Report出し分けが2箇所ではない（実際:${feedMatches.length}）`);

  const topicDetailMatches = topicDetail.match(pattern) ?? [];
  assert.equal(
    topicDetailMatches.length,
    2,
    `SnsTopicDetailのDelete/Report出し分けが2箇所ではない（実際:${topicDetailMatches.length}）`,
  );

  const answerDetailMatches = answerDetail.match(pattern) ?? [];
  assert.equal(
    answerDetailMatches.length,
    2,
    `SnsAnswerDetailのDelete/Report出し分けが2箇所ではない（実際:${answerDetailMatches.length}）`,
  );

  console.log("PASS: お題・回答・ツッコミが表示される全箇所（計6箇所）で、自分の投稿だけDeleteButton・他人の投稿はReportButtonになっている");
}

// 2: DeleteButton.tsx は window.confirm の結果を見てからでないと削除アクションを
//    呼ばない（キャンセル時は何もしない）。
{
  const m = deleteButton.match(
    /const confirmed = window\.confirm\(CONFIRM_MESSAGE\[targetType\]\);\s*\n\s*if \(!confirmed\) return;/,
  );
  assert.ok(m, "DeleteButtonがwindow.confirmでキャンセルされた場合に何もせず戻る作りになっていない");
  // confirmed の判定より前にstore側の削除アクション（deleteTopic/deleteAnswer/deleteComment）
  // を呼んでいないこと（=action変数の組み立て・呼び出しがconfirm判定より後にあること）。
  const confirmIdx = deleteButton.indexOf("const confirmed = window.confirm");
  const actionCallIdx = deleteButton.indexOf("await action(targetId)");
  assert.ok(confirmIdx >= 0 && actionCallIdx > confirmIdx, "削除アクションの呼び出しがconfirm確認より前にある（キャンセルしても削除されてしまう）");
  console.log("PASS: DeleteButtonは確認ダイアログでキャンセルすると削除アクションを呼ばない");
}

// 3: DeleteButton.tsx は連打防止（pendingガード・disabled）を持ち、失敗時は
//    result.reason（useSnsStore側で日本語化済み）だけを表示し、生のエラー
//    オブジェクトや.message等をそのまま出していない。
{
  assert.ok(/if \(pending\) return;/.test(deleteButton), "DeleteButtonにpending中の連打防止ガードが無い");
  assert.ok(/disabled=\{pending\}/.test(deleteButton), "DeleteButtonのbutton要素がpending中disabledになっていない");
  assert.ok(
    /window\.alert\(result\.reason\);/.test(deleteButton),
    "DeleteButtonの失敗時表示がresult.reason（日本語化済み）を使っていない",
  );
  assert.ok(
    !/error\.message|err\.message|\.error\b/.test(deleteButton),
    "DeleteButtonが生のエラーオブジェクト/.messageを直接参照している可能性がある",
  );
  console.log("PASS: DeleteButtonは連打防止（pendingガード・disabled）を持ち、失敗時は日本語化済みの理由だけを表示する");
}

// 4: useSnsStore.ts側のdelete系アクションは、エラーコードを直接返さず必ず
//    mapSnsDeleteError（日本語文言）を経由している（DeleteButton側の3と対になる確認）。
{
  const store = readFileSync(join(process.cwd(), "src", "store", "useSnsStore.ts"), "utf8");
  const deleteActionsBlock = store.slice(store.indexOf("deleteTopic:"));
  const rawReasonLeak = /reason: error\.message/.test(deleteActionsBlock);
  assert.ok(!rawReasonLeak, "delete系アクションが生のerror.messageをそのままreasonに使っている可能性がある");
  const mapCount = (deleteActionsBlock.match(/mapSnsDeleteError\(error\.message\)/g) ?? []).length;
  assert.equal(mapCount, 3, `deleteTopic/deleteAnswer/deleteCommentの3つすべてがmapSnsDeleteErrorを通っていない（実際:${mapCount}）`);
  console.log("PASS: useSnsStoreのdelete系アクションはいずれもmapSnsDeleteError経由でしかエラー理由を返さない");
}

// 5: 遊び方ページのお題提供者リンクが、別タブ・安全な属性・正しい文言で組まれている。
{
  assert.ok(howToPlay.includes('href="https://x.com/kusenotuyoiodai"'), "お題提供者のXリンクのURLが正しくない");
  assert.ok(howToPlay.includes('target="_blank"'), "お題提供者のXリンクがtarget=\"_blank\"になっていない");
  assert.ok(howToPlay.includes('rel="noopener noreferrer"'), "お題提供者のXリンクにrel=\"noopener noreferrer\"が無い");
  assert.ok(howToPlay.includes("@kusenotuyoiodai"), "お題提供者のXアカウント表記(@kusenotuyoiodai)が無い");
  assert.ok(howToPlay.includes("癖の強いお題を出す大喜利"), "お題提供者名（癖の強いお題を出す大喜利）の記載が無い");
  assert.ok(/aria-label="[^"]*X[^"]*"/.test(howToPlay), "お題提供者のXリンクにアクセシブルなaria-labelが無い");
  // 埋め込みウィジェット・画像を使わずテキストリンクのみであること。
  assert.ok(!/twitter\.com\/widgets|platform\.twitter\.com|<img/.test(howToPlay), "Xの埋め込みウィジェット/画像が使われている（テキストリンクのみのはず）");
  console.log("PASS: 遊び方ページのお題提供者リンクが正しいURL・別タブ・安全な属性・アクセシブルなラベルで組まれている");
}

console.log("ALL SNS_DELETION WIRING CHECKS PASSED");
