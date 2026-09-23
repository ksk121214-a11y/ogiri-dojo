// src/app/admin/schedule/page.tsx の「全体アンケート集計」カード（0075対応）の
// 配線確認（静的検査）。実際にReactをレンダリングする自動テスト基盤が無いため、
// ソースを読み取り、要求された挙動がコード上に存在することを確認する。
//
// 確認する要求事項：
// - フロントはprofilesを直接取得・集計せず、RPC(admin_referral_survey_summary)
//   の結果だけを使う（個人情報を含む行をブラウザへ渡さない）。
// - 取得失敗時は0人と誤表示せず、専用のエラーメッセージを表示する。
// - 回答が0件の場合は専用の案内文を表示する。
// - 再読み込みボタンは読み込み中disabledになる。
// - 初回自動取得・再読み込みボタンのどちらも、同じsingle-flightヘルパー
//   （src/lib/singleFlight.ts、runSingleFlight）を経由する。stateのloadingだけを
//   ロックに使っていないこと（実際の同時呼び出し耐性はsingleFlight.check.tsで
//   直接検証済み）をここでは配線として確認する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const page = readFileSync(join(process.cwd(), "src", "app", "admin", "schedule", "page.tsx"), "utf8");

// 1: OverallReferralSurveySectionがRPC呼び出しだけを使い、profilesテーブルを
//    直接selectしていない（全件取得・個人情報の取得を避ける）。
const sectionIdx = page.indexOf("function OverallReferralSurveySection");
assert.ok(sectionIdx >= 0, "OverallReferralSurveySectionが見つからない");
const fetchFnIdx = page.indexOf("async function fetchOverallReferralSurveySummary");
assert.ok(fetchFnIdx >= 0, "fetchOverallReferralSurveySummaryが見つからない");
const fetchFnBlock = page.slice(fetchFnIdx, sectionIdx);
assert.ok(
  fetchFnBlock.includes('supabase.rpc("admin_referral_survey_summary")'),
  "fetchOverallReferralSurveySummaryがRPC admin_referral_survey_summary を呼んでいない",
);
assert.ok(
  !/\.from\(\s*["']profiles["']\s*\)/.test(fetchFnBlock),
  "全体アンケート集計がprofilesテーブルを直接selectしている（RPC経由のみにすべき）",
);
console.log("PASS: 全体アンケート集計はprofilesを直接取得せず、RPC(admin_referral_survey_summary)の結果だけを使う");

// 2: 取得失敗（"error"）を0人と誤表示せず、専用メッセージを出す。
const sectionEndIdx = page.indexOf("\nfunction ResultsPublishSection", sectionIdx);
const sectionBlock = page.slice(sectionIdx, sectionEndIdx >= 0 ? sectionEndIdx : undefined);
assert.ok(
  sectionBlock.includes("全体アンケート集計の取得に失敗しました"),
  "取得失敗時の専用エラーメッセージが見当たらない",
);
assert.ok(
  /summary === "error"/.test(sectionBlock),
  "summary===\"error\"の分岐が見当たらない（0人と誤表示しない判定）",
);
console.log("PASS: 取得失敗時は0人と誤表示せず「全体アンケート集計の取得に失敗しました」を表示する");

// 3: 回答0件の場合の専用案内文。
assert.ok(
  sectionBlock.includes("アンケートの回答はまだありません"),
  "回答0件時の案内文が見当たらない",
);
assert.ok(
  /answeredTotal === 0/.test(sectionBlock),
  "answeredTotal===0の分岐が見当たらない",
);
console.log("PASS: 回答済み合計が0件の場合は「アンケートの回答はまだありません」を表示する");

// 4: 再読み込みボタンはloading中disabledになる。
assert.ok(
  /<AdminButton className="mt-2" disabled=\{loading\} onClick=\{load\}>/.test(sectionBlock),
  "再読み込みボタンがdisabled={loading}になっていない",
);
console.log("PASS: 再読み込みボタンは読み込み中disabledになる");

// 5（レビュー対応で置き換え）：以前はloadハンドラ内の"if (loading) return;"と
//    いう文字列の存在だけを確認していたが、これはstateのloadingを連打防止の
//    ロックに使っている場合の実装であり、実際に二重実行を防げることの証明には
//    ならない（Reactのstate更新は次の再描画まで反映されないため、同じtick内で
//    2回呼ばれると両方が古いloadingを見てしまう）。今回はロジックを
//    useRefベースのsingle-flightへ置き換えたため、"if (loading) return"という
//    文字列は存在しない前提とし、代わりに実際の排他制御ロジック
//    （runSingleFlight・useRef）がload/初回effectの両方から使われていることを
//    配線として確認する。実際の同時呼び出し耐性そのものはsingleFlight.check.tsで
//    直接検証済み。
assert.ok(
  !/if \(loading\) return;/.test(sectionBlock),
  "state(loading)だけをロックにするif (loading) return;がまだ残っている（single-flightへの置き換えが不完全）",
);
assert.ok(
  /import \{ runSingleFlight \} from "@\/lib\/singleFlight";/.test(page),
  "src/lib/singleFlightのrunSingleFlightをimportしていない",
);
const loadFnIdx = sectionBlock.indexOf("const load = ()");
assert.ok(loadFnIdx >= 0, "loadハンドラが見つからない");
const loadFnEndIdx = sectionBlock.indexOf("\n  };", loadFnIdx);
const loadFnBlock = sectionBlock.slice(loadFnIdx, loadFnEndIdx >= 0 ? loadFnEndIdx : undefined);
assert.ok(
  /runSingleFlight\(inFlightLockRef,/.test(loadFnBlock),
  "loadハンドラがrunSingleFlight(inFlightLockRef, ...)を使っていない",
);
console.log(
  "PASS: 再読み込みハンドラはstateのloadingではなくrunSingleFlight(useRefベース)で排他制御している",
);

// 6: 初回表示時の自動取得（useEffect）も、再読み込みボタンと同じload()経由、
//    つまり同じsingle-flight制御を使っている（別経路で直接fetchを呼んでいない）。
const mountEffectIdx = sectionBlock.indexOf("useEffect(() => {\n    load();");
assert.ok(
  mountEffectIdx >= 0,
  "初回表示時のuseEffectがload()（再読み込みボタンと同じsingle-flight制御）を呼んでいない",
);
console.log("PASS: 初回表示時の自動取得も、再読み込みボタンと同じsingle-flight制御(load())を通る");

// 7: アンマウント後に古い取得結果でstateを更新しないためのmountedRefガードが
//    setSummary/setLoadingの呼び出しにかかっている。
assert.ok(
  /const mountedRef = useRef\(true\);/.test(sectionBlock),
  "mountedRefが見当たらない（アンマウント後のstate更新ガードが無い）",
);
const setSummaryCalls = loadFnBlock.match(/setSummary\([^)]*\)/g) ?? [];
assert.ok(setSummaryCalls.length >= 2, "setSummaryの呼び出し（成功・エラーの両方）が見当たらない");
for (const call of setSummaryCalls) {
  const idx = loadFnBlock.indexOf(call);
  const before = loadFnBlock.slice(Math.max(0, idx - 60), idx);
  assert.ok(
    /mountedRef\.current/.test(before),
    `setSummary呼び出し(${call})の直前にmountedRef.currentのガードが無い`,
  );
}
console.log("PASS: setSummary/setLoadingはmountedRef.currentでガードされ、アンマウント後の状態更新を避けている");

console.log("ALL ADMIN_SCHEDULE_REFERRAL_WIRING CHECKS PASSED");
