// ConsentRequiredGate.tsx（利用規約・プライバシーポリシーの既存ユーザー向け
// 同意確認）が使う、テスト容易性のために切り出した純粋なロジック部分。
// window/localStorage・Supabaseクライアントに直接依存させず、必要な処理を
// depsとして注入することで、実DOM無しのnode環境でも検証できるようにする
// （src/lib/singleFlight.ts等、このリポジトリの既存の「pure関数を切り出して
// src/lib/__tests__/で検証する」方針を踏襲）。

// userIdが変わるたびに世代を進め、古い世代の非同期結果を判別するための
// ガード。React stateやDBクライアントには一切依存しない。
export class GenerationGuard {
  private current = 0;

  next(): number {
    this.current += 1;
    return this.current;
  }

  // 現在の世代番号を、進めずに読み取るだけ。ユーザー操作（例：同意ボタンの
  // クリック）の開始時点で「今どの世代か」を記録しておき、非同期処理の完了後に
  // isCurrent()で照合するために使う（next()は新しい世代を作ってしまうため使えない）。
  peek(): number {
    return this.current;
  }

  isCurrent(generation: number): boolean {
    return generation === this.current;
  }
}

export type ConsentCheckResult =
  | { kind: "accepted" }
  | { kind: "consent-required" }
  | { kind: "error"; message: string };

export type PendingConsentKind = "x-login" | "guest";

export interface PendingConsentFlag {
  kind: PendingConsentKind;
  termsVersion: string;
  privacyVersion: string;
  createdAt: number;
}

// 保留同意の有効期限。src/store/useConsentGateStore.tsのPENDING_CONSENT_TTL_MSと
// 同じ値を、window非依存のこのファイル内にも定数として持つ（互いに参照し合う
// 循環importを避けるため）。値を変える場合は両方を同時に更新すること。
export const PENDING_CONSENT_TTL_MS = 10 * 60 * 1000;

export interface ConsentCheckDeps {
  // ConsentGateModalでの明示同意直後にセットされる「記録待ち」フラグを読む。
  readPendingFlag: () => PendingConsentFlag | null;
  // 取り違え・期限切れ等で使えないと判定した保留フラグを消去する。
  clearPendingFlag: () => void;
  // 現在のバージョンで同意を記録する（record_terms_consent RPC呼び出し）。
  recordConsent: () => Promise<{ error: unknown }>;
  // 現在のバージョンに一致する同意記録が既に存在するかを確認する。
  hasCurrentConsentRow: (uid: string) => Promise<{ ok: true; exists: boolean } | { ok: false }>;
  termsVersion: string;
  privacyVersion: string;
  // 現在チェック対象のセッションが匿名（ゲスト）かどうか。保留フラグの
  // 操作種別（kind）と現在のログイン種別が一致するかを確認するために使う
  // （Xログイン用の保留同意をゲストへ、ゲスト用の保留同意をX会員へ流用しない）。
  isAnonymousUser: boolean;
  // 現在時刻を取得する（テスト容易性のためDate.now()を直接使わず注入する）。
  now: () => number;
}

export const CONSENT_CHECK_ERROR_MESSAGE = "同意状況を確認できませんでした。時間をおいて再度お試しください。";

// 保留フラグが「今チェックしているセッションのために書かれたものだ」と
// 信頼してよいかどうかを判定する。バージョン一致に加え、操作種別（kind）が
// 現在のログイン種別（匿名かどうか）と一致すること、作成から一定時間
// （PENDING_CONSENT_TTL_MS）以内であることの両方を要求する。
function isPendingFlagTrustworthy(
  pending: PendingConsentFlag,
  deps: Pick<ConsentCheckDeps, "termsVersion" | "privacyVersion" | "isAnonymousUser" | "now">,
): boolean {
  const versionMatches = pending.termsVersion === deps.termsVersion && pending.privacyVersion === deps.privacyVersion;
  const kindMatches =
    (pending.kind === "guest" && deps.isAnonymousUser) || (pending.kind === "x-login" && !deps.isAnonymousUser);
  const notExpired = deps.now() - pending.createdAt <= PENDING_CONSENT_TTL_MS;
  return versionMatches && kindMatches && notExpired;
}

// 指定ユーザーの同意状況を判定する。
// 1. 記録待ちフラグがあり、かつ現在のセッションのために書かれたものだと
//    信頼できる場合（バージョン一致・操作種別一致・有効期限内）だけ、
//    それを記録してみる（成功すればaccepted）。信頼できない場合
//    （別の操作種別・期限切れ・バージョン不一致）は、取り違えを防ぐため
//    その場でフラグを破棄し、通常判定へ進む。
// 2. 記録自体に失敗した場合はフラグを残したまま（同意済み扱いにせず）、
//    通常の未同意判定へフォールスルーする（次回リトライできるようにする）。
// 3. 現在のバージョンに一致する同意記録がDBにあるかを直接確認する。
export async function checkConsentForUser(uid: string, deps: ConsentCheckDeps): Promise<ConsentCheckResult> {
  const pending = deps.readPendingFlag();
  if (pending) {
    if (!isPendingFlagTrustworthy(pending, deps)) {
      // 別の利用者・別の操作種別・期限切れの保留同意は、取り違えを防ぐため
      // 使わずに破棄する。
      deps.clearPendingFlag();
    } else {
      const { error } = await deps.recordConsent();
      if (!error) {
        deps.clearPendingFlag();
        return { kind: "accepted" };
      }
      // 記録自体が失敗した場合はフラグを残したまま、通常の未同意判定へ
      // フォールスルーする（同意済み扱いにしない）。
    }
  }

  const result = await deps.hasCurrentConsentRow(uid);
  if (!result.ok) {
    return { kind: "error", message: CONSENT_CHECK_ERROR_MESSAGE };
  }
  return result.exists ? { kind: "accepted" } : { kind: "consent-required" };
}
