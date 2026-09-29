// マイページ演者名カード(MyProfileTicket)のアイコン拡大（2026-09-30）の静的検査。
// 「カード本体・半券のレイアウト寸法は変えず、アイコンの見た目だけをtransform:
// scaleで拡大する」という設計を、ソースの静的検査で固定する（実際の寸法比較・
// クリッピング確認はPlaywrightで320/390/1280px、通常/限定アイコンともに別途
// 実施済み）。
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

// 1) MyProfileTicket.tsx：アイコンのラッパーspanにscale-[1.15]、MyIconAvatarは
//    size={48}のまま（レイアウト上の占有領域は変えていないことの根拠）。
{
  const src = read("src/components/home/MyProfileTicket.tsx");
  assert.ok(
    /<span className="flex shrink-0 scale-\[1\.15\] items-center justify-center">\s*<MyIconAvatar size=\{48\} bare \/>\s*<\/span>/.test(src),
    "MyProfileTicket: アイコンラッパーにscale-[1.15]が無い、またはMyIconAvatarのsizeが48から変わっている",
  );
  // ラッパー自体に固定のwidth/height指定を追加していないこと（transformだけで
  // 拡大し、レイアウトボックス自体はMyIconAvatarの48px×48pxのまま）。
  assert.ok(
    !/scale-\[1\.15\][^`]*style=\{\{[^}]*(width|height)/.test(src),
    "MyProfileTicket: アイコンラッパーに幅・高さの固定指定が追加されている（transformだけで拡大する設計から外れている）",
  );
  console.log("PASS: MyProfileTicketのアイコンはMyIconAvatar size={48}のまま、ラッパーのtransform: scale(1.15)で見た目だけ拡大している");
}

// 2) MyIconAvatar.tsx（共通実装）自体は変更しない：bare時にwidth/height=sizeを
//    そのままstyleに設定する既存の構造を維持していること。
{
  const src = read("src/components/app/MyIconAvatar.tsx");
  assert.ok(
    /if \(bare\) \{\s*return \(\s*<span className="flex shrink-0 items-center justify-center" style=\{\{ width: size, height: size \}\}>/.test(src),
    "MyIconAvatar: bare表示の共通実装が変わっている（他画面のアイコンサイズに影響する可能性がある）",
  );
  console.log("PASS: MyIconAvatarの共通実装（bare表示）は変更されていない");
}

// 3) 今回の拡大(scale-[1.15])が、MyProfileTicket.tsx以外（ライブ・寄合帳・
//    他ユーザープロフィール等、MyIconAvatarを使う他画面）へ漏れ出していないこと。
{
  const srcFiles = walk(join(ROOT, "src"));
  const hits = srcFiles
    .map((f) => ({ f: f.slice(ROOT.length + 1), text: readFileSync(f, "utf8") }))
    .filter((s) => s.text.includes("scale-[1.15]"))
    .map((s) => s.f);
  assert.deepEqual(
    hits,
    ["src/components/home/MyProfileTicket.tsx"],
    `scale-[1.15]がMyProfileTicket.tsx以外にも存在する（他画面のアイコンサイズに意図せず影響している可能性）: ${hits.join(", ")}`,
  );
  console.log("PASS: アイコン拡大(scale-[1.15])はMyProfileTicket.tsxだけに限定されている");
}

// 4) カード本体・半券のレイアウト（StadiumHome.module.css）自体は変更していない
//    ことの根拠として、既存の主要な構造がそのまま残っていることを確認する。
{
  const css = read("src/components/home/StadiumHome.module.css");
  assert.ok(/\.profileCardRow \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) 92px;/.test(css), "profileCardRowのグリッド定義が変わっている");
  assert.ok(/\.profileCardMain \{[^}]*overflow: hidden;/.test(css), "profileCardMainのoverflow:hiddenが失われている");
  assert.ok(/\.profileCardStub \{[^}]*width: 92px;/.test(css), "profileCardStubの幅(92px)が変わっている");
  console.log("PASS: カード本体・半券のCSS構造（StadiumHome.module.css）は変更されていない");
}
