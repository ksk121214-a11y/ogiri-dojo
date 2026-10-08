// /auth/callback（X認証の戻り先）の処理本体の検証。ブラウザ・Supabaseはダミーの環境で置き換え、
// 実際のトークン・Supabaseへの通信は一切行わない。トークンは明らかなダミー文字列だけを使う。
// エラーは、auth-js 2.110.2のAuthErrorと同じ形（__isAuthError・name・status・code）のダミーで模す。
// 検証の出力に、トークン・エラーのmessageを含めないこと。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AUTH_CALLBACK_MESSAGES,
  createAuthCallbackRunner,
  describeAuthError,
  parseAuthCallback,
  processAuthCallback,
  readJwtExpirySeconds,
  stripAuthParams,
  withTimeout,
  type ApiKeyProbeResult,
  type AuthCallbackEnvironment,
  type AuthCallbackLocation,
  type AuthCallbackOutcome,
  type AuthSessionLike,
} from "../authCallback";

type FailedOutcome = Extract<AuthCallbackOutcome, { ok: false }>;

// 失敗の結果であることを検査したうえで、失敗用の型として扱う。
function asFailure(outcome: AuthCallbackOutcome): FailedOutcome {
  assert.equal(outcome.ok, false, "失敗の結果を期待していた");
  return outcome as FailedOutcome;
}

const DUMMY_ACCESS = "dummy-access-token-AAAA";
const DUMMY_REFRESH = "dummy-refresh-token-BBBB";
const BASE_HREF = "https://app.example.invalid/auth/callback/";
const X_SESSION: AuthSessionLike = { access_token: DUMMY_ACCESS, user: { is_anonymous: false } };
const ANON_SESSION: AuthSessionLike = { user: { is_anonymous: true } };

// auth-jsのAuthErrorと同じ形のダミー。messageにはトークンを含めて、出力に混ざらないことを確かめる。
function authError(name: string, status: number | undefined, code: string | undefined): Error {
  return Object.assign(new Error(`raw supabase detail ${DUMMY_ACCESS} ${DUMMY_REFRESH}`), {
    __isAuthError: true,
    name,
    status,
    code,
  });
}

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// 署名部分は形式（base64url）だけを満たすダミー。
function dummyJwt(expSeconds: number): string {
  return `${encodeSegment({ alg: "HS256", typ: "JWT" })}.${encodeSegment({ sub: "dummy-user", exp: expSeconds })}.c2lnbmF0dXJl`;
}

function hrefWith(fragment: string, query = ""): string {
  return `${BASE_HREF}${query}${fragment}`;
}

function tokenFragment(access = DUMMY_ACCESS): string {
  return `#access_token=${access}&refresh_token=${DUMMY_REFRESH}&expires_in=3600&token_type=bearer`;
}

function toLocation(href: string): AuthCallbackLocation {
  const url = new URL(href);
  return { href, hash: url.hash, search: url.search };
}

type SetStep = { session?: AuthSessionLike | null; error?: unknown; throws?: unknown; saveAnyway?: AuthSessionLike };

interface FakeOptions {
  href: string;
  initialSession?: AuthSessionLike | null;
  // setSessionの呼び出しごとの結果（指定がない回は既定の成功）
  setSteps?: SetStep[];
  getSessionError?: unknown;
  probe?: ApiKeyProbeResult;
  probeThrows?: boolean;
}

// 記録付きのダミー環境。log：呼び出し順、storage：保存済みセッション（Supabase相当）。
function fakeEnv(options: FakeOptions) {
  const log: string[] = [];
  const setCalls: { access_token: string; refresh_token: string }[] = [];
  const probeCalls: number[] = [];
  let location = toLocation(options.href);
  const storage: { session: AuthSessionLike | null } = { session: options.initialSession ?? null };
  const env: AuthCallbackEnvironment = {
    readLocation: () => {
      log.push("read");
      return location;
    },
    replaceLocation: (url) => {
      log.push("replace");
      location = toLocation(url);
    },
    getSession: async () => {
      log.push("getSession");
      return { session: storage.session, error: options.getSessionError ?? null };
    },
    setSession: async (tokens) => {
      log.push("setSession");
      setCalls.push(tokens);
      // 既定の成功は、渡されたトークンのXセッションを保存する（実際のsetSessionと同じ振る舞い）
      const step: SetStep = options.setSteps?.[setCalls.length - 1] ?? { session: { access_token: tokens.access_token, user: { is_anonymous: false } }, error: null };
      if (step.throws !== undefined) throw step.throws;
      if (step.saveAnyway !== undefined) storage.session = step.saveAnyway;
      if (step.error === undefined || step.error === null) {
        if (step.session !== undefined) storage.session = step.session;
        else storage.session = X_SESSION;
        return { session: storage.session, error: null };
      }
      return { session: null, error: step.error };
    },
  };
  if (options.probe !== undefined || options.probeThrows) {
    env.probeApiKey = async () => {
      probeCalls.push(1);
      if (options.probeThrows) throw new Error("probe failure");
      return options.probe as ApiKeyProbeResult;
    };
  }
  return { env, log, storage, setCalls, probeCalls, currentLocation: () => location };
}

(async () => {
  // 途中で止まって終了した場合（待ち続けるPromiseなど）に、成功扱いで終わらないようにする。
  let finished = false;
  process.on("exit", (code) => {
    if (code === 0 && !finished) {
      console.error("authCallback.check FAILED: 途中で終了した（全件の検査が完了していない）");
      process.exitCode = 1;
    }
  });

  // ---- フラグメントの解析 ----
  {
    assert.deepEqual(parseAuthCallback(tokenFragment(), ""), { kind: "tokens", accessToken: DUMMY_ACCESS, refreshToken: DUMMY_REFRESH });
    assert.equal(parseAuthCallback(`#refresh_token=${DUMMY_REFRESH}&expires_in=3600`, "").kind, "incomplete", "アクセストークン不足");
    assert.equal(parseAuthCallback(`#access_token=${DUMMY_ACCESS}&expires_in=3600`, "").kind, "incomplete", "リフレッシュトークン不足");
    assert.equal(parseAuthCallback("#access_token=&refresh_token=", "").kind, "incomplete", "空の値");
    assert.equal(parseAuthCallback("", "").kind, "none");
    assert.equal(parseAuthCallback("#", "").kind, "none");
    assert.deepEqual(parseAuthCallback("#error=access_denied&error_description=SECRET-TEXT", ""), { kind: "cancelled" });
    assert.deepEqual(parseAuthCallback("", "?error=access_denied"), { kind: "cancelled" });
    assert.deepEqual(parseAuthCallback("#error=server_error&error_description=SECRET-TEXT", ""), { kind: "oauth_error" });
    assert.deepEqual(parseAuthCallback("", "?error=server_error&error_description=SECRET-TEXT"), { kind: "oauth_error" });
    assert.deepEqual(parseAuthCallback(`${tokenFragment()}&error=server_error`, ""), { kind: "oauth_error" }, "エラーがあればトークンがあっても失敗");
    console.log("PASS: フラグメントの解析（正常・不足・空・キャンセル・OAuthエラー）は想定どおり");
  }

  // ---- URLからの除去 ----
  {
    const stripped = stripAuthParams(hrefWith(tokenFragment(), "?keep=1"));
    assert.equal(stripped.includes("#"), false);
    assert.equal(stripped.includes(DUMMY_ACCESS), false);
    assert.equal(stripped.includes(DUMMY_REFRESH), false);
    assert.equal(stripped, `${BASE_HREF}?keep=1`, "パスや他のクエリまで消している");
    assert.equal(stripAuthParams(hrefWith("", "?error=access_denied&error_code=x&error_description=y")), BASE_HREF);
    console.log("PASS: 認証のフラグメントとエラー用クエリだけを取り除き、パスや他のクエリは残す");
  }

  // ---- 安全な分類（auth-js 2.110.2のエラーの形を模す） ----
  {
    assert.equal(describeAuthError(Object.assign(new Error("x"), { name: "LockAcquireTimeoutError", isAcquireTimeout: true })).category, "lock_timeout");
    assert.equal(describeAuthError(authError("AuthRetryableFetchError", 0, undefined)).category, "network", "通信失敗（status 0）");
    assert.equal(describeAuthError(authError("AuthRetryableFetchError", 503, undefined)).category, "network", "5xx");
    assert.equal(describeAuthError(new TypeError("fetch failed")).category, "network", "fetchの例外");
    assert.equal(describeAuthError(authError("AuthInvalidJwtError", 400, "invalid_jwt")).category, "token_format");
    assert.equal(describeAuthError(authError("AuthSessionMissingError", 400, undefined)).category, "session_not_found");
    assert.equal(describeAuthError(authError("AuthApiError", 401, "bad_jwt")).category, "auth_rejected", "JWT拒否（bad_jwt）");
    assert.equal(describeAuthError(authError("AuthApiError", 401, undefined)).category, "auth_rejected", "401（JWTかキーか未判別）");
    assert.equal(describeAuthError(authError("AuthApiError", 403, undefined)).category, "auth_rejected");
    assert.equal(describeAuthError(authError("AuthUnknownError", undefined, undefined)).category, "unknown");
    assert.equal(describeAuthError("plain string").category, "unknown");
    assert.equal(describeAuthError(null).category, "unknown");
    console.log("PASS: 保存の失敗はロック・通信・トークン形式・セッション不存在・認証拒否・不明に分類される");
  }

  // ---- 安全な診断は、形式を検査した値だけを出す（名前・コードに想定外の文字列が入っていても出さない） ----
  {
    const weird = describeAuthError(Object.assign(new Error("m"), { name: `Auth ${DUMMY_ACCESS}`, status: 401.5, code: `bad ${DUMMY_REFRESH}` }));
    assert.equal(weird.name, null);
    assert.equal(weird.status, null);
    assert.equal(weird.code, null);
    const normal = describeAuthError(authError("AuthApiError", 401, "bad_jwt"));
    assert.deepEqual(normal, { name: "AuthApiError", status: 401, code: "bad_jwt", category: "auth_rejected" });
    const serialized = JSON.stringify(describeAuthError(authError("AuthApiError", 401, "bad_jwt")));
    assert.equal(serialized.includes(DUMMY_ACCESS), false, "診断にトークンが含まれる");
    assert.equal(serialized.includes("raw supabase detail"), false, "診断にエラーのmessageが含まれる");
    console.log("PASS: 診断には形式を検査した名前・HTTP状態・コードだけを出し、messageやトークンは含まれない");
  }

  // ---- JWTの期限（端末時計との比較用。トークン値は返さない） ----
  {
    assert.equal(readJwtExpirySeconds(dummyJwt(1_700_000_000)), 1_700_000_000);
    assert.equal(readJwtExpirySeconds("not-a-jwt"), null);
    assert.equal(readJwtExpirySeconds(`a.@@@.c`), null);
    console.log("PASS: トークンの期限は読めれば数値、読めなければnull（トークン値は返さない）");
  }

  // ---- 保存の成功・失敗・回復 ----
  {
    const f = fakeEnv({ href: hrefWith(tokenFragment()), initialSession: null });
    assert.deepEqual(await processAuthCallback(f.env, toLocation(hrefWith(tokenFragment()))), { ok: true });
    assert.equal(f.setCalls.length, 1);
    assert.equal(f.setCalls[0].access_token, DUMMY_ACCESS);
    console.log("PASS: 保存成功（非匿名セッションが保存された）は成功になる");
  }
  {
    const f = fakeEnv({ href: hrefWith(tokenFragment()), initialSession: null, setSteps: [{ error: authError("AuthApiError", 401, "bad_jwt") }], probe: "valid" });
    const outcome = await runWithFake(f);
    assert.equal(outcome.ok, false);
    { const failed = asFailure(outcome);
      assert.equal(failed.reason, "save_failed");
      assert.equal(failed.diagnostic?.attempts, 1, "認証拒否は再試行しない");
      assert.equal(failed.diagnostic?.first?.category, "auth_rejected");
      assert.equal(failed.diagnostic?.apiKey, "valid", "キーは有効（トークンの拒否）と判定");
      assert.equal(failed.diagnostic?.afterSave, "none");
    }
    console.log("PASS: 保存失敗（JWT拒否）は再試行せず、公開キーが有効であることを診断に記録する");
  }
  {
    const f = fakeEnv({ href: hrefWith(tokenFragment()), initialSession: null, setSteps: [{ error: authError("AuthApiError", 401, undefined) }], probe: "rejected" });
    const outcome = await runWithFake(f);
    assert.equal(outcome.ok, false);
    assert.equal(asFailure(outcome).diagnostic?.apiKey, "rejected", "キーが拒否された場合を区別できない");
    console.log("PASS: 公開キーが拒否された場合は、キーの問題として区別できる");
  }
  {
    const f = fakeEnv({
      href: hrefWith(tokenFragment()),
      initialSession: null,
      setSteps: [{ error: Object.assign(new Error("lock"), { isAcquireTimeout: true }) }, { session: X_SESSION, error: null }],
    });
    assert.deepEqual(await runWithFake(f), { ok: true }, "ロック取得の一時的な失敗は一度だけ再試行して成功");
    assert.equal(f.setCalls.length, 2);
    assert.deepEqual(f.setCalls[0], f.setCalls[1], "再試行は同じトークン");
    console.log("PASS: ロック取得の一時的な失敗は、同じトークンで一度だけ再試行して成功になる");
  }
  {
    const f = fakeEnv({ href: hrefWith(tokenFragment()), initialSession: null, setSteps: [{ throws: new TypeError("fetch failed") }, { throws: new TypeError("fetch failed") }] });
    const outcome = await runWithFake(f);
    assert.equal(f.setCalls.length, 2, "通信失敗は一度だけ再試行");
    assert.equal(asFailure(outcome).diagnostic?.attempts, 2);
    console.log("PASS: 通信失敗は再試行しても失敗なら、試行回数と分類を診断に記録する");
  }
  {
    // 保存は途中まで成功していた（エラーを返したが、非匿名のセッションが残っている）→ 回復として成功
    const f = fakeEnv({ href: hrefWith(tokenFragment()), initialSession: null, setSteps: [{ error: authError("AuthApiError", 500, undefined), saveAnyway: X_SESSION }] });
    assert.deepEqual(await runWithFake(f), { ok: true }, "保存済みの非匿名セッションがあれば回復として成功");
    assert.equal(f.setCalls.length, 1, "回復の確認ではトークンを再利用しない");
    console.log("PASS: 保存の結果が失敗でも、保存済みの非匿名セッションが残っていれば回復として成功になる");
  }
  {
    // 保存後のセッションが匿名のまま（成功応答だが非匿名が得られなかった）→ 失敗、保存後の状態を記録
    const f = fakeEnv({ href: hrefWith(tokenFragment()), initialSession: ANON_SESSION, setSteps: [{ session: ANON_SESSION, error: null }] });
    const outcome = await runWithFake(f);
    assert.equal(outcome.ok, false, "匿名セッションをXログイン成功として扱っている");
    { const failed = asFailure(outcome);
      assert.equal(failed.diagnostic?.afterSave, "anonymous");
      assert.equal(failed.diagnostic?.first, null, "成功応答のため最初の失敗は無し");
    }
    console.log("PASS: 保存後も匿名セッションのままなら、成功にせず保存後の状態を診断に記録する");
  }
  {
    // 端末時計がトークンの期限を過ぎている（期限切れとして扱われる状態）を診断に記録する
    const expired = dummyJwt(1_000);
    const f = fakeEnv({ href: hrefWith(tokenFragment(expired)), initialSession: null, setSteps: [{ error: authError("AuthApiError", 401, "bad_jwt") }] });
    const outcome = await processAuthCallback(f.env, toLocation(hrefWith(tokenFragment(expired))), undefined, 2_000_000_000_000);
    assert.equal(asFailure(outcome).diagnostic?.tokenExpiredByLocalClock, true, "端末時計での期限切れを記録していない");
    console.log("PASS: 端末時計で見てトークンが期限切れかどうかを診断に記録する");
  }
  {
    // 公開キーの確認が例外でも、処理は失敗として終わり、キーの状態は到達不能になる
    const f = fakeEnv({ href: hrefWith(tokenFragment()), initialSession: null, setSteps: [{ error: authError("AuthApiError", 401, undefined) }], probeThrows: true });
    const outcome = await runWithFake(f);
    assert.equal(outcome.ok, false);
    assert.equal(asFailure(outcome).diagnostic?.apiKey, "unreachable");
    console.log("PASS: 公開キーの確認が例外でも、失敗として安全に終わる");
  }
  {
    // 認証拒否以外（通信失敗など）では公開キーを確認しない
    const f = fakeEnv({ href: hrefWith(tokenFragment()), initialSession: null, setSteps: [{ error: authError("AuthRetryableFetchError", 0, undefined) }, { error: authError("AuthRetryableFetchError", 0, undefined) }], probe: "valid" });
    const outcome = await runWithFake(f);
    assert.equal(f.probeCalls.length, 0, "通信失敗でキーの確認をしている");
    assert.equal(asFailure(outcome).diagnostic?.apiKey, "not_checked");
    console.log("PASS: 通信失敗ではキーの確認をしない（原因の切り分けが必要な場合だけ確認する）");
  }

  // ---- 生のエラー文言・トークンが出力に混ざらない ----
  {
    const f = fakeEnv({ href: hrefWith(tokenFragment()), initialSession: null, setSteps: [{ throws: authError("AuthApiError", 401, "bad_jwt") }], probe: "valid" });
    const outcome = await runWithFake(f);
    const serialized = JSON.stringify(outcome);
    assert.equal(serialized.includes(DUMMY_ACCESS), false, "結果にアクセストークンが含まれる");
    assert.equal(serialized.includes(DUMMY_REFRESH), false, "結果にリフレッシュトークンが含まれる");
    assert.equal(serialized.includes("raw supabase detail"), false, "結果に生のエラー文言が含まれる");
    assert.equal(asFailure(outcome).message, AUTH_CALLBACK_MESSAGES.save_failed, "利用者向けの文言が固定でない");
    console.log("PASS: 結果（利用者向け文言・診断）に、トークン・生のエラー文言は含まれない");
  }

  // ---- 既存のセッション・匿名切り替え・キャンセル ----
  {
    const f = fakeEnv({ href: hrefWith(tokenFragment()), initialSession: X_SESSION });
    assert.deepEqual(await runWithFake(f), { ok: true });
    assert.equal(f.setCalls.length, 0, "既存のXセッションがあるのにsetSessionを重ねている");
    console.log("PASS: 有効なXセッションが保存済みなら、setSessionを重ねず成功扱いにする");
  }
  {
    const f = fakeEnv({ href: hrefWith(tokenFragment()), initialSession: ANON_SESSION });
    assert.deepEqual(await runWithFake(f), { ok: true });
    assert.equal(f.setCalls.length, 1, "匿名からの切り替えでsetSessionが呼ばれていない");
    assert.equal(f.storage.session?.user?.is_anonymous, false, "匿名セッションがXのセッションへ置き換わっていない");
    console.log("PASS: 匿名ゲストからXログインへの切り替えは、Xのセッションへ置き換えて成功になる");
  }
  {
    const f = fakeEnv({ href: hrefWith("#error=access_denied&error_description=x"), initialSession: ANON_SESSION });
    const outcome = await runWithFake(f);
    assert.equal(outcome.ok, false);
    assert.equal(asFailure(outcome).reason, "cancelled");
    assert.deepEqual(f.log, ["read", "replace"], "キャンセル時にセッションへアクセスしている");
    assert.equal(f.storage.session, ANON_SESSION, "キャンセルで匿名セッションが変わった");
    const source = readFileSync(join(process.cwd(), "src/lib/authCallback.ts"), "utf8");
    assert.doesNotMatch(source, /signOut/, "コールバック処理がsignOutを呼べる構造になっている");
    console.log("PASS: OAuthをキャンセルした場合、元の匿名セッションにはsetSessionもsignOutも行わず残る");
  }
  {
    const incomplete = fakeEnv({ href: hrefWith(`#access_token=${DUMMY_ACCESS}`), initialSession: null });
    assert.equal((await runWithFake(incomplete)).ok, false);
    assert.equal(incomplete.setCalls.length, 0, "不完全な応答でsetSessionを呼んでいる");
    const none = fakeEnv({ href: hrefWith(""), initialSession: ANON_SESSION });
    assert.deepEqual(await runWithFake(none), { ok: false, reason: "no_session", message: AUTH_CALLBACK_MESSAGES.no_session });
    const reloaded = fakeEnv({ href: hrefWith(""), initialSession: X_SESSION });
    assert.deepEqual(await runWithFake(reloaded), { ok: true }, "再読み込み後の有効なXセッションは成功");
    console.log("PASS: 不完全な応答・認証情報なしは失敗、再読み込み後の有効なXセッションは成功になる");
  }
  {
    // セッションの確認がエラーでも、トークンがあれば保存を試みる
    const f = fakeEnv({ href: hrefWith(tokenFragment()), initialSession: null, getSessionError: authError("AuthApiError", 500, undefined) });
    assert.deepEqual(await runWithFake(f), { ok: true });
    console.log("PASS: 既存セッションの確認がエラーでも、トークンがあれば保存を試みる");
  }

  // ---- 処理の順序：URLの除去は、最初の非同期処理より前 ----
  {
    const f = fakeEnv({ href: hrefWith(tokenFragment()), initialSession: null });
    await runWithFake(f);
    assert.deepEqual(f.log.slice(0, 2), ["read", "replace"], "URLの除去が非同期処理より後になっている");
    assert.equal(f.currentLocation().hash, "");
    assert.equal(f.currentLocation().href.includes(DUMMY_ACCESS), false);
    console.log("PASS: 認証情報は非同期処理の前にURLから取り除かれ、処理後もアドレスバーに残らない");
  }

  // ---- 新しいOAuth試行と二重実行（ランナー） ----
  {
    const f = fakeEnv({ href: hrefWith(tokenFragment()), initialSession: null });
    const run = createAuthCallbackRunner(f.env, () => Date.now());
    const [a, b] = await Promise.all([run(), run()]);
    assert.deepEqual(a, { ok: true });
    assert.deepEqual(b, { ok: true });
    assert.equal(f.setCalls.length, 1, "Strict Mode相当の二重実行でsetSessionが複数回呼ばれた");
    console.log("PASS: Strict Mode相当の二重実行でも、setSessionは1回だけ実行される");
  }
  {
    // 新しいトークンが戻った（別のOAuth試行）→ 前の結果を再利用せず、新しいトークンで保存し直す
    const f = fakeEnv({ href: hrefWith(tokenFragment("dummy-access-token-OLD1")), initialSession: null });
    const run = createAuthCallbackRunner(f.env, () => Date.now());
    assert.deepEqual(await run(), { ok: true });
    f.env.replaceLocation(hrefWith(""));
    (f.env as { readLocation: () => AuthCallbackLocation }).readLocation = () => toLocation(hrefWith(tokenFragment("dummy-access-token-NEW2")));
    assert.deepEqual(await run(), { ok: true });
    assert.equal(f.setCalls.length, 2, "新しいOAuth試行で古い結果を再利用している");
    assert.equal(f.setCalls[1].access_token, "dummy-access-token-NEW2");
    assert.equal(f.storage.session?.access_token, "dummy-access-token-NEW2", "新しいトークンのセッションが保存されていない");
    console.log("PASS: 新しいOAuth試行（別のトークン）では古い結果を再利用せず、新しく保存する");
  }
  {
    // 成功のあとのキャンセル（別の試行）は、前の成功結果を再利用しない
    const f = fakeEnv({ href: hrefWith(tokenFragment()), initialSession: null });
    const run = createAuthCallbackRunner(f.env, () => Date.now());
    assert.deepEqual(await run(), { ok: true });
    (f.env as { readLocation: () => AuthCallbackLocation }).readLocation = () => toLocation(hrefWith("#error=access_denied"));
    const cancelled = await run();
    assert.equal(cancelled.ok, false, "キャンセルの試行で前の成功結果を再利用している");
    console.log("PASS: 成功のあとの別の試行（キャンセル）では、前の成功結果を再利用しない");
  }
  {
    // フラグメントが無い二回目の呼び出し（既に除去済み）は、直前の結果を再利用する
    const f = fakeEnv({ href: hrefWith(tokenFragment()), initialSession: null });
    const run = createAuthCallbackRunner(f.env, () => Date.now());
    assert.deepEqual(await run(), { ok: true });
    assert.deepEqual(await run(), { ok: true });
    assert.equal(f.setCalls.length, 1);
    console.log("PASS: 既に取り除かれた後の二回目の呼び出しは、直前の結果を再利用する");
  }

  // ---- 成功後の遷移（ページ側の配線） ----
  {
    const page = readFileSync(join(process.cwd(), "src/app/auth/callback/page.tsx"), "utf8");
    assert.match(page, /router\.replace\("\/"\);/, "成功後にrouter.replace(\"/\")していない");
    assert.doesNotMatch(page, /router\.push\(/, "router.pushで履歴にコールバックが残る");
    assert.match(page, /console\.warn\("\[auth-callback\] failed", outcome\.ok \? null : \{ reason: outcome\.reason, diagnostic: outcome\.diagnostic \}\);/, "失敗のログが安全な項目だけになっていない");
    assert.doesNotMatch(page, /console\.(log|warn|error)\([^)]*(error|message|session)/, "ログにエラーオブジェクト・メッセージ・セッションを出している");
    console.log("PASS: 成功後はrouter.replace(\"/\")で移動し、失敗時のログは安全な項目だけを出す");
  }

  // ---- タイムアウト ----
  {
    const pendingNever = new Promise<string>(() => undefined);
    const fired: { callback: (() => void) | null } = { callback: null };
    const cleared: unknown[] = [];
    const pendingTimeout = withTimeout(
      pendingNever,
      15_000,
      "timeout",
      (callback) => {
        fired.callback = callback;
        return "handle-1";
      },
      (handle) => cleared.push(handle),
    );
    assert.equal(typeof fired.callback, "function", "タイマーが登録されていない");
    fired.callback?.();
    assert.equal(await pendingTimeout, "timeout");
    const done = await withTimeout(Promise.resolve("done"), 15_000, "timeout", () => "handle-2", (handle) => cleared.push(handle));
    assert.equal(done, "done");
    assert.deepEqual(cleared, ["handle-2"], "タイマーが解除されていない");
    console.log("PASS: 時間切れは固定の失敗になり、時間内に終われば結果を返してタイマーを解除する");
  }

  // ---- 利用者向け文言 ----
  {
    for (const message of Object.values(AUTH_CALLBACK_MESSAGES)) {
      assert.match(message, /[ぁ-んァ-ヶ一-龠]/, `文言が日本語ではない: ${message}`);
      assert.doesNotMatch(message, /supabase|error|token|session|bad_jwt|401/i, `文言に技術用語が含まれる: ${message}`);
    }
    console.log("PASS: 利用者向けの文言はすべて一般化された日本語で、技術用語を含まない");
  }

  finished = true;
  console.log("authCallback.check: ALL PASS");
})().catch((error: unknown) => {
  // 例外の内容（messageにトークンが含まれうる）は出さず、種類だけを出す
  // テストのダミー値だけを含むため、検査の説明文（AssertionErrorのmessage）は出してよい。実トークンは使わない。
  const detail = error instanceof Error && error.name === "AssertionError" ? error.message.split("\n")[0] : "";
  console.error("authCallback.check FAILED:", error instanceof Error ? error.name : "unknown", detail);
  process.exitCode = 1;
});

// ダミー環境で、現在の位置からコールバック処理を一度実行する。
async function runWithFake(f: ReturnType<typeof fakeEnv>) {
  return processAuthCallback(f.env, f.env.readLocation(), undefined, Date.now());
}
