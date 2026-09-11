// useLiveFollowerStore.ts の refreshTurnDerived / refreshFinalResult を
// 「本番と同じ実装のまま」呼び出して、購読世代の競合を検証するスクリプト。
// 実行方法は src/lib/__tests__/run.sh 参照（この1ファイルだけ専用のtsconfigと
// requireフック(pathAliasHook.js)経由でコンパイル・実行される。理由：
// useLiveFollowerStore.tsは"@/..."エイリアスとSupabaseクライアントの実生成を
// 含むため、他のcheck.tsと同じ素のtsc起動では解決できない）。
//
// 2026-09-16（再レビュー対応・問題1）：前回追加したテストは
// createChannelSwapControllerを使って「同じ形の」ガードを再現しただけの
// 簡略化されたfakeSubscribeであり、useLiveFollowerStore.ts本体のrefreshTurnDerived/
// refreshFinalResultを一度も呼んでいなかった。ここでは実際にimportした本番の
// useLiveFollowerStore（Zustandストアそのもの）とrefreshTurnDerived/
// refreshFinalResultを呼び出し、supabaseクライアントの.from(...)だけを
// タイミング制御可能なモックに差し替えて、要求された6ステップの競合シナリオを
// 実際のコードパスで検証する。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import {
  refreshFinalResult,
  refreshTurnDerived,
  useLiveFollowerStore,
} from "@/store/useLiveFollowerStore";
import type { AnswerRow, LiveRow, ParticipantRow, TopicRow, TurnRow } from "@/lib/liveRoomTypes";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- supabase.from(...) の最小限のモック ----
// select/eq/order/limit/maybeSingleはすべて自分自身を返すチェーン可能な
// ダミーで、実際のフィルタ条件は見ない（テーブル名だけで返す内容を決める）。
// 呼び出された瞬間（.then()が呼ばれる瞬間）の`blocked`フラグを見て、
// trueなら共有ゲート(gatePromise)が解決されるまで応答を保留し、falseなら
// 次のマイクロタスクですぐ応答する。「Aの取得を保留したままBを先に完了させ、
// 最後にAを完了させる」という要求されたシナリオを、本物のrefreshTurnDerived/
// refreshFinalResizedの内部で実際に発生するsupabase.from(...)呼び出しに対して
// 再現する。
// 2026-09-16（再レビュー対応・問題1、追加修正）：同一世代内の競合テストでは、
// 「Aの最初のturn/topic/answers取得は即解決させつつ、Aが自分で呼ぶ
// refreshFinalResult内部の取得（同じ"answers"テーブル）だけを保留する」必要が
// あり、単純な時刻ベースのblockedフラグの切り替えでは、fetchTurnAndTopicが
// 最初のturns解決後に発火する2段目のtopics呼び出しまで巻き込んでしまい
// タイミングが安定しない。blockAnswersOnCallが設定されている間は、"answers"
// テーブルへのN回目の呼び出し（呼び出し回数で決定的に識別できる）だけを
// gatePromise待ちにし、他のテーブルは従来どおりblockedフラグに従う。
let blocked = false;
let cannedFor: (table: string) => { data: unknown; error: null };
let answersCallCount = 0;
let blockAnswersOnCall: number | null = null;
let gatePromise: Promise<void>;
let releaseGate: () => void;
function resetGate() {
  gatePromise = new Promise<void>((r) => {
    releaseGate = r;
  });
}
resetGate();

function makeQueryBuilder(table: string) {
  let blockedAtCallTime: boolean;
  if (table === "answers" && blockAnswersOnCall !== null) {
    answersCallCount += 1;
    blockedAtCallTime = answersCallCount === blockAnswersOnCall;
  } else {
    blockedAtCallTime = blocked;
  }
  const cannedFn = cannedFor;
  const builder: PromiseLike<{ data: unknown; error: null }> & Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => builder,
    then(onFulfilled: (v: { data: unknown; error: null }) => unknown) {
      const respond = () => onFulfilled(cannedFn(table));
      if (blockedAtCallTime) {
        void gatePromise.then(respond);
      } else {
        void Promise.resolve().then(respond);
      }
      return Promise.resolve();
    },
  } as unknown as PromiseLike<{ data: unknown; error: null }> & Record<string, unknown>;
  return builder;
}

// eslint的なany回避のため、テストの間だけ本物のsupabaseクライアントの
// from(...)を差し替える（rpc等、他のメソッドはrefreshTurnDerived/
// refreshFinalResultからは呼ばれないため触らない）。
(supabase as unknown as { from: (table: string) => unknown }).from = makeQueryBuilder;

// ---- テストデータ ----
const LIVE_ID = "live-race-1";
const TURN_ID_A = "turn-a";
const TURN_ID_B = "turn-b";
const TOPIC_ID = "topic-1";
const PARTICIPANT_ME = "participant-me";
const PARTICIPANT_OTHER = "participant-other";

const baseLive: LiveRow = {
  id: LIVE_ID,
  scheduled_at: new Date().toISOString(),
  rounds_per_live: 1,
  current_phase: "final_result",
  current_turn_id: TURN_ID_A,
  phase_deadline: null,
  answering_paused: false,
  answering_remaining_ms: null,
  reveal_sequence_until: null,
  created_at: new Date().toISOString(),
  sequence_number: 1,
  title: "テスト",
  description: null,
  max_players: null,
  planned_group_count: null,
  reception_starts_at: null,
  reception_ends_at: null,
  results_published: false,
  ended_at: null,
  announcement_message: null,
  announcement_scope: null,
  announcement_sent_at: null,
  created_by: null,
  rank_rewards_applied: false,
};

const participants: ParticipantRow[] = [
  {
    id: PARTICIPANT_ME,
    live_id: LIVE_ID,
    user_id: "user-me",
    group_id: "group-1",
    role: "player",
    preferred_role: "player",
    joined_at: new Date().toISOString(),
    host_message: null,
    host_message_sent_at: null,
    kicked_at: null,
  },
  {
    id: PARTICIPANT_OTHER,
    live_id: LIVE_ID,
    user_id: "user-other",
    group_id: "group-1",
    role: "player",
    preferred_role: "player",
    joined_at: new Date().toISOString(),
    host_message: null,
    host_message_sent_at: null,
    kicked_at: null,
  },
];

function makeTurn(id: string): TurnRow {
  return {
    id,
    live_id: LIVE_ID,
    round: 1,
    group_id: "group-1",
    topic_id: TOPIC_ID,
    status: "active",
    eligible_judge_count: 1,
  };
}
function makeTopic(body: string): TopicRow {
  return { id: TOPIC_ID, live_id: LIVE_ID, body, format: "text", created_at: new Date().toISOString(), topic_bank_id: null, locked: true };
}
function makeAnswer(id: string, label: string, score: number): AnswerRow {
  return {
    id,
    turn_id: TURN_ID_A,
    live_id: LIVE_ID,
    participant_id: PARTICIPANT_ME,
    seq: 1,
    body: label,
    score_total: score,
    top_score_votes: 0,
    judge_count: 1,
    laugh_triggered: false,
    // 未公開・未確定のまま（revealed_at:null）にして、fetchAnswersAndScoreForTurnが
    // scoresの2段目取得を行わないようにする（このテストで検証したい競合とは無関係な
    // 分岐なので、単純化する）。
    revealed_at: null,
    judging_ends_at: null,
    resolved: true,
    created_at: new Date().toISOString(),
  };
}

function cannedA(table: string): { data: unknown; error: null } {
  switch (table) {
    case "turns":
      return { data: makeTurn(TURN_ID_A), error: null };
    case "topics":
      return { data: makeTopic("TOPIC-A"), error: null };
    case "answers":
      return { data: [makeAnswer("answer-a", "回答A", 10)], error: null };
    case "answering_cues":
      return { data: null, error: null };
    default:
      throw new Error(`cannedA: 想定外のtable(${table})`);
  }
}
function cannedB(table: string): { data: unknown; error: null } {
  switch (table) {
    case "turns":
      return { data: makeTurn(TURN_ID_B), error: null };
    case "topics":
      return { data: makeTopic("TOPIC-B"), error: null };
    case "answers":
      return { data: [makeAnswer("answer-b", "回答B", 99)], error: null };
    case "answering_cues":
      return { data: null, error: null };
    default:
      throw new Error(`cannedB: 想定外のtable(${table})`);
  }
}

async function main() {
  // 2026-09-16（再レビュー対応・問題1）：refreshTurnDerivedが呼ぶ
  // refreshFinalResultも含めて検証するため、current_phase="final_result"に
  // しておく（fetchResolvedAnswersForLiveも同じ"answers"テーブルを叩くため、
  // 上のcannedA/cannedBのanswers応答がそのまま最終結果の集計にも使われる）。
  useLiveFollowerStore.setState({
    live: baseLive,
    myParticipant: participants[0],
    participants,
    participantNames: { [PARTICIPANT_ME]: "自分", [PARTICIPANT_OTHER]: "相手" },
    groups: [],
    currentTurn: null,
    turnAnswers: [],
    activeAnswer: null,
    activeAnswerScores: [],
    finalResult: null,
    groupResult: null,
  });

  let currentGen = 1;
  const isGenA = () => currentGen === 1;
  const isGenB = () => currentGen === 2;

  // 1. subscribe A開始（Aの取得を保留）：blocked=trueのままrefreshTurnDerivedを
  //    呼ぶと、内部のsupabase.from(...)呼び出しはすべてgatePromiseの解決待ちになる。
  resetGate();
  blocked = true;
  cannedFor = cannedA;
  const callA = refreshTurnDerived(isGenA);

  // 3. subscribe B開始（Aのcleanupを待たずに購読世代を切り替える＝cleanup漏れ・
  //    順序のズレがあった場合と同じ状況）。
  currentGen = 2;
  blocked = false;
  cannedFor = cannedB;
  const callB = refreshTurnDerived(isGenB);

  // 4. Bを先に完了させる。
  const bOk = await callB;
  assert.equal(bOk, true, "Bのrefreshが失敗した");
  {
    const s = useLiveFollowerStore.getState();
    assert.equal(s.currentTurn?.id, TURN_ID_B, "Bの完了直後、currentTurnがBの値になっていない");
    assert.equal(s.turnAnswers[0]?.id, "answer-b", "Bの完了直後、turnAnswersがBの値になっていない");
    assert.equal(s.finalResult?.bestAnswer?.body, "回答B", "Bの完了直後、finalResultがBの値になっていない");
  }

  // 5. Aを最後に完了させる（保留していたgateを解放する）。
  releaseGate();
  const aOk = await callA;
  assert.equal(aOk, false, "古い世代のAが false を返さなかった（stillCurrentガードが効いていない）");

  // 6. 最終stateがBの値のまま（Aの遅延結果に一切書き換えられていない）。
  {
    const s = useLiveFollowerStore.getState();
    assert.equal(s.currentTurn?.id, TURN_ID_B, "古いAの遅延結果でcurrentTurnが上書きされた");
    assert.equal(s.turnAnswers[0]?.id, "answer-b", "古いAの遅延結果でturnAnswersが上書きされた");
    assert.equal(s.activeAnswer, null, "古いAの遅延結果でactiveAnswerが変化した");
    assert.equal(s.groupResult, null, "古いAの遅延結果でgroupResultが変化した（現在のフェーズはfinal_resultなのでnullのまま）");
    assert.equal(s.finalResult?.bestAnswer?.body, "回答B", "古いAの遅延結果でfinalResultが上書きされた");
  }
  console.log(
    "PASS: 本番のrefreshTurnDerived/refreshFinalResultを直接呼び出し、古い購読世代Aの遅延取得結果が新しい世代Bのstateを一切上書きしないことを確認",
  );

  // 追加確認：refreshFinalResult単体にも同じガードが効くこと（stillCurrentが
  // falseなら取得後もsetState直前もstateを一切変更しない）。
  {
    useLiveFollowerStore.setState({ finalResult: null });
    blocked = false;
    cannedFor = cannedA;
    await refreshFinalResult(() => false);
    assert.equal(
      useLiveFollowerStore.getState().finalResult,
      null,
      "stillCurrent=false でも refreshFinalResult が finalResult を書き換えた",
    );
    console.log("PASS: refreshFinalResult単体もstillCurrent=falseならstateを変更しない");
  }

  // 2026-09-16（再レビュー対応・問題1、追加修正）：同一購読世代内で
  // refreshTurnDerivedが2回重なった場合の競合。A（先発）が通常のturn/topic/answers
  // 取得と最初のsetStateを終えた後、refreshFinalResult内部の取得だけが保留になり、
  // その間にB（後発、同じ購読世代）が開始して先に完了しfinalResultを反映する、
  // というシナリオを、本番のrefreshTurnDerived/refreshFinalResultをそのまま
  // 呼び出して検証する（購読世代（isCurrentGen）だけを見るガードでは検出できず、
  // ownsRequest（購読世代＋同一世代内のrequestId）が必要な回帰）。
  {
    useLiveFollowerStore.setState({
      live: baseLive,
      myParticipant: participants[0],
      participants,
      participantNames: { [PARTICIPANT_ME]: "自分", [PARTICIPANT_OTHER]: "相手" },
      groups: [],
      currentTurn: null,
      turnAnswers: [],
      activeAnswer: null,
      activeAnswerScores: [],
      finalResult: null,
      groupResult: null,
    });
    // このテストの間、購読世代は一貫して「同じ」ままにする（切り替えない）。
    const sameGen = () => true;

    // 1. 同じ購読世代でrefreshTurnDerived A（先発）を開始する。"answers"テーブルへの
    //    2回目の呼び出し（＝Aが最初のsetStateの後、自分で呼ぶrefreshFinalResult
    //    内部のfetchResolvedAnswersForLive）だけをgatePromise待ちにする。1回目の
    //    呼び出し（＝fetchAnswersAndScoreForTurnによるturnAnswers取得）と、
    //    turns/topics/answering_cuesは即解決させ、Aを通常どおり最初のsetStateまで
    //    確実に進ませる（時刻ベースのフラグ切り替えだと、topicsの2段目呼び出しの
    //    タイミングが安定しないため、呼び出し回数で決定的に識別する）。
    resetGate();
    answersCallCount = 0;
    blockAnswersOnCall = 2;
    blocked = false;
    cannedFor = cannedA;
    const call2A = refreshTurnDerived(sameGen);

    // Aが最初のsetStateまで進み、refreshFinalResultの取得で止まるのを待つ。
    await delay(20);
    {
      const s = useLiveFollowerStore.getState();
      assert.equal(s.currentTurn?.id, TURN_ID_A, "Aが最初のturn/topic/answers取得・setStateを終えていない（テストの前提が崩れている）");
      assert.equal(s.finalResult, null, "AのrefreshFinalResultがまだ完了していないはずなのにfinalResultが埋まっている");
    }

    // 4. refreshTurnDerived B（後発、同じ購読世代）を開始する。Bの取得はすべて
    //    即座に解決させ、Bを先に完了させる。
    cannedFor = cannedB;
    blocked = false;
    const call2B = refreshTurnDerived(sameGen);
    const b2Ok = await call2B;
    assert.equal(b2Ok, true, "同一世代内の後発B（refreshTurnDerived）が失敗した");
    {
      const s = useLiveFollowerStore.getState();
      assert.equal(s.currentTurn?.id, TURN_ID_B, "Bの完了直後、currentTurnがBの値になっていない");
      assert.equal(s.turnAnswers[0]?.id, "answer-b", "Bの完了直後、turnAnswersがBの値になっていない");
      assert.equal(s.finalResult?.bestAnswer?.body, "回答B", "Bの完了直後、finalResultがBの値になっていない");
    }

    // 6. AのrefreshFinalResult取得を最後に完了させる（保留していたgateを解放）。
    releaseGate();
    const a2Ok = await call2A;
    assert.equal(
      a2Ok,
      false,
      "同一世代内でBに追い越された古いAのrefreshTurnDerivedがfalseを返さなかった（ownsRequestが効いていない）",
    );

    // 7. currentTurn・turnAnswers・activeAnswerScores・groupResult・finalResultの
    //    いずれもBの値のまま（Aの遅れて完了したrefreshFinalResultで上書きされない）。
    {
      const s = useLiveFollowerStore.getState();
      assert.equal(s.currentTurn?.id, TURN_ID_B, "同一世代内の古いAの遅延finalResultでcurrentTurnが変化した");
      assert.equal(s.turnAnswers[0]?.id, "answer-b", "同一世代内の古いAの遅延finalResultでturnAnswersが変化した");
      assert.equal(s.activeAnswerScores.length, 0, "同一世代内の古いAの遅延finalResultでactiveAnswerScoresが変化した");
      assert.equal(s.groupResult, null, "同一世代内の古いAの遅延finalResultでgroupResultが変化した");
      assert.equal(
        s.finalResult?.bestAnswer?.body,
        "回答B",
        "同一世代内の古いA（先発）のrefreshFinalResultが、後発BのfinalResultを上書きした",
      );
    }
  }
  console.log(
    "PASS: 同一購読世代内でrefreshTurnDerivedが重なっても、先発Aの遅延したrefreshFinalResultが後発Bのstateを上書きしない（ownsRequest）",
  );

  console.log("ALL USE_LIVE_FOLLOWER_STORE_RACE CHECKS PASSED");
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
