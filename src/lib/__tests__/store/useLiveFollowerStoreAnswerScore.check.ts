// 第2段階（本番・体験版/撮影モードの画面共通化）レビュー対応：
// 本番の共用表示部品(StageAnsweringPresentation/AudienceAnsweringPresentation)が
// 返すcallback(onSubmit/onScore)は、StageAnsweringView/AudienceAnsweringView
// （本番adapter）がuseLiveFollowerStoreから直接取り出したsubmitMyAnswer/
// submitMyScoreをそのまま使っている（共用部品自体は外部書き込みを持たない）。
// この検証では、その到達先であるsubmitMyAnswer/submitMyScoreを「本番と同じ
// 実装のまま」呼び出し、共通化の前後で引数・回数・Supabaseへの書き込み内容が
// 変わっていないことを確認する。実行方法はsrc/lib/__tests__/run.sh参照
// （useLiveFollowerStore.tsが"@/..."エイリアスとSupabaseクライアントの実生成を
// 含むため、他のcheck.tsと同じ素のtsc起動では解決できず、専用tsconfig経由で
// コンパイル・実行する）。
import assert from "node:assert/strict";

import { supabase } from "@/lib/supabase";
import type { AnswerRow, ParticipantRow, TurnRow } from "@/lib/liveRoomTypes";
import { useAuthStore } from "@/store/useAuthStore";
import { useLiveFollowerStore } from "@/store/useLiveFollowerStore";
import { useProfileStore } from "@/store/useProfileStore";

type FromCall = { table: string; op: "insert"; payload: unknown };
const fromCalls: FromCall[] = [];
let nextInsertError: { code?: string; message: string } | null = null;

// submitMyAnswer/submitMyScoreは成功後にrefreshTurnDerived()を呼ぶため、
// .insert()以外のチェーン（.select()等）も空データで安全に解決できるようにしておく
// （未モックのメソッド呼び出しで例外にならないようにするだけで、他のテストの検証対象ではない）。
function chainable(): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const methods = ["select", "eq", "order", "limit", "maybeSingle", "single", "in"];
  for (const m of methods) obj[m] = () => chainable();
  (obj as unknown as PromiseLike<{ data: unknown[]; error: null }>).then = (resolve) =>
    Promise.resolve({ data: [], error: null }).then(resolve as never);
  return obj;
}

(supabase as unknown as { from: (table: string) => unknown }).from = (table: string) => ({
  insert: (payload: unknown) => {
    fromCalls.push({ table, op: "insert", payload });
    return Promise.resolve({ error: nextInsertError });
  },
  ...chainable(),
});

function resetFromMock() {
  fromCalls.length = 0;
  nextInsertError = null;
}

function makeTurn(overrides: Partial<TurnRow> = {}): TurnRow {
  return { id: "turn-1", group_id: "group-1", eligible_judge_count: 3, ...overrides } as unknown as TurnRow;
}

function makeParticipant(overrides: Partial<ParticipantRow> = {}): ParticipantRow {
  return {
    id: "participant-1",
    live_id: "live-1",
    user_id: "user-1",
    group_id: "group-2",
    role: "player",
    preferred_role: "player",
    joined_at: new Date().toISOString(),
    is_guest: false,
    ...overrides,
  } as unknown as ParticipantRow;
}

function makeAnswer(overrides: Partial<AnswerRow> = {}): AnswerRow {
  return {
    id: "answer-1",
    turn_id: "turn-1",
    participant_id: "participant-other",
    resolved: false,
    judging_ends_at: new Date(Date.now() + 10_000).toISOString(),
    score_total: 0,
    judge_count: 0,
    top_score_votes: 0,
    ...overrides,
  } as unknown as AnswerRow;
}

function resetToLoggedInMember(id = "user-1") {
  useAuthStore.setState({
    user: { id, is_anonymous: false } as unknown as ReturnType<typeof useAuthStore.getState>["user"],
    loading: false,
  });
  useProfileStore.setState({
    profile: { id, isGuest: false } as unknown as ReturnType<typeof useProfileStore.getState>["profile"],
    loading: false,
  });
}

async function main() {
// ---- submitMyAnswer ----
{
  resetFromMock();
  resetToLoggedInMember();
  useLiveFollowerStore.setState({
    currentTurn: makeTurn(),
    myParticipant: makeParticipant({ id: "participant-1" }),
    myAnswerCount: 2,
  });
  const result = await useLiveFollowerStore.getState().submitMyAnswer("テスト回答本文");
  assert.equal(result.ok, true, "正常な回答送信が成功しない");
  assert.equal(fromCalls.length, 1, "answersテーブルへの書き込みが1回でない");
  assert.equal(fromCalls[0].table, "answers", "回答送信が別テーブルへ書き込まれている");
  assert.deepEqual(
    fromCalls[0].payload,
    { turn_id: "turn-1", participant_id: "participant-1", seq: 3, body: "テスト回答本文" },
    "回答送信の引数(turn_id/participant_id/seq/body)が共通化前と変わっている",
  );
  console.log("PASS: submitMyAnswerは共用部品から渡された本文で、answersテーブルへ1回だけ正しい引数で書き込む");
}

{
  resetFromMock();
  resetToLoggedInMember();
  useLiveFollowerStore.setState({
    currentTurn: makeTurn(),
    myParticipant: makeParticipant({ id: "participant-1" }),
    myAnswerCount: 0,
  });
  const empty = await useLiveFollowerStore.getState().submitMyAnswer("   ");
  assert.equal(empty.ok, false, "空文字の回答が送信されてしまう");
  assert.equal(fromCalls.length, 0, "空文字でもSupabaseへ書き込みが発生している");
  console.log("PASS: 空文字の回答はSupabaseへ到達する前に拒否される（共通化後も変わらない）");
}

{
  resetFromMock();
  // ゲストセッションへ切り替える
  useAuthStore.setState({
    user: { id: "guest-1", is_anonymous: true } as unknown as ReturnType<typeof useAuthStore.getState>["user"],
    loading: false,
  });
  useProfileStore.setState({
    profile: { id: "guest-1", isGuest: true } as unknown as ReturnType<typeof useProfileStore.getState>["profile"],
    loading: false,
  });
  useLiveFollowerStore.setState({
    currentTurn: makeTurn(),
    myParticipant: makeParticipant({ id: "participant-1" }),
    myAnswerCount: 0,
  });
  const guestResult = await useLiveFollowerStore.getState().submitMyAnswer("ゲストの回答");
  assert.equal(guestResult.ok, false, "ゲストの回答がSupabaseまで到達してしまう");
  assert.equal(fromCalls.length, 0, "ゲストなのにanswersテーブルへ書き込みが発生している");
  console.log("PASS: ゲストの回答はSupabaseへ到達する前に拒否される（共通化後も変わらない）");
}

// ---- submitMyScore ----
{
  resetFromMock();
  resetToLoggedInMember();
  useLiveFollowerStore.setState({
    activeAnswer: makeAnswer(),
    myParticipant: makeParticipant({ id: "participant-judge" }),
    myScore: null,
  });
  const result = await useLiveFollowerStore.getState().submitMyScore(3);
  assert.equal(result.ok, true, "正常な採点が成功しない");
  assert.equal(fromCalls.length, 1, "scoresテーブルへの書き込みが1回でない");
  assert.equal(fromCalls[0].table, "scores", "採点が別テーブルへ書き込まれている");
  assert.deepEqual(
    fromCalls[0].payload,
    { answer_id: "answer-1", judge_participant_id: "participant-judge", points: 3 },
    "採点の引数(answer_id/judge_participant_id/points)が共通化前と変わっている",
  );
  console.log("PASS: submitMyScoreは共用部品から渡された点数で、scoresテーブルへ1回だけ正しい引数で書き込む");
}

{
  resetFromMock();
  resetToLoggedInMember();
  useLiveFollowerStore.setState({
    activeAnswer: makeAnswer(),
    myParticipant: makeParticipant({ id: "participant-judge" }),
    myScore: 2, // 既に採点済み
  });
  const dup = await useLiveFollowerStore.getState().submitMyScore(3);
  assert.equal(dup.ok, false, "採点済みなのに2回目の採点が成功してしまう");
  assert.equal(fromCalls.length, 0, "採点済みなのにscoresテーブルへ書き込みが発生している");
  console.log("PASS: 同じ回答への2回目の採点はSupabaseへ到達する前に拒否される（重複送信防止、共通化後も変わらない）");
}

console.log("ALL USE_LIVE_FOLLOWER_STORE_ANSWER_SCORE CHECKS PASSED");
}

main();
