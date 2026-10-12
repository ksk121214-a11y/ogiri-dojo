// 公開サポートページ（/terms・/privacy・/contact・/account-deletion）と、純正アプリ向け
// 方針配信RPC（supabase/migrations/0089）の配線確認（フェーズ1E-S）。
// 実際にReactをレンダリングする自動テスト基盤が無いため、パス判定は純粋関数を実行して
// 確認し、ページ・ゲートの配線はソースを読み取って確認する（legalPagesWiring.check.tsと同じ方式）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { isNoAudioRoute } from "../audioRoutes";
import { ACCOUNT_DELETION_MAIL_SUBJECT, CONTACT_EMAIL } from "../legalInfo";
import { PUBLIC_SUPPORT_PATHS, isPublicSupportPath } from "../publicSupportPaths";

const read = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), "utf8");
const squash = (s: string) => s.replace(/\s+/g, "");

const contactPage = read("src", "app", "contact", "page.tsx");
const accountDeletionPage = read("src", "app", "account-deletion", "page.tsx");
const consentRequiredGate = read("src", "components", "app", "ConsentRequiredGate.tsx");
const consentGateModal = read("src", "components", "legal", "ConsentGateModal.tsx");
const consentGateStore = read("src", "store", "useConsentGateStore.ts");
const migration0089 = read("supabase", "migrations", "0089_native_client_policy_and_consent_v3.sql");

// 1: 公開サポートパスはちょうど4件で、完全一致だけがゲートを通過する。
{
  assert.deepEqual([...PUBLIC_SUPPORT_PATHS], ["/terms", "/privacy", "/contact", "/account-deletion"]);
  // trailingSlash: true（next.config.ts）のため、実際のusePathname()は"/contact/"の形になる。
  // 末尾スラッシュ有無の両方を通し、それ以外は完全一致だけを通す。
  assert.ok(read("next.config.ts").includes("trailingSlash: true"), "next.config.tsのtrailingSlash設定が前提と異なる");
  for (const p of PUBLIC_SUPPORT_PATHS) {
    assert.ok(isPublicSupportPath(p), `${p} が公開サポートパスとして通過しない`);
    assert.ok(isPublicSupportPath(`${p}/`), `${p}/ が公開サポートパスとして通過しない`);
  }
  const rejected: (string | null | undefined)[] = [
    "/contact-x",
    "/contact-x/",
    "/contactx",
    "/contact//",
    "/contact/foo",
    "/contact/foo/",
    "/account-deletion-x",
    "/account-deletion/confirm",
    "/termsx",
    "/terms/x",
    "/privacy-old",
    "/Contact",
    "/terms?x=1",
    "/contact#top",
    "contact",
    "/",
    "/mypage",
    "/live",
    "/admin",
    "",
    null,
    undefined,
  ];
  for (const p of rejected) {
    assert.ok(!isPublicSupportPath(p), `${String(p)} が誤って公開サポートパスとして通過する`);
  }
}
console.log("PASS: 公開サポートパスは4件だけで、/contact-x・前方一致・query/fragment付き等の似たパスは通過しない");

// 2: ConsentRequiredGate・ConsentGateModalは共通関数で判定し、パスを個別にハードコードしない。
{
  assert.ok(
    consentRequiredGate.includes('import { isPublicSupportPath } from "@/lib/publicSupportPaths"'),
    "ConsentRequiredGateがisPublicSupportPathをimportしていない",
  );
  assert.ok(
    consentRequiredGate.includes("const isPublicSupportPage = isPublicSupportPath(pathname);") &&
      /if \(isPublicSupportPage\) \{\s*return <>\{children\}<\/>;/.test(consentRequiredGate),
    "ConsentRequiredGateが公開サポートページで子要素をそのまま描画していない",
  );
  assert.ok(
    consentGateModal.includes("isPublicSupportPath(pathname)") &&
      consentGateModal.includes("if (!pendingModal || isPublicSupportPath(pathname)) return null;"),
    "ConsentGateModalが公開サポートページの本文を覆わない構成になっていない",
  );
  for (const [name, src] of [
    ["ConsentRequiredGate", consentRequiredGate],
    ["ConsentGateModal", consentGateModal],
  ] as const) {
    for (const p of PUBLIC_SUPPORT_PATHS) {
      assert.ok(!src.includes(`pathname === "${p}"`), `${name}が${p}を個別にハードコードしている`);
    }
  }
  // 公開ページ以外の既存ゲート挙動（未ログイン・同意済みだけ子要素を描画）は維持。
  assert.ok(
    consentRequiredGate.includes('if (status.kind === "unauthenticated" || status.kind === "accepted") {'),
    "ConsentRequiredGateの既存のゲート判定が変わっている",
  );
}
console.log("PASS: ConsentRequiredGate・ConsentGateModalは公開サポートパスを共通関数で判定し、個別にハードコードしていない");

// 3: 公開サポートページでは音声確認（BGMモーダル等）を出さない。既存の対象外/対象画面は不変。
{
  for (const p of PUBLIC_SUPPORT_PATHS) {
    assert.ok(isNoAudioRoute(p) && isNoAudioRoute(`${p}/`), `${p} で音声確認が出る`);
  }
  for (const p of ["/", "/live", "/mypage", "/contact-x", "/account-deletion-x", "/termsx"]) {
    assert.ok(!isNoAudioRoute(p), `${p} が誤って音声対象外になっている`);
  }
}
console.log("PASS: 公開サポートページ4件は音声対象外で、/contact-x等の似たパスは対象のまま");

// 4: お問い合わせページは既存の連絡先定数を使い、注意書き・削除案内を持ち、フォーム等を持たない。
{
  assert.ok(
    contactPage.includes('import { CONTACT_EMAIL, CONTACT_MAILTO, OPERATOR_NAME } from "@/lib/legalInfo";'),
    "お問い合わせページがlegalInfo.tsの連絡先定数をimportしていない",
  );
  assert.ok(contactPage.includes("href={CONTACT_MAILTO}"), "お問い合わせページのメールリンクがCONTACT_MAILTOではない");
  assert.ok(contactPage.includes("{CONTACT_EMAIL}"), "お問い合わせページがCONTACT_EMAILを表示していない");
  assert.ok(!contactPage.includes(CONTACT_EMAIL), "お問い合わせページにメールアドレスが直書きされている");
  assert.ok(!contactPage.includes("mailto:"), "お問い合わせページにmailto:が直書きされている");
  assert.ok(
    squash(contactPage).includes("パスワード、認証コード、アクセストークンその他の認証情報は、メールに書かないでください。"),
    "お問い合わせページに認証情報を書かないよう求める注意書きが無い",
  );
  assert.ok(contactPage.includes('href="/account-deletion"'), "お問い合わせページから/account-deletionへの案内が無い");
}
console.log("PASS: お問い合わせページは既存のCONTACT_EMAIL/CONTACT_MAILTOを使い、認証情報の注意書きと/account-deletionへの案内がある");

// 5: アカウント削除案内ページは既存の削除依頼件名・mailtoヘルパーを使い、必要な注意書きを持つ。
{
  assert.ok(
    accountDeletionPage.includes(
      'import { ACCOUNT_DELETION_MAIL_SUBJECT, CONTACT_EMAIL, OPERATOR_NAME, contactMailtoWithSubject } from "@/lib/legalInfo";',
    ),
    "アカウント削除案内ページがlegalInfo.tsの件名・mailtoヘルパーをimportしていない",
  );
  assert.ok(
    accountDeletionPage.includes("contactMailtoWithSubject(ACCOUNT_DELETION_MAIL_SUBJECT)") &&
      accountDeletionPage.includes("href={deletionMailto}"),
    "アカウント削除案内ページのメールリンクが既存の削除依頼件名付きmailtoになっていない",
  );
  assert.ok(!accountDeletionPage.includes(CONTACT_EMAIL), "アカウント削除案内ページにメールアドレスが直書きされている");
  assert.ok(!accountDeletionPage.includes(ACCOUNT_DELETION_MAIL_SUBJECT), "アカウント削除案内ページに件名が直書きされている");
  assert.ok(!accountDeletionPage.includes("mailto:"), "アカウント削除案内ページにmailto:が直書きされている");

  const body = squash(accountDeletionPage);
  assert.ok(body.includes("マイページの「編集する」（プロフィール編集）内にある"), "ログインできる利用者向けのアプリ内申請の案内が無い");
  assert.ok(body.includes("「アカウントの削除を申請する」"), "既存のアプリ内申請ボタン名の案内が無い");
  assert.ok(
    read("src", "components", "app", "MyProfileEditModal.tsx").includes("アカウントの削除を申請する"),
    "案内しているアプリ内申請ボタン名が実装と一致しない",
  );
  assert.ok(
    body.includes("パスワード、認証コード、アクセストークンその他の認証情報は送らないでください。"),
    "アカウント削除案内ページに認証情報を送らないよう求める注意書きが無い",
  );
  assert.ok(
    body.includes("演者名（表示名）、Xの表示名・ユーザー名、公開プロフィール等、一般に公開されている情報だけを根拠に削除することはありません。"),
    "公開情報だけで本人確認しない旨の注意書きが無い",
  );
  assert.ok(
    body.includes("運営から安全な本人確認の方法をご案内し、ご本人であることを確認できた後に処理します。"),
    "安全な本人確認の後に処理する旨の記載が無い",
  );
  assert.ok(
    accountDeletionPage.includes('href="/privacy#account-deletion"') && accountDeletionPage.includes('href="/privacy#retention"'),
    "削除対象・保持される記録の詳細としてプライバシーポリシーへリンクしていない",
  );
  assert.ok(
    read("src", "app", "privacy", "page.tsx").includes('id="account-deletion"') &&
      read("src", "app", "privacy", "page.tsx").includes('id="retention"'),
    "リンク先のプライバシーポリシーのアンカーが存在しない",
  );
  assert.ok(body.includes("ただちに削除されるものではありません。"), "即時削除ではない旨の記載が無い");
  for (const ng of ["即時に削除します", "即時削除します", "すぐに削除します", "自動的に削除されます", "自動で削除されます", "必ず削除します"]) {
    assert.ok(!body.includes(ng), `アカウント削除案内ページに即時・自動削除を保証する表現（${ng}）がある`);
  }
}
console.log("PASS: アカウント削除案内ページは既存の削除依頼件名・mailtoヘルパーを使い、認証情報・公開情報・本人確認の注意書きとプライバシーポリシーへのリンクがある");

// 6: 公開2ページはサーバーコンポーネントの静的文書で、フォーム・認証・DB書き込みを持たない。
for (const [name, src] of [
  ["お問い合わせページ", contactPage],
  ["アカウント削除案内ページ", accountDeletionPage],
] as const) {
  assert.ok(!src.includes('"use client"'), `${name}がクライアントコンポーネントになっている`);
  assert.ok(src.includes('from "@/components/legal/LegalPageLayout"'), `${name}が文書画面の共通レイアウトを使っていない`);
  for (const ng of ["<form", "<input", "<textarea", "supabase", "useAuthStore", "useConsentGateStore", "signIn", ".rpc(", "fetch("]) {
    assert.ok(!src.includes(ng), `${name}に${ng}が含まれている（フォーム・認証・DB書き込みは作らない）`);
  }
}
console.log("PASS: 公開2ページは文書画面の共通レイアウトを使う静的ページで、フォーム・認証・DB書き込みを持たない");

// 7: 0089の方針URLのパスは公開サポートパス4件と一致し、すべて実在するページである。
{
  const insertStart = migration0089.indexOf("insert into public.client_policy_config");
  assert.ok(insertStart >= 0, "0089に設定行のINSERTが見つからない");
  const insertSql = migration0089.slice(insertStart, migration0089.indexOf(");", migration0089.indexOf("values", insertStart)));
  const urls = [...insertSql.matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1]);
  assert.equal(urls.length, 4, `0089の初期URLが4件ではない(got=${urls.length})`);
  const paths = urls.map((u) => {
    const url = new URL(u);
    assert.equal(url.protocol, "https:", `${u} がHTTPSではない`);
    assert.equal(url.host, "ogiri-dojo.vercel.app", `${u} のホストが許可ホストではない`);
    assert.equal(url.username + url.password + url.search + url.hash, "", `${u} にuserinfo・query・fragmentがある`);
    return url.pathname;
  });
  assert.deepEqual(paths, [...PUBLIC_SUPPORT_PATHS], "0089の方針URLのパスが公開サポートパスと一致しない");
  for (const p of paths) {
    assert.ok(existsSync(join(process.cwd(), "src", "app", ...p.split("/").filter(Boolean), "page.tsx")), `${p} のページが存在しない`);
    assert.ok(migration0089.includes(`= 'https://ogiri-dojo.vercel.app${p}'`), `0089のCHECK制約に${p}のURLが無い`);
  }
}
console.log("PASS: 0089の方針URL4件は許可ホストのHTTPS絶対URLで、パスが公開サポートパス・実在するページと一致する");

// 8: Webの既存同意呼び出しはrecord_terms_consent_v2のままで、v3はWebコードから呼ばない。
{
  assert.ok(
    consentRequiredGate.includes('supabase.rpc("record_terms_consent_v2", {'),
    "ConsentRequiredGateの同意記録がrecord_terms_consent_v2ではない",
  );
  assert.ok(
    consentGateStore.includes('supabase.rpc("record_terms_consent_v2", {'),
    "useConsentGateStoreの同意記録がrecord_terms_consent_v2ではない",
  );
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "__tests__") continue;
        walk(full);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry) && readFileSync(full, "utf8").includes("record_terms_consent_v3")) {
        offenders.push(full);
      }
    }
  };
  walk(join(process.cwd(), "src"));
  assert.deepEqual(offenders, [], `Webコードがrecord_terms_consent_v3を参照している: ${offenders.join(", ")}`);
}
console.log("PASS: Webの同意記録は引き続きrecord_terms_consent_v2で、record_terms_consent_v3はWebコードから呼ばれていない");

// 9: 適用済みの履歴マイグレーション0001〜0088は、フェーズ1E-S開始時点（ba4da21）から変更されていない
//    （0087の再実行テスト分離も、0087自体を編集せずに行っている）。
{
  const BASELINE_COMMIT = "ba4da21";
  const changed = execFileSync("git", ["diff", "--name-only", BASELINE_COMMIT, "--", "supabase/migrations"], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .filter((f) => {
      const m = /^supabase\/migrations\/(\d{4})_/.exec(f);
      return m !== null && Number(m[1]) <= 88;
    });
  assert.deepEqual(changed, [], `0001〜0088が変更されている: ${changed.join(", ")}`);
}
console.log("PASS: 0001〜0088の履歴マイグレーションは変更されていない");

console.log("publicSupportPages.check: ALL PASS");
