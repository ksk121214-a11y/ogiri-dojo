// ゲスト（匿名参加者）かどうかの判定を全画面で共通化するための純粋関数。
//
// 背景（2026-09-13、0070ゲスト参加レビュー対応）：これまで各コンポーネントが
// 個別にprofile?.isGuestだけを見て判定していたため、profile取得前・取得失敗時
// （profileがnullのまま）は「ゲストではない＝通常会員」と誤判定され、段位・
// ポイント・会員限定UIが一瞬（あるいは取得失敗時はずっと）通常会員として
// 表示されてしまう不具合があった。
//
// authUser.is_anonymous（Supabase Authのセッションに載っている実値、profileの
// 取得を待たずに分かる）とprofile.isGuest（profiles.is_guest由来、DB側の
// 最終防御と同じ判定元）のどちらか一方でもtrueならゲストとして扱うfail-safe設計
// にすることで、profileがまだ無くても匿名ユーザーを取り違えない。
import type { User } from "@supabase/supabase-js";

export interface GuestProfileLike {
  id: string;
  isGuest: boolean;
}

export function isGuestUser(
  authUser: Pick<User, "is_anonymous"> | null | undefined,
  profile: Pick<GuestProfileLike, "isGuest"> | null | undefined,
): boolean {
  return authUser?.is_anonymous === true || profile?.isGuest === true;
}

// 「段位・ポイント・寄合券残数・通知」等、実際にprofilesの実データが確定して
// いなければ表示してはいけない会員専用UIを出してよいかどうかの判定。
// 認証済み・匿名ではない・profile取得済み（loading中でない）・profile.isGuestで
// ない・認証中ユーザーのidとprofile.idが一致している、の全てが揃って初めて
// true になる（1つでも欠けていれば通常会員としては一切表示しない）。
//
// 2026-09-13（再レビュー対応）：id一致チェックを追加した理由——useProfileStoreは
// ログイン中ユーザーの切り替え（会員A→ゲスト、会員A→会員B）の際、旧ユーザーの
// profileを一瞬（fetchProfileの完了まで）保持したままになり得る実装上の隙が
// あった（loadForUser自体はここで直さず別途nullリセットするが、念のため
// 「今のauthUserと一致しないprofile」を安全側でも弾く多層防御として、
// isConfirmedMemberの側でも必ずid一致を要求する）。
export function isConfirmedMember(params: {
  authUser: Pick<User, "is_anonymous" | "id"> | null | undefined;
  profile: GuestProfileLike | null | undefined;
  profileLoading: boolean;
}): boolean {
  const { authUser, profile, profileLoading } = params;
  if (!authUser) return false;
  if (isGuestUser(authUser, profile)) return false;
  if (profileLoading) return false;
  if (!profile) return false;
  if (profile.id !== authUser.id) return false;
  return true;
}

// PointHistoryModal・NotificationBell等、「自分のuserId向けにデータを取得し、
// 完了時点でもまだ同じ利用者のままかを確認してから表示する」パターン共通の
// 判定。取得中に別アカウント・ゲストへ切り替わっていた場合、遅れて届いた
// レスポンスを表示に使わない（前の利用者のデータが一瞬でも残って見えるのを防ぐ）。
export function isSameUser(
  requestedUserId: string | null | undefined,
  currentAuthUserId: string | null | undefined,
): boolean {
  return !!requestedUserId && requestedUserId === currentAuthUserId;
}
