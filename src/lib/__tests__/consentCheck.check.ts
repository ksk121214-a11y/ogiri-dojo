// src/lib/consentCheck.ts（ConsentRequiredGate.tsxが使う、同意確認ロジックの
// 純粋な中核部分）の検証。window/Supabaseクライアントに依存しないため、
// 専用tsconfig無しでこのファイル単体として実行できる（src/lib/__tests__/run.sh
// のSOURCE_FILES経由）。
import assert from "node:assert/strict";

import {
  checkConsentForUser,
  CONSENT_CHECK_ERROR_MESSAGE,
  GenerationGuard,
  PENDING_CONSENT_TTL_MS,
  type ConsentCheckDeps,
  type PendingConsentFlag,
} from "../consentCheck";

const TERMS_VERSION = "2026-09-25-v1";
const PRIVACY_VERSION = "2026-09-25-v1";
const NOW = 1_000_000_000_000; // 固定の「現在時刻」（テストの再現性のため）

function pendingFlag(overrides: Partial<PendingConsentFlag> = {}): PendingConsentFlag {
  return {
    kind: "x-login",
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    createdAt: NOW,
    ...overrides,
  };
}

function baseDeps(overrides: Partial<ConsentCheckDeps> = {}): ConsentCheckDeps {
  return {
    readPendingFlag: () => null,
    clearPendingFlag: () => {},
    recordConsent: async () => ({ error: null }),
    hasCurrentConsentRow: async () => ({ ok: true, exists: false }),
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    isAnonymousUser: false,
    now: () => NOW,
    ...overrides,
  };
}

async function main() {
  // ---- テスト1: 記録待ちフラグの操作種別(kind)が現在のログイン種別と一致し、
  //      バージョンも一致し、有効期限内であれば記録を試み、成功時は即座に
  //      acceptedを返す（hasCurrentConsentRowは呼ばれない）。記録後は
  //      clearPendingFlagが呼ばれる。 ----
  {
    let hasCurrentCalled = false;
    let clearCalled = false;
    const r1 = await checkConsentForUser(
      "user-a",
      baseDeps({
        readPendingFlag: () => pendingFlag({ kind: "x-login" }),
        clearPendingFlag: () => {
          clearCalled = true;
        },
        isAnonymousUser: false, // Xログイン中のセッション
        recordConsent: async () => ({ error: null }),
        hasCurrentConsentRow: async () => {
          hasCurrentCalled = true;
          return { ok: true, exists: false };
        },
      }),
    );
    assert.deepEqual(r1, { kind: "accepted" });
    assert.equal(hasCurrentCalled, false, "記録待ちフラグでの記録が成功したのに、余計にhasCurrentConsentRowが呼ばれた");
    assert.equal(clearCalled, true, "記録に成功したのに保留フラグがclearPendingFlagで消去されていない");
  }
  console.log("PASS: 種別・バージョンが一致し有効期限内の記録待ちフラグは、記録に成功すると即座にacceptedになり、保留フラグは消去される");

  // ---- テスト2: 記録待ちフラグは信頼できる（種別・バージョン一致、期限内）が、
  //      記録(RPC)自体が失敗した場合、フラグを消去せず残したまま、通常の
  //      hasCurrentConsentRow判定へフォールスルーする（同意済み扱いにしない。
  //      次回リトライできるようにする）。 ----
  {
    let clearCalled = false;
    const r2 = await checkConsentForUser(
      "user-a",
      baseDeps({
        readPendingFlag: () => pendingFlag(),
        clearPendingFlag: () => {
          clearCalled = true;
        },
        recordConsent: async () => ({ error: { message: "network error" } }),
        hasCurrentConsentRow: async () => ({ ok: true, exists: false }),
      }),
    );
    assert.deepEqual(r2, { kind: "consent-required" }, "記録失敗時にフォールスルーせず同意済み扱いになってしまった");
    assert.equal(clearCalled, false, "記録自体が失敗したのに保留フラグを消去してしまった（次回リトライできなくなる）");
  }
  console.log("PASS: 信頼できる記録待ちフラグでも記録自体が失敗した場合は、同意済み扱いにせずフラグも残したまま通常判定へフォールスルーする");

  // ---- テスト3: 記録待ちフラグが無い場合、現在バージョンに一致する同意記録が
  //      存在すればaccepted。 ----
  const r3 = await checkConsentForUser("user-a", baseDeps({ hasCurrentConsentRow: async () => ({ ok: true, exists: true }) }));
  assert.deepEqual(r3, { kind: "accepted" });
  console.log("PASS: 現在バージョンに一致する同意記録が存在すればaccepted");

  // ---- テスト4: 存在しなければconsent-required。 ----
  const r4 = await checkConsentForUser("user-a", baseDeps({ hasCurrentConsentRow: async () => ({ ok: true, exists: false }) }));
  assert.deepEqual(r4, { kind: "consent-required" });
  console.log("PASS: 現在バージョンに一致する同意記録が存在しなければconsent-required");

  // ---- テスト5: DB確認自体が失敗した場合はerror（同意済みと誤判定しない）。 ----
  const r5 = await checkConsentForUser("user-a", baseDeps({ hasCurrentConsentRow: async () => ({ ok: false }) }));
  assert.deepEqual(r5, { kind: "error", message: CONSENT_CHECK_ERROR_MESSAGE });
  console.log("PASS: 同意状況の確認自体が失敗した場合はerrorになり、同意済みと誤判定しない");

  // ---- テスト6: 記録待ちフラグのバージョンが現在バージョンと異なる場合は、
  //      取り違え防止のため信頼せず消去し、通常のhasCurrentConsentRow判定が
  //      使われる。 ----
  {
    let clearCalled = false;
    const r6 = await checkConsentForUser(
      "user-a",
      baseDeps({
        readPendingFlag: () => pendingFlag({ termsVersion: "old-v0", privacyVersion: "old-v0" }),
        clearPendingFlag: () => {
          clearCalled = true;
        },
        hasCurrentConsentRow: async () => ({ ok: true, exists: true }),
      }),
    );
    assert.deepEqual(r6, { kind: "accepted" });
    assert.equal(clearCalled, true, "バージョンが一致しない保留フラグが消去されていない");
  }
  console.log("PASS: バージョンが一致しない記録待ちフラグは信頼されず消去され、通常判定が使われる");

  // ---- テスト7（共有端末での取り違え対策）：Xログイン用（kind:"x-login"）の
  //      保留同意が、実際には匿名（ゲスト）セッションに対して自動適用されない
  //      （種別の不一致）。取り違え防止のためフラグは消去される。 ----
  {
    let recordCalled = false;
    let clearCalled = false;
    const r7 = await checkConsentForUser(
      "user-guest",
      baseDeps({
        readPendingFlag: () => pendingFlag({ kind: "x-login" }),
        clearPendingFlag: () => {
          clearCalled = true;
        },
        isAnonymousUser: true, // 実際にはゲスト（匿名）セッション
        recordConsent: async () => {
          recordCalled = true;
          return { error: null };
        },
        hasCurrentConsentRow: async () => ({ ok: true, exists: false }),
      }),
    );
    assert.deepEqual(r7, { kind: "consent-required" }, "Xログイン用の保留同意がゲストセッションへ誤って適用されてしまった");
    assert.equal(recordCalled, false, "種別が不一致なのにrecordConsent（DB記録）が呼ばれてしまった");
    assert.equal(clearCalled, true, "種別が不一致の保留フラグが消去されていない");
  }
  console.log("PASS: Xログイン用の保留同意は、実際のセッションが匿名（ゲスト）の場合は適用されず、取り違え防止のため消去される");

  // ---- テスト8（共有端末での取り違え対策）：ゲスト用（kind:"guest"）の保留
  //      同意が、実際にはXログイン（非匿名）セッションに対して自動適用されない
  //      （種別の不一致、逆方向）。 ----
  {
    let recordCalled = false;
    let clearCalled = false;
    const r8 = await checkConsentForUser(
      "user-x",
      baseDeps({
        readPendingFlag: () => pendingFlag({ kind: "guest" }),
        clearPendingFlag: () => {
          clearCalled = true;
        },
        isAnonymousUser: false, // 実際にはXログイン済みセッション
        recordConsent: async () => {
          recordCalled = true;
          return { error: null };
        },
        hasCurrentConsentRow: async () => ({ ok: true, exists: false }),
      }),
    );
    assert.deepEqual(r8, { kind: "consent-required" }, "ゲスト用の保留同意がX会員セッションへ誤って適用されてしまった");
    assert.equal(recordCalled, false, "種別が不一致なのにrecordConsent（DB記録）が呼ばれてしまった");
    assert.equal(clearCalled, true, "種別が不一致の保留フラグが消去されていない");
  }
  console.log("PASS: ゲスト用の保留同意は、実際のセッションがX会員（非匿名）の場合は適用されず、取り違え防止のため消去される");

  // ---- テスト9（共有端末での取り違え対策）：作成から一定時間
  //      （PENDING_CONSENT_TTL_MS）を過ぎた保留同意は、種別・バージョンが
  //      一致していても使用されず、取り違え防止のため消去される。 ----
  {
    let recordCalled = false;
    let clearCalled = false;
    const r9 = await checkConsentForUser(
      "user-a",
      baseDeps({
        readPendingFlag: () => pendingFlag({ kind: "x-login", createdAt: NOW - PENDING_CONSENT_TTL_MS - 1 }),
        clearPendingFlag: () => {
          clearCalled = true;
        },
        isAnonymousUser: false,
        now: () => NOW,
        recordConsent: async () => {
          recordCalled = true;
          return { error: null };
        },
        hasCurrentConsentRow: async () => ({ ok: true, exists: false }),
      }),
    );
    assert.deepEqual(r9, { kind: "consent-required" }, "期限切れの保留同意が使用されてしまった");
    assert.equal(recordCalled, false, "期限切れなのにrecordConsent（DB記録）が呼ばれてしまった");
    assert.equal(clearCalled, true, "期限切れの保留フラグが消去されていない");
  }
  console.log("PASS: 有効期限を過ぎた保留同意は、種別・バージョンが一致していても使用されず、取り違え防止のため消去される");

  // ---- テスト10（世代ガード・競合防止）：ユーザーAの取得が遅延している間に
  //      ユーザーBへ切り替わった場合、Aの遅延結果が「現在の世代」と判定されず、
  //      呼び出し側がその結果を破棄できることを確認する。 ----
  const guard = new GenerationGuard();
  const genA = guard.next(); // ユーザーA表示開始
  assert.equal(guard.isCurrent(genA), true, "切り替え前はAの世代が最新のはず");

  const genB = guard.next(); // ユーザーBへ切り替え（Aの取得はまだ未完了）
  assert.equal(guard.isCurrent(genA), false, "Bへ切り替わった後もAの世代が最新のままになっている（古い結果が反映されてしまう）");
  assert.equal(guard.isCurrent(genB), true, "Bへ切り替わった後はBの世代が最新であるべき");

  // 実際のchecker呼び出しでも同じことを確認する：Aは遅延・失敗寄りの結果、
  // Bは即座にacceptedを返す状況を模して、両方のPromiseが解決した後、
  // 「Aの結果は世代ガードにより無視すべき」と呼び出し側が判定できることを見る。
  let resolveADeferred!: () => void;
  const aDeferred = new Promise<void>((resolve) => {
    resolveADeferred = resolve;
  });
  const guard2 = new GenerationGuard();
  const genA2 = guard2.next();
  const resultAPromise = checkConsentForUser(
    "user-a",
    baseDeps({
      hasCurrentConsentRow: async () => {
        await aDeferred; // ユーザーBへの切り替えが起きるまで完了しない
        return { ok: true, exists: true };
      },
    }),
  );
  const genB2 = guard2.next(); // Aの取得完了前にBへ切り替え
  const resultB = await checkConsentForUser("user-b", baseDeps({ hasCurrentConsentRow: async () => ({ ok: true, exists: false }) }));
  assert.equal(guard2.isCurrent(genB2), true, "Bの世代が最新であるべき");
  // Bの結果はconsent-requiredとして反映してよい（現在の世代のため）。
  assert.deepEqual(resultB, { kind: "consent-required" });

  resolveADeferred();
  const resultA = await resultAPromise;
  // Aの取得は最終的にacceptedを返すが、この時点でgenA2は既に古い世代のため、
  // 呼び出し側はresultAをstateへ反映してはいけない（guard2.isCurrent(genA2)がfalse）。
  assert.deepEqual(resultA, { kind: "accepted" });
  assert.equal(
    guard2.isCurrent(genA2),
    false,
    "Aの取得が遅れて完了した時点でAの世代は既に古いはずなのに、まだ最新扱いになっている（古いユーザーの結果が新しいユーザーへ反映されるバグ）",
  );
  console.log("PASS: ユーザーAの取得が遅延している間にユーザーBへ切り替わった場合、世代ガードによりAの遅延結果は古い世代と判定され、呼び出し側で破棄できる");

  // ---- テスト11（再々監査対応：ConsentRequiredGate.handleAgree/useEffectの
  //      競合防止）：ConsentRequiredGateの実装を忠実に模した小さなハーネスで、
  //      「Aが同意保存中にBへ切り替わる」一連の流れを検証する。
  //        1. Aで同意保存を開始する
  //        2. 保存中にBへ切り替わる（useEffect相当：世代を進めsubmittingをfalseへ戻す）
  //        3. Bではsubmittingがfalseへ戻り、同意操作できる
  //        4. Bが同意保存を開始する
  //        5. その後Aの古いRPCが成功または失敗する
  //        6. Aの結果でBのaccepted・エラー・localStorage・submittingが変化しない
  //        7. B自身の処理完了時だけBの状態が更新される
  //      handleAgree同様、世代の一致だけでなく「保存完了時点の実際の認証済み
  //      userId」との一致も確認する（startedUserIdパターン）。 ----
  {
    interface FakeGate {
      guard: GenerationGuard;
      currentAuthUserId: string | null; // useAuthStore.getState().user?.id相当
      submitting: boolean;
      status: { kind: string };
      ackedLocalStorage: string | null; // markDeviceConsentAck()相当（localStorageの記録内容）
      agreeError: string | null;
    }

    function createFakeGate(): FakeGate {
      return {
        guard: new GenerationGuard(),
        currentAuthUserId: null,
        submitting: false,
        status: { kind: "unauthenticated" },
        ackedLocalStorage: null,
        agreeError: null,
      };
    }

    // ConsentRequiredGateのuseEffect（authLoading/userIdの変化を検知する部分）
    // をそのまま模す：世代を進め、agreeError/checked/submittingをリセットし、
    // 新しいuserIdに応じた状態にする（このテストではauthLoadingは常にfalse
    // として省略し、userIdの変化だけを扱う）。
    function simulateUserIdChange(gate: FakeGate, newUserId: string | null): number {
      const myGeneration = gate.guard.next();
      gate.agreeError = null;
      gate.submitting = false; // 修正要件1：世代を進めるuseEffect自身がsubmittingを戻す
      gate.currentAuthUserId = newUserId;
      gate.status = newUserId ? { kind: "consent-required" } : { kind: "unauthenticated" };
      return myGeneration;
    }

    // handleAgreeをそのまま模す：開始時点の世代とuserId（startedUserId）を
    // 記録し、保存RPC完了後にguard.isCurrent()とcurrentAuthUserId===startedUserId
    // の両方が揃った場合だけ状態を反映する。
    async function simulateHandleAgree(gate: FakeGate, saveResult: Promise<{ error: unknown }>): Promise<void> {
      if (gate.submitting) return;
      const myGeneration = gate.guard.peek();
      const startedUserId = gate.currentAuthUserId;
      const ownsThisAttempt = () => gate.guard.isCurrent(myGeneration) && gate.currentAuthUserId === startedUserId;
      gate.submitting = true;
      gate.agreeError = null;
      const { error } = await saveResult;
      if (!ownsThisAttempt()) return; // 修正要件4：所有権を失った結果は一切反映しない
      if (error) {
        gate.agreeError = "同意内容を保存できませんでした。時間をおいて再度お試しください。";
        gate.submitting = false;
        return;
      }
      gate.ackedLocalStorage = startedUserId;
      gate.status = { kind: "accepted" };
      gate.submitting = false;
    }

    async function runScenario(aLateResult: { error: unknown }) {
      const gate = createFakeGate();

      // 1. Aとしてログインし、consent-required画面でAが同意保存を開始する。
      simulateUserIdChange(gate, "user-a");
      let resolveA!: (value: { error: unknown }) => void;
      const aSave = new Promise<{ error: unknown }>((resolve) => {
        resolveA = resolve;
      });
      const aPromise = simulateHandleAgree(gate, aSave);
      assert.equal(gate.submitting, true, "Aの保存開始直後はsubmittingがtrueのはず");

      // 2. Aの保存が完了する前にBへ切り替わる。
      simulateUserIdChange(gate, "user-b");
      // 3. Bではsubmittingがfalseへ戻り、同意操作できる。
      assert.equal(gate.submitting, false, "Bへ切り替わった直後にsubmittingがfalseへ戻っていない（修正要件1）");

      // 4. Bが同意保存を開始する。
      let resolveB!: (value: { error: unknown }) => void;
      const bSave = new Promise<{ error: unknown }>((resolve) => {
        resolveB = resolve;
      });
      const bPromise = simulateHandleAgree(gate, bSave);
      assert.equal(gate.submitting, true, "Bの保存開始直後はsubmittingがtrueのはず");

      // 5. その後Aの古いRPCが成功または失敗する。
      resolveA(aLateResult);
      await aPromise;

      // 6. Aの結果でBのaccepted・エラー・localStorage・submittingが変化しない。
      assert.notEqual(gate.ackedLocalStorage, "user-a", "Aの遅延結果がlocalStorageへuser-aとして記録されてしまった");
      assert.deepEqual(gate.status, { kind: "consent-required" }, "Aの遅延結果でBのstatusが書き換わってしまった");
      assert.equal(gate.agreeError, null, "Aの遅延結果でBのエラー表示が書き換わってしまった");
      assert.equal(
        gate.submitting,
        true,
        "Aの遅延結果の処理で、B自身が処理中のsubmittingがfalseへ戻されてしまった（修正要件4）",
      );

      // 7. B自身の処理完了時だけBの状態が更新される。
      resolveB({ error: null });
      await bPromise;
      assert.equal(gate.ackedLocalStorage, "user-b", "B自身の保存成功がlocalStorageへuser-bとして記録されていない");
      assert.deepEqual(gate.status, { kind: "accepted" }, "B自身の保存完了でstatusがacceptedにならなかった");
      assert.equal(gate.submitting, false, "B自身の保存完了でsubmittingがfalseに戻らなかった");
    }

    // Aの遅延結果が「成功」だった場合。
    await runScenario({ error: null });
    // Aの遅延結果が「失敗」だった場合。
    await runScenario({ error: { message: "network error" } });
  }
  console.log(
    "PASS: Aが同意保存中にBへ切り替わった場合、切替時点でBのsubmittingがfalseへ戻り、Bが同意操作・保存を開始できる。Aの古いRPCが（成功・失敗いずれでも）後から完了しても、Bのaccepted・エラー表示・localStorage・submittingは一切変化せず、B自身の保存完了時だけBの状態が更新される",
  );

  console.log("ALL CONSENT_CHECK CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
