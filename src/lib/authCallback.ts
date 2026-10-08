// /auth/callback（X認証の戻り先）の処理本体。ブラウザAPI・Supabaseへの依存は
// AuthCallbackEnvironmentとして注入するため、テストではダミーの環境で挙動を検証できる。
//
// 前提（supabase-js 2.110.2 / auth-js 2.110.2の既定）：flowTypeは'implicit'。X認証の成功時、
// アクセストークン・リフレッシュトークンはURLのフラグメント（#access_token=...&refresh_token=...）
// で戻る。supabase-jsのURL自動検出（detectSessionInUrl）は無効（src/lib/supabase.ts）で、
// セッションの確立はこのページが行う。自動検出は、フラグメントにexpires_in・token_typeが
// 無い場合に保存せずに失敗するため、手動で扱う。
//
// 処理の流れ：
// 1) フラグメントを読み取った直後、同期的にURLから認証情報を取り除く
// 2) キャンセル・OAuthエラーは、既存のセッション（匿名ゲストを含む）に触れずに終える
// 3) 既に非匿名（Xの）セッションがあれば、setSessionを重ねず成功扱いにする
// 4) setSession({access_token, refresh_token})で保存する。ロック取得の失敗・通信失敗は、
//    同じトークンで一度だけ再試行する（リフレッシュトークンを更新に使う経路は使わない）
// 5) 保存の結果が失敗でも、保存済みの非匿名セッションが残っていれば成功とする（回復の確認）
// 6) 失敗時は、安全な診断（エラーの名前・HTTP状態・コード・分類、公開キーの有効性）を返す
//
// 秘密情報の扱い：access_token・refresh_token・Supabaseのエラーのmessage・URL・キーは、
// 戻り値・例外文・ログのいずれにも含めない。診断は安全な構造情報だけで組み立てる。

import { isNonAnonymousSession, type AuthSessionLike } from "./authCallbackGuard";

export type { AuthSessionLike };

export interface AuthCallbackLocation {
  href: string;
  hash: string;
  search: string;
}

export type ApiKeyProbeResult = "valid" | "rejected" | "unreachable";

export interface AuthCallbackEnvironment {
  readLocation(): AuthCallbackLocation;
  // history.replaceState相当。認証情報を取り除いたURLへ置き換える。
  replaceLocation(url: string): void;
  // error：成功時はnull（falseやundefinedも成功として扱う）。失敗時はSupabaseのエラーオブジェクト。
  getSession(): Promise<{ session: AuthSessionLike | null; error: unknown }>;
  setSession(tokens: { access_token: string; refresh_token: string }): Promise<{ session: AuthSessionLike | null; error: unknown }>;
  // 公開キーだけで確認できる公開エンドポイントの応答を返す（トークンは送らない）。省略可。
  probeApiKey?(): Promise<ApiKeyProbeResult>;
}

export type AuthCallbackParse =
  | { kind: "tokens"; accessToken: string; refreshToken: string }
  | { kind: "cancelled" }
  | { kind: "oauth_error" }
  | { kind: "incomplete" }
  | { kind: "none" };

// フラグメント（とクエリ）からOAuthの結果を読む。エラー説明文（error_description）は
// 利用者の入力を含みうるため、読み取らず、種類（キャンセルかその他か）だけを返す。
export function parseAuthCallback(hash: string, search: string): AuthCallbackParse {
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const query = new URLSearchParams(search.replace(/^\?/, ""));
  const error = fragment.get("error") ?? query.get("error");
  if (error !== null) {
    return error === "access_denied" ? { kind: "cancelled" } : { kind: "oauth_error" };
  }
  const accessToken = fragment.get("access_token") ?? "";
  const refreshToken = fragment.get("refresh_token") ?? "";
  if (accessToken !== "" && refreshToken !== "") {
    return { kind: "tokens", accessToken, refreshToken };
  }
  if (accessToken !== "" || refreshToken !== "" || fragment.has("access_token") || fragment.has("refresh_token")) {
    return { kind: "incomplete" };
  }
  return { kind: "none" };
}

// URLから認証に関わるフラグメントとエラー用のクエリを取り除いた文字列を返す。
export function stripAuthParams(href: string): string {
  const url = new URL(href);
  url.hash = "";
  for (const key of ["error", "error_code", "error_description", "code"]) {
    url.searchParams.delete(key);
  }
  return url.toString();
}

// ---------------------------------------------------------------------------
// 安全な診断情報
// ---------------------------------------------------------------------------

// 分類（auth-js 2.110.2のエラー種別・HTTP状態・コードから決める）。
// - lock_timeout：ブラウザのロック取得がタイムアウト（LockAcquireTimeoutError、isAcquireTimeout=true）
// - network：通信失敗（AuthRetryableFetchError。ネットワーク・5xx。fetchの例外はTypeError）
// - token_format：アクセストークンがJWTとして解釈できない（AuthInvalidJwtError、クライアント側）
// - session_not_found：サーバーがセッションを見つけられない（AuthSessionMissingError。
//   auth-jsはこのとき保存済みのセッションも削除する）
// - auth_rejected：サーバーがトークン・キーを拒否（AuthApiError。401/403、またはbad_jwt・invalid_jwt）
// - unknown：上記以外（非JSON応答など）
export type AuthErrorCategory =
  | "lock_timeout"
  | "network"
  | "token_format"
  | "session_not_found"
  | "auth_rejected"
  | "unknown";

export interface SafeErrorInfo {
  name: string | null;
  status: number | null;
  code: string | null;
  category: AuthErrorCategory;
}

// 形式を検査した値だけを出す（想定外の文字列が入っていても、出力に混ざらないようにする）。
function safeToken(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

export function describeAuthError(error: unknown): SafeErrorInfo {
  if (typeof error !== "object" || error === null) {
    return { name: null, status: null, code: null, category: "unknown" };
  }
  const e = error as { name?: unknown; status?: unknown; code?: unknown; isAcquireTimeout?: unknown };
  const name = safeToken(e.name, /^[A-Za-z]{1,60}$/);
  const status = typeof e.status === "number" && Number.isInteger(e.status) ? e.status : null;
  const code = safeToken(e.code, /^[a-z_]{1,60}$/);
  let category: AuthErrorCategory = "unknown";
  if (e.isAcquireTimeout === true) category = "lock_timeout";
  else if (name === "AuthRetryableFetchError" || name === "TypeError") category = "network";
  else if (name === "AuthInvalidJwtError") category = "token_format";
  else if (name === "AuthSessionMissingError") category = "session_not_found";
  else if (name === "AuthApiError" && (status === 401 || status === 403 || code === "bad_jwt" || code === "invalid_jwt")) {
    category = "auth_rejected";
  }
  return { name, status, code, category };
}

// アクセストークンのexp（秒）を読む。解釈できなければnull。トークン値自体は返さない。
// 端末時計が進んでいると、auth-jsはexpを過ぎたものとして扱い、更新の経路に入る。
export function readJwtExpirySeconds(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : null;
  } catch {
    return null;
  }
}

export interface AuthSaveDiagnostic {
  attempts: number;
  // 最初のsetSessionの失敗の分類（成功応答で非匿名が得られなかった場合はnull）
  first: SafeErrorInfo | null;
  // 端末時計で見たとき、アクセストークンが既に期限切れか（null＝判定できない）
  tokenExpiredByLocalClock: boolean | null;
  // 保存を試みた後の、保存済みセッションの状態
  afterSave: "non_anonymous" | "anonymous" | "none" | "unreadable";
  apiKey: ApiKeyProbeResult | "not_checked";
}

// ---------------------------------------------------------------------------
// 結果
// ---------------------------------------------------------------------------

export type AuthCallbackFailureReason =
  | "cancelled"
  | "oauth_error"
  | "incomplete"
  | "no_session"
  | "save_failed"
  | "timeout";

export type AuthCallbackOutcome =
  | { ok: true }
  | { ok: false; reason: AuthCallbackFailureReason; message: string; diagnostic?: AuthSaveDiagnostic };

// 利用者向けの文言は固定の日本語だけ。
export const AUTH_CALLBACK_MESSAGES: Record<AuthCallbackFailureReason, string> = {
  cancelled: "Xログインがキャンセルされました。ゲストとしての参加はそのまま続けられます。",
  oauth_error: "Xログインを完了できませんでした。時間をおいて再度お試しください。",
  incomplete: "Xログインの応答を確認できませんでした。もう一度お試しください。",
  no_session: "ログイン情報が見つかりませんでした。もう一度Xでログインしてください。",
  save_failed: "ログイン情報を保存できませんでした。時間をおいて再度お試しください。",
  timeout: "ログイン処理がタイムアウトしました。もう一度お試しください。",
};

function fail(reason: AuthCallbackFailureReason, diagnostic?: AuthSaveDiagnostic): AuthCallbackOutcome {
  return diagnostic
    ? { ok: false, reason, message: AUTH_CALLBACK_MESSAGES[reason], diagnostic }
    : { ok: false, reason, message: AUTH_CALLBACK_MESSAGES[reason] };
}

// ---------------------------------------------------------------------------
// 処理本体
// ---------------------------------------------------------------------------

function isNoError(error: unknown): boolean {
  return error === null || error === undefined || error === false;
}

type SessionRead = { ok: true; session: AuthSessionLike | null } | { ok: false };

// 例外・エラー応答をどちらも「読めなかった」として扱い、生の内容は外へ出さない。
async function safeGetSession(env: AuthCallbackEnvironment): Promise<SessionRead> {
  try {
    const result = await env.getSession();
    return isNoError(result.error) ? { ok: true, session: result.session } : { ok: false };
  } catch {
    return { ok: false };
  }
}

// 1回の保存の試行結果。成功・失敗にかかわらず同じ形（error は失敗時のみ値を持つ）。
interface SetAttempt {
  ok: boolean;
  session: AuthSessionLike | null;
  error: unknown;
}

async function trySetSession(
  env: AuthCallbackEnvironment,
  tokens: { access_token: string; refresh_token: string },
): Promise<SetAttempt> {
  try {
    const result = await env.setSession(tokens);
    return isNoError(result.error)
      ? { ok: true, session: result.session, error: null }
      : { ok: false, session: null, error: result.error };
  } catch (error) {
    // 例外の内容は分類にだけ使い、出力には含めない
    return { ok: false, session: null, error };
  }
}

// 一時的な失敗（ロック取得・通信）だけ、同じトークンで一度だけ再試行する。
function isTransient(category: AuthErrorCategory): boolean {
  return category === "lock_timeout" || category === "network";
}

// 保存後の状態を読む（保存が途中まで成功していた場合の回復にも使う。トークンは使わない）。
async function readAfterSave(env: AuthCallbackEnvironment): Promise<{ state: AuthSaveDiagnostic["afterSave"]; ok: boolean }> {
  const current = await safeGetSession(env);
  if (!current.ok) return { state: "unreadable", ok: false };
  if (current.session === null) return { state: "none", ok: false };
  return isNonAnonymousSession(current.session) ? { state: "non_anonymous", ok: true } : { state: "anonymous", ok: false };
}

// 保存に失敗したときの診断を組み立てる。公開キーは、拒否の原因（キーかトークンか）を
// 切り分ける必要がある場合だけ確認する。
async function diagnoseSaveFailure(
  env: AuthCallbackEnvironment,
  accessToken: string,
  first: SafeErrorInfo | null,
  attempts: number,
  afterSave: AuthSaveDiagnostic["afterSave"],
  nowMs: number,
): Promise<AuthSaveDiagnostic> {
  const exp = readJwtExpirySeconds(accessToken);
  const tokenExpiredByLocalClock = exp === null ? null : exp * 1000 <= nowMs;
  let apiKey: ApiKeyProbeResult | "not_checked" = "not_checked";
  if (first !== null && (first.category === "auth_rejected" || first.category === "unknown") && env.probeApiKey) {
    try {
      apiKey = await env.probeApiKey();
    } catch {
      apiKey = "unreachable";
    }
  }
  return { attempts, first, tokenExpiredByLocalClock, afterSave, apiKey };
}

// 1回の処理。locationは呼び出し側で読み取ったもの（同じ位置を二重に読まない）。
export async function processAuthCallback(
  env: AuthCallbackEnvironment,
  location: AuthCallbackLocation,
  parsed: AuthCallbackParse = parseAuthCallback(location.hash, location.search),
  nowMs: number = Date.now(),
): Promise<AuthCallbackOutcome> {
  // 読み取った直後に、アドレスバーから認証情報を取り除く（以降の処理の結果によらない）。
  env.replaceLocation(stripAuthParams(location.href));

  if (parsed.kind === "cancelled") return fail("cancelled");
  if (parsed.kind === "oauth_error") return fail("oauth_error");
  if (parsed.kind === "incomplete") return fail("incomplete");

  const current = await safeGetSession(env);
  if (parsed.kind === "none") {
    // 再読み込みなどで認証情報が既に取り除かれている場合：有効なXセッションがあれば成功扱い。
    if (current.ok && isNonAnonymousSession(current.session)) return { ok: true };
    return fail("no_session");
  }

  // 同じアクセストークンのXセッションが既に保存されていれば、setSessionを重ねない。
  // 別のトークン（新しいOAuth試行）の場合は、そのトークンで保存し直す。
  if (current.ok && isNonAnonymousSession(current.session) && current.session?.access_token === parsed.accessToken) {
    return { ok: true };
  }

  const tokens = { access_token: parsed.accessToken, refresh_token: parsed.refreshToken };
  let attempts = 1;
  let attempt = await trySetSession(env, tokens);
  const first: SafeErrorInfo | null = attempt.ok ? null : describeAuthError(attempt.error);
  if (first !== null && isTransient(first.category)) {
    attempts = 2;
    attempt = await trySetSession(env, tokens);
  }

  if (attempt.ok && isNonAnonymousSession(attempt.session)) return { ok: true };

  // 失敗、または匿名・空のセッションが返った場合も、保存済みの非匿名セッションが残っていれば成功とする。
  const after = await readAfterSave(env);
  if (after.ok) return { ok: true };

  const diagnostic = await diagnoseSaveFailure(env, parsed.accessToken, attempt.ok ? null : first, attempts, after.state, nowMs);
  return fail("save_failed", diagnostic);
}

// 新しいOAuth試行ごとに処理を分ける。
// - 同じトークンのフラグメント（Strict Modeの二重effectなど）は、進行中・完了済みの結果を再利用し、
//   setSessionを二重に呼ばない。
// - 新しいトークンの戻り・キャンセルなど、別の試行の結果では再利用しない。
// - フラグメントが無い（既に取り除かれた後の二回目の呼び出し）は、直前の結果を再利用する。
export function createAuthCallbackRunner(
  env: AuthCallbackEnvironment,
  nowMs: () => number = () => Date.now(),
): () => Promise<AuthCallbackOutcome> {
  let last: { key: string | null; promise: Promise<AuthCallbackOutcome> } | null = null;
  return () => {
    const location = env.readLocation();
    const parsed = parseAuthCallback(location.hash, location.search);
    const key = parsed.kind === "tokens" ? `${parsed.accessToken}\n${parsed.refreshToken}` : null;
    const sameAttempt = last !== null && (parsed.kind === "none" || (parsed.kind === "tokens" && key === last.key));
    if (sameAttempt && last !== null) return last.promise;
    const promise = processAuthCallback(env, location, parsed, nowMs());
    last = { key, promise };
    return promise;
  };
}

// 時間切れの場合は、固定の結果を返す（待ち続けて画面が止まらないようにする）。
// タイマーは注入可能（テストではダミーのタイマーを使う）。
export function withTimeout<T, H = ReturnType<typeof setTimeout>>(
  promise: Promise<T>,
  ms: number,
  onTimeout: T,
  schedule: (callback: () => void, ms: number) => H = (callback, delay) => setTimeout(callback, delay) as H,
  cancel: (handle: H) => void = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = schedule(() => resolve(onTimeout), ms);
    promise.then(
      (value) => {
        cancel(handle);
        resolve(value);
      },
      (error) => {
        cancel(handle);
        reject(error);
      },
    );
  });
}
