// Xログイン・ゲスト参加の直前に、利用規約・プライバシーポリシーへの明示同意を
// 求める共通ゲート。
//
// 背景：`rg "signInWithX\(" src` の結果、直接呼び出しは13箇所、`signInAsGuest`は
// 1箇所あり、見た目・文脈（ヘッダーの下線リンク、CTAボタン、ゲートUI等）が
// すべて異なる。13箇所それぞれにチェックボックス付きUIを埋め込むと重複実装に
// なり迂回経路が生まれやすいため、代わりに「呼び出し元は全員このストアの
// requestXLogin/requestGuestStartを呼ぶ」という単一の入口に統一する。
// useAuthStore.signInWithX/signInAsGuest自体（OAuthスコープ・匿名サインイン呼び出し）
// は一切変更しない。
//
// 同意チェックが済んでいるかどうかは、端末のlocalStorageに保存した
// 「同意した規約バージョン」で判定する（未ログイン時点ではuser_idが無くDBに
// 記録できないため）。
//
// 2026-09-25（共有端末での取り違え対策）：以前はPENDING_CONSENT_STORAGE_KEYに
// バージョンだけを保存しており、以下のような取り違えが起こり得た。
//   - Xログインの同意チェック後、OAuthを完了せず（途中で閉じる等）別の人が
//     同じ端末でゲスト参加すると、Xログイン用の保留同意がそのままゲストの
//     DB記録に使われてしまう。
//   - 逆にゲスト用の保留同意がX会員側に使われてしまう。
//   - 保留同意に有効期限が無く、古い保留がいつまでも残り得る。
// 対応として、保留同意に操作種別(kind)・作成日時(createdAt)を持たせ、
// ConsentRequiredGate側で「種別が現在のログイン種別（匿名かどうか）と一致し、
// かつ有効期限内であること」を確認してからDBへ記録するようにした
// （検証ロジック自体はsrc/lib/consentCheck.tsのcheckConsentForUserに実装、
// テスト容易性のため純粋関数として切り出し済み）。
// また、ゲスト参加はページ遷移を伴わないため、保留フラグを経由せず、この
// ファイル内で直接record_terms_consentを呼ぶことで、取り違えの可能性を
// 構造的に無くしている（Xログインだけは、OAuthのフルページ遷移を挟むため
// 保留フラグでの中継が引き続き必要）。
import { create } from "zustand";

import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legalInfo";
import { beginGuestConsentWindow, recordTermsConsentOnce } from "@/lib/termsConsentRecorder";
import { supabase } from "@/lib/supabase";
import { useAudienceJoinIntentStore } from "@/store/useAudienceJoinIntentStore";
import { useAuthStore } from "@/store/useAuthStore";

export const CONSENT_ACK_STORAGE_KEY = "dojo-consent-ack-version";
export const PENDING_CONSENT_STORAGE_KEY = "dojo-pending-terms-consent";

// 保留同意の有効期限。OAuthのリダイレクト往復に通常必要な時間を十分に見込みつつ、
// 古い保留同意がいつまでも残らないようにする。
export const PENDING_CONSENT_TTL_MS = 10 * 60 * 1000;

export type PendingConsentKind = "x-login" | "guest";

export interface PendingConsentFlag {
  kind: PendingConsentKind;
  termsVersion: string;
  privacyVersion: string;
  createdAt: number;
}

function currentVersionTag(): string {
  return `${TERMS_VERSION}|${PRIVACY_VERSION}`;
}

function hasAckedCurrentVersion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CONSENT_ACK_STORAGE_KEY) === currentVersionTag();
  } catch {
    return false;
  }
}

// 端末共通の「同意済み」フラグは、同意モーダルを再表示するかどうかのUX上の
// 目安に過ぎない（実際に何を同意したことにするかの正はDBのterms_consents）。
export function markDeviceConsentAck(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONSENT_ACK_STORAGE_KEY, currentVersionTag());
  } catch {
    // 無視してよい（次回同意モーダルが再表示されるだけで実害はない）。
  }
}

// 共有端末でログアウトした後、次に使う別の利用者が前の利用者の「同意済み」
// フラグ・保留同意をそのまま引き継がないよう、ログアウト検知時
// （ConsentRequiredGate.tsx）に呼び出して両方消去する。
export function clearDeviceConsentAck(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CONSENT_ACK_STORAGE_KEY);
    window.localStorage.removeItem(PENDING_CONSENT_STORAGE_KEY);
  } catch {
    // 無視してよい。
  }
}

export function readPendingConsentFlag(): PendingConsentFlag | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      ((parsed as { kind?: unknown }).kind === "x-login" || (parsed as { kind?: unknown }).kind === "guest") &&
      typeof (parsed as { termsVersion?: unknown }).termsVersion === "string" &&
      typeof (parsed as { privacyVersion?: unknown }).privacyVersion === "string" &&
      typeof (parsed as { createdAt?: unknown }).createdAt === "number"
    ) {
      return parsed as PendingConsentFlag;
    }
    return null;
  } catch {
    return null;
  }
}

function writePendingConsentFlag(kind: PendingConsentKind): void {
  if (typeof window === "undefined") return;
  try {
    const flag: PendingConsentFlag = {
      kind,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      createdAt: Date.now(),
    };
    window.localStorage.setItem(PENDING_CONSENT_STORAGE_KEY, JSON.stringify(flag));
  } catch {
    // 無視してよい。
  }
}

export function clearPendingConsentFlag(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PENDING_CONSENT_STORAGE_KEY);
  } catch {
    // 無視してよい。
  }
}

// ゲスト開始の結果通知（観客参加の意図の開始・完了・キャンセルを呼び出し元へ返す）。
export type GuestStartSettled =
  | { status: "started"; userId: string | null }
  | { status: "cancelled" }
  | { status: "failed" };
export interface GuestStartOptions {
  onSettled?: (result: GuestStartSettled) => void;
  // この開始要求が現在も有効か（ページ離脱・Xログイン等で無効になっていれば、以後の状態更新をしない）。
  isCurrent?: () => boolean;
}

type PendingAction =
  | { kind: "x-login"; options?: { isGuestSwitch?: boolean } }
  // onSettledは1回だけ呼ぶ（settledで二重通知を防ぐ）。
  | {
      kind: "guest";
      onSettled?: (result: GuestStartSettled) => void;
      isCurrent?: () => boolean;
      settled?: boolean;
    };

const GUEST_BUSY_MESSAGE = "ゲスト参加の処理中です。完了してからもう一度お試しください。";
const X_BUSY_MESSAGE = "Xログインの処理中です。完了してからもう一度お試しください。";

function guestPendingFrom(options: GuestStartOptions | undefined): PendingAction {
  const p: PendingAction = { kind: "guest" };
  if (options?.onSettled) p.onSettled = options.onSettled;
  if (options?.isCurrent) p.isCurrent = options.isCurrent;
  return p;
}

function settleGuestPending(p: PendingAction | null, result: GuestStartSettled): void {
  if (!p || p.kind !== "guest" || p.settled) return;
  p.settled = true;
  p.onSettled?.(result);
}

interface ConsentGateState {
  pendingModal: PendingAction | null;
  errorReason: string | null;
  requestXLogin: (options?: { isGuestSwitch?: boolean }) => Promise<{ ok: true } | { ok: false; reason?: string }>;
  requestGuestStart: (options?: GuestStartOptions) => Promise<{ ok: true } | { ok: false; reason?: string }>;
  confirm: () => Promise<void>;
  cancel: () => void;
}

type AuthActionResult = { ok: true } | { ok: false; reason?: string };

// 戻り値の型をsignInWithX/signInAsGuestそれぞれの型（reasonの必須/任意が
// 異なる）から、明示的に共通のAuthActionResultへ揃える。こうしておかないと、
// confirm()内のswitch/ifでの絞り込みが、由来の異なる2つの合同型（一方は
// reason必須、一方はreason任意）の組み合わせにより曖昧になり得る。
async function runXLogin(options?: { isGuestSwitch?: boolean }): Promise<AuthActionResult> {
  return useAuthStore.getState().signInWithX(options);
}

type GuestStartResult = { ok: true; userId: string | null } | { ok: false; reason?: string };
const GUEST_FLOW_FAILED_MESSAGE = "処理に失敗しました。時間をおいて再度お試しください。";
const CONSENT_RECORD_FAILED_MESSAGE =
  "利用規約への同意の記録に失敗しました。通信状況を確認して、もう一度お試しください。";

// stage：auth＝匿名認証まで進めなかった／consent＝認証は済んだが同意の記録に失敗（再試行は同じ
// 認証済みユーザーで同意記録だけを行う）。
type GuestFlightOutcome =
  | { ok: true; userId: string }
  | { ok: false; stage: "auth" | "consent"; reason: string };
let guestFlight: Promise<GuestFlightOutcome> | null = null;
// このフローで匿名認証に成功したユーザー。同意記録だけ失敗した後の再試行で、新しい匿名
// アカウントを作らず同じユーザーを使うために保持する（成功・キャンセルで破棄）。
let guestAuthAttempt: { userId: string | null } | null = null;

// ゲスト開始（匿名認証＋同意記録）全体をsingle-flight化する。同時の呼び出しは同じ処理へ合流し、
// 匿名認証も記録RPCも1回だけ実行する。窓（beginGuestConsentWindow）は全期間を覆い、必ず解除される。
function runGuestFlight(): Promise<GuestFlightOutcome> {
  if (!guestFlight) {
    const endGuestWindow = beginGuestConsentWindow();
    guestFlight = guestStartAndRecord()
      .catch((): GuestFlightOutcome => ({ ok: false, stage: "auth", reason: GUEST_FLOW_FAILED_MESSAGE }))
      .finally(() => {
        guestFlight = null;
        endGuestWindow();
      });
  }
  return guestFlight;
}

async function runGuestStart(): Promise<GuestStartResult> {
  const result = await useAuthStore.getState().signInAsGuest();
  if (!result.ok) return result;
  return { ok: true, userId: result.userId ?? null };
}

// signInAnonymouslyの結果にuserIdが無い場合に限り、認証ストアで利用者が確定するまで
// 短時間待つ（確定しなければnull。nullのまま記録RPCは呼ばない）。
function waitForAuthUserId(timeoutMs: number): Promise<string | null> {
  const now = useAuthStore.getState().user?.id ?? null;
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    let done = false;
    const finish = (id: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(id);
    };
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state.user?.id) finish(state.user.id);
    });
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

export const useConsentGateStore = create<ConsentGateState>()((set, get) => ({
  pendingModal: null,
  errorReason: null,

  requestXLogin: async (options) => {
    // ゲスト観客の意図（ライブID取得待ちを含む）を先に無効化する。遅れて完了する古いゲスト処理は
    // tokenが無効なので、以後ゲスト開始・同意モーダル・認証を行わない。
    useAudienceJoinIntentStore.getState().discard();
    // 保留中のゲスト同意モーダルは、Xログインの同意に置き換わる時点で破棄する。
    settleGuestPending(get().pendingModal, { status: "cancelled" });
    // 匿名認証の実行中にXログインを並行させない（両方がセッションを書き換えるのを防ぐ）。
    if (guestFlight || useAuthStore.getState().guestSigningIn) return { ok: false, reason: GUEST_BUSY_MESSAGE };
    if (hasAckedCurrentVersion()) {
      return runXLogin(options);
    }
    set({ pendingModal: { kind: "x-login", options }, errorReason: null });
    return { ok: false };
  },

  requestGuestStart: async (options) => {
    // 無効な（破棄済みの）要求は何もしない：モーダルを開かない・認証しない。
    if (options?.isCurrent && !options.isCurrent()) return { ok: false };
    // Xログイン処理中に匿名認証を並行させない。
    if (useAuthStore.getState().xSigningIn) {
      options?.onSettled?.({ status: "failed" });
      return { ok: false, reason: X_BUSY_MESSAGE };
    }
    if (hasAckedCurrentVersion()) {
      // 同意済みの端末でも、この匿名ユーザーの同意記録が成功するまで「開始成功」にしない。
      let outcome: GuestFlightOutcome;
      try {
        outcome = await runGuestFlight();
      } catch {
        outcome = { ok: false, stage: "auth", reason: GUEST_FLOW_FAILED_MESSAGE };
      }
      // 完了までにページ離脱・Xログイン等で無効になっていたら、通知もモーダル操作もしない。
      if (options?.isCurrent && !options.isCurrent()) return { ok: false };
      if (outcome.ok) {
        options?.onSettled?.({ status: "started", userId: outcome.userId });
        return { ok: true };
      }
      if (outcome.stage === "consent") {
        // 認証は済んでいるが同意の記録に失敗：同意画面を開いて再試行できるようにする
        // （意図は保留のまま。閉じれば破棄）。新しい匿名アカウントは作らない。
        settleGuestPending(get().pendingModal, { status: "cancelled" });
        set({ pendingModal: guestPendingFrom(options), errorReason: outcome.reason });
        return { ok: false, reason: outcome.reason };
      }
      options?.onSettled?.({ status: "failed" });
      return { ok: false, reason: outcome.reason };
    }
    settleGuestPending(get().pendingModal, { status: "cancelled" });
    set({ pendingModal: guestPendingFrom(options), errorReason: null });
    return { ok: false };
  },

  // 2026-09-25（再監査対応）：以前はモーダルを先に閉じてからsignInWithX/
  // signInAsGuestを呼び、その戻り値（{ok:false, reason}）を無視していたため、
  // 匿名認証無効・通信障害・OAuth開始失敗等が起きても利用者に何も表示されず、
  // モーダルだけが消えて「同意して続けたのに何も起きない」状態になっていた。
  // 戻り値を必ず確認し、失敗時はモーダルを閉じずerrorReasonへ日本語文言を
  // セットする。成功した場合だけ処理を進めモーダルを閉じる（二重実行防止は
  // useAuthStore側のxSigningIn/guestSigningInガードで維持される）。
  // 2026-09-25（再々監査対応）：将来runXLogin/runGuestStartが例外を投げても
  // safeな日本語エラーへフォールバックし、ボタンが「処理中」のまま残らない
  // ようにする。
  // 2026-09-25（共有端末での取り違え対策）：Xログインは保留フラグ（種別・
  // 作成日時付き）を残すだけにし、実際のDB記録はページ遷移後にConsentRequiredGate
  // が種別・有効期限・現在の認証状態（匿名でないこと）を確認してから行う。
  // ゲスト参加はページ遷移を伴わないため、保留フラグを使わずこの場で直接
  // record_terms_consentを呼ぶ（取り違えようがない）。
  confirm: async () => {
    const pending = get().pendingModal;
    if (!pending) return;
    set({ errorReason: null });
    try {
      if (pending.kind === "x-login") {
        if (guestFlight || useAuthStore.getState().guestSigningIn) {
          set({ errorReason: GUEST_BUSY_MESSAGE });
          return;
        }
        const result = await runXLogin(pending.options);
        if (!result.ok) {
          set({ errorReason: result.reason ?? "処理に失敗しました。時間をおいて再度お試しください。" });
          return;
        }
        writePendingConsentFlag("x-login");
        markDeviceConsentAck();
        set({ pendingModal: null, errorReason: null });
        return;
      }

      // ゲスト同意処理全体はsingle-flight（runGuestFlight）。同時のconfirmは同じ処理へ合流し、
      // 匿名認証も記録RPCも1回だけ実行する。
      // 無効になった（ページ離脱・Xログイン等で破棄済みの）ゲスト要求は実行せず閉じる。
      if (pending.isCurrent && !pending.isCurrent()) {
        if (get().pendingModal === pending) set({ pendingModal: null, errorReason: null });
        return;
      }
      if (useAuthStore.getState().xSigningIn) {
        set({ errorReason: X_BUSY_MESSAGE });
        return;
      }
      const outcome = await runGuestFlight();
      // 待機中に別のモーダル（Xログイン用等）へ置き換わっていたら、古い処理は何も更新しない。
      if (get().pendingModal !== pending) return;
      if (!outcome.ok) {
        // モーダルは開いたまま（再試行できる）。意図は保留のまま、キャンセルされた時に破棄される。
        set({ errorReason: outcome.reason });
        return;
      }
      if (!pending.isCurrent || pending.isCurrent()) {
        settleGuestPending(pending, { status: "started", userId: outcome.userId });
      }
      set({ pendingModal: null, errorReason: null });
    } catch {
      if (get().pendingModal === pending) set({ errorReason: "処理に失敗しました。時間をおいて再度お試しください。" });
    }
  },

  cancel: () => {
    settleGuestPending(get().pendingModal, { status: "cancelled" });
    guestAuthAttempt = null;
    set({ pendingModal: null, errorReason: null });
  },
}));

// ゲスト参加を開始し、確定したuserIdで同意を記録する。DBへの記録（record_terms_consent）が
// 正常終了した場合だけ成功（{ok:true}）を返す。記録に失敗した場合・userIdを確定できない場合は
// 成功扱いにせず（観客参加の意図も成立させない）、端末の「同意済み」フラグも付けない。
// 匿名認証済みの状態で記録だけ失敗した場合の再試行では、新しい匿名アカウントを作らず、同じ
// 認証済みユーザーで記録だけを再試行する。
async function guestStartAndRecord(): Promise<GuestFlightOutcome> {
  let startedUserId: string | null = null;

  if (guestAuthAttempt) {
    const existingId = useAuthStore.getState().user?.id ?? (await waitForAuthUserId(3_000));
    const existing = useAuthStore.getState().user;
    if (existingId && existing?.is_anonymous === true && (guestAuthAttempt.userId === null || guestAuthAttempt.userId === existingId)) {
      startedUserId = existingId;
    } else {
      guestAuthAttempt = null;
    }
  }

  if (!startedUserId) {
    const result = await runGuestStart();
    if (!result.ok) {
      return { ok: false, stage: "auth", reason: result.reason ?? GUEST_FLOW_FAILED_MESSAGE };
    }
    guestAuthAttempt = { userId: result.userId ?? null };
    // 記録に使うuserIdは、signInAnonymouslyの結果から確定したものを使う（認証ストアへの反映が
    // 遅れていても、userId=nullのままRPCを呼ばない）。
    startedUserId = result.userId ?? (await waitForAuthUserId(3_000));
    if (startedUserId) guestAuthAttempt = { userId: startedUserId };
  }
  if (!startedUserId) {
    return { ok: false, stage: "consent", reason: CONSENT_RECORD_FAILED_MESSAGE };
  }

  let recordError: unknown;
  try {
    const { error } = await recordTermsConsentOnce({
      userId: startedUserId,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      rpc: async () => {
        const { error: rpcError } = await supabase.rpc("record_terms_consent");
        return { error: rpcError };
      },
    });
    recordError = error;
  } catch (e) {
    recordError = e ?? new Error("record_terms_consent failed");
  }
  if (recordError) {
    return { ok: false, stage: "consent", reason: CONSENT_RECORD_FAILED_MESSAGE };
  }
  // 完了までに別の利用者へ切り替わっていた場合、前の利用者の結果を反映しない。
  const currentUserId = useAuthStore.getState().user?.id ?? null;
  if (currentUserId !== null && currentUserId !== startedUserId) {
    guestAuthAttempt = null;
    return { ok: false, stage: "auth", reason: GUEST_FLOW_FAILED_MESSAGE };
  }
  guestAuthAttempt = null;
  clearPendingConsentFlag();
  markDeviceConsentAck();
  return { ok: true, userId: startedUserId };
}
