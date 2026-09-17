// linkAttempt.ts（複数プロバイダー対応レビュー再修正・項目1）の検証。
// sessionStorageへの保存・読み込み・削除・有効期限判定が、壊れた/改ざんされた
// 値に対しても例外を投げずnull/falseへ安全に倒れることを確認する。
// window.sessionStorageは関数呼び出し時に参照されるだけ（モジュール読み込み時の
// 副作用が無い）ため、先にin-memoryモックをglobal.windowへ設定してから
// 呼び出せばよい（useAuthStore.tsのような読み込み時副作用は無い）。
import assert from "node:assert/strict";

const memoryStorage = new Map<string, string>();
let throwOnSetItem = false;
(global as unknown as { window: unknown }).window = {
  sessionStorage: {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (throwOnSetItem) throw new Error("quota exceeded (test)");
      memoryStorage.set(key, value);
    },
    removeItem: (key: string) => {
      memoryStorage.delete(key);
    },
  },
};

import {
  LINK_ATTEMPT_STORAGE_KEY,
  clearLinkAttempt,
  isLinkAttemptExpired,
  readLinkAttempt,
  saveLinkAttempt,
} from "../linkAttempt";

function main() {
  // ---- 正常系：保存→読み込みで同じ内容が戻る ----
  memoryStorage.clear();
  const saved = saveLinkAttempt({ userId: "user-1", provider: "google", priorIdentityIds: ["id-x"] });
  assert.equal(saved, true, "正常な保存がfalseを返している");
  const read = readLinkAttempt();
  assert.ok(read, "保存直後の読み込みがnullになっている");
  assert.equal(read?.userId, "user-1");
  assert.equal(read?.provider, "google");
  assert.deepEqual(read?.priorIdentityIds, ["id-x"]);
  assert.equal(read?.v, 1);
  assert.equal(typeof read?.startedAt, "number");
  console.log("PASS: 正常に保存した一時情報はそのまま読み込める");

  // ---- 削除後は読み込めない ----
  clearLinkAttempt();
  assert.equal(readLinkAttempt(), null, "clearLinkAttempt後もidentitiesが読み込めてしまっている");
  console.log("PASS: clearLinkAttempt後は読み込めない（再利用不可）");

  // ---- 壊れたJSON（形式が不正）はnullを返す（例外を投げない） ----
  memoryStorage.set(LINK_ATTEMPT_STORAGE_KEY, "{not valid json");
  assert.equal(readLinkAttempt(), null, "壊れたJSONでも例外を投げずnullを返すべき");
  console.log("PASS: 壊れたJSONは例外を投げずnullとして扱われる");

  // ---- 形式は正しいJSONだが、想定外の形（provider改ざん・型不一致）はnullを返す ----
  memoryStorage.set(
    LINK_ATTEMPT_STORAGE_KEY,
    JSON.stringify({ v: 1, userId: "user-1", provider: "facebook", startedAt: Date.now(), priorIdentityIds: [] }),
  );
  assert.equal(readLinkAttempt(), null, "対応外のprovider(\"facebook\")を持つ値を信頼してしまっている");

  memoryStorage.set(
    LINK_ATTEMPT_STORAGE_KEY,
    JSON.stringify({ v: 1, userId: 12345, provider: "google", startedAt: Date.now(), priorIdentityIds: [] }),
  );
  assert.equal(readLinkAttempt(), null, "userIdが数値（型不一致）の値を信頼してしまっている");

  memoryStorage.set(LINK_ATTEMPT_STORAGE_KEY, JSON.stringify({ v: 2, userId: "u", provider: "x" }));
  assert.equal(readLinkAttempt(), null, "vが1以外・必須フィールド欠落の値を信頼してしまっている");
  console.log("PASS: 形式が不正な値（provider改ざん・型不一致・必須項目欠落）はnullとして扱われる");

  // ---- 保存失敗時（sessionStorageへの書き込み拒否）はfalseを返す ----
  memoryStorage.clear();
  throwOnSetItem = true;
  const savedFail = saveLinkAttempt({ userId: "user-1", provider: "apple", priorIdentityIds: [] });
  assert.equal(savedFail, false, "sessionStorageへの書き込みが失敗してもtrueを返してしまっている");
  assert.equal(readLinkAttempt(), null, "書き込みに失敗したのに何かが保存されてしまっている");
  throwOnSetItem = false;
  console.log("PASS: sessionStorageへの保存に失敗した場合はfalseを返し、何も保存しない");

  // ---- 有効期限判定 ----
  memoryStorage.clear();
  saveLinkAttempt({ userId: "user-1", provider: "google", priorIdentityIds: [] });
  const attempt = readLinkAttempt()!;
  assert.equal(isLinkAttemptExpired(attempt, attempt.startedAt), false, "開始直後は期限切れと判定されている");
  assert.equal(
    isLinkAttemptExpired(attempt, attempt.startedAt + 9 * 60 * 1000),
    false,
    "9分後（10分以内）が期限切れと判定されている",
  );
  assert.equal(
    isLinkAttemptExpired(attempt, attempt.startedAt + 11 * 60 * 1000),
    true,
    "11分後（10分超過）が期限切れと判定されていない",
  );
  console.log("PASS: 有効期限は目安10分で正しく判定される");

  console.log("ALL LINK_ATTEMPT CHECKS PASSED");
}

main();
