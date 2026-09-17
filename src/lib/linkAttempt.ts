// 2026-09-18（複数プロバイダー対応レビュー再修正・項目1）：Xログイン中の
// アカウントへGoogle/Appleを追加連携する際、「実際にidentityが追加された
// ことを確認できた場合だけ連携成功として扱う」ための一時情報を
// sessionStorageへ保存・検証・削除する。
//
// 背景：修正前は、ログイン済みユーザーが/auth/callback/?flow=linkを直接
// 開いただけでも（既存セッションがあるというだけの理由で）連携成功扱いに
// なっていた。この一時情報（連携を開始したuser ID・対象provider・開始前の
// identity一覧・開始時刻）をuseAuthStore.linkProviderが連携開始時に保存し、
// コールバック側（linkFlowVerification.ts）がSupabaseから実際に取得した
// identity一覧と突き合わせて初めて成功と判定する。
import type { AuthProviderId } from "./authProviders";

export const LINK_ATTEMPT_STORAGE_KEY = "dojo_link_attempt_v1";
// 目安10分。OAuth同意画面での操作に現実的にかかる時間を超えつつ、
// 古いタブ・放置されたセッションストレージが誤って有効と判定されない範囲。
export const LINK_ATTEMPT_TTL_MS = 10 * 60 * 1000;

export interface LinkAttempt {
  v: 1;
  userId: string;
  provider: AuthProviderId;
  startedAt: number;
  // 連携開始「前」に取得できていたidentity_idの一覧。連携後にこの一覧へ
  // 含まれないidentityが増えていれば、それが今回追加されたものだと判定できる。
  priorIdentityIds: string[];
}

function hasSessionStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.sessionStorage;
  } catch {
    // 一部のプライベートブラウジング環境ではsessionStorageへのアクセス自体が
    // 例外を投げることがあるため、存在確認自体も例外安全にする。
    return false;
  }
}

function isValidLinkAttemptShape(value: unknown): value is LinkAttempt {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.userId === "string" &&
    v.userId.length > 0 &&
    (v.provider === "x" || v.provider === "google" || v.provider === "apple") &&
    typeof v.startedAt === "number" &&
    Number.isFinite(v.startedAt) &&
    Array.isArray(v.priorIdentityIds) &&
    v.priorIdentityIds.every((id) => typeof id === "string")
  );
}

// 連携開始時にuseAuthStore.linkProviderから呼ぶ。保存できた場合だけtrueを返す
// （呼び出し元は、falseの場合はlinkIdentity()自体を開始してはいけない）。
export function saveLinkAttempt(input: {
  userId: string;
  provider: AuthProviderId;
  priorIdentityIds: string[];
}): boolean {
  if (!hasSessionStorage()) return false;
  const attempt: LinkAttempt = {
    v: 1,
    userId: input.userId,
    provider: input.provider,
    startedAt: Date.now(),
    priorIdentityIds: input.priorIdentityIds,
  };
  try {
    window.sessionStorage.setItem(LINK_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
    return true;
  } catch {
    // sessionStorageの容量超過・プライベートブラウジング等での書き込み拒否。
    return false;
  }
}

// 壊れている・形式が不正な場合はnullを返す（例外を投げない）。
// JSONとして読めた場合でも、想定外の形（provider改ざん・型不一致等）なら
// 信頼できないものとして扱いnullにする。
export function readLinkAttempt(): LinkAttempt | null {
  if (!hasSessionStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(LINK_ATTEMPT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidLinkAttemptShape(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// 一時情報は「一度使ったら再利用できない」必要があるため、コールバック側は
// 成功・失敗・期限切れ・キャンセルのいずれの結果でも、判定に使った直後に
// 必ずこれを呼ぶ。
export function clearLinkAttempt(): void {
  if (!hasSessionStorage()) return;
  try {
    window.sessionStorage.removeItem(LINK_ATTEMPT_STORAGE_KEY);
  } catch {
    // 削除に失敗しても（読み取り専用ストレージ等）、後続の判定は
    // 「有効期限切れ」または「別の一致しない試行」として自然に無害化される。
  }
}

export function isLinkAttemptExpired(attempt: LinkAttempt, now: number = Date.now()): boolean {
  return now - attempt.startedAt > LINK_ATTEMPT_TTL_MS;
}
