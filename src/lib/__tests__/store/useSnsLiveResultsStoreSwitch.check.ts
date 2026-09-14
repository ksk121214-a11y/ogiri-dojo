// useSnsLiveResultsStore.ts の「ログイン中ユーザーの切り替え」時の挙動
// （2026-09-13、再々レビュー2回目対応）を「本番と同じ実装のまま」呼び出して
// 検証するスクリプト。実行方法はsrc/lib/__tests__/run.sh参照。
//
// 検証すること：
//   1) 認証が既に確定した状態（loading:false）でこのモジュールが読み込まれた
//      場合、その時点のuserIdが正しく初期値として扱われる。したがって、
//      「認証済みの状態でモジュールを読み込む→詳細取得→最初のアカウント切替」でも
//      その最初の切替がちゃんとgenerationを進めてdetails・いいね状態をリセットする
//      （切替が「初期値の設定」として誤魔化されない）。
//   2) 古い世代（切替前）のfetchDetailが遅れて完了しても、新しい世代（切替後）が
//      同じliveResultIdへ既に開始していたfetchDetailのdetailLoadingを消さない。
import assert from "node:assert/strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { supabase } = require("@/lib/supabase") as typeof import("@/lib/supabase");

// ---- sns_live_results（fetchDetailの最初のクエリ）だけを呼び出し順に手動で
//      解決できるようにするゲート機構。他のテーブルは即座に解決する。----
type Resolver = () => void;
let liveResultCallSeq = 0;
// callIndex（0始まり）ごとに、保留するかどうかを指定する。指定が無いコールは
// 即座に解決する。
const heldCallIndices = new Set<number>();
const pendingResolvers = new Map<number, Resolver>();

function holdLiveResultCall(callIndex: number) {
  heldCallIndices.add(callIndex);
}
function releaseLiveResultCall(callIndex: number) {
  const resolve = pendingResolvers.get(callIndex);
  if (resolve) {
    pendingResolvers.delete(callIndex);
    resolve();
  }
}

// live_result_id -> 返す行（無ければnullを返す＝!resultData経路）。
const liveResultRowById = new Map<string, { id: string; live_id: string; manager_best_answer_id: null; manager_comment: null }>();
const liveRowById = new Map<string, { id: string; official_sequence_number: number; title: null; ended_at: null; results_published: boolean }>();

function makeSafeChain(resolveValue: () => unknown) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => resolveValue(),
    single: async () => resolveValue(),
    then: (resolve: (v: unknown) => void) => Promise.resolve(resolveValue()).then(resolve),
  };
  return chain;
}

(supabase as unknown as { from: (table: string) => unknown }).from = (table: string) => {
  if (table === "sns_live_results") {
    let targetId: string | null = null;
    const callIndex = liveResultCallSeq++;
    const chain = {
      select: () => chain,
      eq: (_col: string, val: string) => {
        targetId = val;
        return chain;
      },
      maybeSingle: async () => {
        if (heldCallIndices.has(callIndex)) {
          await new Promise<void>((resolve) => pendingResolvers.set(callIndex, resolve));
        }
        const row = liveResultRowById.get(targetId ?? "") ?? null;
        return { data: row, error: null };
      },
    };
    return chain;
  }

  if (table === "lives") {
    let targetId: string | null = null;
    const chain = {
      select: () => chain,
      eq: (_col: string, val: string) => {
        if (_col === "id") targetId = val;
        return chain;
      },
      maybeSingle: async () => {
        const row = liveRowById.get(targetId ?? "") ?? null;
        return { data: row, error: null };
      },
    };
    return chain;
  }

  if (table === "sns_live_result_answers") {
    // このテストでは掲載回答を持たないライブ結果だけを扱うため、常に空配列を
    // 返す（answers/turns/topics/participants/comments/likesへの後続クエリが
    // すべてスキップされ、テストがシンプルになる）。
    return makeSafeChain(() => ({ data: [], error: null }));
  }

  // それ以外のテーブル（useSnsStore.ts/useProfileStore.tsの自動init()等、この
  // テストの主目的とは無関係な副作用）は、常にdata:nullで安全に解決する
  // （fetchProfile等が「取得失敗」として素直に扱える値にする）。
  return makeSafeChain(() => ({ data: null, error: null, count: 0 }));
};

(supabase as unknown as { rpc: (name: string, args: unknown) => Promise<{ data: unknown; error: null }> }).rpc =
  async () => ({ data: [], error: null });

(supabase.auth as unknown as {
  getSession: () => Promise<{ data: { session: { user: { id: string; is_anonymous: boolean } } | null } }>;
}).getSession = async () => ({
  data: { session: { user: { id: "userA", is_anonymous: false } } },
});
(
  supabase.auth as unknown as {
    onAuthStateChange: () => { data: { subscription: { unsubscribe: () => void } } };
  }
).onAuthStateChange = () => ({ data: { subscription: { unsubscribe: () => {} } } });

const memoryLocalStorage = new Map<string, string>();
(global as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (key: string) => memoryLocalStorage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryLocalStorage.set(key, value);
    },
    removeItem: (key: string) => {
      memoryLocalStorage.delete(key);
    },
  },
};

async function waitMicrotasks() {
  await new Promise((r) => setTimeout(r, 0));
}

async function main() {
  // ---- 準備：useAuthStoreはモック済みgetSession()により、モジュール読み込み
  //      直後の非同期解決で自然にuserA・loading:falseへ確定する。この解決を
  //      待ってから（＝「認証が既に確定した状態」を作ってから）本題の
  //      useSnsLiveResultsStoreを読み込む。----
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAuthStore } = require("@/store/useAuthStore") as typeof import("@/store/useAuthStore");
  await waitMicrotasks();
  await waitMicrotasks();
  assert.equal(useAuthStore.getState().loading, false, "テスト前提が崩れている（useAuthStoreがまだloading中）");
  assert.equal(useAuthStore.getState().user?.id, "userA", "テスト前提が崩れている（userAで確定していない）");

  // ---- 本題：認証が既に確定した状態で、useSnsLiveResultsStoreを初めて読み込む。----
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useSnsLiveResultsStore } = require("@/store/useSnsLiveResultsStore") as
    typeof import("@/store/useSnsLiveResultsStore");

  liveResultRowById.set("lr1", { id: "lr1", live_id: "live1", manager_best_answer_id: null, manager_comment: null });
  liveRowById.set("live1", { id: "live1", official_sequence_number: 1, title: null, ended_at: null, results_published: true });

  // 会員Aとして詳細を取得する（このモジュールが読み込まれて以降、初めての
  // fetchDetail呼び出し）。
  await useSnsLiveResultsStore.getState().fetchDetail("lr1");
  assert.ok(useSnsLiveResultsStore.getState().details["lr1"], "会員Aの詳細取得が反映されていない");
  const generationAfterA = useSnsLiveResultsStore.getState().generation;

  // ---- 最初のアカウント切替（A→B）。以前はこの切替が「初期値の設定」として
  //      扱われ、Aのdetailsが消えなかった。----
  function setAuthUser(id: string | null, isAnonymous = false) {
    useAuthStore.setState({
      user: id ? ({ id, is_anonymous: isAnonymous } as unknown as ReturnType<typeof useAuthStore.getState>["user"]) : null,
      loading: false,
    });
  }
  setAuthUser("userB");
  await waitMicrotasks();

  assert.equal(
    useSnsLiveResultsStore.getState().generation,
    generationAfterA + 1,
    "認証済みモジュール読み込み後、最初のアカウント切替でgenerationが進んでいない",
  );
  assert.deepEqual(
    useSnsLiveResultsStore.getState().details,
    {},
    "認証済みモジュール読み込み後の最初のアカウント切替で、会員Aのdetailsが消えていない",
  );
  assert.deepEqual(
    useSnsLiveResultsStore.getState().likedResultAnswerIds,
    [],
    "認証済みモジュール読み込み後の最初のアカウント切替で、会員Aのいいね済み状態が消えていない",
  );
  console.log(
    "PASS: 認証済みの状態でモジュールを読み込んだ場合でも、最初のアカウント切替で正しくgeneration・details・いいね状態がリセットされる",
  );

  // ---- 古い世代のfetchDetailが遅れて完了しても、新しい世代が同じ
  //      liveResultIdへ既に開始していたdetailLoadingを消さない。----
  liveResultRowById.set("lr2", { id: "lr2", live_id: "live2", manager_best_answer_id: null, manager_comment: null });
  liveRowById.set("live2", { id: "live2", official_sequence_number: 2, title: null, ended_at: null, results_published: true });

  liveResultCallSeq = 0; // このシナリオ用にコール番号を振り直す。
  holdLiveResultCall(0); // userB（切替前）からの1回目の呼び出しを保留する。
  const staleFetch = useSnsLiveResultsStore.getState().fetchDetail("lr2"); // userBとして開始
  await waitMicrotasks(); // 保留ポイントまで進める

  // Bのまま留まらず、さらにCへ切り替える（世代が進み、detailLoading等がリセットされる）。
  setAuthUser("userC");
  await waitMicrotasks();

  holdLiveResultCall(1); // userC（切替後）の2回目の呼び出しも保留し、「新しい世代の
  // 処理がまだ完了していない」状態を作る。
  const freshFetch = useSnsLiveResultsStore.getState().fetchDetail("lr2"); // userCとして開始
  await waitMicrotasks();
  assert.equal(
    useSnsLiveResultsStore.getState().detailLoading["lr2"],
    true,
    "新しい世代(userC)のfetchDetailがdetailLoadingを立てていない",
  );

  // 古い世代(userB)の遅延処理を先に完了させる。
  releaseLiveResultCall(0);
  await staleFetch;
  assert.equal(
    useSnsLiveResultsStore.getState().detailLoading["lr2"],
    true,
    "古い世代の遅延処理が完了した際、新しい世代がまだ処理中のdetailLoadingを誤って消してしまった",
  );
  assert.equal(
    useSnsLiveResultsStore.getState().details["lr2"],
    undefined,
    "古い世代の遅延処理が、新しい世代のdetailsへ古い内容を書き込んでしまった",
  );
  console.log("PASS: 古い世代の遅延fetchDetailが完了しても、新しい世代が処理中のdetailLoadingを消さない");

  // 新しい世代(userC)自身の処理を完了させる。
  releaseLiveResultCall(1);
  await freshFetch;
  assert.equal(
    useSnsLiveResultsStore.getState().detailLoading["lr2"],
    undefined,
    "新しい世代自身の処理が完了したのにdetailLoadingが解除されていない",
  );
  assert.ok(useSnsLiveResultsStore.getState().details["lr2"], "新しい世代自身の処理が完了したのにdetailsへ反映されていない");
  console.log("PASS: 新しい世代自身のfetchDetailは正常に完了し、pendingが正しく解除される");

  console.log("ALL USE_SNS_LIVE_RESULTS_STORE_SWITCH CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
