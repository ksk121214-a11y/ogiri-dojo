// useSnsLiveResultsStore.ts の「1〜3位の同順位タイ表示」「順位→参加者→お題→回答
// カードの階層ソート」を、本番と同じ実装（fetchSummaryPage経由のinit()・
// fetchDetail()）を実際に呼び出して検証する。
// シナリオ：1位をAlice1・Alice2（表示名が同じ別参加者）がタイで分け合い、3位は
// Bobの1人だけ（2位は存在しない）。Alice1は2つのお題（topicA・topicB）に代表
// 回答を持ち、topicBには同点(score=6)の回答が2件ある。Alice2のtopicCには
// 点数が異なる回答が3件（score=9,3,7）あり、カード自体のscore降順ソートを
// 検証する（同点のtopicBだけでは、score降順sortを削除してもテストが通って
// しまうため、この差点ケースを別途用意している）。DBから返る行の順序は
// 意図的にcreated_atの順・score順のどちらとも無関係にスクランブルしてあり、
// ストア側の明示的な安定ソート（score降順→同点時はcreated_at→id）だけが
// 正しい順序を作れることを確認する。
// 実行方法はsrc/lib/__tests__/run.sh参照（専用tsconfig経由）。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import { useSnsLiveResultsStore } from "@/store/useSnsLiveResultsStore";

const LIVE_ID = "11110000-0000-4000-8000-000000000000";
const RESULT_ID = "22220000-0000-4000-8000-000000000000";

const P1 = "aaaa0000-0000-4000-8000-000000000001"; // Alice1
const P2 = "aaaa0000-0000-4000-8000-000000000002"; // Alice2（表示名が同じ別参加者）
const P3 = "bbbb0000-0000-4000-8000-000000000003"; // Bob

const U1 = "u-alice1";
const U2 = "u-alice2";
const U3 = "u-bob";

const TOPIC_A = "topic-a";
const TOPIC_B = "topic-b";
const TOPIC_C = "topic-c";
const TOPIC_D = "topic-d";

// answer_id -> {participant_id, turn_id, score, body}
const ANSWERS = {
  "ans-p2-topicc": { participantId: P2, turnId: "turn-c", score: 9, body: "P2のtopicC回答" },
  "ans-p2-topicc-2": { participantId: P2, turnId: "turn-c", score: 3, body: "P2のtopicC回答2(低得点)" },
  "ans-p2-topicc-3": { participantId: P2, turnId: "turn-c", score: 7, body: "P2のtopicC回答3(中得点)" },
  "ans-p1-topica": { participantId: P1, turnId: "turn-a", score: 8, body: "P1のtopicA回答" },
  "ans-p1-topicb-1": { participantId: P1, turnId: "turn-b", score: 6, body: "P1のtopicB回答1" },
  "ans-p1-topicb-2": { participantId: P1, turnId: "turn-b", score: 6, body: "P1のtopicB回答2" },
  "ans-p3-topicd": { participantId: P3, turnId: "turn-d", score: 4, body: "P3のtopicD回答" },
} as const;

const TURN_TOPIC: Record<string, string> = {
  "turn-a": TOPIC_A,
  "turn-b": TOPIC_B,
  "turn-c": TOPIC_C,
  "turn-d": TOPIC_D,
};

const TOPIC_BODY: Record<string, string> = {
  [TOPIC_A]: "お題A",
  [TOPIC_B]: "お題B",
  [TOPIC_C]: "お題C",
  [TOPIC_D]: "お題D",
};

// sns_live_result_answers行。rank=1をP1(2お題・3件)・P2(3件)で分け合い、rank=3はP3のみ
// （rank=2は存在しない＝「存在しない2位を作らない」の確認）。created_atは意図的に
// 昇順で定義するが、DBから返す配列自体（RA_ROWS_SCRAMBLED）は順序をシャッフルする。
const RA_DEFS = [
  { id: "ra-p2-topicc", answerId: "ans-p2-topicc", rank: 1 as const, createdAt: "2026-01-01T00:00:01Z" },
  { id: "ra-p2-topicc-2", answerId: "ans-p2-topicc-2", rank: 1 as const, createdAt: "2026-01-01T00:00:01.100Z" },
  { id: "ra-p2-topicc-3", answerId: "ans-p2-topicc-3", rank: 1 as const, createdAt: "2026-01-01T00:00:01.200Z" },
  { id: "ra-p1-topica", answerId: "ans-p1-topica", rank: 1 as const, createdAt: "2026-01-01T00:00:02Z" },
  { id: "ra-p1-topicb-1", answerId: "ans-p1-topicb-1", rank: 1 as const, createdAt: "2026-01-01T00:00:03Z" },
  { id: "ra-p1-topicb-2", answerId: "ans-p1-topicb-2", rank: 1 as const, createdAt: "2026-01-01T00:00:04Z" },
  { id: "ra-p3-topicd", answerId: "ans-p3-topicd", rank: 3 as const, createdAt: "2026-01-01T00:00:05Z" },
];

function raRow(id: string) {
  const def = RA_DEFS.find((d) => d.id === id)!;
  return {
    id: def.id,
    live_result_id: RESULT_ID,
    answer_id: def.answerId,
    rank: def.rank,
    included: true,
    likes: 0,
    created_at: def.createdAt,
  };
}

// DBの暗黙の返却順がcreated_at順・score順のどちらとも無関係であることを模すため、
// 意図的にシャッフルした順序で返す（topicc-3(score7) → topicb-2 → topicd →
// topica → topicc(score9) → topicb-1 → topicc-2(score3)）。
// topicCの3件(score 9,7,3)はscore降順(9→7→3)とも保存順(9→3→7)とも異なる
// 順序で並べてあり、「score降順sortを削除してもテストが通る」状態になっていない
// ことを保証する。
const RA_ROWS_SCRAMBLED = [
  raRow("ra-p2-topicc-3"),
  raRow("ra-p1-topicb-2"),
  raRow("ra-p3-topicd"),
  raRow("ra-p1-topica"),
  raRow("ra-p2-topicc"),
  raRow("ra-p1-topicb-1"),
  raRow("ra-p2-topicc-2"),
];

function makeChain(resolve: () => unknown) {
  const chain: Record<string, unknown> = {};
  const passthrough = ["select", "eq", "neq", "in", "order", "limit", "lt", "is", "match"];
  for (const m of passthrough) chain[m] = () => chain;
  chain.maybeSingle = async () => resolve();
  chain.single = async () => resolve();
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(resolve()).then(ok);
  return chain;
}

(supabase as unknown as Record<string, unknown>).from = (table: string) => {
  if (table === "lives") {
    // fetchSummaryPage: .select(...).eq(...).eq(...).eq(...).order(...).limit(...) → then
    // fetchDetail:      .select(...).eq("id", resultRow.live_id).eq("live_mode","official").maybeSingle()
    return makeChain(() => ({
      data: [
        {
          id: LIVE_ID,
          official_sequence_number: 1,
          title: "テストライブ",
          ended_at: "2026-01-02T00:00:00Z",
          results_published: true,
        },
      ],
      error: null,
    }));
  }
  if (table === "sns_live_results") {
    // fetchSummaryPage: .in("live_id", liveIds) → then（配列）
    // fetchDetail:      .eq("id", liveResultId).maybeSingle()（単体）
    const chain: Record<string, unknown> = {};
    const row = { id: RESULT_ID, live_id: LIVE_ID, manager_best_answer_id: null, manager_comment: null };
    const passthrough = ["select", "eq", "in"];
    for (const m of passthrough) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: row, error: null });
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [row], error: null }).then(ok);
    return chain;
  }
  if (table === "sns_live_result_answers") {
    return makeChain(() => ({ data: RA_ROWS_SCRAMBLED, error: null }));
  }
  if (table === "answers") {
    const rows = Object.entries(ANSWERS).map(([id, a]) => ({
      id,
      participant_id: a.participantId,
      turn_id: a.turnId,
      score_total: a.score,
      body: a.body,
      judge_count: 0,
      top_score_votes: 0,
    }));
    return makeChain(() => ({ data: rows, error: null }));
  }
  if (table === "turns") {
    const rows = Object.entries(TURN_TOPIC).map(([id, topicId]) => ({ id, topic_id: topicId }));
    return makeChain(() => ({ data: rows, error: null }));
  }
  if (table === "topics") {
    const rows = Object.entries(TOPIC_BODY).map(([id, body]) => ({ id, body }));
    return makeChain(() => ({ data: rows, error: null }));
  }
  if (table === "sns_live_result_comments") {
    return makeChain(() => ({ data: [], error: null }));
  }
  // 未ログイン想定（myUserId=null）のため、sns_live_result_likesクエリ自体は
  // 発生しないが、念のため安全なフォールバックを用意する。
  return makeChain(() => ({ data: [], error: null }));
};

(supabase as unknown as Record<string, unknown>).rpc = (name: string, args?: unknown) => {
  if (name === "sns_result_participant_user_ids") {
    const ids = (args as { p_participant_ids: string[] }).p_participant_ids;
    const map: Record<string, string> = { [P1]: U1, [P2]: U2, [P3]: U3 };
    const data = ids.map((participant_id) => ({ participant_id, user_id: map[participant_id] }));
    return Promise.resolve({ data, error: null });
  }
  if (name === "sns_author_names") {
    const ids = (args as { p_ids: string[] }).p_ids;
    const names: Record<string, string> = { [U1]: "アリス", [U2]: "アリス", [U3]: "ボブ" };
    const data = ids.map((id) => ({
      id,
      display_name: names[id] ?? "（不明）",
      avatar_icon: "default",
      avatar_color: "default",
      mastery_meter: 0,
      bio: null,
      equipped_limited_icon_slug: null,
      equipped_title_display_name: null,
    }));
    return Promise.resolve({ data, error: null });
  }
  return Promise.resolve({ data: null, error: null });
};

async function main() {
  // ===== 1) 一覧(summaries.podiumNames)：1位タイ全員＋3位のみ、2位は存在しない =====
  useSnsLiveResultsStore.setState({ loaded: false, summaries: [], cursor: null, hasMore: true });
  await useSnsLiveResultsStore.getState().init();
  const summary = useSnsLiveResultsStore.getState().summaries.find((s) => s.id === RESULT_ID);
  assert.ok(summary, "一覧にテスト対象のライブ結果summaryが無い");

  const rank1Entries = summary!.podiumNames.filter((p) => p.rank === 1);
  const rank2Entries = summary!.podiumNames.filter((p) => p.rank === 2);
  const rank3Entries = summary!.podiumNames.filter((p) => p.rank === 3);

  assert.equal(rank2Entries.length, 0, "存在しない2位がpodiumNamesに作られてしまった");
  assert.equal(rank3Entries.length, 1, "3位がBobの1人だけになっていない");
  assert.equal(rank3Entries[0].name, "ボブ");

  // 1位タイの全員(P1・P2)が出て、P1は3件の代表回答があっても1回だけ出る。
  assert.equal(rank1Entries.length, 2, `1位が2人(P1・P2)とも出ていない（実際=${rank1Entries.length}件）`);
  const rank1ParticipantIds = rank1Entries.map((p) => p.participantId);
  assert.ok(rank1ParticipantIds.includes(P1), "P1が1位一覧から漏れている");
  assert.ok(rank1ParticipantIds.includes(P2), "P2が1位一覧から漏れている");
  assert.equal(new Set(rank1ParticipantIds).size, 2, "同一参加者の代表回答が複数あるために名前が重複している");
  // 表示名が同じ別参加者(P1・P2、どちらも「アリス」)が両方出ていることも確認する。
  assert.equal(rank1Entries.filter((p) => p.name === "アリス").length, 2, "表示名が同じ別参加者の片方が欠落している");
  // 同順位の参加者同士も、結果データの保存順（created_at昇順：P2が00:01で最も早い→P1が00:02）を維持する。
  assert.deepEqual(rank1ParticipantIds, [P2, P1], "1位タイの参加者の並び順が、結果データの保存順(created_at)になっていない");
  console.log("PASS: 一覧(podiumNames) - 1位タイの全員が表示され、同一参加者の重複は無く、表示名が同じ別参加者も両方出て、存在しない2位は作られない");

  // ===== 2) 詳細(detail.podium)：順位→参加者→お題→回答の階層ソート =====
  useSnsLiveResultsStore.setState({ details: {}, detailLoading: {} });
  await useSnsLiveResultsStore.getState().fetchDetail(RESULT_ID);
  const detail = useSnsLiveResultsStore.getState().details[RESULT_ID];
  assert.ok(detail, "詳細が取得できていない");

  const rank1Group = detail.podium.find((g) => g.rank === 1);
  const rank2Group = detail.podium.find((g) => g.rank === 2);
  const rank3Group = detail.podium.find((g) => g.rank === 3);
  assert.ok(!rank2Group, "存在しない2位のグループが作られてしまった");
  assert.ok(rank1Group, "1位グループが無い");
  assert.ok(rank3Group, "3位グループが無い");

  // 1位同士のカードが参加者単位で混ざらない：2参加者ぶんのグループに分かれている。
  assert.equal(rank1Group!.participants.length, 2, "1位の参加者ブロックが2つに分かれていない（参加者単位で混ざっている）");
  assert.deepEqual(
    rank1Group!.participants.map((p) => p.participantId),
    [P2, P1],
    "1位の参加者ブロックの並び順が、結果データの保存順(created_at)になっていない",
  );

  const p1Group = rank1Group!.participants.find((p) => p.participantId === P1)!;
  // 一人に複数お題(topicA・topicB)がある場合、topicId単位で固まる。
  assert.equal(p1Group.topics.length, 2, "P1のお題ブロックがtopicId単位で2つに分かれていない");
  // お題ブロックは回答点合計の降順：topicB(6+6=12) > topicA(8)。
  assert.deepEqual(
    p1Group.topics.map((t) => t.topicId),
    [TOPIC_B, TOPIC_A],
    "お題ブロックが合計点の高い順になっていない（DBの入力順(topicA→topicB)のままになっている）",
  );
  assert.equal(p1Group.topics[0].totalScore, 12, "topicBの合計点が正しく計算されていない(6+6=12のはず)");
  assert.equal(p1Group.topics[1].totalScore, 8, "topicAの合計点が正しく計算されていない(8のはず)");

  // topicB内の2件は同点(score=6)。score降順では順位が決まらないため、結果データの
  // 保存順(created_at: topicb-1が00:03、topicb-2が00:04)を維持する。DBから返る配列
  // (RA_ROWS_SCRAMBLED)はtopicb-2が先に来る順序だが、それに引きずられていないことを確認する。
  const topicBCards = p1Group.topics[0].cards;
  assert.equal(topicBCards.length, 2, "topicBの回答が2件になっていない");
  assert.deepEqual(
    topicBCards.map((c) => c.resultAnswerId),
    ["ra-p1-topicb-1", "ra-p1-topicb-2"],
    "同点時の並び順が、結果データの保存順(created_at)で安定していない（DBの返却順に引きずられている）",
  );
  for (const c of topicBCards) {
    assert.equal(c.score, 6, "topicBの各カードのscoreが想定と異なる");
    assert.equal(c.participantId, P1, "カードのparticipantIdがP1になっていない");
    assert.equal(c.topicId, TOPIC_B, "カードのtopicIdがTOPIC_Bになっていない");
  }

  // 同一参加者・同一お題(P2のtopicC)に点数が異なる回答が3件(score=9,3,7)ある場合、
  // カード自体がscore降順(9→7→3)に並ぶことをID配列・点数配列の両方で確認する。
  // DBモック(RA_ROWS_SCRAMBLED)からはscore順とも保存順とも異なる順序で返っているため、
  // ストア側のscore降順sortを削除すると、このassertは失敗するようになっている。
  const p2Group = rank1Group!.participants.find((p) => p.participantId === P2)!;
  assert.equal(p2Group.topics.length, 1, "P2のお題ブロックがtopicC単独になっていない");
  assert.equal(p2Group.topics[0].topicId, TOPIC_C);
  assert.equal(p2Group.topics[0].totalScore, 19, "topicCの合計点が正しく計算されていない(9+3+7=19のはず)");
  const topicCCards = p2Group.topics[0].cards;
  assert.equal(topicCCards.length, 3, "topicCの回答が3件になっていない");
  assert.deepEqual(
    topicCCards.map((c) => c.resultAnswerId),
    ["ra-p2-topicc", "ra-p2-topicc-3", "ra-p2-topicc-2"],
    "点数が異なる回答のID配列がscore降順(9→7→3)になっていない",
  );
  assert.deepEqual(
    topicCCards.map((c) => c.score),
    [9, 7, 3],
    "点数が異なる回答のscore配列が降順(9→7→3)になっていない",
  );

  assert.equal(rank3Group!.participants.length, 1, "3位の参加者ブロックが1つになっていない");
  assert.equal(rank3Group!.participants[0].participantId, P3);
  assert.equal(rank3Group!.participants[0].topics[0].cards[0].score, 4);

  console.log(
    "PASS: 詳細(podium) - 順位→参加者→お題→回答の階層で正しくグルーピング・ソートされ、DBの入力順を崩しても期待順になる",
  );

  console.log("ALL USE_SNS_LIVE_RESULTS_STORE_RANKING CHECKS PASSED");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
