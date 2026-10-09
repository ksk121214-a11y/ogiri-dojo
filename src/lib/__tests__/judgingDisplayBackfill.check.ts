// 不具合「第1組・自分の最初の回答だけ、回答後にフリップも回答文字も表示されない」の修正検証。
// 原因：useJudgingDisplay（src/lib/useJudgingDisplay.ts）は、activeAnswer（revealedかつ
// 未resolved）をクライアントが一度でも観測しないと、その回答のidを永久に追跡しない。
// 初回取得・Realtime購読確立が遅れ、短いrevealed→resolvedの遷移を丸ごと逃すと、
// フリップも回答文字も一切表示されないまま次の回答まで進んでしまっていた。
//
// 修正：src/lib/judgingDisplayBackfill.ts（安全な候補選定。reveal_sequence_untilまでの
// 残り時間も返す）とsrc/lib/judgingDisplayState.ts（ターンを跨いで持ち越さない状態遷移、
// かつ補完表示はreveal_sequence_untilを超えて残らない）を検証する。
// ここでは副作用の無い純粋関数だけを対象にする（React実機でのStage/Audience両方の
// 配線確認はjudgingDisplayBackfillWiring.check.ts、実ブラウザでの3回以上の再現確認は
// 別途Playwrightで実施）。
import assert from "node:assert/strict";

import { selectJudgingDisplayBackfillCandidate, type ResolvableAnswerLike } from "../judgingDisplayBackfill";
import {
  initialJudgingDisplayState,
  nextJudgingDisplayState,
  type JudgingDisplayState,
} from "../judgingDisplayState";

type A = ResolvableAnswerLike & { label: string };

const a = (id: string, resolved: boolean, revealedAt: string | null, label = id): A => ({
  id,
  resolved,
  revealed_at: revealedAt,
  label,
});

const ms = (iso: string) => new Date(iso).getTime();
const GRACE_MS = 2200; // STANDARD_TIMING.revealGraceMsと同じ既定値で検証する。

function main() {
  // ========== selectJudgingDisplayBackfillCandidate（安全な候補選定）==========

  // 2) activeを一度も観測せず、表示可能期間内にresolved回答を初取得した場合は候補になる。
  //    remainingUntilRevealSequenceMsも正しく算出される。
  {
    const turnAnswers = [a("a1", true, "2026-01-01T00:00:00.000Z")];
    const candidate = selectJudgingDisplayBackfillCandidate(turnAnswers, "2026-01-01T00:00:05.000Z", {
      now: ms("2026-01-01T00:00:02.000Z"),
      fresh: true,
    });
    assert.ok(candidate, "表示可能期間内のresolved回答が候補として選ばれなかった");
    assert.equal(candidate!.id, "a1");
    assert.equal(candidate!.remainingUntilRevealSequenceMs, 3000, "reveal_sequence_untilまでの残り時間の算出が誤っている");
    console.log("PASS: 表示可能期間内の未観測resolved回答が候補になり、残り時間も正しく算出される");
  }

  // 3) 表示可能期間（reveal_sequence_until）を過ぎたresolved回答は候補にしない。
  {
    const turnAnswers = [a("a1", true, "2026-01-01T00:00:00.000Z")];
    const candidate = selectJudgingDisplayBackfillCandidate(turnAnswers, "2026-01-01T00:00:05.000Z", {
      now: ms("2026-01-01T00:00:06.000Z"),
      fresh: true,
    });
    assert.equal(candidate, null, "表示可能期間を過ぎたresolved回答が候補になってしまった");
    console.log("PASS: 表示可能期間を過ぎたresolved回答は候補にならない");
  }

  // 4) リロード時（表示可能期間が過ぎてから長時間経った後の初取得）に古いresolved回答を
  //    候補にしない。
  {
    const turnAnswers = [a("a1", true, "2026-01-01T00:00:00.000Z")];
    const candidate = selectJudgingDisplayBackfillCandidate(turnAnswers, "2026-01-01T00:00:05.000Z", {
      now: ms("2026-01-01T01:00:00.000Z"),
      fresh: true,
    });
    assert.equal(candidate, null, "リロード時に古いresolved回答が候補になってしまった");
    console.log("PASS: リロード時の古いresolved回答は候補にならない");
  }

  // 5) 複数のresolved回答がある場合、最新（revealed_atが最大）だけを候補にする。
  //    未resolvedの行は（revealed_atが新しくても）対象外。
  {
    const turnAnswers = [
      a("old", true, "2026-01-01T00:00:00.000Z"),
      a("new", true, "2026-01-01T00:00:03.000Z"),
      a("unresolved", false, "2026-01-01T00:00:04.000Z"),
    ];
    const candidate = selectJudgingDisplayBackfillCandidate(turnAnswers, "2026-01-01T00:00:10.000Z", {
      now: ms("2026-01-01T00:00:05.000Z"),
      fresh: true,
    });
    assert.ok(candidate);
    assert.equal(candidate!.id, "new", "複数resolved回答のうち最新ではないものが選ばれた");
    console.log("PASS: 複数のresolved回答では最新の1件だけが候補になる");
  }

  // サーバー時計が未同期（fresh:false）の間は、何も安全に判定できないため候補を出さない。
  {
    const turnAnswers = [a("a1", true, "2026-01-01T00:00:00.000Z")];
    const candidate = selectJudgingDisplayBackfillCandidate(turnAnswers, "2026-01-01T00:00:05.000Z", {
      now: ms("2026-01-01T00:00:02.000Z"),
      fresh: false,
    });
    assert.equal(candidate, null, "サーバー時計未同期なのに候補が出てしまった");
    console.log("PASS: サーバー時計が未同期の間は候補を出さない");
  }

  // reveal_sequence_untilが無い（採点確定イベント自体が無い）間は候補を出さない。
  {
    const turnAnswers = [a("a1", true, "2026-01-01T00:00:00.000Z")];
    const candidate = selectJudgingDisplayBackfillCandidate(turnAnswers, null, {
      now: ms("2026-01-01T00:00:02.000Z"),
      fresh: true,
    });
    assert.equal(candidate, null, "reveal_sequence_untilが無いのに候補が出てしまった");
    console.log("PASS: reveal_sequence_untilが無い間は候補を出さない");
  }

  // ========== nextJudgingDisplayState（ターンを跨いで持ち越さない状態遷移）==========

  const withGrace = (
    prev: JudgingDisplayState,
    activeAnswerId: string | null,
    turnAnswerIds: ReadonlySet<string>,
    backfillCandidate: { id: string; remainingUntilRevealSequenceMs: number } | null,
  ) => nextJudgingDisplayState(prev, { activeAnswerId, turnAnswerIds, backfillCandidate, graceMs: GRACE_MS });

  // 1) 通常のactive→resolvedでは、ターンが変わらない限り従来どおり猶予表示を保つ
  //    （activeAnswerIdがnullになっても、まだturnAnswerIdsに残っていれば保持する）。
  //    expireAfterMsはnull（従来どおりgraceMsをそのまま使う経路）のまま。
  {
    let state = initialJudgingDisplayState;
    state = withGrace(state, "a1", new Set(["a1"]), null);
    assert.deepEqual(state, { answerId: "a1", expired: false, expireAfterMs: null });
    state = withGrace(state, null, new Set(["a1"]), null);
    assert.deepEqual(
      state,
      { answerId: "a1", expired: false, expireAfterMs: null },
      "通常のresolved直後に猶予表示を保てていない",
    );
    console.log("PASS: 通常のactive→resolvedでは従来どおり猶予表示を保つ（expireAfterMsもnullのまま）");
  }

  // 2') 初期状態からactiveを一度も観測せず、backfillCandidateだけで採用できる。
  //    表示期限(expireAfterMs)は、graceMsとreveal_sequence_untilまでの残り時間の
  //    小さい方になる。
  {
    const state = withGrace(initialJudgingDisplayState, null, new Set(["a1"]), {
      id: "a1",
      remainingUntilRevealSequenceMs: 5000, // graceMs(2200)より大きい→2200で頭打ち
    });
    assert.deepEqual(state, { answerId: "a1", expired: false, expireAfterMs: 2200 });
    console.log("PASS: 初期状態からbackfillCandidateだけで表示を採用でき、表示期限はgraceMsで頭打ちになる");
  }

  // 「reveal_sequence_untilを超えて表示が残る」対策：残り時間がgraceMsより短い場合は、
  // その短い方が表示期限になる（次の回答が開始し得る時点より前に必ず収まる）。
  {
    const state = withGrace(initialJudgingDisplayState, null, new Set(["a1"]), {
      id: "a1",
      remainingUntilRevealSequenceMs: 300, // graceMs(2200)より小さい→300が採用される
    });
    assert.deepEqual(
      state,
      { answerId: "a1", expired: false, expireAfterMs: 300 },
      "reveal_sequence_untilまでの残り時間がgraceMsより短いのに、expireAfterMsがgraceMsのままになっている",
    );
    console.log("PASS: reveal_sequence_untilまでの残り時間がgraceMsより短い場合、その短い方が表示期限になる");
  }

  // 6) ターン／組切替時に前の回答を持ち越さない。かつ、切替と同時に新ターン自身の
  //    backfillCandidateは正しく採用できる（旧ターンのidがprev.answerIdに残っていても
  //    ブロックされない）。
  {
    const prev: JudgingDisplayState = { answerId: "old-turn-answer", expired: false, expireAfterMs: null };
    const resetOnly = withGrace(prev, null, new Set(["new-turn-answer-x"]), null);
    assert.deepEqual(
      resetOnly,
      { answerId: null, expired: false, expireAfterMs: null },
      "ターン切替時に前の回答が持ち越されている",
    );

    const resetAndAdopt = withGrace(prev, null, new Set(["new-turn-answer-x"]), {
      id: "new-turn-answer-x",
      remainingUntilRevealSequenceMs: 5000,
    });
    assert.deepEqual(
      resetAndAdopt,
      { answerId: "new-turn-answer-x", expired: false, expireAfterMs: 2200 },
      "ターン切替直後、新ターン自身のbackfillCandidateが旧ターンのidによってブロックされている",
    );
    console.log("PASS: ターン／組切替時に前の回答を持ち越さず、新ターンの候補は正しく採用できる");
  }

  // 9) backfillで補完表示した後も、次の正常な（実際に観測した）回答は通常どおり
  //    最優先で表示が切り替わる。
  {
    const backfilled: JudgingDisplayState = { answerId: "backfilled-a1", expired: false, expireAfterMs: 2200 };
    const next = withGrace(backfilled, "a2", new Set(["backfilled-a1", "a2"]), null);
    assert.deepEqual(
      next,
      { answerId: "a2", expired: false, expireAfterMs: null },
      "補完表示後、次の正常な回答へ切り替わらない",
    );
    console.log("PASS: 補完表示の後も、次の正常な回答は通常どおり表示へ切り替わる（expireAfterMsもnullに戻る）");
  }

  // 猶予切れ(expired:true)の後、同じターンのまま古いbackfillCandidateが再提示されても
  // 復活させない（一度切れた表示を蘇らせない）。
  {
    const prev: JudgingDisplayState = { answerId: "a1", expired: true, expireAfterMs: 2200 };
    const state = withGrace(prev, null, new Set(["a1"]), { id: "a1", remainingUntilRevealSequenceMs: 4000 });
    assert.deepEqual(
      state,
      { answerId: "a1", expired: true, expireAfterMs: 2200 },
      "猶予切れ後にbackfillで表示が復活してしまった",
    );
    console.log("PASS: 猶予切れ後はbackfillCandidateが同じidなら表示を復活させない");
  }

  // 4') リロード相当：初期状態で、表示可能期間を過ぎたresolved回答しかturnAnswersに
  //    無い場合（selectJudgingDisplayBackfillCandidateがnullを返す想定）、何も表示しない。
  {
    const turnAnswers = [a("stale", true, "2026-01-01T00:00:00.000Z")];
    const candidate = selectJudgingDisplayBackfillCandidate(turnAnswers, "2026-01-01T00:00:05.000Z", {
      now: ms("2026-01-01T02:00:00.000Z"),
      fresh: true,
    });
    const state = withGrace(initialJudgingDisplayState, null, new Set(turnAnswers.map((x) => x.id)), candidate);
    assert.deepEqual(
      state,
      { answerId: null, expired: false, expireAfterMs: null },
      "リロード時に古いresolved回答が表示されてしまった",
    );
    console.log("PASS: リロード時、候補選定と状態遷移を通しても古いresolved回答は表示されない");
  }

  // ========== 今回の修正（同一ターン内で2件目以降のcoldMissを補完できるようにする）==========

  // a) 通常観測したa1→猶予切れ→resolved済みa2だけを初観測：a2を採用する。
  {
    // a1はactiveAnswerとして観測され、その後猶予切れになった想定
    // （フックのタイマーeffectがexpired:trueへ更新した結果をprevとして与える）。
    const prevAfterExpire: JudgingDisplayState = { answerId: "a1", expired: true, expireAfterMs: null };
    const state = withGrace(prevAfterExpire, null, new Set(["a1", "a2"]), {
      id: "a2",
      remainingUntilRevealSequenceMs: 5000,
    });
    assert.deepEqual(
      state,
      { answerId: "a2", expired: false, expireAfterMs: 2200 },
      "通常観測したa1が猶予切れになった後、同じターンの新しいcoldMiss(a2)を採用できていない",
    );
    console.log("PASS: active a1→猶予切れ→resolved済みa2だけを初観測した場合、a2を採用する");
  }

  // b) backfillしたa1→猶予切れ→新しいbackfill候補a2：a2を採用する。
  {
    const prevAfterExpire: JudgingDisplayState = { answerId: "a1", expired: true, expireAfterMs: 2200 };
    const state = withGrace(prevAfterExpire, null, new Set(["a1", "a2"]), {
      id: "a2",
      remainingUntilRevealSequenceMs: 1000,
    });
    assert.deepEqual(
      state,
      { answerId: "a2", expired: false, expireAfterMs: 1000 },
      "backfillしたa1が猶予切れになった後、同じターンの新しいbackfill候補(a2)を採用できていない",
    );
    console.log("PASS: backfill a1→猶予切れ→新しいbackfill a2の場合、a2を採用する");
  }

  // c) 猶予切れa1→同じ候補a1：復活しない（上の「猶予切れ後は復活させない」テストと同義だが、
  //    今回の要求文言に対応する独立ケースとしても明記しておく）。
  {
    const prevAfterExpire: JudgingDisplayState = { answerId: "a1", expired: true, expireAfterMs: 2200 };
    const state = withGrace(prevAfterExpire, null, new Set(["a1"]), {
      id: "a1",
      remainingUntilRevealSequenceMs: 4000,
    });
    assert.deepEqual(state, prevAfterExpire, "猶予切れa1に対し、同じ候補a1が再提示されたのに表示が復活してしまった");
    console.log("PASS: 猶予切れa1に対し、同じ候補a1は復活しない");
  }

  // d) a2採用後に通常のactive a3：a3へ切り替わる。
  {
    const afterA2: JudgingDisplayState = { answerId: "a2", expired: false, expireAfterMs: 2200 };
    const state = withGrace(afterA2, "a3", new Set(["a1", "a2", "a3"]), null);
    assert.deepEqual(
      state,
      { answerId: "a3", expired: false, expireAfterMs: null },
      "a2採用後、通常のactive a3へ切り替わっていない",
    );
    console.log("PASS: a2採用後に通常のactive a3が観測されると、a3へ切り替わる");
  }

  console.log("ALL JUDGING_DISPLAY_BACKFILL CHECKS PASSED");
}

main();
