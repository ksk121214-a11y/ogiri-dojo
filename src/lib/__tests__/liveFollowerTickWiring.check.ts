// 配線確認：観客・回答者側の補助tick（useLiveFollowerStore.ts の tickIfNeeded）が
// 「更新が無かった場合に毎回refetchAll（重い全件再取得）しない」ことと、
// 「ライブ状態を復元中…」が利用者向け画面から置き換わっていることを、
// ソースの静的検査で確認する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const followerSrc = readFileSync(
  join(process.cwd(), "src", "store", "useLiveFollowerStore.ts"),
  "utf8",
);

// 1: tickIfNeeded は advance_live_progress_if_due を1回だけ呼ぶ統合RPCを使う
//    （5秒ごとに複数RPCを無条件で呼ぶ旧実装には戻っていない）。
{
  const fn = followerSrc.match(/const tickIfNeeded = async \(\) => \{[\s\S]*?\n    \};/);
  assert.ok(fn, "tickIfNeeded が見つからない");
  const body = fn![0];
  assert.ok(
    /\.rpc\("advance_live_progress_if_due"/.test(body),
    "tickIfNeeded が advance_live_progress_if_due を呼んでいない",
  );
  const rpcCount = (body.match(/\.rpc\(/g) ?? []).length;
  assert.equal(rpcCount, 1, `tickIfNeeded 内のRPC呼び出しが1回ではない(got=${rpcCount})`);

  // 2: 更新が無かった場合（updated=falseかつフェーズ/ターン不変）は、
  //    refetchAll（重い全件再取得）を呼ばない。
  assert.ok(!/refetchAll\(\)/.test(body), "tickIfNeeded が refetchAll を呼んでいる（過剰な通信の再発）");

  // 3: 実際に変化した場合だけrefreshTurnDerived（turn/topic/answers/scoresの
  //    再取得。refetchAllより軽い）を呼び、変化が無ければlive行のsetStateだけで
  //    済ませる、という分岐構造になっていることを確認する。
  const changedIdx = body.indexOf("if (result.updated || phaseOrTurnChanged)");
  const refreshIdx = body.indexOf("refreshTurnDerived(isMyGenCurrent)");
  const elseIdx = body.indexOf("} else if (result.live)");
  assert.ok(
    changedIdx !== -1 && refreshIdx !== -1 && elseIdx !== -1 && changedIdx < refreshIdx && refreshIdx < elseIdx,
    "tickIfNeeded が「変化した場合だけrefreshTurnDerived、それ以外は軽量なsetStateのみ」という構造になっていない",
  );
  console.log("PASS: 補助tick(tickIfNeeded)は統合RPCを1回だけ呼び、更新が無い場合はrefetchAll等の重い再取得をしない");
}

// 4: 「ライブ状態を復元中…」という旧文言が利用者向け画面(src/app/live/page.tsx)に
//    残っておらず、「ライブ入場中…」に置き換わっていることを確認する。
{
  const livePagePath = join(process.cwd(), "src", "app", "live", "page.tsx");
  const livePageSrc = readFileSync(livePagePath, "utf8");
  assert.ok(
    !livePageSrc.includes("ライブ状態を復元中"),
    "src/app/live/page.tsx に旧文言「ライブ状態を復元中…」がまだ残っている",
  );
  assert.ok(
    livePageSrc.includes("ライブ入場中…"),
    "src/app/live/page.tsx に新文言「ライブ入場中…」が見つからない",
  );
  // エラー時の文言（意味が異なるため変更対象ではない）は維持されていることも確認する。
  assert.ok(
    livePageSrc.includes("ライブ状態の取得に失敗しました"),
    "エラー時の文言「ライブ状態の取得に失敗しました」が変わっている（変更対象ではないはず）",
  );
  console.log("PASS: 「ライブ状態を復元中…」が「ライブ入場中…」に置き換わり、エラー文言は維持されている");
}

console.log("ALL LIVE_FOLLOWER_TICK_WIRING CHECKS PASSED");
