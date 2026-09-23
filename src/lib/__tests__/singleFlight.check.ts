// runSingleFlight（src/lib/singleFlight.ts）の検証。
// 「stateのloadingだけをロックに使うと、同じtick内で2回呼ばれた場合に両方とも
// 古いloadingを見て二重実行してしまう」という問題に対し、useRefが満たすのと
// 同じ{ current: boolean }形の同期ロックで、実際に同時呼び出しを1回に抑える
// ことを、実際の非同期タスク（setTimeoutで遅延させたPromise）で検証する。
import assert from "node:assert/strict";

import { runSingleFlight, SINGLE_FLIGHT_SKIPPED, type SingleFlightLock } from "../singleFlight";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  // 1: 未完了の取得処理がある状態で、同期的に2回呼ぶと、内部タスクは1回しか
  //    呼ばれない（2回目はSINGLE_FLIGHT_SKIPPEDを返す）。
  {
    const lock: SingleFlightLock = { current: false };
    let callCount = 0;
    const task = async () => {
      callCount += 1;
      await delay(20);
      return "ok";
    };

    const p1 = runSingleFlight(lock, task);
    const p2 = runSingleFlight(lock, task); // p1が完了する前に同期的に2回目を呼ぶ

    // p1のtask()は、runSingleFlight呼び出し直後（最初のawaitの前）に既に
    // 同期的に実行されているため、この時点でcallCountは1のはず。
    assert.equal(callCount, 1, "1回目の呼び出し時点でtaskが同期的に開始されていない");

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(callCount, 1, "未完了の間に2回呼んだのにtaskが2回実行された");
    assert.equal(r1, "ok", "1回目の呼び出しの結果がtaskの戻り値になっていない");
    assert.equal(r2, SINGLE_FLIGHT_SKIPPED, "実行中の2回目の呼び出しがSINGLE_FLIGHT_SKIPPEDを返していない");
  }
  console.log("PASS: 未完了の取得処理がある状態で同期的に2回呼んでも、内部タスクは1回しか実行されない");

  // 2: 最初の取得が完了したあとに再度呼ぶと、新しい取得が1回開始される
  //    （ロックが正しく解除され、次回は素通しになる）。
  {
    const lock: SingleFlightLock = { current: false };
    let callCount = 0;
    const task = async () => {
      callCount += 1;
      await delay(5);
      return callCount;
    };

    const r1 = await runSingleFlight(lock, task);
    const r2 = await runSingleFlight(lock, task);
    assert.equal(callCount, 2, "完了後の再呼び出しでtaskが新しく実行されていない");
    assert.equal(r1, 1);
    assert.equal(r2, 2);
    assert.equal(lock.current, false, "完了後にロックが解除されていない");
  }
  console.log("PASS: 最初の取得が完了したあとに再度呼ぶと、新しい取得が1回開始される");

  // 3: taskが例外を投げて失敗しても、finally相当の処理でロックが解除され、
  //    次の呼び出しが正常に再試行できる（取得失敗後の再読み込みボタンの動作に相当）。
  {
    const lock: SingleFlightLock = { current: false };
    let attempt = 0;
    const flakyTask = async () => {
      attempt += 1;
      await delay(5);
      if (attempt === 1) throw new Error("boom");
      return "recovered";
    };

    await assert.rejects(() => runSingleFlight(lock, flakyTask), /boom/);
    assert.equal(lock.current, false, "taskが例外を投げた後もロックが解除されていない");

    const r2 = await runSingleFlight(lock, flakyTask);
    assert.equal(r2, "recovered", "失敗後の再試行が新しいtaskを実行できていない");
  }
  console.log("PASS: taskが例外を投げて失敗しても、ロックは解除され次の呼び出しで正常に再試行できる");

  // 4: 完全に同時（同じマイクロタスクtick）に3回呼んでも、実行されるのは
  //    最初の1回だけ（連打の極端なケース）。
  {
    const lock: SingleFlightLock = { current: false };
    let callCount = 0;
    const task = async () => {
      callCount += 1;
      await delay(10);
      return "ok";
    };

    const results = await Promise.all([
      runSingleFlight(lock, task),
      runSingleFlight(lock, task),
      runSingleFlight(lock, task),
    ]);
    assert.equal(callCount, 1, "3連打で内部タスクが1回に抑えられていない");
    const skippedCount = results.filter((r) => r === SINGLE_FLIGHT_SKIPPED).length;
    assert.equal(skippedCount, 2, "スキップされた呼び出しの数が想定と異なる");
  }
  console.log("PASS: 3連打相当の完全同時呼び出しでも、実行されるのは1回だけ");

  console.log("ALL SINGLE_FLIGHT CHECKS PASSED");
}

main();
