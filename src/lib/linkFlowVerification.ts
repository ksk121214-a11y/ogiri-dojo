// 2026-09-18（複数プロバイダー対応レビュー再修正・項目1）：linkAttempt.tsで
// 保存した一時情報と、実際にSupabaseから取得したidentity一覧を突き合わせ、
// 「本当に連携が完了したか」を判定する純粋関数群。
// auth/callbackページ（src/app/auth/callback/page.tsx）はこの2関数を順番に
// 呼ぶだけで、URLから受け取った値（provider等）は一切判定に使わない
// （providerは常にsessionStorageに保存された、linkProvider()呼び出し時点の
// 値だけを信頼する）。
import type { UserIdentity } from "@supabase/supabase-js";

import { SUPABASE_PROVIDER_VALUE } from "./authProviders";
import type { LinkAttempt } from "./linkAttempt";
import { isLinkAttemptExpired } from "./linkAttempt";

export type LinkVerificationFailureReason =
  | "no_attempt"
  | "expired"
  | "user_mismatch"
  | "identities_fetch_failed"
  | "identity_not_added"
  | "provider_mismatch";

export type LinkVerificationCheck = { ok: true } | { ok: false; reason: LinkVerificationFailureReason };

// 手順1〜5相当：一時情報そのものの有効性（存在する・期限内・連携開始時と
// 同じuser IDでコールバックへ戻ってきている）を確認する。この時点でNGなら、
// 呼び出し元はgetUserIdentities()すら呼ばずに済ませてよい。
export function validateLinkAttempt(
  attempt: LinkAttempt | null,
  now: number,
  currentUserId: string | null,
): LinkVerificationCheck {
  if (!attempt) return { ok: false, reason: "no_attempt" };
  if (isLinkAttemptExpired(attempt, now)) return { ok: false, reason: "expired" };
  if (!currentUserId || currentUserId !== attempt.userId) return { ok: false, reason: "user_mismatch" };
  return { ok: true };
}

export type IdentitiesFetchResult = { ok: true; identities: UserIdentity[] } | { ok: false };

// 手順6〜7相当：validateLinkAttemptがokの場合にのみ呼ぶ。実際に
// getUserIdentities()を実行した結果と、連携開始「前」のidentity_id一覧を
// 突き合わせ、(a) 新しいidentityが実際に増えていること、(b) その新しい
// identityのproviderが、連携を開始したprovider（sessionStorageに保存された
// 値、URLの値ではない）と一致することの両方を確認する。
export function verifyIdentityWasAdded(
  attempt: LinkAttempt,
  identitiesResult: IdentitiesFetchResult,
): LinkVerificationCheck {
  if (!identitiesResult.ok) return { ok: false, reason: "identities_fetch_failed" };

  const newIdentity = identitiesResult.identities.find(
    (identity) => !attempt.priorIdentityIds.includes(identity.identity_id),
  );
  if (!newIdentity) return { ok: false, reason: "identity_not_added" };

  if (newIdentity.provider !== SUPABASE_PROVIDER_VALUE[attempt.provider]) {
    return { ok: false, reason: "provider_mismatch" };
  }

  return { ok: true };
}
