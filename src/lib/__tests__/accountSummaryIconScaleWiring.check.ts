// ホーム画面の名前・段位・ポイントカード(AccountSummary)のアイコン拡大
// （2026-09-30、40px→52px）の静的検査。MyProfileTicket（マイページ・寄合帳の
// 演者名チケット、2026-09-30のコミット07ca94dでtransform: scale(1.15)による
// 見た目拡大を実施済み）とは別画面・別方式の変更であり、互いに影響しないことを
// 固定する。
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

// 1) AccountSummary.tsx：アイコンはsize={52}（リテラルなsize変更、transformは
//    使わない今回の方式）。
{
  const src = read("src/components/home/AccountSummary.tsx");
  assert.ok(
    /<MyIconAvatar size=\{52\} bare \/>/.test(src),
    "AccountSummary: アイコンがsize={52}になっていない",
  );
  assert.ok(
    !/<MyIconAvatar size=\{40\} bare \/>/.test(src),
    "AccountSummary: 旧サイズsize={40}がまだ残っている",
  );
  console.log("PASS: AccountSummaryのアイコンはsize={52}（40pxから拡大）になっている");
}

// 2) size={52}（このホーム画面専用の拡大）が、AccountSummary.tsx以外へ
//    漏れ出していないこと。MyProfileTicket.tsx等、他画面のMyIconAvatar呼び出しに
//    size={52}が紛れ込んでいないことを確認する。
{
  const srcFiles = walk(join(ROOT, "src"));
  const hits = srcFiles
    .map((f) => ({ f: f.slice(ROOT.length + 1), text: readFileSync(f, "utf8") }))
    .filter((s) => s.text.includes("MyIconAvatar size={52}"))
    .map((s) => s.f);
  assert.deepEqual(
    hits,
    ["src/components/home/AccountSummary.tsx"],
    `MyIconAvatar size={52}がAccountSummary.tsx以外にも存在する（他画面へ意図せず拡大が波及している可能性）: ${hits.join(", ")}`,
  );
  console.log("PASS: size={52}への拡大はAccountSummary.tsxだけに限定されている");
}

// 3) MyProfileTicket.tsx（2026-09-30のコミット07ca94dで対応済みの、マイページ・
//    寄合帳の演者名チケット側の拡大）は今回の変更で一切触れていないこと。
//    scale-[1.15]によるtransform方式・MyIconAvatar size={48}のままであることを
//    再確認する（後退防止）。
{
  const src = read("src/components/home/MyProfileTicket.tsx");
  assert.ok(
    /<span className="flex shrink-0 scale-\[1\.15\] items-center justify-center">\s*<MyIconAvatar size=\{48\} bare \/>\s*<\/span>/.test(src),
    "MyProfileTicket: scale-[1.15]によるアイコン拡大(コミット07ca94d)が失われている、またはsize={48}から変わっている",
  );
  console.log("PASS: MyProfileTicket（マイページ・寄合帳の演者名チケット）のアイコン拡大は今回の変更で後退していない");
}

// 4) 共通実装MyIconAvatar.tsx自体は変更していないこと（bare表示の構造を維持）。
{
  const src = read("src/components/app/MyIconAvatar.tsx");
  assert.ok(
    /if \(bare\) \{\s*return \(\s*<span className="flex shrink-0 items-center justify-center" style=\{\{ width: size, height: size \}\}>/.test(src),
    "MyIconAvatar: bare表示の共通実装が変わっている（他画面のアイコンサイズに影響する可能性がある）",
  );
  console.log("PASS: MyIconAvatarの共通実装（bare表示）は変更されていない");
}

// 5) AccountSummary.tsx内の演者名・段位・累計ポイント・ポイント残高の表示位置を
//    決めている構造（flex row・各要素のクラス）自体は変更していないこと
//    （アイコンのsize変更だけであり、周辺レイアウトのクラスをいじっていない
//    ことの根拠。実際の寸法・重なり無しはPlaywrightで320/390/1280px確認済み）。
{
  const src = read("src/components/home/AccountSummary.tsx");
  assert.ok(
    /className=\{`\$\{styles\.surfaceLight\} relative flex items-center gap-3 pl-7 pr-4 pt-6 pb-3\.5 text-\[var\(--ink\)\]`\}/.test(src),
    "AccountSummary: カードsectionの余白・レイアウトクラスが変わっている",
  );
  assert.ok(src.includes('<div className="min-w-0 flex-1">'), "AccountSummary: 演者名・段位カラムのレイアウトクラスが変わっている");
  console.log("PASS: AccountSummaryのカード余白・演者名カラムのレイアウトクラスは変更されていない（アイコンのsizeのみ変更）");
}
