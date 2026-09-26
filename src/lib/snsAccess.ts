import type { User } from "@supabase/supabase-js";

import { isGuestUser, type GuestProfileLike } from "./guestStatus";

// 寄合帳での利用者の立場。画面ごとに判定が食い違わないよう、判定はここに一本化する。
//  checking  : 認証確認中（未ログイン用UI・「寄合券0枚」等を出さない）
//  anonymous : 未ログイン（閲覧のみ。操作するにはXログインが必要）
//  guest     : ゲスト（閲覧のみ。投稿・回答・ツッコミ・いいね・フォロー・通報は不可）
//  member    : 通常会員（操作可能）
export type SnsAccess = "checking" | "anonymous" | "guest" | "member";

export function resolveSnsAccess(p: {
  authUser: Pick<User, "is_anonymous"> | null | undefined;
  authLoading: boolean;
  profile: Pick<GuestProfileLike, "isGuest"> | null | undefined;
}): SnsAccess {
  if (p.authLoading) return "checking";
  if (!p.authUser) return "anonymous";
  return isGuestUser(p.authUser, p.profile) ? "guest" : "member";
}

// 閲覧のみの利用者に出す案内文（checkingは何も出さない）。verbは「回答」「ツッコミ」「コメント」等。
export function readOnlyNoticeText(access: SnsAccess, verb: string): string | null {
  if (access === "anonymous") return `${verb}するにはXログインが必要です。閲覧のみ可能です。`;
  if (access === "guest") return `ゲストは${verb}できません。Xでログインしてください。`;
  return null;
}
