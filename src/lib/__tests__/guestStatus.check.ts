// isGuestUser / isConfirmedMember（src/lib/guestStatus.ts）の検証。
// 「authUser.is_anonymous または profile.isGuest のどちらか一方でもtrueならゲスト」
// というOR判定と、「確定会員（isConfirmedMember）はprofile取得済み・かつ
// authUser.idとprofile.idが一致していなければ一切trueにならない」という、
// 2026-09-13の再レビュー指摘の核心部分を確認する。
import assert from "node:assert/strict";

import { isConfirmedMember, isGuestUser, isSameUser } from "../guestStatus";

type FakeUser = { id: string; is_anonymous?: boolean } | null | undefined;
type FakeProfile = { id: string; isGuest: boolean } | null | undefined;

// ---- isGuestUser ----

// 1: authUser=null・profile=null は通常の未ログイン。ゲストではない。
assert.equal(isGuestUser(null, null), false);
console.log("PASS: authUser/profileどちらもnullならゲストではない");

// 2: authUser.is_anonymous=true・profile=null（profile取得前・取得失敗）でも即ゲスト。
//    これがこの共通化の核心：profileの成否を待たずにauthUser側だけで判定できる。
const anonUser: FakeUser = { id: "guest-1", is_anonymous: true };
assert.equal(isGuestUser(anonUser, null), true);
console.log("PASS: profileがnullでもauthUser.is_anonymous=trueなら即ゲストと判定する");

// 3: authUser.is_anonymous=false（通常のXユーザー）・profile.isGuest=trueという
//    通常はあり得ない組み合わせでも、ORなのでゲスト扱いになる（fail-safe）。
const xUser: FakeUser = { id: "u1", is_anonymous: false };
const guestProfile: FakeProfile = { id: "u1", isGuest: true };
assert.equal(isGuestUser(xUser, guestProfile), true);
console.log("PASS: profile.isGuest=trueだけでもゲストと判定する（fail-safe OR）");

// 4: 通常のXユーザー（is_anonymous=false・profile.isGuest=false）はゲストではない。
const memberProfile: FakeProfile = { id: "u1", isGuest: false };
assert.equal(isGuestUser(xUser, memberProfile), false);
console.log("PASS: 通常のXユーザーはゲストと判定されない");

// ---- isConfirmedMember ----

// 5: 未ログイン(authUser=null)は確定会員にならない。
assert.equal(
  isConfirmedMember({ authUser: null, profile: memberProfile, profileLoading: false }),
  false,
);
console.log("PASS: 未ログインは確定会員にならない");

// 6: 認証済みだがprofile取得中(profileLoading=true)は、profileが無くても
//    有っても確定会員にならない（既定値を実データのように見せないための核心）。
assert.equal(
  isConfirmedMember({ authUser: xUser, profile: null, profileLoading: true }),
  false,
);
assert.equal(
  isConfirmedMember({ authUser: xUser, profile: memberProfile, profileLoading: true }),
  false,
);
console.log("PASS: profile取得中は確定会員にならない（profileの有無によらず）");

// 7: profileLoading=falseでもprofileがnull（取得失敗）なら確定会員にならない。
assert.equal(
  isConfirmedMember({ authUser: xUser, profile: null, profileLoading: false }),
  false,
);
console.log("PASS: profile取得に失敗した場合（loading完了・profile null）は確定会員にならない");

// 8: 匿名ユーザーは、profileが会員っぽい値(isGuest:false、あり得ない組み合わせ)でも
//    確定会員にはならない（is_anonymousが優先）。
assert.equal(
  isConfirmedMember({
    authUser: anonUser,
    profile: { id: "guest-1", isGuest: false },
    profileLoading: false,
  }),
  false,
);
console.log("PASS: authUser.is_anonymous=trueは確定会員にならない");

// 9: 認証済み・匿名でない・profile取得済み・isGuestでない・id一致、が全て揃って
//    初めてtrue。
assert.equal(
  isConfirmedMember({ authUser: xUser, profile: memberProfile, profileLoading: false }),
  true,
);
console.log("PASS: 認証済み・匿名でない・profile取得済み・isGuestでない・id一致の全条件が揃うと確定会員になる");

// 10（再レビュー対応）：authUser.idとprofile.idが一致しない場合は、他の条件が
//     全て揃っていても確定会員にならない（前の利用者のprofileが一瞬残っている
//     状態を、この判定自身でも安全側に倒すための核心）。
const staleProfileOfDifferentUser: FakeProfile = { id: "u-old", isGuest: false };
assert.equal(
  isConfirmedMember({ authUser: xUser, profile: staleProfileOfDifferentUser, profileLoading: false }),
  false,
);
console.log("PASS: authUser.idとprofile.idが不一致なら、profileLoading=false・isGuest=falseでも確定会員にならない");

// ---- isSameUser ----
// PointHistoryModal・NotificationBellが「取得中に別ユーザー/ゲストへ切り替わって
// いたら、遅れて届いた結果を採用しない」ために使う判定。

// 11: 取得をリクエストした時点のuserIdと、結果が届いた時点の認証userIdが一致すれば true。
assert.equal(isSameUser("u1", "u1"), true);
console.log("PASS: isSameUserはrequestedUserIdとcurrentAuthUserIdが一致すればtrue");

// 12: 一致しない（別ユーザーへ切り替わった）場合はfalse——前の利用者のデータを
//     表示させない核心。
assert.equal(isSameUser("u1", "u2"), false);
console.log("PASS: isSameUserは別ユーザーへ切り替わっていればfalse（前の利用者のデータを表示しない）");

// 13: currentAuthUserIdがnull/undefined（ログアウト・ゲストへ切り替わった）場合もfalse。
assert.equal(isSameUser("u1", null), false);
assert.equal(isSameUser("u1", undefined), false);
console.log("PASS: isSameUserはログアウト・ゲストへの切り替え（currentAuthUserIdがnull）でもfalse");

// 14: requestedUserId自体が空/nullなら常にfalse（取得すらしていないはずの状態）。
assert.equal(isSameUser(null, "u1"), false);
assert.equal(isSameUser("", "u1"), false);
console.log("PASS: isSameUserはrequestedUserIdが無ければfalse");

console.log("ALL GUEST_STATUS CHECKS PASSED");
