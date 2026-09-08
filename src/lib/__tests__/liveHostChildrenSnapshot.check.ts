// resolveLiveChildrenSnapshot()（src/lib/liveHostChildrenSnapshot.ts）の検証
// スクリプト。実行方法はsrc/lib/__tests__/run.sh参照（answeringCueOrdering.check.tsと
// 同じ、tsc+nodeで直接実行する方式）。
import assert from "node:assert/strict";

import { resolveLiveChildrenSnapshot } from "../liveHostChildrenSnapshot";

interface Children {
  turns: string[];
}

// シナリオ1：取得成功時は新しいデータを採用し、readyになる。
{
  const result = resolveLiveChildrenSnapshot<Children>({
    fetchOk: true,
    freshChildren: { turns: ["new"] },
    sameLiveAsBefore: true,
    prevChildren: { turns: ["old"] },
    prevReady: true,
    emptyChildren: { turns: [] },
  });
  assert.deepEqual(result.children, { turns: ["new"] });
  assert.equal(result.ready, true);
  console.log("PASS: シナリオ1（取得成功時は新しいデータを採用し、readyになる）");
}

// シナリオ2（必須テスト1）：同じライブでの取得失敗時、既存のturns/groups
// （ここではturnsで代表）が空にならない。
{
  const result = resolveLiveChildrenSnapshot<Children>({
    fetchOk: false,
    freshChildren: { turns: [] },
    sameLiveAsBefore: true,
    prevChildren: { turns: ["existing"] },
    prevReady: true,
    emptyChildren: { turns: [] },
  });
  assert.deepEqual(result.children, { turns: ["existing"] });
  assert.equal(result.ready, true);
  console.log("PASS: シナリオ2（同じライブでの取得失敗は、既存のturns/groupsを空にしない）");
}

// シナリオ3（必須テスト2の前提）：初回取得がまだ一度も成功しておらず
// （prevReady:false）、今回も失敗した場合はreadyにならない＝advanceIfDueの
// 自動進行を行わない状態が維持される（final_resultへの誤遷移を防ぐ）。
{
  const result = resolveLiveChildrenSnapshot<Children>({
    fetchOk: false,
    freshChildren: { turns: [] },
    sameLiveAsBefore: true,
    prevChildren: { turns: [] },
    prevReady: false,
    emptyChildren: { turns: [] },
  });
  assert.equal(result.ready, false);
  console.log("PASS: シナリオ3（初回取得が失敗し続ける間はreadyにならない＝自動進行を行わない）");
}

// シナリオ4：別ライブへ切り替わった場合、取得に失敗しても前ライブのデータを
// 流用せず空にする（readyもfalseに戻る）。
{
  const result = resolveLiveChildrenSnapshot<Children>({
    fetchOk: false,
    freshChildren: { turns: [] },
    sameLiveAsBefore: false,
    prevChildren: { turns: ["old-live-data"] },
    prevReady: true,
    emptyChildren: { turns: [] },
  });
  assert.deepEqual(result.children, { turns: [] });
  assert.equal(result.ready, false);
  console.log("PASS: シナリオ4（別ライブへの切り替え時は前ライブのデータを流用しない）");
}

// シナリオ5：一度readyになった後、同じライブで一時的に取得が失敗しても、
// readyの状態自体は維持される（次に成功すればまた新しいデータに置き換わる）。
{
  const result = resolveLiveChildrenSnapshot<Children>({
    fetchOk: false,
    freshChildren: { turns: [] },
    sameLiveAsBefore: true,
    prevChildren: { turns: ["a", "b"] },
    prevReady: true,
    emptyChildren: { turns: [] },
  });
  assert.equal(result.ready, true);
  assert.deepEqual(result.children, { turns: ["a", "b"] });
  console.log("PASS: シナリオ5（一度readyになった後の一時的な取得失敗でもreadyは維持される）");
}

console.log("ALL LIVE_HOST_CHILDREN_SNAPSHOT CHECKS PASSED");
