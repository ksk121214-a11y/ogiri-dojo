// useProfileStore.ts の「ログイン中ユーザーの切り替え」時の挙動（2026-09-13、
// 0070ゲスト参加の再レビュー対応）を「本番と同じ実装のまま」呼び出して検証する
// スクリプト。実行方法はsrc/lib/__tests__/run.sh参照（useSnsStoreDelete.check.ts等と
// 同様、専用tsconfig＋requireフック経由）。
//
// 検証すること：
//   - 会員A→会員Bへ切り替えた瞬間（Bのprofile取得が完了する前）、Aのprofileが
//     即座にnullへ戻る（Aの名前・ポイント等が一瞬でも残らない）。
//   - 会員A→ゲスト（匿名）へ切り替えた場合も同様。
//   - 連続切り替え（A→B→C）で、遅れて届いたA・B向けの取得結果が、Cのstateを
//     上書きしない（最後に切り替えた利用者の結果だけが反映される）。
import assert from "node:assert/strict";

// supabase.auth.getSession/onAuthStateChange（useAuthStore.tsの起動時セッション
// 復元）・supabase.from("profiles")（useProfileStore.tsのfetchProfile/update系）を
// モックしてから、useAuthStore/useProfileStoreを読み込む。この2ストアはどちらも
// `if (typeof window !== "undefined")`ブロックでモジュール読み込み時に副作用
// （セッション復元・store間のsubscribe配線）を行うため、global.windowを設定した
// 状態でrequireする必要がある（importの静的hoistを避けるため、意図的にrequireを使う）。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { supabase } = require("@/lib/supabase") as typeof import("@/lib/supabase");

type ProfileRow = {
  id: string;
  display_name: string;
  display_name_set: boolean;
  x_username: string | null;
  avatar_url: string | null;
  role: string;
  avatar_icon: string;
  avatar_color: string;
  bio: string | null;
  mastery_meter: number;
  total_points: number;
  points_balance: number;
  live_count: number;
  award_count_first: number;
  award_count_second: number;
  award_count_third: number;
  best_answer_count: number;
  tickets_count: number;
  tickets_next_recovery_at: string | null;
  is_guest: boolean;
};

function makeProfileRow(id: string, overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id,
    display_name: `名前-${id}`,
    display_name_set: true,
    x_username: null,
    avatar_url: null,
    role: "user",
    avatar_icon: "default",
    avatar_color: "#c8320c",
    bio: "",
    mastery_meter: 0,
    total_points: 0,
    points_balance: 0,
    live_count: 0,
    award_count_first: 0,
    award_count_second: 0,
    award_count_third: 0,
    best_answer_count: 0,
    tickets_count: 5,
    tickets_next_recovery_at: null,
    is_guest: false,
    ...overrides,
  };
}

// userIdごとに「fetchProfileの結果をいつ返すか」を制御するための待機ハンドル。
const deferredByUserId = new Map<string, { promise: Promise<void>; resolve: () => void }>();
const rowByUserId = new Map<string, ProfileRow | null>();
const selectCallLog: string[] = [];

function makeDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function armDeferredFetch(userId: string, row: ProfileRow | null) {
  rowByUserId.set(userId, row);
  deferredByUserId.set(userId, makeDeferred());
}

// supabase.from("profiles")の最小限のフルエントモック。
// select().eq().single() と update(...).eq().select().single() の2パターンだけ
// 対応する（useProfileStore.tsが実際に使うチェーンそのまま）。
(supabase as unknown as { from: (table: string) => unknown }).from = (table: string) => {
  assert.equal(table, "profiles", `想定外のテーブルがfromされた: ${table}`);
  let mode: "select" | "update" = "select";
  let targetUserId: string | null = null;
  const chain = {
    select: () => chain,
    update: () => {
      mode = "update";
      return chain;
    },
    eq: (_col: string, val: string) => {
      targetUserId = val;
      return chain;
    },
    single: async () => {
      if (mode === "select") selectCallLog.push(targetUserId ?? "?");
      const userId = targetUserId as string;
      const deferred = deferredByUserId.get(userId);
      if (deferred) await deferred.promise;
      const row = rowByUserId.get(userId) ?? null;
      if (!row) return { data: null, error: { message: "not found" } };
      return { data: row, error: null };
    },
  };
  return chain;
};

(supabase.auth as unknown as { getSession: () => Promise<{ data: { session: null } }> }).getSession = async () => ({
  data: { session: null },
});
(
  supabase.auth as unknown as {
    onAuthStateChange: () => { data: { subscription: { unsubscribe: () => void } } };
  }
).onAuthStateChange = () => ({ data: { subscription: { unsubscribe: () => {} } } });

// useProfileStore.ts経由でuseUserStore.ts（zustandのpersistミドルウェア、
// localStorageを使う）へも書き込みが起きるため、最小限のin-memory localStorage
// モックも用意する（本物のブラウザ環境が無いNode実行のため）。
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useAuthStore } = require("@/store/useAuthStore") as typeof import("@/store/useAuthStore");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useProfileStore } = require("@/store/useProfileStore") as typeof import("@/store/useProfileStore");

function setAuthUser(id: string | null, isAnonymous = false) {
  useAuthStore.setState({
    user: id ? ({ id, is_anonymous: isAnonymous } as unknown as ReturnType<typeof useAuthStore.getState>["user"]) : null,
    loading: false,
  });
}

// Promise.resolve()の連打だけだと、モックのチェーン呼び出しの深さによっては
// マイクロタスクのフラッシュ回数が足りないことがあるため、実際に1マクロタスク
// （setTimeout）待つことで、保留中の全マイクロタスクを確実に消化する。
async function waitMicrotasks() {
  await new Promise((r) => setTimeout(r, 0));
}

async function main() {
  // useAuthStore.ts自体のモジュール読み込み時セッション復元
  // （supabase.auth.getSession().then(...)、モックはuser:null相当を返す）が
  // 完了するのを待ってから、以降のsetAuthUser呼び出しを行う。これを待たずに
  // setAuthUserを呼ぶと、後から解決するgetSession().then()のコールバックが
  // user:nullで上書きし、テスト自身のsetAuthUserの結果と競合してしまう
  // （実装のバグではなく、モック環境固有の初期化順序の問題）。
  await waitMicrotasks();

  // ---- テスト1: 会員A→会員Bへの切り替えで、Bの取得完了前にAのprofileが
  //      即座にnullへ戻る。 ----
  armDeferredFetch("userA", makeProfileRow("userA", { display_name: "会員A" }));
  deferredByUserId.get("userA")!.resolve();
  setAuthUser("userA");
  await waitMicrotasks();
  assert.equal(useProfileStore.getState().profile?.id, "userA", "会員Aのprofileが読み込まれていない");
  assert.equal(useProfileStore.getState().profile?.displayName, "会員A");

  armDeferredFetch("userB", makeProfileRow("userB", { display_name: "会員B" }));
  // Bの取得はまだ解決させない。
  setAuthUser("userB");
  assert.equal(
    useProfileStore.getState().profile,
    null,
    "会員A→会員Bへ切り替えた瞬間、Bの取得完了前にAのprofileがnullへ戻っていない",
  );
  assert.equal(useProfileStore.getState().loading, true, "切り替え直後、loadingがtrueになっていない");

  deferredByUserId.get("userB")!.resolve();
  await waitMicrotasks();
  assert.equal(useProfileStore.getState().profile?.id, "userB", "会員Bのprofileが反映されていない");
  assert.equal(useProfileStore.getState().profile?.displayName, "会員B", "会員Aの名前が残っている（前の利用者のデータ漏れ）");
  console.log("PASS: 会員A→会員Bへの切り替えで、Bの取得完了前にAのprofileが即座にnullへ戻り、完了後は正しくBのprofileになる");

  // ---- テスト2: 会員A→ゲスト（匿名）への切り替えでも同様。 ----
  armDeferredFetch("userA2", makeProfileRow("userA2", { display_name: "会員A2" }));
  deferredByUserId.get("userA2")!.resolve();
  setAuthUser("userA2");
  await waitMicrotasks();
  assert.equal(useProfileStore.getState().profile?.id, "userA2");

  armDeferredFetch("guestX", makeProfileRow("guestX", { display_name: "ゲスト", is_guest: true, tickets_count: 0 }));
  setAuthUser("guestX", true);
  assert.equal(
    useProfileStore.getState().profile,
    null,
    "会員A→ゲストへ切り替えた瞬間、ゲストの取得完了前に会員Aのprofileがnullへ戻っていない",
  );

  deferredByUserId.get("guestX")!.resolve();
  await waitMicrotasks();
  assert.equal(useProfileStore.getState().profile?.id, "guestX");
  assert.equal(useProfileStore.getState().profile?.isGuest, true, "ゲストのprofile.isGuestがtrueになっていない");
  console.log("PASS: 会員A→ゲストへの切り替えでも、取得完了前に会員Aのprofileが即座にnullへ戻り、完了後は正しくゲストのprofileになる");

  // ---- テスト3: 連続切り替え（A→B→C）で、遅れて届いたA・B向けの取得結果を
  //      Cのstateへ反映しない（最後の切り替え＝Cの結果だけが反映される）。 ----
  armDeferredFetch("raceA", makeProfileRow("raceA", { display_name: "race-A" }));
  armDeferredFetch("raceB", makeProfileRow("raceB", { display_name: "race-B" }));
  armDeferredFetch("raceC", makeProfileRow("raceC", { display_name: "race-C" }));
  setAuthUser("raceA");
  setAuthUser("raceB");
  setAuthUser("raceC");
  assert.equal(useProfileStore.getState().profile, null, "連続切り替え直後もprofileはnullのはず");

  // 遅れてA・Bの結果が届いても、現在の認証ユーザー(raceC)と一致しないため無視される。
  deferredByUserId.get("raceA")!.resolve();
  await waitMicrotasks();
  assert.equal(useProfileStore.getState().profile, null, "古いraceAの取得結果が反映されてしまっている");

  deferredByUserId.get("raceB")!.resolve();
  await waitMicrotasks();
  assert.equal(useProfileStore.getState().profile, null, "古いraceBの取得結果が反映されてしまっている");

  deferredByUserId.get("raceC")!.resolve();
  await waitMicrotasks();
  assert.equal(useProfileStore.getState().profile?.id, "raceC", "最後に切り替えたraceCの結果が反映されていない");
  console.log("PASS: 連続切り替え（A→B→C）で、遅れて届いた古い利用者向けの取得結果はstateへ反映されず、最後の利用者の結果だけが反映される");

  console.log("ALL USE_PROFILE_STORE_SWITCH CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
