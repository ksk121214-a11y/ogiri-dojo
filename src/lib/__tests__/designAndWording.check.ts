// 用語（「高座名」→「演者名」）・和風デザイン禁止・法務/同意画面の可読性・回答席レイアウトの
// 静的検査。表示文言・クラス名・配色は実ブラウザでも別途スクリーンショット確認している。
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "__tests__" || name === "harness-tmp" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx|css)$/.test(name)) out.push(p);
  }
  return out;
}
const srcFiles = walk(join(ROOT, "src"));
const sources = srcFiles.map((f) => ({ f: f.slice(ROOT.length + 1), text: readFileSync(f, "utf8") }));

// 1) 利用者向けの「高座名」が0件（表示名は「演者名」）。文字列を分割して書き、このテスト自体が対象に含まれても誤検出しない。
{
  const banned = "高座" + "名";
  const hits = sources.filter((s) => s.text.includes(banned)).map((s) => s.f);
  assert.deepEqual(hits, [], `「${banned}」が残っている: ${hits.join(", ")}`);
  for (const rel of ["src/app/terms/page.tsx", "src/app/privacy/page.tsx"]) {
    assert.ok(read(rel).includes("演者名（表示名）"), `${rel}に「演者名（表示名）」の表記がない`);
  }
  console.log("PASS: 利用者向けの「高座名」は0件（規約・ポリシーは「演者名（表示名）」）");
}

// 2) 初回設定画面の文言・見た目。
{
  const m = read("src/components/app/DisplayNameSetupModal.tsx");
  assert.ok(m.includes("演者名を決めましょう"), "見出しが「演者名を決めましょう」でない");
  assert.ok(m.includes("で名乗る名前を{DISPLAY_NAME_MAX_LENGTH}文字以内で決めてください。後からでも変更できます。"), "本文が指定の文言でない");
  assert.ok(!/placeholder="例: (?:高座|花子)/.test(m) && m.includes('placeholder="例: たろう"'), "placeholderが和風の例のまま");
  assert.ok(!m.includes("font-brush") && !/dojo-(?:tatami|washi|light-brown|dark-brown)/.test(m), "初回設定モーダルに和風の配色・筆文字が残っている");
  assert.ok(m.includes("bg-white") && m.includes("text-gray-900"), "初回設定モーダルが白背景・黒文字でない");
  console.log("PASS: 初回設定画面は指定の見出し・本文・一般的なplaceholder、白背景の現代的な見た目");
}

// 3) 和風デザインの撤廃（筆文字・畳/和紙/焦げ茶の和風トークン）。ただし「地下ライブ会場風の
//    暗い背景」「ノイズ・グレイン」「紙・印刷物・チケットの質感」は爆笑スタジアムの世界観として
//    必須であり、和風とは別物なので撤廃してはならない（下で存在を確認する）。
{
  const bannedPatterns: Array<[RegExp, string]> = [
    [/font-brush/, "font-brush（筆文字）"],
    [/Yuji_Syuku|yuji-syuku/i, "Yuji Syuku（毛筆風フォント）"],
    [/dojo-(?:tatami|washi)/, "dojo-tatami/washi（畳・和紙トークン）"],
    [/dojo-(?:light-brown|dark-brown)/, "焦げ茶・薄茶トークン"],
  ];
  for (const [re, label] of bannedPatterns) {
    const hits = sources.filter((s) => re.test(s.text)).map((s) => s.f);
    assert.deepEqual(hits, [], `${label}が残っている: ${hits.join(", ")}`);
  }
  const layout = read("src/app/layout.tsx");
  assert.ok(!/Yuji/.test(layout), "layout.tsxが和風フォント(Yuji Syuku)を読み込んでいる");
  const css = read("src/app/globals.css");
  assert.ok(!/--font-brush|#e8dcc4|#5b4530|#d8c6a3/i.test(css), "globals.cssに和風のトークン・配色が残っている");

  // 地下ライブ会場・チケットの世界観（質感画像・ノイズ・グレイン・紙）が保たれている。
  for (const f of ["dark-grain-512.webp", "ivory-paper-512.webp", "ogiri-light-concrete-512.webp", "warm-kraft-paper-512.webp", "title-ivory-ink-texture-512.webp"]) {
    assert.ok(existsSync(join(ROOT, "public/images/textures", f)), `世界観の質感素材が失われている: ${f}`);
  }
  const home = read("src/components/home/StadiumHome.module.css");
  for (const re of [
    /\.surfaceDark \{[^}]*dark-grain-512\.webp[^}]*background-blend-mode: overlay/,
    /\.surfaceLight \{[^}]*ivory-paper-512\.webp[^}]*background-blend-mode: soft-light/,
    /\.surfaceAccent \{[^}]*dark-grain-512\.webp/,
    /\.titleTexture \{[^}]*title-ivory-ink-texture-512\.webp/,
    /\.pageBgDeep \{[^}]*warm-kraft-paper-512\.webp/,
    /\.pageBgLight \{[^}]*ogiri-light-concrete-512\.webp/,
    /\.shell::before \{[^}]*feTurbulence/,
  ]) {
    assert.ok(re.test(home), `地下ライブ・チケットの質感（${re}）が失われている`);
  }
  console.log("PASS: 筆文字・畳/和紙/焦げ茶の和風要素は無く、地下ライブ会場風の質感（グレイン・ノイズ・紙・チケット・クラフト・コンクリート）は保たれている");
}

// 4) 恒久ルール（AGENTS.md）と方針文書。CLAUDE.mdは従来どおりAGENTS.mdを参照する。
{
  const agents = read("AGENTS.md");
  assert.ok(/和風デザイン禁止/.test(agents) && /明示的に依頼されない限り/.test(agents), "AGENTS.mdに和風デザイン禁止の恒久ルールがない");
  assert.ok(read("CLAUDE.md").includes("@AGENTS.md"), "CLAUDE.mdがAGENTS.mdを参照していない");
  const policy = read("デザイン方針.md");
  assert.ok(/現代的なスタジアム・エンタメ/.test(policy) && /和風デザイン/.test(policy), "デザイン方針.mdが現代的なスタジアム方針へ更新されていない");
  console.log("PASS: AGENTS.mdに和風デザイン禁止の恒久ルール、CLAUDE.mdは従来どおりAGENTS.mdを参照、デザイン方針.mdを更新");
}

// 5) 利用規約・プライバシーポリシー：白背景・黒文字・グレーの境界・ゴシック、装飾なし。
{
  for (const rel of ["src/app/terms/page.tsx", "src/app/privacy/page.tsx", "src/components/legal/LegalPageLayout.tsx"]) {
    const t = read(rel);
    assert.ok(!/dojo-|font-brush|grain|gradient|bg-gradient|from-|to-\[|backdrop-blur-\[/.test(t.replace(/backdrop-blur(?!-\[)/g, "")), `${rel}に和風クラス・グラデーション等が残っている`);
  }
  const layout = read("src/components/legal/LegalPageLayout.tsx");
  assert.ok(layout.includes("bg-white") && layout.includes("text-gray-900"), "法務ページのレイアウトが白背景・黒文字でない");
  assert.ok(layout.includes("border-gray-200"), "境界線が薄いグレーでない");
  assert.ok(layout.includes("text-blue-800") && layout.includes("underline"), "目次リンクが判別しやすい色・下線でない");
  assert.ok(/text-base leading-7/.test(layout), "本文の文字サイズ・行間が十分でない");
  assert.ok(!layout.includes("font-brush"), "法務ページに筆文字が残っている");
  console.log("PASS: 法務ページは白背景・黒文字・薄いグレーの境界・青い下線リンク・十分な文字サイズと行間で、和風クラス・グラデーションが無い");
}

// 6) 同意画面（ConsentGateModal / ConsentRequiredGate）：白背景・黒文字・高コントラスト。
function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
{
  // Tailwind標準色の実値。
  const C = { white: "#ffffff", g100: "#f3f4f6", g300: "#d1d5db", g700: "#374151", g800: "#1f2937", g900: "#111827", blue800: "#1e40af", red700: "#b91c1c" };
  const pairs: Array<[string, string, string, number]> = [
    ["本文(gray-900 on white)", C.g900, C.white, 4.5],
    ["補足(gray-700 on white)", C.g700, C.white, 4.5],
    ["説明(gray-800 on white)", C.g800, C.white, 4.5],
    ["リンク(blue-800 on white)", C.blue800, C.white, 4.5],
    ["エラー(red-700 on white)", C.red700, C.white, 4.5],
    ["主ボタン(white on gray-900)", C.white, C.g900, 4.5],
    ["disabled主ボタン(gray-700 on gray-300)", C.g700, C.g300, 4.5],
    ["ページ地(gray-900 on gray-100)", C.g900, C.g100, 4.5],
  ];
  for (const [label, fg, bg, min] of pairs) {
    const ratio = contrast(fg, bg);
    assert.ok(ratio >= min, `${label}のコントラスト比が${min}未満: ${ratio.toFixed(2)}`);
  }
  for (const rel of ["src/components/legal/ConsentGateModal.tsx", "src/components/app/ConsentRequiredGate.tsx", "src/components/app/DisplayNameSetupModal.tsx"]) {
    const t = read(rel);
    assert.ok(t.includes("bg-white") && t.includes("text-gray-900"), `${rel}のモーダル本体が白背景・黒文字でない`);
    assert.ok(!/var\(--(?:paper|ink|accent)\)|styles\.(?:grain|surface)/.test(t), `${rel}が旧テーマ変数（灰色背景に白文字になる原因）を使っている`);
    assert.ok(t.includes("disabled:bg-gray-300") && t.includes("disabled:text-gray-700"), `${rel}のdisabledボタンの文字が読めない配色`);
    assert.ok(t.includes("text-red-700"), `${rel}のエラーが白背景で読める濃い赤でない`);
    assert.ok(t.includes("focus-visible:outline"), `${rel}にキーボードフォーカスの表示がない`);
    assert.ok(!/opacity-40/.test(t), `${rel}のdisabledが不透明度で薄くなり文字が読めなくなる`);
  }
  const modal = read("src/components/legal/ConsentGateModal.tsx");
  assert.ok(/bg-black\/70/.test(modal) && modal.includes("ring-1 ring-gray-300"), "背景オーバーレイとモーダル本体の区別が不十分");
  assert.ok(modal.includes("text-base font-medium") && modal.includes("h-5 w-5"), "チェックボックスのラベル・ボックスが小さい");
  assert.ok(modal.includes("text-blue-800"), "同意画面のリンクが青でない");
  console.log("PASS: 同意画面は白背景・黒文字・青リンク・濃い赤のエラー・読めるdisabled・フォーカス表示で、主要な色の組はコントラスト比4.5以上");
}

// 7) 回答席：残り回数の行は舞台（回答席・名前）と重ならない場所（入力欄の直上）にあり、席は人数で幅を縮める。
{
  const stage = read("src/components/live-room/StageAnsweringPresentation.tsx");
  const dotsIdx = stage.indexOf("残り{Math.max(0, maxAnswersPerPlayer - myAnswerCount)}回");
  const stageViewIdx = stage.indexOf("<StageCharactersView");
  const textareaIdx = stage.indexOf("<textarea");
  assert.ok(dotsIdx > stageViewIdx && dotsIdx < textareaIdx, "残り回数の行が回答席と重なり得る位置（舞台とボードの間）に残っている");
  assert.equal((stage.match(/残り\{Math\.max\(0, maxAnswersPerPlayer/g) ?? []).length, 1, "残り回数の行が複数ある");
  const chars = read("src/components/live-room/StageCharactersView.tsx");
  assert.ok(chars.includes("calc((100% - 8px) / ${Math.max(1, members.length)})"), "回答席の幅が人数に応じて縮まない（5人以上・狭い画面で重なる）");
  assert.ok(/members\.map\(\(member\) =>/.test(chars) && !/members\s*\.\s*(?:sort|reverse|slice\()/.test(chars), "席の並び順を変える処理がある");
  assert.ok(chars.includes("truncate") && chars.includes("whitespace-nowrap"), "名前が省略されずにリング等へ侵入し得る");
  console.log("PASS: 残り回数は入力欄の直上へ移動、回答席は人数で幅を縮め、並び順・名前の省略は維持");
}

// 8) 利用規約の版・制定日は、このファイルが検査する見た目・用語変更それ自体では
// 変わっていない。
// 2026-09-28：その後、別の理由（第8条・公式SNS等への掲載の実質拡張）で利用規約・
// プライバシーポリシーの両方が改定されTERMS_VERSION/PRIVACY_VERSIONが更新された
// （src/lib/__tests__/legalPagesWiring.check.tsが整合性を検査する）。この検査自体は
// 「このファイルが扱う見た目・用語変更（旧TERMS_VERSION="2026-09-25-v1"時点）に
// 対して制定日は変わっていなかった」という過去の事実の記録であるため、TERMS_VERSIONの
// 現在値についてこれ以上の断定はしない（現在値の断定はlegalPagesWiring.check.tsに
// 集約する）。
{
  const info = read("src/lib/legalInfo.ts");
  assert.ok(/export const ENACTED_ON = "2026年9月25日";/.test(info), "制定日(ENACTED_ON)が変更されている");
  console.log("PASS: 制定日（ENACTED_ON）は変更されていない");
}
