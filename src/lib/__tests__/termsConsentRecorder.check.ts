// record_terms_consent の呼び出しを利用者×規約版ごとに1回へ束ねる共通処理の検証。
// 修正前：ゲスト同意時にRPCが2回送信された（どちらも204）。
import assert from "node:assert/strict";

import {
  beginGuestConsentWindow,
  recordTermsConsentOnce,
  resetTermsConsentRecorderForTests,
  waitForConsentInFlight,
} from "../termsConsentRecorder";

const T = "2026-09-25-v1";
const P = "2026-09-25-v1";
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  // 1) 連打・複数経路（モーダル・ゲート・認証イベント・Strict Mode相当の二重実行）が
  //    同時に呼んでも、RPCは1回だけ。
  resetTermsConsentRecorderForTests();
  let calls = 0;
  const rpc = async () => {
    calls += 1;
    await delay(20);
    return { error: null };
  };
  const results = await Promise.all(
    Array.from({ length: 6 }).map(() => recordTermsConsentOnce({ userId: "u1", termsVersion: T, privacyVersion: P, rpc })),
  );
  assert.equal(calls, 1, "同時に6回呼んでもRPCは1回でなければならない");
  assert.ok(results.every((r) => r.error === null));
  // 2) 成功を記憶しない：完了後の呼び出しはRPCを再実行する（DBを正とする。DBの同意行が
  //    リセットされた場合に、画面だけ成功扱いになることを防ぐ。二重記録はDBのUNIQUE＋
  //    ON CONFLICT DO NOTHINGが防ぐ）。
  await recordTermsConsentOnce({ userId: "u1", termsVersion: T, privacyVersion: P, rpc });
  assert.equal(calls, 2, "完了後の呼び出しが成功キャッシュで省略された（同意行リセット後に再同意できない）");
  console.log("PASS: 同時呼び出しは1本に合流し、完了後は成功を記憶せずRPCを再実行できる（キャッシュ無し）");

  // 3) 失敗した場合も再試行できる。
  resetTermsConsentRecorderForTests();
  calls = 0;
  let fail = true;
  const flaky = async () => {
    calls += 1;
    return fail ? { error: { message: "network" } } : { error: null };
  };
  const r1 = await recordTermsConsentOnce({ userId: "u2", termsVersion: T, privacyVersion: P, rpc: flaky });
  assert.ok(r1.error, "失敗が返っていない");
  fail = false;
  const r2 = await recordTermsConsentOnce({ userId: "u2", termsVersion: T, privacyVersion: P, rpc: flaky });
  assert.equal(r2.error, null);
  assert.equal(calls, 2, "失敗後の再試行が行われていない");
  assert.ok(true);
  // 例外を投げるRPCも失敗として扱い、再試行できる。
  resetTermsConsentRecorderForTests();
  const thrower = async () => {
    throw new Error("boom");
  };
  const r3 = await recordTermsConsentOnce({ userId: "u3", termsVersion: T, privacyVersion: P, rpc: thrower });
  assert.ok(r3.error, "例外が失敗として返っていない");
  console.log("PASS: 失敗（エラー・例外）した場合だけ、次の呼び出しで再試行できる");

  // 4) 利用者が異なれば互いに影響しない（前ユーザーの完了で次ユーザーの記録が省略されない）。
  resetTermsConsentRecorderForTests();
  calls = 0;
  const counting = async () => {
    calls += 1;
    return { error: null };
  };
  await recordTermsConsentOnce({ userId: "guest-a", termsVersion: T, privacyVersion: P, rpc: counting });
  await recordTermsConsentOnce({ userId: "guest-b", termsVersion: T, privacyVersion: P, rpc: counting });
  assert.equal(calls, 2, "利用者Bの同意が、利用者Aの完了を理由に省略された");
  // 規約の版が改定された場合は、同じ利用者でも改めて記録する。
  await recordTermsConsentOnce({ userId: "guest-a", termsVersion: "2026-10-01-v2", privacyVersion: P, rpc: counting });
  assert.equal(calls, 3, "改定版への同意が旧版の記録を理由に省略された");
  console.log("PASS: 利用者ごと・規約版ごとに独立している");

  // 5) 送信中の記録があれば、DBの同意有無の確認前にその完了を待てる（未着による一瞬の「未同意」表示を防ぐ）。
  resetTermsConsentRecorderForTests();
  let done = false;
  const slow = async () => {
    await delay(30);
    done = true;
    return { error: null };
  };
  const pending = recordTermsConsentOnce({ userId: "u5", termsVersion: T, privacyVersion: P, rpc: slow });
  await waitForConsentInFlight("u5", T, P);
  assert.equal(done, true, "送信中の記録の完了を待っていない");
  await pending;
  await waitForConsentInFlight("u5", T, P); // 送信中が無ければ即座に解決する
  console.log("PASS: 送信中の記録の完了を待ってから同意有無を確認できる");

  // 6) userIdが未確定（null）の場合は、記録RPCを呼ばない（束ねられず二重送信になるため）。
  resetTermsConsentRecorderForTests();
  calls = 0;
  const nullResult = await recordTermsConsentOnce({ userId: null, termsVersion: T, privacyVersion: P, rpc: counting });
  assert.equal(calls, 0, "userId=nullのままRPCを呼んでしまった");
  assert.ok(nullResult.error, "userId未確定がエラーとして返っていない");
  console.log("PASS: userIdが未確定の間は記録RPCを呼ばない");

  // 7) 同時に別々の経路が呼んでも、待機用のゲスト同意の窓が終わるまで同意確認は待つ。
  resetTermsConsentRecorderForTests();
  const end = beginGuestConsentWindow();
  let waited = false;
  const waiter = waitForConsentInFlight("g1", T, P).then(() => {
    waited = true;
  });
  await delay(20);
  assert.equal(waited, false, "ゲスト同意の窓が終わる前に同意確認が進んだ（誤って未同意と判定し得る）");
  end();
  await waiter;
  assert.equal(waited, true);
  console.log("PASS: ゲスト同意の窓が終わるまで、同意確認は待つ");

  // 8) 窓は単一変数ではなく集合：重なった窓のうち、後発が先に終わっても先発が終わるまで待つ。
  resetTermsConsentRecorderForTests();
  const endA = beginGuestConsentWindow();
  const endB = beginGuestConsentWindow(); // 再マウント・二重実行で後発が開始
  let released = false;
  const waiter2 = waitForConsentInFlight("g2", T, P).then(() => {
    released = true;
  });
  endB(); // 後発が「処理中」等で先に終了
  await delay(30);
  assert.equal(released, false, "後発の窓の終了で、先発の窓が消えて同意確認が先に進んだ");
  endB(); // 解除は冪等（二重に呼んでも先発の窓を巻き込まない）
  await delay(10);
  assert.equal(released, false, "窓の二重解除が先発の窓を消した");
  endA();
  await waiter2;
  assert.equal(released, true);
  console.log("PASS: 窓が重なっても、後発が先に終わったり二重解除されても、先発の終了まで同意確認は待つ");

  // 9) 最大待機で自動解除される（応答なし・例外・アンマウントで永久待機にならない）。
  resetTermsConsentRecorderForTests();
  beginGuestConsentWindow(60); // 解除されない窓
  const t0 = Date.now();
  await waitForConsentInFlight("g3", T, P);
  const autoReleaseMs = Date.now() - t0;
  assert.ok(autoReleaseMs >= 40 && autoReleaseMs < 1_000, `最大待機での自動解除が働いていない(${autoReleaseMs}ms)`);
  console.log(`PASS: 解除されない窓でも最大待機(${autoReleaseMs}ms)で自動解除され、永久待機にならない`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
