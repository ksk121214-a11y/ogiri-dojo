// 実機不具合対応：司会コンソールの「管理画面トップへ戻る」が、Chromeの「戻る」操作として
// 機能してしまい、ブラウザの閲覧履歴次第でアプリ外（直前に見ていた検索画面等）へ戻ってしまう
// 問題の修正検証。AdminHeaderは閲覧履歴に依存しない固定リンク（Next.jsのLink）であるべきで、
// router.back()・window.history への依存が無いことを静的に確認する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

{
  const src = read("src/components/admin/AdminHeader.tsx");

  assert.doesNotMatch(src, /router\.back\(\)/, "AdminHeaderがrouter.back()に依存している（ブラウザの戻る操作になってしまう）");
  assert.doesNotMatch(src, /window\.history/, "AdminHeaderがwindow.historyに依存している");
  assert.doesNotMatch(src, /useRouter/, "AdminHeaderが不要なuseRouterをimportしている");
  assert.match(src, /import Link from "next\/link";/, "AdminHeaderがnext\/linkのLinkを使っていない");
  assert.match(src, /<Link href=\{backHref\}/, "AdminHeaderがbackHrefへの固定Linkになっていない");
  assert.match(src, /backHref = "\/admin"/, "AdminHeaderのデフォルトのbackHrefが/adminでない");

  console.log("PASS: AdminHeaderはrouter.back()/window.historyに依存せず、backHrefへの固定Linkになっている");
}

// /live/host（司会コンソール）はbackHrefを指定していないため、デフォルトの/adminへ戻る。
{
  const hostPage = read("src/app/live/host/page.tsx");
  assert.match(
    hostPage,
    /<AdminHeader title="司会コンソール（ライブ準備・操作）" \/>/,
    "/live/hostのAdminHeaderがbackHrefを指定せずデフォルト(/admin)のままでなくなっている",
  );
  console.log("PASS: /live/hostのAdminHeaderはbackHref未指定で、デフォルトの/adminへ戻る");
}

// backHrefを明示指定している画面は、その指定先が変わっていないことを確認する（回帰防止）。
{
  const liveResultDetail = read("src/app/admin/live-results/[liveId]/page.tsx");
  const matches = liveResultDetail.match(/<AdminHeader[^/]*backHref="([^"]+)"/g) ?? [];
  assert.ok(matches.length >= 3, "admin/live-results/[liveId]のAdminHeader呼び出し数が想定より少ない");
  for (const m of matches) {
    assert.match(m, /backHref="\/admin\/live-results"/, `admin/live-results/[liveId]のbackHref指定が変わっている: ${m}`);
  }

  const userDetail = read("src/app/admin/users/[id]/page.tsx");
  const userMatches = userDetail.match(/<AdminHeader[^/]*backHref="([^"]+)"/g) ?? [];
  assert.ok(userMatches.length >= 2, "admin/users/[id]のAdminHeader呼び出し数が想定より少ない");
  for (const m of userMatches) {
    assert.match(m, /backHref="\/admin\/users"/, `admin/users/[id]のbackHref指定が変わっている: ${m}`);
  }

  console.log("PASS: backHrefを明示指定している画面（/admin/live-results/[liveId], /admin/users/[id]）の指定先は変わっていない");
}

console.log("ALL ADMIN_HEADER_BACK_LINK CHECKS PASSED");
