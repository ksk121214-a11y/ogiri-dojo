// 「遊び方」手順1への参加無料バッジ追加、及びホーム下部への公式Xリンク追加の静的検査。
// 見た目・320/390/1280pxでの折り返しは実ブラウザで別途スクリーンショット確認している。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// 1) 遊び方の手順1に「無料」が明記されている。
{
  const howToPlay = read("src/app/(main)/how-to-play/page.tsx");
  const step1Match = howToPlay.match(/title="開催通知を確認">([\s\S]*?)<\/StepCard>/);
  assert.ok(step1Match, "手順1(開催通知を確認)のStepCardが見つからない");
  const step1Body = step1Match![1];
  assert.ok(step1Body.includes("参加無料"), "手順1に「参加無料」バッジの文言がない");
  assert.ok(
    step1Body.includes("爆笑スタジアムのライブは無料で参加できます。"),
    "手順1の本文に「爆笑スタジアムのライブは無料で参加できます。」がない",
  );
  // 単なる小さな注釈ではなく、独立したバッジ要素（span）として表示されていること。
  assert.ok(
    /<span[^>]*>\s*参加無料\s*<\/span>/.test(step1Body),
    "「参加無料」が独立したバッジ(span)として表示されていない",
  );
  // 課金・参加費・購入を連想させる語が紛れ込んでいないこと。
  for (const banned of ["参加費", "チケット購入", "課金"]) {
    assert.ok(!step1Body.includes(banned), `手順1に誤解を招く語「${banned}」が含まれている`);
  }
  console.log("PASS: 遊び方の手順1に「参加無料」バッジと無料参加の案内文がある");
}

// 2) 遊び方の他の手順・お題提供欄・既存のX（@kusenotuyoiodai）リンクを誤って書き換えていない。
{
  const howToPlay = read("src/app/(main)/how-to-play/page.tsx");
  assert.ok(howToPlay.includes('href="https://x.com/kusenotuyoiodai"'), "お題提供元のXリンクが失われている");
  assert.ok(howToPlay.includes("「ライブに参加」を押して入室。参加者か観客を選びます。"), "手順2の文言が変わっている");
  console.log("PASS: 遊び方の他の手順・既存Xリンクは変更されていない");
}

// 3) ホーム下部に公式X（@bakusho_stadium）へのリンクがある。
{
  const home = read("src/app/(main)/page.tsx");
  const linkMatch = home.match(/<a\s+href="https:\/\/x\.com\/bakusho_stadium"[\s\S]*?<\/a>/);
  assert.ok(linkMatch, "ホームに公式X（https://x.com/bakusho_stadium）へのリンクがない");
  const linkTag = linkMatch![0];

  assert.ok(linkTag.includes('target="_blank"'), '公式XリンクにTarget="_blank"がない');
  assert.ok(linkTag.includes('rel="noopener noreferrer"'), '公式Xリンクにrel="noopener noreferrer"がない');
  assert.ok(linkTag.includes("@bakusho_stadium"), "公式Xリンクの表示文言に@bakusho_stadiumが含まれていない");

  const ariaMatch = linkTag.match(/aria-label="([^"]*)"/);
  assert.ok(ariaMatch, "公式Xリンクにaria-labelがない");
  const aria = ariaMatch![1];
  assert.ok(aria.includes("公式X"), "aria-labelに「公式X」が含まれていない");
  assert.ok(aria.includes("@bakusho_stadium"), "aria-labelに@bakusho_stadiumが含まれていない");
  assert.ok(aria.includes("新しいタブ"), "aria-labelに「新しいタブ」の案内が含まれていない");

  console.log("PASS: ホーム下部に公式X（@bakusho_stadium、新しいタブ、適切なaria-label）へのリンクがある");
}

// 4) 公式Xリンクがログイン状態の条件分岐（!authLoading && !authUser 等）の内側に置かれていない
//    （未ログイン・ゲスト・Xログイン会員のすべてに常時表示するため）。
{
  const home = read("src/app/(main)/page.tsx");
  const condStart = home.indexOf("{!authLoading && !authUser && (");
  assert.ok(condStart !== -1, "未ログイン限定の条件分岐ブロックが見つからない（既存構造が変わっている）");
  // 条件分岐の閉じ括弧 ")}" を素朴に探す（既存ブロックはJSXの深いネストを持たないため、
  // 対応する行の直後に現れる最初の")}"で十分に特定できる）。
  const condEnd = home.indexOf(")}", condStart);
  assert.ok(condEnd !== -1, "未ログイン限定の条件分岐ブロックの終端が見つからない");
  const condBlock = home.slice(condStart, condEnd);
  assert.ok(
    !condBlock.includes("bakusho_stadium"),
    "公式Xリンクが未ログイン限定の条件分岐の内側に置かれている（常時表示になっていない）",
  );
  console.log("PASS: 公式Xリンクはログイン状態の条件分岐の外に置かれ、常時表示される");
}

// 5) 既存のXログイン・ゲスト参加・法務リンク・法務文言（「現時点で…無料で提供」）を
//    誤って書き換えていないこと。
{
  const home = read("src/app/(main)/page.tsx");
  assert.ok(home.includes("<LegalLinksRow"), "ホームのLegalLinksRow導線が失われている");
  assert.ok(home.includes("useLiveJoinFlow"), "ライブ参加フロー(useLiveJoinFlow)の利用が失われている");
  assert.ok(home.includes("useAuthStore"), "認証ストア(useAuthStore)の利用が失われている");

  const terms = read("src/app/terms/page.tsx");
  assert.ok(
    terms.includes("本サービスは、現時点で以下の機能を無料で提供しています。"),
    "利用規約の「現時点では無料」の文言が変わっている",
  );
  console.log("PASS: 既存のXログイン・ゲスト参加処理・法務リンク・「現時点では無料」の文言は無変更");
}
