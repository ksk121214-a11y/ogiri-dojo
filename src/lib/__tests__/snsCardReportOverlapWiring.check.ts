// 寄合帳（お題/回答カード・お題詳細・回答詳細）で、右端に絶対配置される通報/削除
// ボタンと本文の折り返し直前の文字が重なる表示崩れ（2026-09-29修正）の再発防止。
// このリポジトリに実DOMレンダリング用のテストランナーが無いため、他の*.check.tsと
// 同じ「ソースの静的検査」方式で、ボタンの占有幅（right-*オフセット＋サイズ）より
// 本文側のpr-*（右側の確保幅）が常に広いことを、Tailwindのspacingスケールに基づく
// 数値比較で検証する（実際の見た目はPlaywrightで320/390/1280pxを確認済み）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// Tailwindの既定spacingスケール（1単位=0.25rem=4px）。このファイルで使う範囲のみ。
const SPACING_PX: Record<string, number> = { "2": 8, "3": 12, "4": 16, "9": 36, "10": 40, "11": 44 };
const DEFAULT_BUTTON_SIZE_PX = 22; // ReportButton/DeleteButtonのsize省略時の既定値

function assertPaddingCoversButton(
  label: string,
  rightOffsetToken: string,
  paddingToken: string,
  buttonSizePx: number = DEFAULT_BUTTON_SIZE_PX,
) {
  const rightPx = SPACING_PX[rightOffsetToken];
  const padPx = SPACING_PX[paddingToken];
  assert.ok(rightPx !== undefined, `${label}: right-${rightOffsetToken}のpx換算が未定義`);
  assert.ok(padPx !== undefined, `${label}: pr-${paddingToken}のpx換算が未定義`);
  const footprint = rightPx + buttonSizePx;
  assert.ok(
    padPx >= footprint,
    `${label}: ボタンの占有幅(right-${rightOffsetToken}+size${buttonSizePx}=${footprint}px)に対し、確保している余白pr-${paddingToken}(${padPx}px)が不足している`,
  );
}

// 1) SnsFeedSection.tsx（寄合帳トップ・お題タブ/回答タブの一覧カード）
{
  const src = read("src/components/sns/SnsFeedSection.tsx");

  // お題カード：本文ラッパー(div/Linkの両方)にpr-10、ボタンはright-3・既定サイズ。
  const topicWrapperDiv = /<div className="flex flex-col gap-2 pr-10">\{body\}<\/div>/;
  const topicWrapperLink = /<Link href=\{`\/sns\/\$\{topic\.id\}`\} className="flex flex-col gap-2 pr-10">/;
  assert.ok(topicWrapperDiv.test(src), "TopicFeedList: リンク無効時の本文ラッパーにpr-10が無い");
  assert.ok(topicWrapperLink.test(src), "TopicFeedList: Linkの本文ラッパーにpr-10が無い");
  assertPaddingCoversButton("TopicFeedList", "3", "10");

  // 回答カード：本文ラッパー(div/Linkの両方)にpr-10、ボタンはright-3・既定サイズ。
  const answerWrapperDiv = /<div className="flex flex-col gap-1 pr-10">\{answerBody\}<\/div>/;
  const answerWrapperLink = /<Link href=\{`\/sns\/answers\/\$\{answer\.id\}`\} className="flex flex-col gap-1 pr-10">/;
  assert.ok(answerWrapperDiv.test(src), "AnswerFeedList: リンク無効時の本文ラッパーにpr-10が無い");
  assert.ok(answerWrapperLink.test(src), "AnswerFeedList: Linkの本文ラッパーにpr-10が無い");
  assertPaddingCoversButton("AnswerFeedList", "3", "10");

  // 本文段落自体にもbreak-words（句読点なしの連続文字・URL的な文字列でも
  // 横スクロールを起こさず折り返すための保険）。
  assert.ok(
    /break-words font-sans text-base font-bold leading-snug text-\[var\(--ink\)\] sm:text-lg/.test(src),
    "TopicFeedList: お題本文にbreak-wordsが無い",
  );
  assert.ok(
    /break-words font-sans text-sm font-bold text-\[var\(--ink\)\] sm:text-base/.test(src),
    "AnswerFeedList: 回答本文にbreak-wordsが無い",
  );

  // ボタン自体の絶対配置クラス（right-3・top-1/2）は変更していない
  // （位置そのものを動かす対応ではなく、本文側の余白確保で解決したことの確認）。
  const rightThreeButtons = src.match(/className="absolute right-3 top-1\/2 -translate-y-1\/2"/g) ?? [];
  assert.equal(rightThreeButtons.length, 4, "TopicFeedList/AnswerFeedListのDeleteButton/ReportButtonがright-3のまま4箇所存在するはず");

  console.log("PASS: SnsFeedSection（お題・回答一覧カード）の本文が通報/削除ボタンの占有幅を上回るpr-10を確保している");
}

// 2) SnsTopicDetail.tsx（お題詳細ページ）
{
  const src = read("src/components/sns/SnsTopicDetail.tsx");

  // 本題本文：pr-11・break-words、ボタンはright-4・既定サイズ。
  assert.ok(
    /<p className="mt-3 break-words pr-11 font-sans text-lg font-bold leading-snug text-\[var\(--ink\)\] sm:text-xl">\s*\{topic\.body\}/.test(src),
    "SnsTopicDetail: 本題の本文にbreak-words pr-11が無い",
  );
  assertPaddingCoversButton("SnsTopicDetail本題", "4", "11");
  const rightFourButtons = src.match(/className="absolute right-4 top-1\/2 -translate-y-1\/2"/g) ?? [];
  assert.equal(rightFourButtons.length, 2, "SnsTopicDetailの本題DeleteButton/ReportButtonがright-4のまま2箇所存在するはず");

  // 既存の安全なパターン（回答一覧行：pl-4 pr-9・ボタンright-2）は変更していない。
  assert.ok(
    /pl-4 pr-9 text-\[var\(--ink\)\]`\}/.test(src),
    "SnsTopicDetail: 回答一覧行のpl-4 pr-9（既存の安全なレイアウト）が変わっている",
  );
  assertPaddingCoversButton("SnsTopicDetail回答一覧行", "2", "9");
  const rightTwoButtons = src.match(/className="absolute right-2 top-1\/2 -translate-y-1\/2"/g) ?? [];
  assert.equal(rightTwoButtons.length, 2, "SnsTopicDetailの回答一覧行DeleteButton/ReportButtonがright-2のまま2箇所存在するはず");

  console.log("PASS: SnsTopicDetail（お題詳細）の本題本文がpr-11を確保し、既存の回答一覧行の安全なレイアウトも維持されている");
}

// 3) SnsAnswerDetail.tsx（回答詳細ページ）
{
  const src = read("src/components/sns/SnsAnswerDetail.tsx");

  assert.ok(
    /<p className="break-words pr-11 font-sans text-lg font-bold leading-snug text-\[var\(--ink\)\] sm:text-xl">\s*\{answer\.body\}/.test(src),
    "SnsAnswerDetail: 回答本文にbreak-words pr-11が無い",
  );
  assertPaddingCoversButton("SnsAnswerDetail本文", "4", "11");
  const rightFourButtons = src.match(/className="absolute right-4 top-1\/2 -translate-y-1\/2"/g) ?? [];
  assert.equal(rightFourButtons.length, 2, "SnsAnswerDetailの本文DeleteButton/ReportButtonがright-4のまま2箇所存在するはず");

  // 既存の安全なパターン（ツッコミ一覧：pl-4 pr-9・ボタンright-2）は変更していない。
  assert.ok(
    /py-3 pl-4 pr-9 text-\[var\(--ink\)\]`\}/.test(src),
    "SnsAnswerDetail: ツッコミ一覧のpl-4 pr-9（既存の安全なレイアウト）が変わっている",
  );
  const rightTwoButtons = src.match(/className="absolute right-2 top-1\/2 -translate-y-1\/2"/g) ?? [];
  assert.equal(rightTwoButtons.length, 2, "SnsAnswerDetailのツッコミ一覧DeleteButton/ReportButtonがright-2のまま2箇所存在するはず");

  console.log("PASS: SnsAnswerDetail（回答詳細）の本文がpr-11を確保し、既存のツッコミ一覧の安全なレイアウトも維持されている");
}

// 4) SnsLiveResultBody.tsx（ライブ結果カード）：通報ボタンが無い本体カードには
//    不要な右余白を追加していないこと（要求7）。コメント一覧（通報ボタン有り）の
//    既存の安全なpl-3 pr-9も変更していないこと。
{
  const src = read("src/components/sns/SnsLiveResultBody.tsx");

  assert.ok(
    /<p className="font-sans text-base font-bold leading-snug text-\[var\(--ink\)\] sm:text-lg">\{card\.body\}<\/p>/.test(src),
    "SnsLiveResultBody: 結果カード本体の段落クラスが変わっている（通報ボタンが無いカードのため、pr-*を追加してはいけない）",
  );
  assert.ok(
    /relative flex flex-col gap-1 bg-\[var\(--ink\)\]\/5 py-2 pl-3 pr-9/.test(src),
    "SnsLiveResultBody: コメント一覧のpl-3 pr-9（既存の安全なレイアウト）が変わっている",
  );
  assertPaddingCoversButton("SnsLiveResultBodyコメント一覧", "2", "9");

  console.log("PASS: SnsLiveResultBodyは、通報ボタンが無い結果カード本体に余分な余白を追加せず、コメント一覧の既存レイアウトも維持している");
}
