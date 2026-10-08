// /auth/callbackの成功判定：セッションが存在するだけでなく、非匿名であることを確認できた場合だけ成功とする
// （OAuth開始前のsignOut()廃止に伴う対策）。
import assert from "node:assert/strict";

import { isNonAnonymousSession } from "../authCallbackGuard";

assert.equal(isNonAnonymousSession(null), false, "セッションが無いのに成功扱いになっている");
assert.equal(isNonAnonymousSession(undefined), false);
assert.equal(isNonAnonymousSession({ user: { is_anonymous: true } }), false, "匿名セッションを成功扱いにしている（ゲスト01が残ったまま古い匿名セッションを誤検知する）");
assert.equal(isNonAnonymousSession({ user: { is_anonymous: false } }), true, "非匿名セッションを成功と判定しない");
assert.equal(isNonAnonymousSession({ user: {} }), true, "is_anonymousが未設定（=falseと同義）のセッションを成功と判定しない");
assert.equal(isNonAnonymousSession({}), true, "userが無いセッション形（防御的なケース）で誤って失敗にしていないか確認");
console.log("PASS: 非匿名セッションだけを成功と判定し、匿名・セッション無しは成功にしない");
