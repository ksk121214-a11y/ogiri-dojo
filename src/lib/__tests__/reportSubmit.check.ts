// 通報送信の判断処理・状態遷移を実際に動かして確認する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { classifyReportInsertError, createReportSubmitter, isOwnAuthorId, reportTargetAuthorId } from "../reportSubmit";

const U = "0f8fad5b-d9cb-469f-a165-70867728950e";

async function main() {
  // target_author_id：UUIDだけ通す
  assert.equal(reportTargetAuthorId(U), U);
  assert.equal(reportTargetAuthorId("me"), null);
  assert.equal(reportTargetAuthorId("deleted-user"), null);
  assert.equal(reportTargetAuthorId("author-1"), null);
  assert.equal(reportTargetAuthorId(""), null);
  assert.equal(reportTargetAuthorId(null), null);
  assert.equal(reportTargetAuthorId(undefined), null);

  // 自分のコメントの判定
  assert.equal(isOwnAuthorId("me"), true);
  assert.equal(isOwnAuthorId(U), false);
  assert.equal(isOwnAuthorId("deleted-user"), false);

  // エラー分類：23505だけがduplicate
  assert.equal(classifyReportInsertError(null), "ok");
  assert.equal(classifyReportInsertError({ code: "23505" }), "duplicate");
  for (const code of ["42501", "PGRST301", "23503", "08006", null, undefined]) {
    assert.equal(classifyReportInsertError({ code }), "failed", `${code} は重複扱いにしない`);
  }

  // 二重クリックでINSERTは1回
  {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = createReportSubmitter(async () => {
      calls += 1;
      await gate;
      return { error: null };
    });
    const first = s.submit({});
    assert.equal(s.isSubmitting(), true);
    assert.equal(await s.submit({}), "busy");
    assert.equal(await s.submit({}), "busy");
    release();
    assert.equal(await first, "submitted");
    assert.equal(calls, 1, "INSERTが複数回呼ばれた");
    assert.equal(s.isSubmitting(), false);
  }
  // 23505 → duplicate（通報済み扱い）、通常エラー → failed（通報済みにしない）
  assert.equal(await createReportSubmitter(async () => ({ error: { code: "23505" } })).submit({}), "duplicate");
  assert.equal(await createReportSubmitter(async () => ({ error: { code: "42501" } })).submit({}), "failed");
  // 失敗後も再試行でき、次は成功できる（DBエラー）
  {
    let n = 0;
    const s = createReportSubmitter(async () => (++n === 1 ? { error: { code: "PGRST000" } } : { error: null }));
    assert.equal(await s.submit({}), "failed");
    assert.equal(s.isSubmitting(), false, "DBエラー後にロックが残っている");
    assert.equal(await s.submit({}), "submitted");
  }
  // 通信例外（Promise reject）でも未処理エラーにならず、ロックが解除され再試行できる
  {
    let n = 0;
    const s = createReportSubmitter(async () => {
      if (++n === 1) throw new TypeError("Failed to fetch");
      return { error: null };
    });
    assert.equal(await s.submit({}), "failed");
    assert.equal(s.isSubmitting(), false, "例外後にロックが残っている");
    assert.equal(await s.submit({}), "submitted");
    assert.equal(n, 2);
  }

  // 配線：ReportButtonが実際にこの処理を使い、23505の文言・アンマウント対策・送信中表示を持つ
  const btn = readFileSync(join(process.cwd(), "src", "components", "app", "ReportButton.tsx"), "utf8");
  assert.ok(/createReportSubmitter\(/.test(btn) && /submitter\.current\.submit\(/.test(btn), "ReportButtonがsubmitterを使っていない");
  assert.ok(/reportTargetAuthorId\(targetAuthorId\)/.test(btn), "target_author_idをUUID検査せず送っている");
  assert.ok(/この内容はすでに通報済みです。/.test(btn) && /result === "duplicate"[\s\S]*?setReported\(true\)/.test(btn), "23505の表示・通報済み化がない");
  assert.ok(/mounted\.current/.test(btn) && /aria-busy=\{submitting\}/.test(btn), "アンマウント対策または送信中表示がない");
  const body = readFileSync(join(process.cwd(), "src", "components", "sns", "SnsLiveResultBody.tsx"), "utf8");
  assert.ok(/!isOwnAuthorId\(comment\.authorId\) && \(\s*<ReportButton/.test(body), "自分のライブ結果コメントに通報ボタンが出る");
  assert.ok(!/DeleteButton/.test(body), "ライブ結果コメントに削除ボタンを追加してはいけない");
  console.log("PASS: 通報送信（重複クリック1回・23505は通報済み・通常エラーは再試行可・例外でもロック解除）とtarget_author_idのUUID検査");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
