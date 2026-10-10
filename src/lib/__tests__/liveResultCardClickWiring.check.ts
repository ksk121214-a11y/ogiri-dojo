// SnsLiveResultBody.tsx（順位カード・運営ベスト・満点回答のいずれも共通の
// LiveResultCardを使う）の「カード本文クリックでコメント欄を開閉できる」配線を、
// ソースの静的検査で確認する。
// このリポジトリの*.check.tsランナーは素のtsc+nodeで、jsdom/React描画の環境は
// 用意されていないため、実クリックイベントの発火は確認できない（残課題として
// 最終報告に明記する）。ここでは「どの要素がstopPropagationを持ち、カード本文の
// クリックだけが伝播してhandleCardClickに届くか」という配線そのものを検証する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(process.cwd(), "src", "components", "sns", "SnsLiveResultBody.tsx"),
  "utf8",
);

const fnMatch = src.match(/function LiveResultCard\([\s\S]*?\n\}\n/);
assert.ok(fnMatch, "LiveResultCardが見つからない");
const body = fnMatch![0];

// 1) カード本文クリックで開閉するhandleCardClickが定義され、readOnlyでは何もしない。
assert.ok(
  /const handleCardClick = \(\) => \{\s*\n\s*if \(readOnly\) return;\s*\n\s*setCommentsOpen\(\(v\) => !v\);\s*\n\s*\};/.test(
    body,
  ),
  "handleCardClickが、readOnly時に何もせずcommentsOpenを切り替える実装になっていない",
);

// 2) ルートのカードdivは、readOnly時はonClickを持たず（undefined）、通常時はhandleCardClickを持つ。
//    順位カード・運営ベスト・満点回答はいずれも同じLiveResultCardを使うため、この1箇所の
//    配線がそのまま3種類すべてに適用される。
assert.ok(
  /onClick=\{readOnly \? undefined : handleCardClick\}/.test(body),
  "カードのルート要素がreadOnly時にonClickを無効化していない（運営プレビューの既存静的表示を壊す恐れ）",
);

// 3) いいねボタン（handleToggleLike）はe.stopPropagation()を呼ぶ（カードの開閉を誤発火させない）。
const toggleLikeMatch = body.match(/const handleToggleLike = async \(e: MouseEvent\) => \{[\s\S]*?\n  \};/);
assert.ok(toggleLikeMatch, "handleToggleLikeが見つからない");
assert.ok(/e\.stopPropagation\(\);/.test(toggleLikeMatch![0]), "handleToggleLikeがe.stopPropagation()を呼んでいない");

// 4)「コメント○件」ボタンは、クリック時にe.stopPropagation()してから開閉し、
//    かつ表示件数はcard.commentCount（取得時点の固定値）ではなくcardComments.length
//    （コメント追加・削除で即時に増減するライブな件数）を使う。
const commentToggleMatch = body.match(
  /<button\s+type="button"\s+onClick=\{\(e\) => \{\s*\n\s*e\.stopPropagation\(\);\s*\n\s*setCommentsOpen\(\(v\) => !v\);\s*\n\s*\}\}[\s\S]*?<\/button>/,
);
assert.ok(commentToggleMatch, "「コメント○件」ボタンがe.stopPropagation()してから開閉する配線になっていない");
assert.ok(
  /コメント \{cardComments\.length\}件/.test(commentToggleMatch![0]),
  "「コメント○件」ボタンの表示件数がcardComments.length（ライブな件数）になっていない",
);
assert.ok(
  !/コメント \{card\.commentCount\}件/.test(commentToggleMatch![0]),
  "「コメント○件」ボタンが取得時点の固定値(card.commentCount)のまま表示している",
);

// 5) 投稿者プロフィール（SnsAuthorBadge）はstopPropagationするラッパーに包まれている
//    （クリックしてもカードの開閉を誤発火させない）。
assert.ok(
  /onClick=\{\(e\) => e\.stopPropagation\(\)\}\s+className="contents">\s*\n\s*<SnsAuthorBadge authorId=\{card\.authorId\} hideReportButton \/>/.test(
    body,
  ),
  "投稿者プロフィール(SnsAuthorBadge)がstopPropagationするラッパーに包まれていない",
);

// 6) コメント欄が開いている間の領域（textarea・送信・各コメントの通報/削除・テキスト選択等）は、
//    まとめてstopPropagationするラッパーに包まれている。
assert.ok(
  /\{commentsOpen && \(\s*\n\s*<div\s*\n\s*onClick=\{\(e\) => e\.stopPropagation\(\)\}/.test(body),
  "コメント欄が開いている間の領域がstopPropagationするラッパーに包まれていない",
);

// 7) 自分のコメントには削除ボタン、他人のコメントには通報ボタンを出す（本人確認はisOwnAuthorId）。
assert.ok(
  /isOwnAuthorId\(comment\.authorId\) \? \(\s*\n[\s\S]*?<LiveResultCommentDeleteButton/.test(body),
  "自分のライブ結果コメントに削除ボタンが出る配線になっていない",
);
assert.ok(/\) : \(\s*\n\s*<ReportButton/.test(body), "他人のライブ結果コメントに通報ボタンが出る配線になっていない");

// 8) readOnly分岐（運営プレビュー）自体には、クリック用のonClick等を一切追加していない
//    （既存の静的表示をそのまま維持する）。
const readOnlyBranchMatch = body.match(/readOnly \? \(\s*\n([\s\S]*?)\n\s*\) : \(/);
assert.ok(readOnlyBranchMatch, "readOnly分岐が見つからない");
assert.ok(!/onClick/.test(readOnlyBranchMatch![1]), "readOnly分岐（運営プレビュー）にonClickが追加されている（既存の静的表示を変えてはいけない）");

console.log(
  "PASS: カードクリック配線 - ルートdivのonClick（readOnlyでは無効）、いいね/コメントボタン/投稿者バッジ/コメント欄のstopPropagation、本人削除・他人通報の出し分け、readOnly分岐の静的表示維持（配線の静的検査。実クリックの発火確認はコンポーネント描画環境が無く未実施）",
);

// 9) SnsLiveResultsFeedList.tsx：一覧の同順位タイ表示のReact keyが、participantId
//    単独ではなく`${rank}:${participantId}`の複合キーになっている（通常データでは
//    同じ参加者が複数順位に出ない想定でも、運営差し替え等の不整合時にkeyが衝突
//    しないようにするため）。
{
  const feedListSrc = readFileSync(
    join(process.cwd(), "src", "components", "sns", "SnsLiveResultsFeedList.tsx"),
    "utf8",
  );
  assert.ok(
    /<span key=\{`\$\{rank\}:\$\{participantId\}`\}>/.test(feedListSrc),
    "SnsLiveResultsFeedList.tsxの一覧podiumNamesのkeyが`${rank}:${participantId}`の複合キーになっていない",
  );
  console.log(
    "PASS: SnsLiveResultsFeedList.tsx - 一覧の同順位タイ表示のReact keyがrankとparticipantIdの複合キーになっている",
  );
}
