// 利用規約(/terms)・プライバシーポリシー(/privacy)ページの配線・内容確認（静的検査）。
// 実際にReactをレンダリングする自動テスト基盤が無いため、ソースを読み取り、
// 要求された内容・導線がコード上に存在すること、既存のログイン/ゲスト参加処理
// （useAuthStore.ts）が変更されていないことを確認する。
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ACCOUNT_DELETION_MAIL_SUBJECT,
  CONTACT_EMAIL,
  CONTACT_MAILTO,
  ENACTED_ON,
  OPERATOR_NAME,
  PRIVACY_VERSION,
  SHORT_VIDEO_LICENSE_CONSENT_VERSIONS,
  SHORT_VIDEO_LICENSE_EFFECTIVE_FROM,
  SHORT_VIDEO_LICENSE_EFFECTIVE_ON,
  SHORT_VIDEO_LICENSE_REVISION_PRIVACY_VERSION,
  SHORT_VIDEO_LICENSE_REVISION_TERMS_VERSION,
  TERMS_LAST_REVISED_ON,
  TERMS_VERSION,
  contactMailtoWithSubject,
  contactMailtoWithSubjectAndBody,
  formatShortVideoLicenseConsentVersions,
  isShortVideoLicenseApplicable,
} from "../legalInfo";

const read = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), "utf8");

// 特定のLegalSection（id指定）の本文だけを取り出す。「文字列がページのどこかに
// 含まれていればOK」という弱い検査ではなく、意図した項目の中に実際に書かれて
// いることを確認するために使う。空白は正規化し、改行位置に依存しないようにする。
function sectionBody(src: string, id: string): string {
  const startMarker = `id="${id}"`;
  const startIdx = src.indexOf(startMarker);
  assert.ok(startIdx >= 0, `セクション id="${id}" が見つからない`);
  const nextSectionIdx = src.indexOf("<LegalSection", startIdx + startMarker.length);
  const endIdx = nextSectionIdx >= 0 ? nextSectionIdx : src.length;
  return src.slice(startIdx, endIdx).replace(/\s+/g, "");
}

const termsPage = read("src", "app", "terms", "page.tsx");
const privacyPage = read("src", "app", "privacy", "page.tsx");
const homePage = read("src", "app", "(main)", "page.tsx");
const livePage = read("src", "app", "live", "page.tsx");
const legalLayout = read("src", "components", "legal", "LegalPageLayout.tsx");
const legalLinks = read("src", "components", "legal", "LegalLinks.tsx");
const authStore = read("src", "store", "useAuthStore.ts");
const consentGateStore = read("src", "store", "useConsentGateStore.ts");
const consentGateModal = read("src", "components", "legal", "ConsentGateModal.tsx");
const consentRequiredGate = read("src", "components", "app", "ConsentRequiredGate.tsx");
const rootLayout = read("src", "app", "layout.tsx");
const accountDeletionRequestModal = read("src", "components", "app", "AccountDeletionRequestModal.tsx");
const myProfileEditModal = read("src", "components", "app", "MyProfileEditModal.tsx");
const accountDeletionRequestsAdminPage = read("src", "app", "admin", "account-deletion-requests", "page.tsx");
const migration0077 = read("supabase", "migrations", "0077_account_deletion_requests.sql");

// 2026-09-25（同意ゲート共通化対応）：signInWithX/signInAsGuestを直接呼んでいた
// 全13+1箇所（rg "signInWithX\(" src の結果）が、共通ゲート
// （useConsentGateStore）経由に置き換わっていることを確認する対象ファイル一覧。
const CONSENT_GATED_CALL_SITES = [
  ["FinalResultView", read("src", "components", "live-room", "FinalResultView.tsx")],
  ["AccountSummary", read("src", "components", "home", "AccountSummary.tsx")],
  ["GuestMemberGate", read("src", "components", "app", "GuestMemberGate.tsx")],
  ["MyProfileTicket", read("src", "components", "home", "MyProfileTicket.tsx")],
  ["StadiumHeader", read("src", "components", "home", "StadiumHeader.tsx")],
  ["AppHeader", read("src", "components", "app", "AppHeader.tsx")],
  ["admin/layout", read("src", "app", "admin", "layout.tsx")],
  ["sns/new", read("src", "app", "(main)", "sns", "new", "page.tsx")],
  ["live/page", livePage],
  ["live/host/page", read("src", "app", "live", "host", "page.tsx")],
] as const;

// 1: /terms・/privacyは認証状態を一切参照しない（useAuthStore/useProfileStoreに
//    依存しない）独立したページであり、未ログインでも必ず表示できる構成になっている。
for (const [name, src] of [
  ["terms", termsPage],
  ["privacy", privacyPage],
  ["LegalPageLayout", legalLayout],
] as const) {
  assert.ok(
    !/from ["']@\/store\/(useAuthStore|useProfileStore)["']/.test(src),
    `${name}が認証状態(useAuthStore/useProfileStore)をimportしており、未ログインで開けない可能性がある`,
  );
}
console.log("PASS: /terms・/privacy・共通レイアウトは認証状態に一切依存せず、未ログインでも表示できる構成になっている");

// 2: ホーム画面・未ログインのライブ画面(/live)の両方に、/terms・/privacyへの
//    リンクが実際に置かれている。
for (const [name, src] of [
  ["ホーム画面", homePage],
  ["/liveの未ログイン画面", livePage],
] as const) {
  assert.ok(/LegalLinksRow|LegalConsentNote/.test(src), `${name}が利用規約・プライバシーポリシーの導線部品を使っていない`);
}
assert.ok(legalLinks.includes('href="/terms"'), "LegalLinksRow/LegalConsentNoteが/termsへリンクしていない");
assert.ok(legalLinks.includes('href="/privacy"'), "LegalLinksRow/LegalConsentNoteが/privacyへリンクしていない");
console.log("PASS: ホーム画面・未ログインのライブ画面のいずれにも/terms・/privacyへのリンクがある");

// 3: 両ページに、正式な運営者名・問い合わせ先・施行日が表示される
//    （src/lib/legalInfo.tsの値を実際に参照していることを確認する＝
//    値がハードコードで別々に書かれてズレる心配が無い）。
for (const [name, src] of [
  ["terms", termsPage],
  ["privacy", privacyPage],
] as const) {
  assert.ok(src.includes("OPERATOR_NAME"), `${name}がOPERATOR_NAMEを表示していない`);
  assert.ok(src.includes("CONTACT_EMAIL") || src.includes("CONTACT_MAILTO"), `${name}が問い合わせ先を表示していない`);
  assert.ok(src.includes("ENACTED_ON"), `${name}が制定日(ENACTED_ON)を表示していない`);
}
assert.equal(OPERATOR_NAME, "爆笑スタジアム運営");
assert.equal(CONTACT_EMAIL, "bakushostadium.contact@gmail.com");
assert.equal(ENACTED_ON, "2026年9月25日");
console.log("PASS: 利用規約・プライバシーポリシーの両方が、確定済みの運営者名・問い合わせ先・施行日(src/lib/legalInfo.ts)を表示している");

// 4: 利用者向け文面に「ご確認事項」「未確定」「TODO」「LegalPlaceholder」等の
//    プレースホルダーが一切残っていない。
for (const [name, src] of [
  ["terms", termsPage],
  ["privacy", privacyPage],
  ["LegalPageLayout", legalLayout],
  ["LegalLinks", legalLinks],
] as const) {
  assert.ok(!/ご確認事項|未確定|TODO|LegalPlaceholder/.test(src), `${name}にプレースホルダーが残っている`);
}
console.log('PASS: 利用者向け文面に「ご確認事項」「未確定」「TODO」「LegalPlaceholder」が残っていない');

// 5: 問い合わせ先はクリック可能なmailtoリンクになっている。
assert.ok(termsPage.includes("CONTACT_MAILTO"), "利用規約の問い合わせ先がmailtoリンクになっていない");
assert.ok(privacyPage.includes("CONTACT_MAILTO"), "プライバシーポリシーの問い合わせ先がmailtoリンクになっていない");
console.log("PASS: 問い合わせ先はmailtoリンク（CONTACT_MAILTO）になっている");

// 6: Xログインの用途説明が、利用規約・プライバシーポリシー・ホーム画面の3箇所で
//    矛盾しない（同じ核心フレーズ「ログイン認証、アカウントの識別及び初期
//    プロフィールの作成」を共通して使っている）。
const X_LOGIN_PURPOSE_PHRASE = "ログイン認証、アカウントの識別及び初期プロフィールの作成";
for (const [name, src] of [
  ["terms", termsPage],
  ["privacy", privacyPage],
  ["home", homePage],
] as const) {
  assert.ok(src.includes(X_LOGIN_PURPOSE_PHRASE), `${name}のXログイン用途説明が統一フレーズと一致しない`);
}
// 「本人確認のためにのみ使用します」という誤解を招く表現が残っていないこと。
for (const [name, src] of [
  ["terms", termsPage],
  ["privacy", privacyPage],
  ["home", homePage],
] as const) {
  assert.ok(!src.includes("本人確認のためにのみ使用"), `${name}に実在人物の本人確認と誤解される旧表現が残っている`);
}
console.log("PASS: Xログインの用途説明が利用規約・プライバシーポリシー・ホーム画面で矛盾しない統一フレーズになっている");

// 7: ツッコミの削除ができること、及び投稿削除では寄合券が返還されないことの説明が
//    利用規約・プライバシーポリシーの両方にある。
for (const [name, src] of [
  ["terms", termsPage],
  ["privacy", privacyPage],
] as const) {
  assert.ok(src.includes("ツッコミを削除"), `${name}にツッコミの削除に関する説明がない`);
  assert.ok(src.includes("寄合券"), `${name}に寄合券に関する説明がない`);
  // ソース中の改行位置に依存しないよう、改行・空白を無視して判定する。
  assert.ok(/返還されません|返還されない/.test(src.replace(/\s+/g, "")), `${name}に寄合券が返還されない旨の説明がない`);
}
console.log("PASS: ツッコミの削除、及び投稿削除で寄合券が返還されない旨の説明が利用規約・プライバシーポリシーの両方にある");

// 8: 公式SNS等への掲載条件（事前確認なし・著作権は投稿者に留保・削除依頼窓口）が
//    利用規約・プライバシーポリシーの両方にある。
for (const [name, src] of [
  ["terms", termsPage],
  ["privacy", privacyPage],
] as const) {
  assert.ok(src.includes("公式SNS等"), `${name}に公式SNS等への掲載に関する記載がない`);
  assert.ok(src.includes(CONTACT_EMAIL) || src.includes("CONTACT_EMAIL") || src.includes("CONTACT_MAILTO"), `${name}に公式SNS等の削除依頼窓口の記載がない`);
}
assert.ok(
  sectionBody(termsPage, "content-rights").includes("投稿ごとの事前通知又は個別の確認を原則として行いません"),
  "利用規約に投稿ごとの事前確認を原則行わない旨の記載がない",
);
assert.ok(termsPage.includes("著作権その他の権利は、投稿を行った利用者に留保"), "利用規約に著作権が投稿者に留保される旨の記載がない");
console.log("PASS: 公式SNS等への掲載条件（事前確認は原則なし・著作権は投稿者に留保）と削除依頼方法が利用規約・プライバシーポリシーの両方にある");

// 9: プライバシーポリシーの目次ラベルに手書きの番号（例："1. 取得する情報"）が
//    残っておらず、LegalTableOfContentsによる自動採番だけが表示される
//    （「1. 1. 取得する情報」のような二重表示を防ぐ）。利用規約側の目次
//    （"第1条（...）"形式）は変更対象外なので崩れていないことだけ確認する。
const privacyTocMatch = privacyPage.match(/const TOC = \[([\s\S]*?)\n\];/);
assert.ok(privacyTocMatch, "プライバシーポリシーのTOC定義が見つからない");
const privacyTocBlock = privacyTocMatch![1];
assert.ok(
  !/label:\s*"\d+\.\s/.test(privacyTocBlock),
  "プライバシーポリシーのTOCラベルに手書きの番号が残っており、二重採番になる",
);
assert.ok(termsPage.includes('label: "第1条（本規約の適用）"'), "利用規約の目次（第1条〜）が崩れている");
console.log("PASS: プライバシーポリシーの目次ラベルに手書きの番号が残っておらず、二重採番にならない。利用規約の目次も維持されている");

// 10: 既存のXログイン・ゲスト参加処理（useAuthStore.ts）が変更されておらず、
//     OAuthスコープも追加されていない。
assert.ok(authStore.includes('provider: "x"'), "signInWithXのprovider指定が変更されている");
assert.ok(!/scopes\s*:/.test(authStore), "signInWithOAuthにscopesが追加され、OAuth権限範囲が変わっている");
assert.ok(authStore.includes("supabase.auth.signInAnonymously()"), "signInAsGuestの匿名認証呼び出しが変更されている");
console.log("PASS: 既存のXログイン(signInWithX)・ゲスト参加(signInAsGuest)処理とOAuthスコープは変更されていない");

// 11（2026-09-25レビュー対応）：寄合券はライブ参加用ではなく、寄合帳でお題・
//    回答・ツッコミを投稿する際に使用する回数券的な仕組みであることが正しく
//    説明されている。「寄合券（ライブ参加に用いる〜）」という誤った文言が
//    戻っていないことを、部分一致ではなく該当フレーズそのものの不在で確認する。
for (const [name, src] of [
  ["terms", termsPage],
  ["privacy", privacyPage],
] as const) {
  assert.ok(
    !src.includes("寄合券（ライブ参加に用いる"),
    `${name}に「寄合券はライブ参加用」と誤解させる文言が残っている`,
  );
  assert.ok(
    !/寄合券[^。]{0,20}ライブ参加/.test(src.replace(/\s+/g, "")),
    `${name}に寄合券とライブ参加を結び付ける文言が残っている`,
  );
  assert.ok(
    src.includes("寄合帳でお題・回答・ツッコミを投稿する際に使用する"),
    `${name}に寄合券が寄合帳の投稿用であることの説明がない`,
  );
}
console.log("PASS: 寄合券がライブ参加用ではなく寄合帳の投稿（お題・回答・ツッコミ）用であると正しく説明されている");

// 12（2026-09-25レビュー対応）：運営者情報の開示請求への対応が「氏名（名称）
//    又は住所等」という片方だけを回答するとも読める旧表現ではなく、
//    「氏名又は名称及び住所」を回答する趣旨になっている。
assert.ok(
  privacyPage.includes("氏名又は名称及び住所"),
  "プライバシーポリシーの運営者情報開示文言が「氏名又は名称及び住所」という趣旨になっていない",
);
assert.ok(
  !privacyPage.includes("氏名（名称）又は住所等"),
  "プライバシーポリシーに、氏名/住所のどちらか一方の回答とも読める旧表現が残っている",
);
console.log('PASS: 運営者情報の開示請求対応が「氏名又は名称及び住所」を回答する趣旨になっている');

// 13（2026-09-25レビュー対応）：公式SNS等への掲載を「第三者提供に該当しません」と
//    断定していた旧表現が無く、代わりに（a）公式SNS等掲載は本ポリシーの別項目を
//    参照する形で除外事由の一つとして整理され、（b）公式SNS等掲載自体は利用規約への
//    同意に基づき運営が一般公開するものである旨が、それぞれ矛盾なく説明されている。
assert.ok(
  !privacyPage.includes("本項にいう第三者への個人情報の提供には"),
  "プライバシーポリシーに、公式SNS等掲載を第三者提供に該当しないと断定する旧表現が残っている",
);
const privacyFlat = privacyPage.replace(/\s+/g, "");
assert.ok(
  privacyFlat.includes("公式SNS等への掲載、本サービスの公開機能をご利用いただいた場合"),
  "プライバシーポリシーの第三者提供の説明が、公式SNS等掲載を除外事由として整理した趣旨になっていない",
);
assert.ok(
  privacyFlat.includes("本サービスの提供に必要な委託先による取扱い"),
  "プライバシーポリシーの第三者提供の説明にSupabase・Vercel等の委託先取扱いの記載がない",
);
assert.ok(
  privacyFlat.includes("利用規約第8条への同意に基づき運営が公式SNS等上で一般に公開するものであり"),
  "プライバシーポリシーに、公式SNS等掲載が利用規約への同意に基づく公開であることの説明がない",
);
console.log(
  "PASS: 「公式SNS等への掲載は第三者提供に該当しません」という断定が無く、公式SNS等掲載は利用規約への同意に基づく公開として整理されている",
);

// 14: Xのユーザー名（@ID）・プロフィール画像は、別途許可がない限り公式SNS等へ
//     掲載しない旨が利用規約・プライバシーポリシーの両方にある。
for (const [name, src] of [
  ["terms", termsPage],
  ["privacy", privacyPage],
] as const) {
  assert.ok(
    /Xのユーザー名（@ID）(?:及び|.{0,4})Xのプロフィール\s*画像/.test(src.replace(/\s+/g, "")),
    `${name}にXの@ID・プロフィール画像に関する記載がない`,
  );
  assert.ok(
    src.replace(/\s+/g, "").includes("別途利用者の許可を得ない限り"),
    `${name}にXの@ID・プロフィール画像を別途許可なく掲載しない旨の記載がない`,
  );
}
console.log("PASS: Xのユーザー名（@ID）及びプロフィール画像は、別途許可を得ない限り公式SNS等へ掲載しない旨が両方にある");

// 15: 削除依頼メールの件名(ACCOUNT_DELETION_MAIL_SUBJECT)が意図した値であり、
//     プライバシーポリシーがこの定数から実際にmailtoリンクを組み立てている
//     （contactMailtoWithSubjectの実際の動作＝日本語件名が正しくパーセント
//     エンコードされることも合わせて検証する）。
assert.equal(ACCOUNT_DELETION_MAIL_SUBJECT, "爆笑スタジアム アカウント削除依頼");
const expectedDeletionMailto = `${CONTACT_MAILTO}?subject=${encodeURIComponent(ACCOUNT_DELETION_MAIL_SUBJECT)}`;
assert.equal(contactMailtoWithSubject(ACCOUNT_DELETION_MAIL_SUBJECT), expectedDeletionMailto);
assert.ok(!expectedDeletionMailto.includes(" "), "件名付きmailtoリンクに生のスペースが残っており正しくエンコードされていない");
assert.ok(
  privacyPage.includes("contactMailtoWithSubject(ACCOUNT_DELETION_MAIL_SUBJECT)"),
  "プライバシーポリシーがACCOUNT_DELETION_MAIL_SUBJECTを使って削除依頼の件名付きmailtoリンクを組み立てていない",
);
console.log(
  "PASS: 削除依頼メールの件名(ACCOUNT_DELETION_MAIL_SUBJECT)が意図した値であり、プライバシーポリシーがcontactMailtoWithSubject経由で正しくエンコードされたmailtoリンクを組み立てている",
);

// 16: 問い合わせ先・運営者名・制定日・削除依頼方法（アカウント削除のご依頼に
//     ついてのセクション）が、いずれも維持されている
//     （運営者名・問い合わせ先・制定日そのものはチェック3で確認済みのため、
//     ここでは削除依頼セクション固有の内容を確認する）。
assert.ok(
  privacyPage.includes('id="account-deletion"'),
  "プライバシーポリシーからアカウント削除のご依頼についてのセクションが失われている",
);
assert.ok(privacyPage.includes("受付先："), "プライバシーポリシーの削除依頼セクションから受付先の記載が失われている");
assert.ok(privacyPage.includes("件名例："), "プライバシーポリシーの削除依頼セクションから件名例の記載が失われている");
console.log("PASS: アカウント削除のご依頼について（受付先・件名例を含む）が維持されている");

// 17（2026-09-25再監査対応）：第12条・第14条が運営の軽過失まで無条件に免責する
//    内容になっておらず（消費者契約法8条1項1号・3号に抵触するおそれ）、
//    第12条は独自の免責を持たず第14条を参照し、第14条は「責めに帰すべき事由が
//    あれば法令に従って責任を負う／軽過失の場合のみ賠償範囲を直接かつ通常の
//    損害に限定する／故意重過失の場合はその限定を適用しない」という構成に
//    なっている。
{
  const interruptionBody = sectionBody(termsPage, "live-interruption");
  assert.ok(
    !/故意又は重大な過失による場合はこの限りではありません/.test(interruptionBody),
    "第12条に、独自の損害賠償免責文言（軽過失まで全部免責しうる旧文言）が残っている",
  );
  assert.ok(
    interruptionBody.includes("第14条の定めによるものとします"),
    "第12条が、損害賠償について第14条の定めによる旨を参照していない",
  );

  const disclaimerBody = sectionBody(termsPage, "disclaimer");
  assert.ok(
    !disclaimerBody.includes("故意又は重大な過失による場合を除き、賠償の責任を負わないものとします"),
    "第14条に、運営の軽過失も含め損害賠償を全部免責する旧文言が残っている（消費者契約法8条1項1号・3号に抵触するおそれ）",
  );
  assert.ok(
    disclaimerBody.includes("運営の責めに帰すべき事由により利用者に損害が生じた場合、運営は、消費者契約法その他の法令に従って責任を負います"),
    "第14条に、運営の責めに帰すべき事由がある場合は法令に従って責任を負う旨の記載がない",
  );
  assert.ok(
    disclaimerBody.includes("運営の軽過失による場合、賠償の範囲は、現実に発生した直接かつ通常の損害に限る"),
    "第14条に、軽過失の場合に限り賠償範囲を直接かつ通常の損害へ限定する旨の記載がない",
  );
  assert.ok(
    disclaimerBody.includes("運営の故意又は重大な過失による場合は、この限定を適用しません"),
    "第14条に、故意・重過失の場合は賠償範囲の限定を適用しない旨の記載がない",
  );
}
console.log("PASS: 第12条・第14条が運営の軽過失まで無条件に免責する内容ではなくなり、責めに帰すべき事由・軽過失限定・故意重過失除外の構成になっている");

// 18: 第16条（準拠法・裁判管轄）が、非公開の運営所在地だけを専属管轄とする
//    条項ではなく、法令に定める管轄によるという安全な表現になっている。
{
  const governingLawBody = sectionBody(termsPage, "governing-law");
  assert.ok(!governingLawBody.includes("専属的合意管轄"), "第16条に専属的合意管轄の指定が残っている");
  assert.ok(!governingLawBody.includes("運営の所在地を管轄する裁判所"), "第16条に非公開の運営所在地だけを管轄とする文言が残っている");
  assert.ok(
    governingLawBody.includes("民事訴訟法その他の法令に定める管轄権を有する裁判所"),
    "第16条が法令に定める管轄による旨になっていない",
  );
}
console.log("PASS: 裁判管轄が、非公開の運営所在地だけを専属管轄とする条項ではなく、法令上の管轄による安全な表現になっている");

// 19: 第5条（未成年者の利用）が、民法5条の未成年者取消権を排除する効果を
//    持ち得ない「法定代理人の同意を得て利用しているものとみなす」という
//    言い回しではなく、同意取得を求める条件文になっている。
{
  const minorsBody = sectionBody(termsPage, "minors");
  assert.ok(
    !minorsBody.includes("法定代理人の同意を得て利用しているものとみなします"),
    "第5条に、未成年者の法定代理人同意を一方的に擬制する旧文言が残っている（民法5条の取消権を排除できない）",
  );
  assert.ok(minorsBody.includes("法定代理人の同意を得た上で"), "第5条から、法定代理人の同意を得るよう求める文言が失われている");
}
console.log("PASS: 未成年者条項が、法的効果を持たない同意の擬制ではなく、同意取得を求める表現になっている");

// 20（既存投稿への遡及適用の明確化）：公式SNS等への掲載許諾が本規約の制定日以後の
//    投稿にのみ適用され、制定日より前の投稿は別途対応する旨が、利用規約
//    （第1条）・プライバシーポリシー（投稿内容の公式SNS等への掲載について）の
//    両方に明記されている（遡及的に許諾を得たと断定していない）。
{
  const scopeBody = sectionBody(termsPage, "scope");
  assert.ok(
    scopeBody.includes("制定日（施行日）以後に生成") && scopeBody.includes("された対象投稿等"),
    "利用規約第1条に、公式SNS等掲載許諾の適用対象を制定日以後に生成された対象投稿等に限定する記載がない",
  );
  assert.ok(scopeBody.includes("運営は、投稿者への案内その他の適切な方法により、別途対応"), "利用規約第1条に、制定日より前の投稿への別途対応方針の記載がない");

  const officialXBody = sectionBody(privacyPage, "official-x-posting");
  assert.ok(
    officialXBody.includes("利用規約の制定日（施行日）以後に生成") && officialXBody.includes("された対象投稿等に適用され"),
    "プライバシーポリシーに、公式SNS等掲載許諾が制定日以後に生成された対象投稿等に限られる旨の記載がない",
  );
}
console.log("PASS: 公式SNS等掲載の許諾が制定日以後の投稿にのみ適用され、既存投稿への遡及適用を断定していないことが利用規約・プライバシーポリシーの両方で確認できる");

// 21: 第8条3項・プライバシーポリシーの公式SNS等掲載条件から、範囲が予測しにくい
//    「ライブ結果等」という曖昧な表現が無くなり、得点・順位等の具体的な項目に
//    書き換えられている。
{
  assert.ok(!termsPage.includes("ライブ結果等"), "利用規約に、範囲が予測しにくい「ライブ結果等」という表現が残っている");
  assert.ok(!privacyPage.includes("ライブ結果等"), "プライバシーポリシーに、範囲が予測しにくい「ライブ結果等」という表現が残っている");
  const contentRightsBody = sectionBody(termsPage, "content-rights");
  assert.ok(contentRightsBody.includes("ライブでの得点、順位その他の結果"), "利用規約第8条に、公式SNS等掲載対象の具体的な項目（得点・順位）の記載がない");
}
console.log("PASS: 公式SNS等掲載の対象が「ライブ結果等」という曖昧な表現から、得点・順位等の具体的な項目に書き換えられている");

// 22（2026-09-25再監査対応：0078でauthor_idをon delete cascade→set nullへ変更
//    したことに合わせ、記述も「他人の投稿データが削除される」から「他人の投稿は
//    物理削除されず、親が非表示になることで一般公開画面に表示されなくなるだけ」
//    へ修正した）：投稿削除（第6条・保存期間セクション）は引き続き自分以外の
//    利用者への表示影響を説明し、アカウント削除セクションは「他人の投稿データ
//    自体は削除されない」ことを明記している。
{
  const accountDeletionBody = sectionBody(privacyPage, "account-deletion");
  assert.ok(
    !accountDeletionBody.includes("他の利用者が投稿した回答及びツッコミも、あわせて削除されます"),
    "プライバシーポリシーのアカウント削除セクションに、他人の投稿データが物理削除されるという実装と不一致の旧文言が残っている",
  );
  assert.ok(
    accountDeletionBody.includes("それらの回答・ツッコミのデータ自体が削除されることはありません"),
    "プライバシーポリシーのアカウント削除セクションに、他人の投稿データが削除されない旨の記載がない",
  );
  assert.ok(
    accountDeletionBody.includes("一般公開画面ではあわせて表示されなくなります"),
    "プライバシーポリシーのアカウント削除セクションに、親が非表示になることで他人の投稿も表示されなくなる旨の記載がない",
  );

  const retentionBody = sectionBody(privacyPage, "retention");
  assert.ok(
    retentionBody.includes("自分以外の利用者が投稿した回答・ツッコミにも影響する場合があります"),
    "プライバシーポリシーの保存期間・削除セクションに、他の利用者の投稿への影響の説明がない",
  );
  const postingRulesBody = sectionBody(termsPage, "posting-rules");
  assert.ok(
    postingRulesBody.includes("自分以外の利用者が投稿した回答・ツッコミにも影響する場合があります"),
    "利用規約第6条に、他の利用者の投稿への影響の説明がない",
  );
}
console.log("PASS: 投稿削除は引き続き他の利用者への表示影響を説明し、アカウント削除は他人の投稿データが物理削除されない実装と一致した説明になっている");

// 23: 外部サービスの利用セクション内で、IPアドレス等の技術的情報の取扱いと
//    海外事業者による国外処理の可能性が、実際にそのセクションの中で
//    説明されている（「取得する情報」からの参照先が空振りにならないようにする）。
{
  const thirdPartyServicesBody = sectionBody(privacyPage, "third-party-services");
  assert.ok(
    thirdPartyServicesBody.includes("IPアドレスやアクセス日時等の技術的な情報"),
    "外部サービスの利用セクションに、IPアドレス等の技術的情報の取扱いに関する説明がない",
  );
  assert.ok(
    thirdPartyServicesBody.includes("国外に本拠を置く事業者であり"),
    "外部サービスの利用セクションに、海外事業者による国外での処理・保存の可能性に関する説明がない",
  );
}
console.log("PASS: 外部サービスの利用セクション内に、IPアドレス等の技術的情報の取扱いと海外事業者による国外処理の可能性の説明がある（「取得する情報」からの参照先が空振りにならない）");

// 24: ゲストが投稿・回答・ツッコミだけでなく、いいね・フォロー・通報も
//    行えないことが、利用規約（第4条）・プライバシーポリシー（ゲスト利用時に
//    保存される情報）の両方に明記されている。
{
  const guestBody = sectionBody(termsPage, "guest");
  assert.ok(guestBody.includes("いいね、フォロー及び通報を行うことはできません"), "利用規約第4条に、ゲストがいいね・フォロー・通報を行えない旨の記載がない");
  const guestDataBody = sectionBody(privacyPage, "guest-data");
  assert.ok(
    guestDataBody.includes("いいね、フォロー及び通報を行うことができないため"),
    "プライバシーポリシーのゲスト利用時に保存される情報セクションに、いいね・フォロー・通報を行えない旨の記載がない",
  );
}
console.log("PASS: ゲストがいいね・フォロー・通報も行えないことが利用規約・プライバシーポリシーの両方に明記されている");

// 25（2026-09-25再監査対応、2026-09-28第8条実質改定で目的の文言を拡張）：
//    プライバシーポリシーの「利用目的」一覧に、公式SNS等での紹介・広報・宣伝・記録・
//    振り返り目的が追加されており、利用規約第8条・公式SNS等掲載セクションと
//    対象範囲がずれていない。
{
  const purposeBody = sectionBody(privacyPage, "purpose");
  assert.ok(
    purposeBody.includes("本サービス及び公式SNS等において、本サービス及びライブの紹介、広報、宣伝、記録及び振り返りを行うため"),
    "プライバシーポリシーの利用目的一覧に、公式SNS等での紹介・広報・宣伝・記録・振り返り目的が追加されていない",
  );
}
console.log("PASS: プライバシーポリシーの利用目的一覧に公式SNS等での紹介・広報・宣伝・記録・振り返り目的が追加されている");

// 26（民法548条の4対応）：第15条（本規約の変更）・プライバシーポリシーの
//    「本ポリシーの変更」が、単なる「必要と判断すれば変更できる」ではなく、
//    利用者の一般利益適合又は合理性への限定・事前周知・重大な不利益/法令上の
//    同意を要する変更への明示同意取得、という定型約款の変更要件を満たす構成に
//    なっている。
{
  const amendmentBody = sectionBody(termsPage, "amendment");
  assert.ok(amendmentBody.includes("利用者の一般の利益に適合するとき"), "第15条に、利用者の一般利益適合による変更の要件がない");
  assert.ok(
    amendmentBody.includes("変更の必要性、変更後の内容の相当性その他の変更に係る事情に照らして合理的なものであるとき"),
    "第15条に、契約目的に反せず合理的な場合という変更要件がない",
  );
  assert.ok(
    amendmentBody.includes("利用者から明示的な同意を得るものとし"),
    "第15条に、重大な不利益・法令上同意が必要な変更について明示同意を得る旨の記載がない",
  );

  const policyChangesBody = sectionBody(privacyPage, "policy-changes");
  assert.ok(
    policyChangesBody.includes("効力発生日より相当な期間前に本サービス上への掲示その他の適切な方法により周知"),
    "プライバシーポリシーの変更条項に、重要な変更の事前周知に関する記載がない",
  );
  assert.ok(
    policyChangesBody.includes("必要な同意を取得した上で当該変更を行います"),
    "プライバシーポリシーの変更条項に、法令上同意を要する変更について同意取得する旨の記載がない",
  );
}
console.log("PASS: 規約・ポリシーの変更条項が民法548条の4に沿った構成（事前周知・重大な変更への明示同意）になっている");

// 27（論理削除の説明を実装に合わせる）：管理画面(/admin/posts)に非表示解除機能が
//    実在することと矛盾していた「一般公開画面へ再び表示されることはありません」
//    「原則として復元できません」という断定表現が、利用者自身には復元機能がなく
//    運営が表示状態を変更する場合がある、という実装に即した表現へ変わっている。
{
  assert.ok(
    !termsPage.includes("一般に公開される画面へ再び表示されることはありません"),
    "利用規約に、管理画面の非表示解除機能と矛盾する断定的な旧文言が残っている",
  );
  assert.ok(
    !privacyPage.includes("原則として復元できません"),
    "プライバシーポリシーに、管理画面の非表示解除機能と矛盾する断定的な旧文言が残っている",
  );
  const postingRulesBody2 = sectionBody(termsPage, "posting-rules");
  assert.ok(
    postingRulesBody2.includes("利用者自身には、削除した投稿を取り消す機能及び復元する機能はありません"),
    "利用規約第6条に、利用者自身には削除の取消し・復元機能がない旨の記載がない",
  );
  assert.ok(
    postingRulesBody2.includes("運営がその表示状態を変更することがあります"),
    "利用規約第6条に、運営が表示状態を変更する場合がある旨の記載がない",
  );
  const retentionBody2 = sectionBody(privacyPage, "retention");
  assert.ok(
    retentionBody2.includes("利用者自身には、削除した投稿を取り消す機能及び復元する機能はありません"),
    "プライバシーポリシーの保存期間セクションに、利用者自身には削除の取消し・復元機能がない旨の記載がない",
  );
}
console.log("PASS: 論理削除の説明が、管理画面の非表示解除機能と矛盾しない実装どおりの表現になっている");

// 28（Xログイン付近の自動投稿文言の明確化、2026-09-28第8条実質改定で紹介先の
//    表現を拡張）：「Xへの自動投稿は行いません」という曖昧な表現（公式SNS等での
//    紹介まで否定するように読めてしまう）が、「利用者本人のXアカウントから」の
//    自動投稿に限定され、直後に公式SNSや動画配信サービスでの紹介があり得る旨
//    （利用規約第8条参照）が添えられている（ホーム画面・利用規約第3条・
//    プライバシーポリシーのXログイン情報の利用範囲の3箇所）。
{
  assert.ok(
    homePage.includes("利用者本人のXアカウントからの自動投稿・DM送信"),
    "ホーム画面のX連携案内が、利用者本人のXアカウントからの自動投稿に限定する表現になっていない",
  );
  assert.ok(
    homePage.includes("運営が公式SNSや動画配信サービスで紹介する場合があります"),
    "ホーム画面のX連携案内に、公式SNSや動画配信サービスでの紹介があり得る旨の記載がない",
  );
  const accountBody = sectionBody(termsPage, "account");
  assert.ok(
    accountBody.includes("運営は、利用者本人のXアカウントから自動投稿すること"),
    "利用規約第3条のX自動投稿に関する記載が、利用者本人のXアカウントからの投稿に限定されていない",
  );
  const xLoginScopeBody = sectionBody(privacyPage, "x-login-scope");
  assert.ok(
    xLoginScopeBody.includes("利用者本人のXアカウントから自動投稿すること"),
    "プライバシーポリシーのXログイン情報の利用範囲が、利用者本人のXアカウントからの投稿に限定されていない",
  );
}
console.log("PASS: 「Xへの自動投稿は行いません」の趣旨が「利用者本人のXアカウントから」に限定され、公式SNSや動画配信サービスでの紹介があり得る旨が併記されている");

// 29（開示・訂正・削除請求の応答表現の統一）：「合理的な期間内に対応します」
//    という表現が、開示・訂正・削除請求とアカウント削除依頼の両方で
//    「法令に従い、遅滞なく対応します。」という法令上の表現に統一されている。
{
  assert.ok(
    !privacyPage.includes("合理的な期間内に対応します"),
    "プライバシーポリシーに旧表現「合理的な期間内に対応します」が残っている",
  );
  const rightsRequestsBody = sectionBody(privacyPage, "rights-requests");
  assert.ok(
    rightsRequestsBody.includes("法令に従い、遅滞なく対応します"),
    "プライバシーポリシーの開示・訂正・削除請求セクションが「法令に従い、遅滞なく対応します」になっていない",
  );
  const accountDeletionBody2 = sectionBody(privacyPage, "account-deletion");
  assert.ok(
    accountDeletionBody2.includes("法令に従い、遅滞なく対応します"),
    "プライバシーポリシーのアカウント削除セクションが「法令に従い、遅滞なく対応します」になっていない",
  );
}
console.log('PASS: 開示・訂正・削除請求とアカウント削除依頼の応答表現が「法令に従い、遅滞なく対応します」に統一されている');

// 30（最終整合性チェック対応：ローカルストレージの説明を実装に合わせる）：
//    段位・累計ポイント等はSupabase（profilesテーブル、useProfileStore経由）で
//    正式に管理されており、ログイン後はそちらが正の情報源であることを
//    Cookie・ローカルストレージセクションで明記し、「Supabase側のデータベースと
//    まだ連携していない」という実装と矛盾する旧説明が残っていない。あわせて、
//    useProfileStoreに実在する「過去の端末保存アイコンをログイン時に一度だけ
//    Supabaseへ移行する」処理の例外も正確に記載されている。
{
  const cookiesBody = sectionBody(privacyPage, "cookies");
  assert.ok(
    !cookiesBody.includes("Supabase側のデータベースとまだ連携しておらず"),
    "プライバシーポリシーのローカルストレージ説明に、段位・ポイント等がSupabaseと未連携という実装と矛盾する旧説明が残っている",
  );
  assert.ok(
    cookiesBody.includes("段位（習熟度）、累計ポイント、参加回数、表彰回数、ベストアンサー回数等の正式な"),
    "プライバシーポリシーのローカルストレージ説明に、段位・ポイント等の正式な記録がSupabaseで管理されている旨の記載がない",
  );
  assert.ok(
    cookiesBody.includes("Supabase（運営のデータベース）で管理しており、ログイン後はそちらの情報が正の情報源です"),
    "プライバシーポリシーのローカルストレージ説明に、Supabaseが正の情報源である旨の記載がない",
  );
  assert.ok(
    cookiesBody.includes("ログイン時に一度だけSupabase側のデータベースへ移行される場合があり"),
    "プライバシーポリシーのローカルストレージ説明に、アイコンの自動移行という例外の記載がない",
  );
  assert.ok(
    cookiesBody.includes("ガチャ・") && cookiesBody.includes("楽屋等"),
    "プライバシーポリシーのローカルストレージ説明に、ガチャ・楽屋等の未公開機能で使う仮の記録についての記載がない",
  );
}
console.log("PASS: ローカルストレージの説明が、段位・ポイント等の正式な記録はSupabaseにあること、ローカルは表示補助・アイコン移行前の名残・未公開機能の仮データであることを実装どおりに反映している");

// 31（規約への明示同意とバージョン記録）：TERMS_VERSION/PRIVACY_VERSIONが
//    定数化されており、利用規約第1条に、明示同意時に同意日時・バージョンを
//    記録する旨が記載されている。
{
  assert.equal(typeof TERMS_VERSION, "string");
  assert.ok(TERMS_VERSION.length > 0, "TERMS_VERSIONが空文字になっている");
  assert.equal(typeof PRIVACY_VERSION, "string");
  assert.ok(PRIVACY_VERSION.length > 0, "PRIVACY_VERSIONが空文字になっている");
  const scopeBody2 = sectionBody(termsPage, "scope");
  assert.ok(
    scopeBody2.includes("同意日時及び同意した規約・ポリシーのバージョンを記録します"),
    "利用規約第1条に、同意日時・バージョンを記録する旨の記載がない",
  );
}
console.log("PASS: 利用規約・プライバシーポリシーのバージョンが定数化され、明示同意時に同意日時・バージョンを記録する旨が第1条に記載されている");

// 32（アカウント削除申請の安全な本人紐付け）：メール本文に演者名・Xの@IDを
//    書かせるだけの旧方式ではなく、アプリ内で発行した申請番号を使う方式に
//    変わっており、パスワード等の認証情報を送らせない旨・ゲストのセッション
//    喪失時の取扱いも記載されている。
{
  const accountDeletionBody3 = sectionBody(privacyPage, "account-deletion");
  assert.ok(
    !accountDeletionBody3.includes("本文に、アプリ内の演者名（表示名）と、連携しているXのユーザー名（@ID）をご記載ください"),
    "プライバシーポリシーに、公開情報のみで本人確認する旧方式（演者名・Xの@ID記載）の説明が残っている",
  );
  assert.ok(
    accountDeletionBody3.includes("アプリ内の設定画面から申請できます"),
    "プライバシーポリシーに、アプリ内から削除申請できる旨の記載がない",
  );
  assert.ok(
    accountDeletionBody3.includes("申請番号"),
    "プライバシーポリシーに、削除申請番号に関する記載がない",
  );
  assert.ok(
    accountDeletionBody3.includes("匿名セッションを失ったゲストについては"),
    "プライバシーポリシーに、セッションを失ったゲストの取扱いに関する記載がない",
  );
}
console.log("PASS: アカウント削除依頼が、アプリ内発行の申請番号を用いる安全な方式に変わり、ゲストのセッション喪失時の取扱いも記載されている");

// 33: contactMailtoWithSubjectAndBody（削除申請番号をメール本文へ自動入力する
//     ための新関数）が、件名・本文の両方を正しくパーセントエンコードする。
{
  const body = "削除申請番号：20260925-ABCDEFGH";
  const mailto = contactMailtoWithSubjectAndBody(ACCOUNT_DELETION_MAIL_SUBJECT, body);
  assert.ok(mailto.startsWith(`${CONTACT_MAILTO}?subject=`), "contactMailtoWithSubjectAndBodyの組み立て形式が不正");
  assert.ok(mailto.includes(`&body=${encodeURIComponent(body)}`), "contactMailtoWithSubjectAndBodyが本文を正しくエンコードしていない");
  assert.ok(!mailto.includes(" ") && !mailto.includes("："), "contactMailtoWithSubjectAndBodyの戻り値に生の日本語・スペースが残っており正しくエンコードされていない");
}
console.log("PASS: contactMailtoWithSubjectAndBodyが件名・本文の両方を正しくパーセントエンコードする");

// 34（同意ゲートの共通化・迂回防止）：signInWithX/signInAsGuestを直接呼んで
//    いた全13+1箇所が、共通ゲート（useConsentGateStore）経由に置き換わって
//    いる。useAuthStore.ts自体（呼び出し先の実処理）は変更されていないことは
//    チェック10で別途確認済み。
for (const [name, src] of CONSENT_GATED_CALL_SITES) {
  assert.ok(
    !/useAuthStore\(\(s\)\s*=>\s*s\.signInWithX\)/.test(src),
    `${name}がuseAuthStore.signInWithXを直接呼んでおり、同意ゲートを迂回できる`,
  );
  assert.ok(
    !/useAuthStore\(\(s\)\s*=>\s*s\.signInAsGuest\)/.test(src),
    `${name}がuseAuthStore.signInAsGuestを直接呼んでおり、同意ゲートを迂回できる`,
  );
}
assert.ok(
  /useConsentGateStore\(\(s\)\s*=>\s*s\.requestXLogin\)/.test(
    CONSENT_GATED_CALL_SITES.map(([, src]) => src).join("\n"),
  ),
  "同意ゲート(requestXLogin)経由の呼び出しが1箇所も見つからない",
);
console.log("PASS: signInWithX/signInAsGuestの全呼び出し箇所が共通の同意ゲート（useConsentGateStore）経由になっている");

// 35（同意ゲートの構成）：useConsentGateStoreが未同意時はモーダル表示のみを
//    行い（実際のsignInWithX/signInAsGuestを呼ばない）、同意済み端末では
//    即座に実処理を呼ぶ構成になっている。また、ConsentGateModal・
//    ConsentRequiredGateがルートレイアウトに実際に組み込まれている。
{
  assert.ok(consentGateStore.includes("hasAckedCurrentVersion"), "useConsentGateStoreに同意済み判定のロジックが見当たらない");
  assert.ok(
    consentGateStore.includes("CONSENT_ACK_STORAGE_KEY"),
    "useConsentGateStoreに同意済みバージョンを保存するlocalStorageキーが見当たらない",
  );
  assert.ok(consentGateModal.includes("useConsentGateStore"), "ConsentGateModalがuseConsentGateStoreを使っていない");
  assert.ok(consentRequiredGate.includes("record_terms_consent"), "ConsentRequiredGateがrecord_terms_consent RPCを呼んでいない");
  assert.ok(rootLayout.includes("ConsentRequiredGate"), "ルートレイアウトにConsentRequiredGateが組み込まれていない");
  assert.ok(rootLayout.includes("ConsentGateModal"), "ルートレイアウトにConsentGateModalが組み込まれていない");
  // 2026-10-12：除外判定はsrc/lib/publicSupportPaths.tsのisPublicSupportPath（完全一致）へ
  // 一本化した。/terms・/privacyが実際に除外されることの実行時判定は
  // publicSupportPages.check.tsで行う。
  assert.ok(
    consentRequiredGate.includes("isPublicSupportPath(pathname)") &&
      read("src", "lib", "publicSupportPaths.ts").includes('"/terms", "/privacy"'),
    "ConsentRequiredGateが/terms・/privacyを同意ゲートの対象から除外していない（同意前でも常に閲覧可能にする要件を満たさない）",
  );
}
console.log("PASS: 同意ゲート・既存ユーザー向け同意画面がルートレイアウトに組み込まれ、/terms・/privacyは同意前でも閲覧できる構成になっている");

// 36（アカウント削除申請UIの導線）：MyProfileEditModal（会員向け・ゲスト向け
//    双方）からAccountDeletionRequestModalを開けること、RPC呼び出しが
//    create_account_deletion_requestになっていることを確認する。
{
  assert.ok(
    myProfileEditModal.includes("AccountDeletionRequestModal"),
    "MyProfileEditModalからアカウント削除申請モーダルを開く導線が無い",
  );
  assert.ok(
    accountDeletionRequestModal.includes("create_account_deletion_request"),
    "AccountDeletionRequestModalがcreate_account_deletion_request RPCを呼んでいない",
  );
}
console.log("PASS: プロフィール編集モーダル（会員・ゲスト双方）からアプリ内のアカウント削除申請を開ける導線がある");

// 37（再監査対応：同意確認前にアプリ本体が動いてしまう問題への対応）：
//    ConsentRequiredGateがauth-loading/unauthenticated/checking/
//    consent-required/accepted/errorの6状態を明確に持ち、childrenを返すのは
//    unauthenticated・acceptedの分岐だけであることを確認する（checking・
//    consent-required・error・auth-loadingの間はchildrenをマウントしない）。
//    世代ガード（src/lib/consentCheck.ts）を実際に使っていることも確認する。
{
  const requiredKinds = ["auth-loading", "unauthenticated", "checking", "consent-required", "accepted", "error"];
  for (const kind of requiredKinds) {
    assert.ok(
      consentRequiredGate.includes(`"${kind}"`),
      `ConsentRequiredGateに状態"${kind}"が見当たらない`,
    );
  }
  assert.ok(
    consentRequiredGate.includes('status.kind === "unauthenticated" || status.kind === "accepted"'),
    "ConsentRequiredGateがunauthenticated・accepted以外でもchildrenをマウントしてしまう構成になっている",
  );
  assert.ok(
    consentRequiredGate.includes("GenerationGuard") && consentRequiredGate.includes("consentCheck"),
    "ConsentRequiredGateがsrc/lib/consentCheck.tsの世代ガードを使っていない",
  );
}
console.log("PASS: ConsentRequiredGateが6状態を明確に分け、未同意確認完了前（checking/consent-required/error/auth-loading）はchildrenをマウントせず、世代ガードで古い結果を破棄する構成になっている");

// 38（同意モーダルから規約本文を読めない問題への対応）：ConsentGateModalが
//    LegalLinksRowへopenInNewTabを渡し、LegalLinksRow自体がtarget="_blank"・
//    rel="noopener noreferrer"を実装している。通常画面（ConsentRequiredGateの
//    consent-required画面含む）でも新しいタブで開く（規約本文を覆わないため）。
{
  assert.ok(
    consentGateModal.includes("<LegalLinksRow") && consentGateModal.includes("openInNewTab"),
    "ConsentGateModalがLegalLinksRowへopenInNewTabを渡していない",
  );
  assert.ok(
    legalLinks.includes("openInNewTab") && legalLinks.includes('target: "_blank"') && legalLinks.includes('rel: "noopener noreferrer"'),
    "LegalLinksRowがopenInNewTab指定時にtarget=_blank・rel=noopener noreferrerを設定していない",
  );
  assert.ok(
    consentRequiredGate.includes("<LegalLinksRow") && consentRequiredGate.includes("openInNewTab"),
    "ConsentRequiredGate（既存ユーザー向け同意画面）でもLegalLinksRowが新しいタブで開くようになっていない",
  );
}
console.log("PASS: 同意モーダル・既存ユーザー向け同意画面の規約リンクは新しいタブで開き、規約本文がモーダルに覆われない");

// 39（Xログイン・ゲスト開始の失敗が利用者に表示されない問題への対応、および
//    共有端末での取り違え対策後もこの安全性が維持されていることの確認）：
//    useConsentGateStore.confirmはXログイン枝・ゲスト枝の両方で実処理の
//    戻り値を確認し、失敗時はpendingModalを維持したままerrorReasonをセットする
//    （先にモーダルを閉じてから戻り値を無視する旧実装に戻っていない）。
//    さらにゲスト枝では、signInAsGuest成功後にrecord_terms_consentの結果
//    （error）まで確認してから初めてmarkDeviceConsentAckを呼ぶこと（サインイン
//    成功だけで同意済み扱いにしてしまわないこと）を確認する。
//    ConsentGateModalがそのerrorReasonを実際に画面へ表示している。
{
  const confirmBodyMatch = consentGateStore.match(/confirm:\s*async \(\)\s*=>\s*\{([\s\S]*?)\n  \},/);
  assert.ok(confirmBodyMatch, "useConsentGateStoreのconfirm関数本体が見つからない");
  const confirmBody = confirmBodyMatch![1];
  const guestBranchStart = confirmBody.indexOf("runGuestFlight()");
  assert.ok(guestBranchStart >= 0, "useConsentGateStore.confirmにゲスト枝（ゲスト同意の窓）が見当たらない");
  const xLoginPart = confirmBody.slice(0, guestBranchStart);
  // ゲスト枝の実処理は guestStartAndRecord（同ファイル内の関数）に切り出している。
  const guestFnMatch = consentGateStore.match(/async function guestStartAndRecord\(\)[\s\S]*$/);
  assert.ok(guestFnMatch, "guestStartAndRecord関数が見つからない");
  assert.ok(/guestFlight = guestStartAndRecord\(\)/.test(consentGateStore) && /beginGuestConsentWindow\(\)/.test(consentGateStore) && confirmBody.includes("await runGuestFlight()"), "confirmのゲスト枝が、single-flight化したguestStartAndRecordを経由していない（多重実行で窓・認証が重複する）");
  const guestPart = guestFnMatch![0];

  const xRunIdx = xLoginPart.search(/await runXLogin/);
  const xCheckIdx = xLoginPart.indexOf("if (!result.ok)");
  const xMarkIdx = xLoginPart.search(/writePendingConsentFlag\(|markDeviceConsentAck\(/);
  assert.ok(xRunIdx >= 0, "useConsentGateStore.confirmのXログイン枝が実処理(runXLogin)を呼んでいない");
  assert.ok(xCheckIdx > xRunIdx, "useConsentGateStore.confirmのXログイン枝が実処理の戻り値を確認していない（旧実装は戻り値を無視していた）");
  assert.ok(
    xMarkIdx > xCheckIdx,
    "useConsentGateStore.confirmのXログイン枝が、戻り値の確認より前に保留フラグ書き込み・端末同意済み化をしてしまっている",
  );

  const gRunIdx = guestPart.search(/await runGuestStart/);
  const gCheckIdx = guestPart.indexOf("if (!result.ok)");
  const gRpcIdx = guestPart.indexOf('supabase.rpc("record_terms_consent_v2"');
  assert.ok(guestPart.includes("result.userId") && guestPart.includes("if (!startedUserId) {"), "ゲスト枝が、確定したuserIdが無いままrecord_terms_consentを呼ぶ余地がある");
  const gErrorCheckIdx = guestPart.indexOf("if (recordError)");
  const gMarkIdx = guestPart.indexOf("markDeviceConsentAck()");
  assert.ok(gRunIdx >= 0, "useConsentGateStore.confirmのゲスト枝が実処理(runGuestStart)を呼んでいない");
  assert.ok(gCheckIdx > gRunIdx, "useConsentGateStore.confirmのゲスト枝がsignInAsGuestの戻り値を確認していない");
  assert.ok(
    gRpcIdx > gCheckIdx,
    "useConsentGateStore.confirmのゲスト枝が、signInAsGuestの戻り値確認より前にrecord_terms_consentを呼んでいる",
  );
  assert.ok(
    guestPart.includes("recordTermsConsentOnce("),
    "useConsentGateStore.confirmのゲスト枝が、共通のsingle-flight(recordTermsConsentOnce)を経由せずにrecord_terms_consentを呼んでいる（二重送信の恐れ）",
  );
  assert.ok(
    gErrorCheckIdx > gRpcIdx && gMarkIdx > gErrorCheckIdx,
    "useConsentGateStore.confirmのゲスト枝が、record_terms_consentの成否（error）を確認する前にmarkDeviceConsentAckを呼んでしまっている（サインイン成功だけで同意済み扱いにしてはならない）",
  );

  assert.ok(
    confirmBody.includes("errorReason: result.reason"),
    "useConsentGateStore.confirmが失敗時にerrorReasonへ理由をセットしていない",
  );
  assert.ok(
    consentGateModal.includes("errorReason") && /\{errorReason\s*&&/.test(consentGateModal),
    "ConsentGateModalがstoreのerrorReasonを画面へ表示していない",
  );
}
console.log("PASS: Xログイン・ゲスト開始の実処理が失敗した場合はモーダルを閉じずerrorReasonが画面へ表示され、ゲスト枝は同意記録(record_terms_consent)の成否まで確認してから端末を同意済み扱いにする");

// 40（「みなし同意」の旧表現を残さない）：利用規約第1条2項・LegalConsentNoteの
//    いずれからも、「利用することにより同意したものとみなす」「続行することで
//    同意したものとします」という受動的なみなし同意の表現、及び「原則として」
//    という例外を感じさせる表現が無くなっている。
{
  assert.ok(!termsPage.includes("利用することにより"), "利用規約第1条に、受動的なみなし同意（利用することにより）の旧表現が残っている");
  assert.ok(!termsPage.includes("同意したものとみなされます"), "利用規約第1条に、みなし同意の旧表現が残っている");
  assert.ok(!legalLinks.includes("続行することで"), "LegalConsentNoteに、受動的なみなし同意（続行することで）の旧表現が残っている");
  assert.ok(!legalLinks.includes("原則として"), "LegalConsentNoteに、例外を感じさせる「原則として」という表現が残っている");
  const scopeBody3 = sectionBody(termsPage, "scope");
  assert.ok(
    scopeBody3.includes("同意画面で明示的に同意した上で本サービスを利用します"),
    "利用規約第1条が、明示同意の事実を正確に述べる表現になっていない",
  );
  assert.ok(
    legalLinks.includes("同意画面で明示的に同意した上で本サービスを利用します"),
    "LegalConsentNoteが、明示同意の事実を正確に述べる表現になっていない",
  );
}
console.log("PASS: 利用規約第1条・LegalConsentNoteのいずれからも、受動的なみなし同意の旧表現が無くなり、明示同意の事実を正確に述べる表現に統一されている");

// 41（DBの現在バージョン判定とフロントエンドのTERMS_VERSION/PRIVACY_VERSIONの
//    整合性確認）：current_legal_document_versions()の値と、フロントエンドの
//    TERMS_VERSION/PRIVACY_VERSION（src/lib/legalInfo.ts）が一致している。
//    ここが食い違うと、フロントの「現在バージョンに一致する行を検索する」判定と
//    実際にDBへ記録される値が永久にすれ違い、同意ループに陥る。
//    2026-09-28（世代付き同意RPCへの切替対応）：記録経路そのものは
//    record_terms_consent_v2（クライアントの期待バージョンとDBの現在値が完全
//    一致する場合だけ記録）へ切り替わったが、その内部でもcurrent_legal_document_
//    versions()を参照するため、この一致確認自体は引き続き重要（チェック56で
//    v2 RPC・旧RPCの互換停止・エラーメッセージ変換の各配線を確認する）。
//    2026-09-28（第8条の実質改定対応）：current_legal_document_versions()は0076で
//    定義された後、0081（プライバシーポリシーの称号・限定アイコン追記）で
//    create or replaceされ、0083（第8条：公式SNS等への掲載範囲拡張）で再度
//    create or replaceされた。0076・0081・0083はいずれも本番適用済み・編集禁止の
//    ため、当時のままの値で変わっていないことも併せて確認する
//    （0082は称号表示機能の追加のみでこの関数には触れない）。
//    2026-10-10（ライブ結果コメント自己削除機能に伴う規約改定対応）：今回は0088で
//    さらにcreate or replaceし、現在の最終値を返すようにした。0083はもう最終定義
//    ではないため、0083自身は当時の値（'2026-09-28-v2'/'2026-09-28-v3'）を保持して
//    いることだけを確認し、「現在のTERMS_VERSION/PRIVACY_VERSIONと一致すること」の
//    検証は0088へ移した。
//    2026-10-14（流入アンケートの記載改定・短尺動画の同意条件の文言改定）：0090でさらに
//    create or replaceし、terms 2026-10-14-v4 / privacy 2026-10-14-v5へ更新した。0088自身は当時の値（'2026-10-10-v3'/'2026-10-10-v4'）を
//    保持していることだけを確認し、現在値との一致の検証は0090へ移した。
{
  const migration0076 = read("supabase", "migrations", "0076_terms_consent.sql");
  const migration0081 = read("supabase", "migrations", "0081_titles_and_first_live_rewards.sql");
  const migration0083 = read("supabase", "migrations", "0083_legal_short_video_consent.sql");
  const migration0088 = read("supabase", "migrations", "0088_delete_own_sns_live_result_comment.sql");
  const migration0090 = read("supabase", "migrations", "0090_referral_source_youtube_tiktok.sql");
  assert.ok(
    migration0076.includes("select '2026-09-25-v1'::text, '2026-09-25-v1'::text;"),
    "supabase/migrations/0076_terms_consent.sqlのcurrent_legal_document_versions()の元の定義が変更されている（0076は編集禁止）",
  );
  assert.ok(
    !migration0076.includes("p_terms_version") && !migration0076.includes("p_privacy_version"),
    "record_terms_consent()がまだ引数（p_terms_version/p_privacy_version）を受け取る旧実装のままになっている",
  );
  assert.ok(
    /create or replace function public\.current_legal_document_versions\(\)/.test(migration0081) &&
      migration0081.includes("select '2026-09-25-v1'::text, '2026-09-28-v2'::text;"),
    "0081のcurrent_legal_document_versions()（当時の再定義）が変更されている（0081は本番適用済みのため編集禁止）",
  );
  assert.ok(
    /create or replace function public\.current_legal_document_versions\(\)/.test(migration0083) &&
      migration0083.includes("select '2026-09-28-v2'::text, '2026-09-28-v3'::text;"),
    "0083のcurrent_legal_document_versions()（当時の再定義）が変更されている（0083は本番適用済みのため編集禁止）",
  );
  assert.ok(
    /create or replace function public\.current_legal_document_versions\(\)/.test(migration0088),
    "0088がcurrent_legal_document_versions()をcreate or replaceしていない（ライブ結果コメント自己削除機能に伴う実質改定がDB側の現在バージョン判定に反映されていない）",
  );
  assert.ok(
    migration0088.includes("select '2026-10-10-v3'::text, '2026-10-10-v4'::text;"),
    "0088のcurrent_legal_document_versions()（当時の再定義）が変更されている（0088は編集禁止）",
  );
  assert.ok(
    /create or replace function public\.current_legal_document_versions\(\)/.test(migration0090) &&
      migration0090.includes(`'${TERMS_VERSION}'::text, '${PRIVACY_VERSION}'::text`),
    `supabase/migrations/0090のcurrent_legal_document_versions()（現在の最終定義）が、src/lib/legalInfo.tsのTERMS_VERSION/PRIVACY_VERSION（${TERMS_VERSION}/${PRIVACY_VERSION}）と一致しない（規約改定時は両方を同時に更新すること）`,
  );
  // 0090より後のマイグレーションがcurrent_legal_document_versions()を再定義していない
  // （再定義した場合は、このチェックの「最終定義」の参照先も更新すること）。
  const laterRedefinitions = readdirSync(join(process.cwd(), "supabase", "migrations"))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f > "0090_" && !f.startsWith("0090_"))
    .filter((f) => read("supabase", "migrations", f).includes("function public.current_legal_document_versions()"));
  assert.deepEqual(laterRedefinitions, [], `0090より後にcurrent_legal_document_versions()を再定義している: ${laterRedefinitions.join(", ")}`);
}
console.log("PASS: record_terms_consent()は引数を取らずDB側で現在のバージョンを確定し、その値（0090の最終定義）はsrc/lib/legalInfo.tsのTERMS_VERSION/PRIVACY_VERSIONと一致している。0076・0081・0083・0088自体は編集されていない（当時の値のまま）");

// 41b（利用規約とプライバシーポリシーの最終改定日の分離）：0082リリース時点では
//    プライバシーポリシーだけを改定していたが、0083（第8条の実質改定）・0088
//    （ライブ結果コメント自己削除機能）はいずれも利用規約・プライバシーポリシーの
//    両方を改定するため、文書ごとに独立した定数のうち、両方が同じ改定日を持つ
//    ことを確認する（引き続き共通の1つのLAST_REVISED_ONへは戻していないこと自体は、
//    変数名の使い分けで確認する）。2026-10-10：最新の改定日へ更新した。
{
  const legalInfoSrc = read("src", "lib", "legalInfo.ts");
  assert.ok(
    /export const TERMS_LAST_REVISED_ON: string \| null = "2026年10月14日";/.test(legalInfoSrc),
    "利用規約を今回改定したのに、TERMS_LAST_REVISED_ONが今回の改定日（2026年10月14日）になっていない",
  );
  // 2026-10-14：流入アンケートの記載改定（プライバシーポリシー）と短尺動画の同意条件の
  // 文言改定（利用規約・プライバシーポリシー）のため、両方の改定日を更新した。
  assert.ok(
    /export const PRIVACY_LAST_REVISED_ON: string \| null = "2026年10月14日";/.test(legalInfoSrc),
    "プライバシーポリシーの最終改定日(PRIVACY_LAST_REVISED_ON)が今回の改定日（2026年10月14日）になっていない",
  );
  assert.ok(termsPage.includes("TERMS_LAST_REVISED_ON"), "利用規約ページがTERMS_LAST_REVISED_ONを表示していない（共通のLAST_REVISED_ONを使い続けている可能性）");
  assert.ok(!termsPage.includes("PRIVACY_LAST_REVISED_ON"), "利用規約ページがプライバシーポリシー側の最終改定日を参照してしまっている");
  assert.ok(privacyPage.includes("PRIVACY_LAST_REVISED_ON"), "プライバシーポリシーページがPRIVACY_LAST_REVISED_ONを表示していない");
  assert.ok(!privacyPage.includes("TERMS_LAST_REVISED_ON"), "プライバシーポリシーページが利用規約側の最終改定日を参照してしまっている");
}
console.log("PASS: 利用規約・プライバシーポリシーの最終改定日は文書ごとに独立した定数のままであり、今回はどちらも2026年10月14日の改定表示になっている");

// 42（アカウント削除時の説明を実装と一致させる）：プライバシーポリシーに、
//    本人投稿の本文がモデレーション等のため運営内部に非表示で保持される場合が
//    ある旨が明記され、admin/users/[id]/page.tsxの削除確認文言が「投稿等の
//    関連データも失われます」という0078の実装と食い違う旧表現から、本人投稿は
//    非表示化・他人の投稿行は物理的に残るという正確な説明へ変わっている。
{
  const accountDeletionBody4 = sectionBody(privacyPage, "account-deletion");
  assert.ok(
    accountDeletionBody4.includes("物理的に削除されるわけではなく"),
    "プライバシーポリシーのアカウント削除セクションに、本人投稿の本文が物理削除されない旨の記載がない",
  );
  const adminUsersDetailPage = read("src", "app", "admin", "users", "[id]", "page.tsx");
  assert.ok(
    !adminUsersDetailPage.includes("投稿等の関連データも失われます"),
    "admin/users/[id]/page.tsxの削除確認文言に、0078の実装と食い違う旧表現「投稿等の関連データも失われます」が残っている",
  );
  assert.ok(
    adminUsersDetailPage.includes("他の利用者が投稿した回答・ツッコミの行は物理的に削除されません"),
    "admin/users/[id]/page.tsxの削除確認文言が、他人の投稿行は物理的に残るという実装どおりの説明になっていない",
  );
}
console.log("PASS: アカウント削除時の説明（プライバシーポリシー・管理画面の確認文言）が0078の実装（本人投稿は非表示化、他人の投稿行は物理的に残る）と一致している");

// 43（再々監査対応：同意保存中のアカウント切替競合）：ConsentRequiredGateの
//    handleAgreeがrunCheckと同じ世代ガード（GenerationGuard）を使い、
//    「開始時点の世代・userId（startedUserId）を記録→保存RPC完了後に
//    isCurrent()とuseAuthStore.getState().user?.idの両方を照合→一致する
//    場合だけclearPendingConsentFlag/markDeviceConsentAck/setStatus/setChecked/
//    submitting解除を行う」という構成になっていることを確認する。
{
  const handleAgreeMatch = consentRequiredGate.match(/const handleAgree = async \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(handleAgreeMatch, "ConsentRequiredGateのhandleAgree関数本体が見つからない");
  const handleAgreeBody = handleAgreeMatch![1];
  const peekIdx = handleAgreeBody.indexOf("guardRef.current.peek()");
  const startedUserIdIdx = handleAgreeBody.indexOf("const startedUserId = userId");
  const ownsDefIdx = handleAgreeBody.indexOf("const ownsThisAttempt = ()");
  const rpcIdx = handleAgreeBody.search(/await recordConsentOnceFor\(/);
  const firstCheckIdx = handleAgreeBody.indexOf("if (!ownsThisAttempt())");
  const clearPendingIdx = handleAgreeBody.indexOf("clearPendingConsentFlag()");
  const markIdx = handleAgreeBody.indexOf("markDeviceConsentAck()");
  const finallyOwnsIdx = handleAgreeBody.lastIndexOf("ownsThisAttempt()");

  assert.ok(peekIdx >= 0, "handleAgreeが開始時点の世代をpeek()で記録していない");
  assert.ok(startedUserIdIdx >= 0, "handleAgreeが開始時点のuserIdをstartedUserIdとして記録していない");
  assert.ok(
    ownsDefIdx > peekIdx && ownsDefIdx > startedUserIdIdx,
    "handleAgreeのownsThisAttempt判定が、世代・startedUserIdを記録するより前に定義されている",
  );
  assert.ok(
    handleAgreeBody.includes("guardRef.current.isCurrent(myGeneration) && useAuthStore.getState().user?.id === startedUserId"),
    "handleAgreeが、世代の一致とuseAuthStore.getState().user?.idの一致の両方を確認していない",
  );
  assert.ok(rpcIdx > peekIdx, "handleAgreeが世代を記録するより前に保存RPCを呼んでいる（開始時点の世代を捉えられない）");
  assert.ok(firstCheckIdx > rpcIdx, "handleAgreeが保存RPC完了後にownsThisAttemptを照合していない（旧実装は無条件で状態を適用していた）");
  assert.ok(
    clearPendingIdx > firstCheckIdx && markIdx > clearPendingIdx,
    "handleAgreeが所有権の照合より前にclearPendingConsentFlag/markDeviceConsentAckを実行してしまっている",
  );
  assert.ok(
    finallyOwnsIdx > markIdx,
    "handleAgreeのfinally（submitting解除）でも所有権を照合していない（古い処理が新しい処理のsubmitting表示を誤って解除し得る）",
  );

  // 世代を進めるuseEffect自体でもsubmittingをfalseへ戻していることを確認する
  // （そうしないと、Aの処理がガードにより自身のfinallyでsetSubmitting(false)を
  // 実行しない場合、userBへ切り替わった後も「処理中…」のまま残ってしまう）。
  const effectMatch = consentRequiredGate.match(
    /useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[authLoading, userId, isAnonymousUser, runCheck\]\);/,
  );
  assert.ok(effectMatch, "ConsentRequiredGateの世代管理useEffectが見つからない");
  const effectBody = effectMatch![1];
  const effectNextIdx = effectBody.indexOf("guardRef.current.next()");
  const effectSubmittingIdx = effectBody.indexOf("setSubmitting(false)");
  assert.ok(
    effectSubmittingIdx > effectNextIdx && effectSubmittingIdx >= 0,
    "authLoading/userIdが変わって新しい世代を開始するuseEffectがsetSubmitting(false)を実行していない（切替後の利用者が「処理中…」のまま操作できなくなる）",
  );
}
console.log("PASS: ConsentRequiredGateのhandleAgreeが世代・userIdの両方を照合してから状態を適用し、useEffect（世代切替時）でもsubmittingを確実にfalseへ戻す（同意保存中のアカウント切替競合への対応）");

// 44（ConsentGateModal/useConsentGateStore.confirmが将来例外を投げても
//    ボタンが「処理中」のまま残らない）：confirm()自体がtry/catchで囲まれ
//    safeな日本語エラーへフォールバックし、ConsentGateModal側もconfirm()の
//    呼び出しをtry/finallyで囲みsubmittingを確実に解除する構成になっている。
{
  assert.ok(
    /try\s*\{[\s\S]*await runXLogin[\s\S]*?\}\s*catch/.test(consentGateStore) ||
      /try\s*\{[\s\S]*await runGuestStart[\s\S]*?\}\s*catch/.test(consentGateStore),
    "useConsentGateStore.confirmが実処理の呼び出しをtry/catchで囲んでいない",
  );
  assert.ok(
    /try\s*\{\s*await confirm\(\);\s*\}\s*finally\s*\{\s*setSubmitting\(false\);\s*\}/.test(
      consentGateModal.replace(/\n\s*/g, " "),
    ),
    "ConsentGateModalのhandleConfirmがconfirm()呼び出しをtry/finallyで囲んでいない（例外時にボタンが処理中のまま残り得る）",
  );
}
console.log("PASS: useConsentGateStore.confirm・ConsentGateModalのいずれも、将来例外が投げられてもsafeな日本語エラーを表示しボタンが処理中のまま残らない構成になっている");

// 45（削除申請を未対応へ戻す時の処理日時）：admin_update_account_deletion_
//    requestが、同じstatusへの変更では処理日時・処理者・監査ログを更新せず、
//    rejected→pendingでは処理日時・処理者をNULLへ戻すことを、0077のSQL上で
//    確認する（実際の動作はDB回帰テストで検証済み。ここではロジックの
//    分岐がソース上に実在することだけを確認する）。
{
  assert.ok(
    migration0077.includes("if p_status <> v_row.status then"),
    "0077のadmin_update_account_deletion_requestが、同じstatusへの変更を素通りさせず分岐していない",
  );
  assert.ok(
    /processed_at\s*=\s*case when p_status = 'pending' then null else now\(\) end/.test(migration0077),
    "0077のadmin_update_account_deletion_requestが、pendingへ戻す場合にprocessed_atをNULLへ戻していない",
  );
  assert.ok(
    /processed_by\s*=\s*case when p_status = 'pending' then null else auth\.uid\(\) end/.test(migration0077),
    "0077のadmin_update_account_deletion_requestが、pendingへ戻す場合にprocessed_byをNULLへ戻していない",
  );
  assert.ok(
    migration0077.includes("admin_memoの更新はstatus変更の成否と独立しており、completed済みの行に"),
    "0077に、completed済みの行でもadmin_memoの追記・修正は可能という方針の説明がない",
  );
}
console.log("PASS: admin_update_account_deletion_requestが、同じstatusへの変更では処理日時等を更新せず、rejected→pendingでは処理日時・処理者をNULLへ戻す構成になっている");

// 46（管理画面：現在と同じ状態のボタンをdisabledにする）：
//    /admin/account-deletion-requestsが、r.status === sの場合にボタンを
//    disabledにしていることを確認する。
{
  const disabledExprMatch = accountDeletionRequestsAdminPage.match(/disabled=\{([\s\S]*?)\}\s*\n\s*title=/);
  assert.ok(disabledExprMatch, "管理画面のステータス変更ボタンのdisabled式が見つからない");
  const disabledExpr = disabledExprMatch![1].replace(/\s+/g, " ");
  assert.ok(disabledExpr.includes("changingStatusId === r.id"), "管理画面のボタンが処理中の二重クリック防止を保持していない");
  assert.ok(disabledExpr.includes('r.status === "completed"'), "管理画面のボタンがcompleted時の無効化を保持していない");
  assert.ok(disabledExpr.includes("disabledForMissingUser"), "管理画面のボタンがuser_id欠落時の無効化を保持していない");
  assert.ok(disabledExpr.includes("r.status === s"), "管理画面のボタンが、現在と同じ状態の時にdisabledになっていない");
}
console.log("PASS: 管理画面のステータス変更ボタンは、現在と同じ状態の場合disabledになる");

// 47（最終整合性チェック対応：ライブ結果コメントを利用者コンテンツに含める。
//    2026-10-10：delete_own_sns_live_result_comment(0088)で本人削除が可能になった
//    ことに伴い、「本人による削除機能が無い」旨の記載を「本人が削除できる」旨へ
//    更新した）：
//    ライブ結果コメントが、利用規約（サービス内容・投稿削除ルール）・
//    プライバシーポリシー（取得する情報・保存期間・アカウント削除）の両方に
//    追加され、本人による削除（アイコンから削除可能・寄合券の返還という概念が
//    無い旨）、運営による非表示・削除、親のライブ結果・回答削除に伴う連動削除、
//    及びアカウント削除時は寄合帳の投稿とは異なり物理削除される旨が説明されている。
{
  assert.ok(termsPage.includes("ライブ結果に対するコメントの投稿機能"), "利用規約第2条にライブ結果コメント機能の記載がない");
  const postingRulesBody3 = sectionBody(termsPage, "posting-rules");
  assert.ok(
    postingRulesBody3.includes("ライブ結果へのコメントは、投稿した利用者自身が画面上のアイコンから削除できます"),
    "利用規約第6条に、ライブ結果コメントを本人が削除できる旨の記載がない",
  );
  assert.ok(
    postingRulesBody3.includes("寄合券を使用しない"),
    "利用規約第6条に、ライブ結果コメントは寄合券を使用しない（＝削除しても返還という概念が無い）旨の記載がない",
  );
  assert.ok(
    postingRulesBody3.includes("コメントの投稿先であるライブ結果又は回答が削除された場合、当該コメントも削除されることが") &&
      postingRulesBody3.includes("あります"),
    "利用規約第6条に、親のライブ結果・回答削除に伴うコメントの連動削除についての記載がない",
  );

  assert.ok(
    privacyPage.includes("ライブ結果への投稿情報"),
    "プライバシーポリシーの取得する情報に、ライブ結果コメントの記載がない",
  );
  const retentionBody3 = sectionBody(privacyPage, "retention");
  assert.ok(
    retentionBody3.includes("ライブ結果へのコメントは、投稿した利用者自身が画面上のアイコンから削除できます"),
    "プライバシーポリシーの保存期間セクションに、ライブ結果コメントを本人が削除できる旨の記載がない",
  );
  const accountDeletionBody5 = sectionBody(privacyPage, "account-deletion");
  assert.ok(
    accountDeletionBody5.includes("ライブ結果へのコメントについては、上記の寄合帳の投稿とは異なる取扱いとなっており、アカウント削除に") &&
      accountDeletionBody5.includes("伴い物理的に削除されます"),
    "プライバシーポリシーのアカウント削除セクションに、ライブ結果コメントが物理削除される旨の記載がない",
  );
}
console.log("PASS: ライブ結果コメントが利用者コンテンツとして規約・ポリシーに追加され、本人削除可能・運営非表示削除・親削除連動・アカウント削除時の物理削除という実装どおりの扱いが説明されている");

// 48（最終整合性チェック対応：取得情報・利用目的・外部サービス・公開情報・
//    運営者表示の追加修正）：同意管理情報・アカウント削除申請情報・お問い合わせ
//    情報が取得する情報へ、同意管理・請求対応が利用目的へ追加されている。
//    Google（Gmail・YouTube）が外部サービスへ追加され、Xの外部リンク用途が追記されている。
//    「利用者が自ら公開を選択した場合」という設定の存在を示唆する旧表現が無く、
//    公開機能の一覧が説明されている。運営者名の表記が「運営上の表示名」に
//    統一されている。
{
  assert.ok(privacyPage.includes("同意管理情報"), "プライバシーポリシーの取得する情報に同意管理情報の記載がない");
  assert.ok(privacyPage.includes("アカウント削除申請情報"), "プライバシーポリシーの取得する情報にアカウント削除申請情報の記載がない");
  assert.ok(privacyPage.includes("お問い合わせ情報"), "プライバシーポリシーの取得する情報にお問い合わせ情報の記載がない");
  const purposeBody2 = sectionBody(privacyPage, "purpose");
  assert.ok(purposeBody2.includes("同意の記録及び管理のため"), "プライバシーポリシーの利用目的に同意管理の記載がない");
  assert.ok(
    purposeBody2.includes("アカウント削除申請への対応のため"),
    "プライバシーポリシーの利用目的にアカウント削除申請対応の記載がない",
  );

  assert.ok(privacyPage.includes("Google（Gmail・YouTube）"), "プライバシーポリシーの外部サービスにGoogle（Gmail・YouTube）が追加されていない");
  assert.ok(
    privacyPage.includes("https://policies.google.com/privacy"),
    "プライバシーポリシーにGoogleのプライバシーポリシーへのリンクがない",
  );
  assert.ok(
    privacyPage.includes("お題提供者等の外部Xアカウントへの"),
    "プライバシーポリシーのXの利用目的に、外部Xアカウントへのリンク用途が追記されていない",
  );

  assert.ok(
    !privacyPage.includes("利用者が自ら公開を選択した場合"),
    "プライバシーポリシーに、公開設定が存在するように見える旧表現「利用者が自ら公開を選択した場合」が残っている",
  );
  const thirdPartyDisclosureBody = sectionBody(privacyPage, "third-party-disclosure");
  assert.ok(
    thirdPartyDisclosureBody.includes("演者名（表示名）、アプリアイコン、自己紹介（一言コメント）、段位（習熟度）") &&
      thirdPartyDisclosureBody.includes("未ログインの") &&
      thirdPartyDisclosureBody.includes("利用者を含む第三者が閲覧できる状態で表示する機能があります"),
    "プライバシーポリシーに、本サービスの公開機能（演者名・アイコン・自己紹介・段位・投稿・ライブ結果等）の説明がない",
  );

  assert.ok(!termsPage.includes("運営者名："), "利用規約に「運営者名：」という法的名称であるかのような旧表記が残っている");
  assert.ok(!privacyPage.includes("運営者名："), "プライバシーポリシーに「運営者名：」という法的名称であるかのような旧表記が残っている");
  assert.ok(termsPage.includes("運営上の表示名："), "利用規約が「運営上の表示名：」という表記になっていない");
  assert.ok(privacyPage.includes("運営上の表示名："), "プライバシーポリシーが「運営上の表示名：」という表記になっていない");

  assert.ok(
    !termsPage.includes("爆笑スタジアム公式X") && !privacyPage.includes("爆笑スタジアム公式X"),
    "公式SNS等の定義に、未確定のアカウント名を含意する「爆笑スタジアム公式X」という表現が残っている",
  );
  {
    const definitionPhrase = "その他運営が指定する公式SNSアカウント又は動画配信サービスのアカウント（以下「公式SNS等」といいます。）";
    assert.ok(
      sectionBody(termsPage, "content-rights").includes(definitionPhrase.replace(/\s+/g, "")) &&
        sectionBody(privacyPage, "official-x-posting").includes(definitionPhrase.replace(/\s+/g, "")),
      "公式SNS等の定義が「運営が指定する公式SNSアカウント又は動画配信サービスのアカウント」という表現になっていない",
    );
  }

  const securityBody = sectionBody(privacyPage, "security");
  assert.ok(
    securityBody.includes("安全管理に支障を及ぼすおそれがある内容を除き、ご本人からの求めに応じて、法令に従い遅滞なく回答します"),
    "プライバシーポリシーの安全管理措置セクションが、安全管理に支障のない範囲で法令に従い遅滞なく回答する旨の表現になっていない",
  );
}
console.log("PASS: 取得情報・利用目的へ同意管理・削除申請・問い合わせ情報が追加され、Google（Gmail・YouTube）が外部サービスに追加され、公開機能の説明が実装どおりに整理され、運営者表示が「運営上の表示名」に統一されている");

// 46（最終レビュー対応：安全管理措置は実装で確認できる措置だけを列挙する）：
//    「可能な範囲でご説明します」という曖昧な表現ではなく、実装が確認できている
//    5つの措置（RLS、SECURITY DEFINER関数での認証・権限確認、運営者専用画面の
//    権限制限、Supabase Authによる認証情報管理、Supabase/Vercel基盤）だけを
//    列挙し、MFA・暗号化・監視体制・社内規程等、実装で確認できていない措置は
//    記載しないことを確認する。
{
  const securityBody2 = sectionBody(privacyPage, "security");
  assert.ok(
    !securityBody2.includes("可能な範囲でご説明します"),
    "プライバシーポリシーの安全管理措置セクションに、曖昧な旧表現「可能な範囲でご説明します」が残っている",
  );
  const confirmedMeasures = [
    "RowLevelSecurity",
    "SECURITYDEFINER関数",
    "運営者専用の画面・操作を運営者アカウントに限定する権限制御",
    "SupabaseAuth",
    "Supabase・Vercelの利用",
  ];
  for (const measure of confirmedMeasures) {
    assert.ok(
      securityBody2.includes(measure),
      `プライバシーポリシーの安全管理措置セクションに、実装で確認できている措置「${measure}」の記載がない`,
    );
  }
  const unconfirmedMeasures = ["MFA", "多要素認証", "二要素認証", "暗号化", "監視体制", "社内規程", "ISO"];
  for (const measure of unconfirmedMeasures) {
    assert.ok(
      !securityBody2.includes(measure),
      `プライバシーポリシーの安全管理措置セクションに、実装で確認できていない措置「${measure}」が推測で記載されている`,
    );
  }
}
console.log("PASS: 安全管理措置セクションが、実装で確認できている5つの措置だけを列挙し、未確認の措置（MFA・暗号化・監視体制・社内規程等）を記載しない構成になっている");

// 47（最終レビュー対応：アカウント削除の本人確認を安全にする）：メールでの
//    削除依頼において、演者名（表示名）等の公開情報だけでは本人確認にならない
//    旨が明記され、公開情報のみを本人確認の根拠とする旧来の代替手段（演者名等の
//    記載で足りるとする表現）が残っていないことを確認する。
{
  const accountDeletionBody5 = sectionBody(privacyPage, "account-deletion");
  assert.ok(
    !accountDeletionBody5.includes("演者名（表示名）等、ご本人であることが分かる範囲の情報をご記載ください"),
    "プライバシーポリシーに、公開情報（演者名等）だけで本人確認の代替とする旧表現が残っている",
  );
  assert.ok(
    accountDeletionBody5.includes("一般に公開されている情報だけでは、ご本人からのご依頼であることの確認にはなりません"),
    "プライバシーポリシーに、公開情報だけでは本人確認にならない旨の記載がない",
  );
  assert.ok(
    accountDeletionBody5.includes("ご本人であることを確認できない場合、削除のご依頼にお応えできないことがあります"),
    "プライバシーポリシーに、本人確認ができない場合は削除に対応できないことがある旨の記載がない",
  );
}
console.log("PASS: アカウント削除依頼において、公開情報だけでは本人確認にならない旨、及び確認できない場合は削除に対応できないことがある旨が明記されている");

// 48（最終レビュー対応：管理画面に公開情報だけでの削除判断を戒める注意書き）：
//    アカウント削除申請の管理画面（/admin/account-deletion-requests）に、
//    演者名・Xの@ID等の公開情報だけを根拠に本人からの依頼と判断して削除して
//    はいけない旨の注意書きがあることを確認する。
{
  const adminDeletionRequestsPage = read("src", "app", "admin", "account-deletion-requests", "page.tsx");
  assert.ok(
    adminDeletionRequestsPage.includes("一般に公開されている情報だけを") &&
      adminDeletionRequestsPage.includes("なりすましの可能性があります"),
    "管理画面（アカウント削除申請）に、公開情報だけを根拠に削除しないよう注意する記載がない",
  );
}
console.log("PASS: アカウント削除申請の管理画面に、公開情報だけを根拠に本人からの依頼と判断して削除してはいけない旨の注意書きがある");

// 49（最終レビュー対応：アカウント削除後も残る情報を正確に記載）：0077の
//    account_deletion_requestsが削除後も申請番号・処理状況等をuser_id=NULLの
//    状態で保持することと、Gmailで受信した問い合わせ・削除依頼メールの対応記録が
//    保持されることを、プライバシーポリシーの保存期間セクションが明記している。
{
  const retentionBody2 = sectionBody(privacyPage, "retention") + sectionBody(privacyPage, "account-deletion");
  assert.ok(
    retentionBody2.includes("アカウント削除申請の記録") && retentionBody2.includes("利用者IDがNULLとなった状態で保持"),
    "プライバシーポリシーに、アカウント削除申請の記録が利用者ID=NULLの状態で保持される旨の記載がない",
  );
  assert.ok(
    retentionBody2.includes("Gmail") && retentionBody2.includes("削除のご依頼のメール"),
    "プライバシーポリシーに、Gmailで受信した削除依頼メール・対応記録が保持される旨の記載がない",
  );
  assert.ok(
    retentionBody2.includes("保持の必要がなくなった時点で削除します"),
    "プライバシーポリシーに、保持後は不要になった時点で削除する旨の記載がない",
  );
}
console.log("PASS: プライバシーポリシーに、アカウント削除申請の記録（user_id=NULL化後も保持）及びGmailの削除依頼メール対応記録の保持と、不要になった時点での削除方針が明記されている");

// 50（最終レビュー対応：localStorageの説明を実装(useUserStore)に合わせる）：
//    useUserStoreが実際に永続化している全項目（表示名・アイコン・一言コメント・
//    段位/ポイント等の仮データ・ライブ参加回数・表彰回数・ベストアンサー回数・
//    所持アイテム/装備情報）が、Cookie・ローカルストレージ説明に反映されている。
{
  const cookiesBody2 = sectionBody(privacyPage, "cookies");
  const useUserStoreFields = [
    "表示名",
    "アイコンの種類・色",
    "一言コメント",
    "段位（習熟度）",
    "ライブ参加回数",
    "表彰回数",
    "ベストアンサー回数",
    "所持しているアイテム・装備情報",
  ];
  for (const field of useUserStoreFields) {
    assert.ok(
      cookiesBody2.includes(field),
      `プライバシーポリシーのローカルストレージ説明に、useUserStoreが実際に保存している項目「${field}」の記載がない`,
    );
  }
  assert.ok(
    cookiesBody2.includes("Supabase側の正式な記録とは別の、端末内だけの仮の記録"),
    "プライバシーポリシーのローカルストレージ説明が、Supabase側の正式な記録とは別の端末内だけの仮の記録である旨を明記していない",
  );
}
console.log("PASS: ローカルストレージの説明が、useUserStoreが実際に永続化している全項目（表示名・アイコン・一言コメント・段位/ポイント等の仮データ・参加回数・表彰回数・ベストアンサー回数・所持アイテム/装備情報）を反映している");

// 51（第8条の実質改定：掲載先・対象・目的の拡張）：利用規約第8条・プライバシーポリシーの
//    「投稿内容の公式SNS等への掲載について」の両方に、X以外の具体的な掲載先
//    （YouTube・TikTok・Instagram）、拡張された対象投稿等（称号・アイコン・
//    ライブ結果へのコメント・リアクション・ライブ画面/結果画面）、及び拡張された
//    利用目的（紹介・広報・宣伝・記録・振り返り）が明記されている。
{
  const contentRightsBody2 = sectionBody(termsPage, "content-rights");
  const officialSnsBody = sectionBody(privacyPage, "official-x-posting");
  for (const platform of ["YouTube", "TikTok", "Instagram"]) {
    assert.ok(contentRightsBody2.includes(platform), `利用規約第8条に掲載先「${platform}」の記載がない`);
    assert.ok(officialSnsBody.includes(platform), `プライバシーポリシーの公式SNS等掲載セクションに掲載先「${platform}」の記載がない`);
  }
  assert.ok(
    contentRightsBody2.includes("選択中の称号") && contentRightsBody2.includes("アイコン（限定アイコンを含む）"),
    "利用規約第8条の対象投稿等に、選択中の称号・アイコン（限定アイコンを含む）が追加されていない",
  );
  assert.ok(
    contentRightsBody2.includes("ライブ結果へのコメント") || contentRightsBody2.includes("ライブ結果へのコメントの内容"),
    "利用規約第8条の対象投稿等に、ライブ結果へのコメントが追加されていない",
  );
  assert.ok(
    contentRightsBody2.includes("ライブ中の「爆笑」「ツッコミ」「拍手」等のリアクション"),
    "利用規約第8条の対象投稿等に、ライブ中のリアクションが追加されていない",
  );
  assert.ok(
    contentRightsBody2.includes("ライブ画面及び結果画面その他本サービスの画面"),
    "利用規約第8条の対象投稿等に、ライブ画面・結果画面が追加されていない",
  );
  assert.ok(
    contentRightsBody2.includes("紹介、広報、宣伝、記録並びに振り返りを目的として"),
    "利用規約第8条の利用目的が「紹介、広報、宣伝、記録並びに振り返り」に拡張されていない",
  );
  assert.ok(
    officialSnsBody.includes("紹介、広報、宣伝、記録並びに振り返りのため"),
    "プライバシーポリシーの公式SNS等掲載セクションの目的が「紹介、広報、宣伝、記録並びに振り返り」に拡張されていない",
  );
}
console.log("PASS: 利用規約第8条・プライバシーポリシーの公式SNS等掲載セクションに、YouTube・TikTok・Instagram等の掲載先、称号・アイコン・ライブ結果コメント・リアクション・画面等の対象拡張、紹介・広報・宣伝・記録・振り返りという目的の拡張が反映されている");

// 52（第8条の実質改定：利用態様・非独占的無償許諾・著作権不移転）：利用規約第8条に、
//    抜粋・切り抜き・編集等の具体的な利用態様と、無償かつ非独占的な許諾であって
//    著作権が運営へ移転しない旨が明記されている。
{
  const contentRightsBody3 = sectionBody(termsPage, "content-rights");
  for (const verb of ["抜粋", "切り抜き", "編集", "トリミング", "サイズ変更", "字幕", "BGM", "効果音"]) {
    assert.ok(contentRightsBody3.includes(verb), `利用規約第8条に利用態様「${verb}」の記載がない`);
  }
  assert.ok(
    contentRightsBody3.includes("無償かつ非独占的に対象投稿等の利用を許諾する"),
    "利用規約第8条に、無償かつ非独占的な許諾である旨の記載がない",
  );
  assert.ok(
    contentRightsBody3.includes("この許諾によって対象投稿等の著作権が運営へ移転するものではありません"),
    "利用規約第8条に、著作権が運営へ移転しない旨（譲渡ではないこと）の記載がない",
  );
}
console.log("PASS: 利用規約第8条に、抜粋・切り抜き・編集等の具体的な利用態様と、無償かつ非独占的で著作権を運営へ移転しない許諾である旨が明記されている");

// 53（第8条の実質改定：名誉毀損等の禁止、及び顔・声・メールアドレス・内部IDの
//    掲載対象からの除外）：利用規約第8条・プライバシーポリシーの公式SNS等掲載
//    セクションの両方に、名誉・信用を不当に害する態様等での使用禁止と、顔写真・
//    実写映像・肉声・メールアドレス・認証ID・内部ユーザーIDを掲載対象に含めない旨が
//    明記されている。
{
  const contentRightsBody4 = sectionBody(termsPage, "content-rights");
  const officialSnsBody2 = sectionBody(privacyPage, "official-x-posting");
  for (const [name, body] of [
    ["利用規約第8条", contentRightsBody4],
    ["プライバシーポリシーの公式SNS等掲載セクション", officialSnsBody2],
  ] as const) {
    assert.ok(
      body.includes("名誉") && (body.includes("信用を不当に害する") || body.includes("信用を不当に害する態様")),
      `${name}に、名誉・信用を不当に害する態様での使用を禁止する旨の記載がない`,
    );
    assert.ok(body.includes("誹謗中傷"), `${name}に、誹謗中傷目的での使用を禁止する旨の記載がない`);
    for (const excluded of ["顔写真", "実写映像", "肉声", "メールアドレス", "認証ID", "内部ユーザーID"]) {
      assert.ok(body.includes(excluded), `${name}に、掲載対象から除外する情報「${excluded}」の記載がない`);
    }
  }
}
console.log("PASS: 利用規約第8条・プライバシーポリシーの公式SNS等掲載セクションの両方に、名誉毀損的な使用の禁止と、顔写真・実写映像・肉声・メールアドレス・認証ID・内部ユーザーIDを掲載対象に含めない旨が明記されている");

// 54（第8条の実質改定：将来の顔・声機能への別途同意、動画配信サービスの遡及不適用、
//    掲載後の各プラットフォーム規約への言及）：利用規約第8条に、将来顔・声を用いる
//    機能を追加する場合は本条の許諾に含めず別途明示同意を得る旨が明記され、
//    利用規約第1条・プライバシーポリシーの両方に、動画配信サービスへの掲載が
//    今回の改定の効力発生日以後の投稿にのみ適用される旨（新バージョンへ同意する
//    前の過去コンテンツを新しい用途に使わない前提）が明記されている。プライバシー
//    ポリシーには、掲載後は各プラットフォームの規約・プライバシーポリシーに従って
//    取り扱われる旨も明記されている。
{
  const contentRightsBody5 = sectionBody(termsPage, "content-rights");
  assert.ok(
    contentRightsBody5.includes("顔又は声を用いる機能を追加する場合") &&
      contentRightsBody5.includes("別途利用者から明示的な同意を取得します"),
    "利用規約第8条に、将来顔・声を用いる機能を追加する場合は本条の許諾に含めず別途明示同意を得る旨の記載がない",
  );

  // sectionBodyは.tsxソースファイルをそのまま読んだ文字列であり、{TERMS_LAST_REVISED_ON}は
  // レンダリング結果の日付文字列ではなくJSX式のリテラルとしてそのまま現れる（この検査は
  // 静的なソース検査であり、実際にレンダリングはしない）。TERMS_LAST_REVISED_ONがnullなら
  // そもそも改定日が無い＝この条項が書けないはずなので、その場合は必ず失敗させる。
  assert.ok(TERMS_LAST_REVISED_ON !== null, "利用規約が改定されたはずなのにTERMS_LAST_REVISED_ONがnull(未改定)のままになっている");
  console.log(
    "PASS: 利用規約第8条に将来の顔・声機能への別途同意方針が明記され、TERMS_LAST_REVISED_ONが今回の改定日を持っている",
  );
}

// 54b（2026-09-28再レビュー対応：適用条件を「日付だけ」ではなく「新バージョンへの
//    同意後」にする）：動画配信サービスへの短尺動画掲載の許諾は、(a)効力発生日以後に
//    生成されたこと、(b)生成した利用者がその時点でTERMS_VERSION/PRIVACY_VERSIONへの
//    同意を完了していたこと、の両方を満たす対象投稿等にのみ適用される（日付のみの
//    条件ではない）。対象は「投稿内容」ではなく対象投稿等（得点・順位・リアクション・
//    ライブ画面等を含む）全体であることが利用規約第1条・プライバシーポリシーの
//    両方で明記され、かつ、既に成立していた公式Xへの掲載許諾（日付条件のみ）とは
//    別の許諾として混同されていないことを確認する。
{
  const scopeBody4 = sectionBody(termsPage, "scope");
  const officialSnsBody3 = sectionBody(privacyPage, "official-x-posting");

  // (a) 効力発生日の条件が両方にある。2026-10-14：効力発生日は現在の法務文書の
  //     改定日（TERMS_LAST_REVISED_ON/PRIVACY_LAST_REVISED_ON）ではなく、短尺動画専用の
  //     固定定数SHORT_VIDEO_LICENSE_EFFECTIVE_ONを使う（無関係な改定で移動させない）。
  for (const [name, body] of [
    ["利用規約第1条", scopeBody4],
    ["プライバシーポリシー", officialSnsBody3],
  ] as const) {
    assert.ok(
      body.includes("効力発生日である{SHORT_VIDEO_LICENSE_EFFECTIVE_ON}以後に生成された"),
      `${name}に、動画配信サービスへの掲載が効力発生日（SHORT_VIDEO_LICENSE_EFFECTIVE_ON）以後に生成された対象投稿等に限られる旨の記載がない`,
    );
    assert.ok(
      !body.includes("{TERMS_LAST_REVISED_ON}以後に生成された") && !body.includes("{PRIVACY_LAST_REVISED_ON}以後に生成された"),
      `${name}の短尺動画の効力発生日が、現在の法務文書の改定日を流用している`,
    );
  }

  // (b) 許可バージョンへの同意完了という、日付とは別のもう一つの条件が両方にある。
  //     2026-10-14：現在のTERMS_VERSION/PRIVACY_VERSIONではなく、短尺動画専用の許可
  //     バージョン一覧（SHORT_VIDEO_LICENSE_CONSENT_VERSIONS）から文言を生成する。
  for (const [name, body, termsLabel] of [
    ["利用規約第1条", scopeBody4, "本規約"],
    ["プライバシーポリシー", officialSnsBody3, "利用規約"],
  ] as const) {
    assert.ok(
      body.includes(`{formatShortVideoLicenseConsentVersions("${termsLabel}")}`) &&
        body.includes("いずれかへの同意を完了していたこと"),
      `${name}に、動画配信サービスへの掲載が「許可バージョンのいずれかへ同意した後」の対象投稿等に限られる旨の記載がない（日付だけの条件になっている）`,
    );
    assert.ok(
      !body.includes("{TERMS_VERSION}") && !body.includes("{PRIVACY_VERSION}"),
      `${name}の短尺動画の条項が、現在の法務文書バージョン（TERMS_VERSION/PRIVACY_VERSION）を流用している`,
    );
  }
  assert.ok(
    scopeBody4.includes("{SHORT_VIDEO_LICENSE_EFFECTIVE_ON}改定（利用規約バージョン{SHORT_VIDEO_LICENSE_REVISION_TERMS_VERSION}") &&
      scopeBody4.includes("プライバシーポリシーバージョン{SHORT_VIDEO_LICENSE_REVISION_PRIVACY_VERSION}。以下本項において「本改定」"),
    "利用規約第1条の「本改定」が短尺動画許諾を追加した改定（専用定数）を指していない",
  );

  // 「投稿内容」ではなく「対象投稿等」全体（得点・順位・リアクション・ライブ画面等を
  // 含む）が対象になっていることの確認（第8条で定義した対象投稿等をそのまま参照する
  // 構成になっているか、日付条件の文中で対象投稿等という語を使っているかを見る）。
  assert.ok(scopeBody4.includes("対象投稿等"), "利用規約第1条の適用条件が「対象投稿等」という語を使っておらず、得点・順位・リアクション等が対象に含まれるか不明確になっている");
  assert.ok(officialSnsBody3.includes("対象投稿等"), "プライバシーポリシーの適用条件が「対象投稿等」という語を使っておらず、得点・順位・リアクション等が対象に含まれるか不明確になっている");

  // 公式Xへの既存許諾（日付条件のみ）と、動画配信サービスへの新許諾（日付＋同意の
  // 両方の条件）を混同していない（別の許諾として明記されている）。
  assert.ok(
    scopeBody4.includes("とは別の許諾であり、これを拡張又は代替するものではありません"),
    "利用規約第1条に、動画配信サービスへの許諾が公式Xへの既存許諾とは別のものである旨の記載がない",
  );
  assert.ok(
    officialSnsBody3.includes("公式Xへの掲載について既に成立していた前項の許諾とは別の、新たな許諾であり"),
    "プライバシーポリシーに、動画配信サービスへの許諾が公式Xへの既存許諾とは別のものである旨の記載がない",
  );

  assert.ok(
    officialSnsBody3.includes("各プラットフォームが定める利用規約及びプライバシーポリシーに従って取り扱われます"),
    "プライバシーポリシーに、公式SNS等へ掲載された情報は各プラットフォームの規約・ポリシーに従って取り扱われる旨の記載がない",
  );

  // 10月3日の初回本番ライブは全参加者が新バージョンへ同意してから参加するため、
  // そのライブで生成された対象投稿等は同意後の生成物として切り抜き対象にできる
  // （＝(a)(b)の両条件を満たせば対象になる、という構成そのものがこれを可能にする）。
  // ここでは、条件が「同意前を除外する」netの表現であり「10/3以降を一律除外する」
  // ような誤読を招く書き方になっていないことを確認する（両条件を満たせば対象、と
  // 読める構成になっていること＝「いずれも満たす」という論理積の表現を使っている）。
  assert.ok(scopeBody4.includes("次のいずれも満たす対象投稿等についてのみ適用されます"), "利用規約第1条の動画配信サービス条項が、両条件を満たす場合に対象となる（論理積）という表現になっていない");
  assert.ok(officialSnsBody3.includes("次のいずれも満たす対象投稿等に"), "プライバシーポリシーの動画配信サービス条項が、両条件を満たす場合に対象となる（論理積）という表現になっていない");
}
console.log("PASS: 動画配信サービスへの短尺動画掲載の適用条件が、効力発生日だけでなく利用者がTERMS_VERSION/PRIVACY_VERSIONへ同意した後であることも要求する二重条件になっており、対象は「投稿内容」ではなく対象投稿等全体（得点・順位・リアクション・ライブ画面等を含む）であり、公式Xへの既存許諾とは別の許諾として整理されている");

// 55（外部サービス欄へYouTube・TikTok・Instagramを追加）：プライバシーポリシーの
//    「外部サービスの利用」に、Google（Gmail・YouTube）・TikTok・Instagramが
//    追加され、それぞれ公式プライバシーポリシーへのリンクを持つ。Xの説明にも
//    公式投稿の掲載先である旨が追記されている。SDK・解析機能を組み込んでいる
//    ような誤解を招く表現ではなく、掲載先としての利用である旨が明記され、国外
//    処理の説明にもこれらのサービスが反映されている。
{
  const thirdPartyServicesBody2 = sectionBody(privacyPage, "third-party-services");
  assert.ok(thirdPartyServicesBody2.includes("Google（Gmail・YouTube）"), "プライバシーポリシーの外部サービスにGoogle（Gmail・YouTube）の記載がない");
  assert.ok(thirdPartyServicesBody2.includes("TikTok"), "プライバシーポリシーの外部サービスにTikTokの記載がない");
  assert.ok(
    thirdPartyServicesBody2.includes("Instagram"),
    "プライバシーポリシーの外部サービスにInstagramの記載がない",
  );
  assert.ok(privacyPage.includes('href="https://www.tiktok.com/legal/privacy-policy"'), "プライバシーポリシーにTikTokの公式プライバシーポリシーへのリンクがない");
  assert.ok(privacyPage.includes('href="https://privacycenter.instagram.com/policy/"'), "プライバシーポリシーにInstagramの公式プライバシーポリシーへのリンクがない");
  assert.ok(
    thirdPartyServicesBody2.includes("公式投稿の掲載先として利用"),
    "プライバシーポリシーのXの説明に、公式投稿の掲載先でもある旨の記載がない",
  );
  assert.ok(
    thirdPartyServicesBody2.includes("これらのSDKや解析機能等を組み込んでいる") &&
      thirdPartyServicesBody2.includes("掲載先として利用しているものです"),
    "プライバシーポリシーに、YouTube・TikTok・InstagramのSDK等をアプリへ組み込んでいるという誤解を招かない説明がない",
  );
  assert.ok(
    thirdPartyServicesBody2.includes("Google（YouTubeを含む）") &&
      thirdPartyServicesBody2.includes("TikTok") &&
      thirdPartyServicesBody2.includes("Instagram（MetaPlatforms"),
    "プライバシーポリシーの国外処理事業者の説明に、Google（YouTube）・TikTok・Instagram（Meta）が反映されていない",
  );
  // バージョンは、外部サービス欄の追加（このブロックの検証対象）だけを理由に
  // 独自に上げていないことを確認する。2026-10-10：ライブ結果コメント自己削除
  // 機能の追加で別の理由からバージョンが更に進んだため、期待値もその現在の
  // 最終値（src/lib/legalInfo.ts）へ更新した（この外部サービス欄の追加自体は
  // 今回も版を進める理由になっていない）。
  // 2026-10-14：流入アンケートの記載改定・短尺動画の同意条件の文言改定で
  // TERMS_VERSION/PRIVACY_VERSIONが2026-10-14-v4/2026-10-14-v5へ進んだ。
  assert.equal(TERMS_VERSION, "2026-10-14-v4", "外部サービス欄の追加に伴いTERMS_VERSIONが意図せず変更されている");
  assert.equal(PRIVACY_VERSION, "2026-10-14-v5", "外部サービス欄の追加に伴いPRIVACY_VERSIONが意図せず変更されている");
}
console.log("PASS: プライバシーポリシーの外部サービス欄にGoogle（Gmail・YouTube）・TikTok・Instagramが公式プライバシーポリシーへのリンク付きで追加され、Xも公式投稿の掲載先である旨が追記され、SDK組み込みと誤解されない説明と国外処理事業者への反映があり、バージョン・改定日はさらに変更されていない");

// 56（2026-09-28、0083適用と新フロントエンドのデプロイ順序に依存しない世代付き
//    同意RPCへの切替）：0083が新RPC record_terms_consent_v2(text, text)を新設し、
//    クライアントの期待バージョンとDBの現在値が一致しない場合はVERSION_MISMATCHで
//    拒否し同意行を作らないこと、旧RPC record_terms_consent()（0076、引数なし）を
//    create or replaceして常にCLIENT_UPDATE_REQUIREDで拒否する安全な互換停止状態に
//    していること、0082には一切触れていないことを確認する。あわせて、新アプリの
//    同意記録経路（ConsentRequiredGate・useConsentGateStore）がすべて新RPCへ統一
//    され、VERSION_MISMATCH/CLIENT_UPDATE_REQUIREDを生のDBエラーのまま見せず、
//    再読み込みを促す専用の案内へ変換していることを確認する。
{
  const migration0083b = read("supabase", "migrations", "0083_legal_short_video_consent.sql");
  const consentVersionError = read("src", "lib", "consentVersionError.ts");

  assert.ok(
    /create or replace function public\.record_terms_consent_v2\(\s*p_expected_terms_version text,\s*p_expected_privacy_version text\s*\)/.test(
      migration0083b.replace(/\r/g, ""),
    ) || /create or replace function public\.record_terms_consent_v2\(/.test(migration0083b),
    "0083がrecord_terms_consent_v2(text, text)を新設していない",
  );
  assert.ok(migration0083b.includes("raise exception 'NOT_LOGGED_IN'"), "record_terms_consent_v2がNOT_LOGGED_INを確認していない");
  assert.ok(
    (migration0083b.match(/raise exception 'VERSION_MISMATCH'/g) ?? []).length >= 1,
    "record_terms_consent_v2がVERSION_MISMATCHで拒否する分岐を持っていない",
  );
  assert.ok(
    migration0083b.includes("from public.current_legal_document_versions()"),
    "record_terms_consent_v2がDBのcurrent_legal_document_versions()から現在値を取得していない（クライアント引数をそのまま信用している可能性）",
  );
  assert.ok(
    /insert into public\.terms_consents \(user_id, terms_version, privacy_version\)\s*\n\s*values \(v_uid, v_current_terms, v_current_privacy\)/.test(
      migration0083b,
    ),
    "record_terms_consent_v2が、記録時にクライアント引数(p_expected_*)ではなくDBから取得し直した値(v_current_*)を使っていない",
  );
  assert.ok(
    migration0083b.includes("on conflict (user_id, terms_version, privacy_version) do nothing"),
    "record_terms_consent_v2が既存のUNIQUE制約・ON CONFLICT DO NOTHINGを維持していない",
  );
  assert.ok(
    /revoke execute on function public\.record_terms_consent_v2\(text, text\) from public/.test(migration0083b) &&
      /revoke execute on function public\.record_terms_consent_v2\(text, text\) from anon/.test(migration0083b) &&
      /grant execute on function public\.record_terms_consent_v2\(text, text\) to authenticated/.test(migration0083b),
    "record_terms_consent_v2の権限が、PUBLIC/anonからrevoke・authenticatedへのみgrantになっていない",
  );

  // 旧RPCの安全な互換停止：引数なし・returns voidのシグネチャは変えず
  // （0076のGRANTを維持するため）、本体だけをCLIENT_UPDATE_REQUIRED固定にしている。
  const legacyFnMatch = migration0083b.match(/create or replace function public\.record_terms_consent\(\)[\s\S]*?\$\$;/);
  assert.ok(legacyFnMatch, "0083が旧record_terms_consent()（引数なし）をcreate or replaceしていない");
  const legacyFnBody = legacyFnMatch![0];
  assert.ok(legacyFnBody.includes("raise exception 'CLIENT_UPDATE_REQUIRED'"), "旧record_terms_consent()がCLIENT_UPDATE_REQUIREDで拒否するようになっていない");
  assert.ok(
    !legacyFnBody.includes("insert into public.terms_consents") && !legacyFnBody.includes("terms_consents"),
    "旧record_terms_consent()が、互換停止後もterms_consentsへ書き込む経路を残している",
  );
  assert.ok(
    !migration0083b.includes("drop function if exists public.record_terms_consent()"),
    "0083が旧record_terms_consent()をdropしている（シグネチャ不変のためcreate or replaceで0076のGRANTを維持すべき）",
  );

  // 0082（称号表示機能）には一切触れていない（説明コメント中の言及は除き、
  // 実際にその関数・テーブルを再定義・変更するSQL文が無いことを確認する）。
  assert.ok(
    !/create (?:or replace )?function public\.sns_author_names/.test(migration0083b) &&
      !/drop function if exists public\.sns_author_names/.test(migration0083b) &&
      !/alter table public\.(?:titles|profiles)\b/.test(migration0083b),
    "0083が0082の称号表示機能（sns_author_names等）を実際に再定義・変更している",
  );

  // 新アプリの同意記録経路はすべて新RPCへ統一され、旧RPC名は直接呼んでいない。
  for (const [name, src] of [
    ["ConsentRequiredGate", consentRequiredGate],
    ["useConsentGateStore", consentGateStore],
  ] as const) {
    assert.ok(src.includes('supabase.rpc("record_terms_consent_v2"'), `${name}がrecord_terms_consent_v2を呼んでいない`);
    assert.ok(
      !/supabase\.rpc\("record_terms_consent"\)/.test(src),
      `${name}が退役済みの旧RPC(record_terms_consent、引数なし)をまだ直接呼んでいる`,
    );
    assert.ok(
      src.includes("p_expected_terms_version: TERMS_VERSION") && src.includes("p_expected_privacy_version: PRIVACY_VERSION"),
      `${name}がrecord_terms_consent_v2へ、画面が表示している現在のTERMS_VERSION/PRIVACY_VERSIONを期待値として渡していない`,
    );
  }

  // VERSION_MISMATCH/CLIENT_UPDATE_REQUIREDは生のDBエラーのまま見せず、専用の
  // 案内文言へ変換される（consentVersionError.tsの共通ヘルパー経由）。
  assert.ok(
    consentVersionError.includes("VERSION_MISMATCH") && consentVersionError.includes("CLIENT_UPDATE_REQUIRED"),
    "consentVersionError.tsがVERSION_MISMATCH/CLIENT_UPDATE_REQUIREDの両方を検知していない",
  );
  assert.ok(
    !/[「『]VERSION_MISMATCH[」』]|生のVERSION_MISMATCH/.test(consentVersionError) &&
      /規約情報が更新されました/.test(consentVersionError),
    "consentVersionError.tsの案内文言が、再読み込みを促す内容になっていない",
  );
  for (const [name, src] of [
    ["ConsentRequiredGate", consentRequiredGate],
    ["useConsentGateStore", consentGateStore],
  ] as const) {
    assert.ok(
      src.includes("isConsentVersionMismatchError") && src.includes("CONSENT_VERSION_RELOAD_MESSAGE"),
      `${name}がVERSION_MISMATCH/CLIENT_UPDATE_REQUIREDを専用の案内文言へ変換する共通ヘルパーを使っていない`,
    );
  }
}
console.log("PASS: 0083がクライアントの期待バージョンとDBの現在値が完全一致する場合だけ記録する新RPC(record_terms_consent_v2)を新設し、旧RPCを安全な互換停止（CLIENT_UPDATE_REQUIRED固定・同意行を作らない）にし、0082には触れておらず、新アプリの同意記録経路はすべて新RPCへ統一され、VERSION_MISMATCH/CLIENT_UPDATE_REQUIREDは生のDBエラーではなく再読み込みを促す専用の案内文言に変換される");

// 57（2026-10-14、0090：利用規約v4・プライバシーポリシーv5と短尺動画許諾の分離）：
//    - プライバシーポリシーの流入アンケートの記載が新しい5択と一致する。
//    - 短尺動画許諾の効力発生日（2026年10月10日）・「本改定」の版（v3/v4）・許可
//      バージョンの組（過去分v3+v4・現在分v4+v5）が専用定数として固定され、現在のTERMS_VERSION/
//      PRIVACY_VERSIONの組を含む（追記漏れで新規利用者が対象外にならない）。
//    - 画面の条項文言・フロントの判定関数・DB側（0090）の判定が同じ値を使う。
{
  const surveyItem = privacyPage.slice(privacyPage.indexOf("アンケート回答"), privacyPage.indexOf("シェアボタンの利用記録"));
  assert.ok(surveyItem.includes("（X／YouTube／TikTok／友人／その他）"), "プライバシーポリシーの流入アンケートの選択肢が新しい5択と一致しない");
  assert.ok(!surveyItem.includes("友人・知人の紹介／アプリ内"), "プライバシーポリシーに流入アンケートの旧選択肢の列挙が残っている");

  assert.equal(SHORT_VIDEO_LICENSE_EFFECTIVE_ON, "2026年10月10日");
  assert.equal(SHORT_VIDEO_LICENSE_EFFECTIVE_FROM, "2026-10-10T00:00:00+09:00");
  assert.equal(SHORT_VIDEO_LICENSE_REVISION_TERMS_VERSION, "2026-10-10-v3");
  assert.equal(SHORT_VIDEO_LICENSE_REVISION_PRIVACY_VERSION, "2026-10-10-v4");
  assert.deepEqual(SHORT_VIDEO_LICENSE_CONSENT_VERSIONS, [
    { termsVersion: "2026-10-10-v3", privacyVersion: "2026-10-10-v4" },
    { termsVersion: "2026-10-14-v4", privacyVersion: "2026-10-14-v5" },
  ]);
  // 未適用の中間案（terms v3＋privacy v5）は許可の組に含めない。
  assert.ok(
    !SHORT_VIDEO_LICENSE_CONSENT_VERSIONS.some((v) => v.termsVersion === "2026-10-10-v3" && v.privacyVersion === "2026-10-14-v5"),
    "中間案（terms v3＋privacy v5）が短尺動画の許可の組に含まれている",
  );
  assert.ok(
    SHORT_VIDEO_LICENSE_CONSENT_VERSIONS.some((v) => v.termsVersion === TERMS_VERSION && v.privacyVersion === PRIVACY_VERSION),
    "現在のTERMS_VERSION/PRIVACY_VERSIONの組が短尺動画の許可バージョン一覧に無い（法務文書の改定時に追記が必要）",
  );
  // 法務文書の改定日（2026年10月14日）と短尺動画の効力発生日（2026年10月10日）は別の値。
  assert.equal(TERMS_LAST_REVISED_ON, "2026年10月14日");
  assert.notEqual(SHORT_VIDEO_LICENSE_EFFECTIVE_ON, TERMS_LAST_REVISED_ON, "短尺動画の効力発生日が利用規約の改定日に連動している");

  // 画面の条項文言（利用規約・プライバシーポリシーで同じ一覧から生成）。
  assert.equal(
    formatShortVideoLicenseConsentVersions("本規約"),
    "本規約バージョン2026-10-10-v3及びプライバシーポリシーバージョン2026-10-10-v4、又は本規約バージョン2026-10-14-v4及びプライバシーポリシーバージョン2026-10-14-v5",
  );

  // DB側（0090）の判定が同じ効力発生日・許可バージョンの組を使う。
  const migration0090 = read("supabase", "migrations", "0090_referral_source_youtube_tiktok.sql");
  assert.ok(migration0090.includes("select '2026-10-10 00:00:00+09'::timestamptz;"), "0090の短尺動画の効力発生日がフロントと一致しない");
  for (const v of SHORT_VIDEO_LICENSE_CONSENT_VERSIONS) {
    assert.ok(
      migration0090.includes(`('${v.termsVersion}'::text, '${v.privacyVersion}'::text)`),
      `0090の短尺動画の許可バージョン一覧に${v.termsVersion}/${v.privacyVersion}が無い`,
    );
  }

  // フロントの判定関数（DBテスト0090_privacy_v5_and_short_video_license.test.sqlと同じシナリオ）。
  const at = (iso: string) => new Date(iso);
  const v4 = (consentedAt: string) => ({ termsVersion: "2026-10-10-v3", privacyVersion: "2026-10-10-v4", consentedAt: at(consentedAt) });
  const v5 = (consentedAt: string) => ({ termsVersion: "2026-10-14-v4", privacyVersion: "2026-10-14-v5", consentedAt: at(consentedAt) });
  const existing = [v4("2026-10-10T09:00:00+09:00")];
  assert.equal(isShortVideoLicenseApplicable(at("2026-10-11T20:00:00+09:00"), existing), true, "v4同意者の10/11生成物が対象外");
  assert.equal(isShortVideoLicenseApplicable(at("2026-10-13T23:59:59+09:00"), existing), true, "v4同意者の10/13生成物が対象外");
  assert.equal(isShortVideoLicenseApplicable(at("2026-10-14T00:00:00+09:00"), existing), true, "v4同意者の10/14生成物が対象外");
  assert.equal(isShortVideoLicenseApplicable(at("2026-10-10T08:59:59+09:00"), existing), false, "同意前の生成物が対象になった");
  const newcomer = [v5("2026-10-15T10:00:00+09:00")];
  assert.equal(isShortVideoLicenseApplicable(at("2026-10-15T11:00:00+09:00"), newcomer), true, "v5同意者の同意後の生成物が対象外");
  assert.equal(isShortVideoLicenseApplicable(at("2026-10-15T09:59:59+09:00"), newcomer), false, "v5同意者の同意前の生成物が対象になった");
  const early = [v4("2026-10-09T22:00:00+09:00")];
  assert.equal(isShortVideoLicenseApplicable(at("2026-10-09T23:59:59+09:00"), early), false, "効力発生日前の生成物が対象になった");
  assert.equal(isShortVideoLicenseApplicable(at("2026-10-10T00:00:00+09:00"), early), true, "効力発生日ちょうどの生成物が対象外");
  const oldOnly = [{ termsVersion: "2026-09-28-v2", privacyVersion: "2026-09-28-v3", consentedAt: at("2026-09-28T12:00:00+09:00") }];
  assert.equal(isShortVideoLicenseApplicable(at("2026-10-12T12:00:00+09:00"), oldOnly), false, "許可一覧に無い旧版のみの同意者が対象になった");
  assert.equal(isShortVideoLicenseApplicable(at("2026-10-12T12:00:00+09:00"), []), false, "同意記録なしが対象になった");
  const interim = [{ termsVersion: "2026-10-10-v3", privacyVersion: "2026-10-14-v5", consentedAt: at("2026-10-14T12:00:00+09:00") }];
  assert.equal(isShortVideoLicenseApplicable(at("2026-10-15T12:00:00+09:00"), interim), false, "中間案（v3+v5）のみの同意者が対象になった");

  // 効力発生日は法務文書の版・改定日の定数に依存しない（legalInfo.tsのソース上で、
  // SHORT_VIDEO_LICENSE_*の定義がTERMS_*/PRIVACY_*を参照していない）。
  const legalInfoSrc = read("src", "lib", "legalInfo.ts");
  for (const line of legalInfoSrc.split("\n").filter((l) => l.startsWith("export const SHORT_VIDEO_LICENSE_"))) {
    assert.ok(!/TERMS_|PRIVACY_/.test(line.split("=").slice(1).join("=")), `短尺動画の定数が現在の法務版を参照している: ${line}`);
  }
}
console.log("PASS: プライバシーポリシーの流入アンケート記載は新しい5択と一致し、短尺動画許諾は現在の法務版から分離した専用定数（効力発生日2026年10月10日・許可の組v3+v4/v4+v5）で画面・フロント判定・DB(0090)が一致し、v3+v4既存利用者・v4+v5利用者・10/10〜13・10/14以降・同意前・10/9以前・旧版のみ・中間案のみの生成物を正しく判定する");

console.log("ALL LEGAL_PAGES_WIRING CHECKS PASSED");
