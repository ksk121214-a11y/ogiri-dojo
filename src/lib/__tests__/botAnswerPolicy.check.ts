// ボット回答の送信方針（src/lib/botAnswerPolicy.ts）の検証。
// 修正前の問題：ボットの回答→審査→次のボット回答が連鎖し、人間の回答者は
// 「審査中…」で送信できない時間が続き、回答時間内に1件も送れなかった。
// また同一tickで複数ボットが同時にINSERTして409/403が多発した。
import assert from "node:assert/strict";

import {
  BOT_ANSWER_DEADLINE_MARGIN_MS,
  BOT_HUMAN_GRACE_MS,
  BOT_UNKNOWN_CONFLICT_MAX_ATTEMPTS,
  botRetryBackoffMs,
  botAnswerKey,
  botHumanGraceMs,
  classifyBotAnswerInsertError,
  createBotAnswerGuard,
  createBotIdleTracker,
  decideBotAnswerGate,
  finishBotAnswer,
  observeBotIdleWindow,
  tryBeginBotAnswer,
} from "../botAnswerPolicy";

const DEADLINE = 1_000_000;

// 1) 猶予の値：standard/short_test それぞれ。
assert.equal(botHumanGraceMs("standard"), 6_000);
assert.equal(botHumanGraceMs("short_test"), 2_000);
assert.equal(botHumanGraceMs(null), 6_000);
assert.equal(botHumanGraceMs(undefined), 6_000);
console.log("PASS: 猶予はstandard 6秒 / short_test 2秒（不明なprofileはstandard）");

// 2) 基本ゲート。
{
  const t = createBotIdleTracker();
  observeBotIdleWindow(t, { turnId: "t1", busy: false, nowMs: 100 });
  const base = { nowMs: 100, busy: false, paused: false, phaseDeadlineMs: DEADLINE, humanUnsentCount: 0, tracker: t, graceMs: 6_000 };
  assert.deepEqual(decideBotAnswerGate(base), { allow: true }, "人間の未送信者がいなければ遅延なしで送信できる");
  assert.deepEqual(decideBotAnswerGate({ ...base, nowMs: null }), { allow: false, reason: "clock-not-fresh" });
  assert.deepEqual(decideBotAnswerGate({ ...base, busy: true }), { allow: false, reason: "busy" });
  assert.deepEqual(decideBotAnswerGate({ ...base, paused: true }), { allow: false, reason: "paused" });
  assert.deepEqual(decideBotAnswerGate({ ...base, phaseDeadlineMs: null }), { allow: false, reason: "no-deadline" });
  assert.deepEqual(
    decideBotAnswerGate({ ...base, nowMs: DEADLINE - BOT_ANSWER_DEADLINE_MARGIN_MS }),
    { allow: false, reason: "near-deadline" },
    "締切の直前は送信しない（RLSで拒否される時間帯を避ける）",
  );
  console.log("PASS: 同期時計・審査中・一時停止・締切直前はボット回答を許可しない／人間未送信者がいなければ遅延なし");
}

// 3) 人間優先：審査が終わって送信可能になってから猶予の間はボットが送らない。
for (const [profile, grace] of [["standard", BOT_HUMAN_GRACE_MS.standard], ["short_test", BOT_HUMAN_GRACE_MS.short_test]] as const) {
  const t = createBotIdleTracker();
  const graceMs = botHumanGraceMs(profile);
  assert.equal(graceMs, grace);
  // 審査中→送信可能に切り替わる瞬間。
  observeBotIdleWindow(t, { turnId: "t1", busy: true, nowMs: 1_000 });
  observeBotIdleWindow(t, { turnId: "t1", busy: false, nowMs: 5_000 });
  const gate = (now: number) =>
    decideBotAnswerGate({ nowMs: now, busy: false, paused: false, phaseDeadlineMs: DEADLINE, humanUnsentCount: 2, tracker: t, graceMs });
  // 猶予の全期間（500ms tickごと）でボットは送れない＝人間は少なくとも graceMs の間は送信できる。
  for (let now = 5_000; now < 5_000 + graceMs; now += 500) {
    assert.deepEqual(gate(now), { allow: false, reason: "human-priority" }, `${profile}: 猶予中(${now - 5_000}ms)にボットが送れてしまう`);
  }
  assert.deepEqual(gate(5_000 + graceMs), { allow: true }, `${profile}: 猶予を過ぎてもボットが送れない`);
  console.log(`PASS: ${profile}: 送信可能になってから${graceMs}msの間、人間の未送信者がいればボットは回答を送らない`);
}

// 4) 回数上限は無い：人間が初回回答を送るまでは、何回目の送信可能時間帯でも猶予が与えられる。
{
  const t = createBotIdleTracker();
  let now = 0;
  for (let i = 0; i < 40; i += 1) {
    observeBotIdleWindow(t, { turnId: "t1", busy: true, nowMs: now });
    now += 1_000;
    observeBotIdleWindow(t, { turnId: "t1", busy: false, nowMs: now });
    const first = decideBotAnswerGate({ nowMs: now, busy: false, paused: false, phaseDeadlineMs: DEADLINE, humanUnsentCount: 1, tracker: t, graceMs: 6_000 });
    assert.deepEqual(first, { allow: false, reason: "human-priority" }, `${i + 1}回目の送信可能時間帯で猶予が与えられていない`);
    const later = decideBotAnswerGate({ nowMs: now + 6_000, busy: false, paused: false, phaseDeadlineMs: DEADLINE, humanUnsentCount: 1, tracker: t, graceMs: 6_000 });
    assert.deepEqual(later, { allow: true }, "猶予を過ぎても永久に待っている");
    now += 6_000;
  }
  console.log("PASS: 人間の初回回答まで、40回目の送信可能時間帯でも毎回猶予が与えられる（回数上限なし）");
}

// 5) ターンが変わると窓の数え直し。人間が既に送信済みなら待たない。
{
  const t = createBotIdleTracker();
  observeBotIdleWindow(t, { turnId: "t1", busy: false, nowMs: 0 });
  observeBotIdleWindow(t, { turnId: "t2", busy: false, nowMs: 10_000 });
  assert.equal(t.turnId, "t2");
  assert.equal(t.windowsStarted, 1, "ターン切替で窓の数がリセットされていない");
  assert.equal(t.idleSinceMs, 10_000);
  // 同期時計がfreshでないtickは状態を変えない。
  observeBotIdleWindow(t, { turnId: "t2", busy: true, nowMs: null });
  observeBotIdleWindow(t, { turnId: "t2", busy: false, nowMs: null });
  assert.equal(t.idleSinceMs, null, "busy中はidleSinceが消える");
  console.log("PASS: ターン切替で窓をリセット／時計が未同期なら誤った時刻で窓を開始しない");
}

// 6) 回答時間全体（standard 60秒／short_test 20秒）を通したシミュレーション。
//    ボット6体が毎tick試み、人間2人は最後まで送信しない（離席）。回答の持ち時間は
//    「審査中でない時間」だけ進む（猶予中も消費される）。
//    - 各送信可能時間帯の先頭 graceMs は、必ず人間用猶予（ボットは送れない）。
//    - それでも持ち時間は必ず0に到達する（永久停止しない）。
for (const profile of ["standard", "short_test"] as const) {
  const graceMs = botHumanGraceMs(profile);
  const answerMs = profile === "standard" ? 60_000 : 20_000;
  const judgeCycleMs = profile === "standard" ? 16_000 : 12_000; // 審査＋演出（送信不可の時間）
  const TICK = 500;
  const t = createBotIdleTracker();
  let remaining = answerMs; // 持ち時間（idleの間だけ減る）
  let busyUntil = -1;
  let now = 0;
  let idleStart: number | null = null;
  let windows = 0;
  let botAnswers = 0;
  let violations = 0;
  let guard = 0;
  while (remaining > 0 && guard < 100_000) {
    guard += 1;
    const busy = now < busyUntil;
    observeBotIdleWindow(t, { turnId: "t1", busy, nowMs: now });
    if (busy) idleStart = null;
    else if (idleStart === null) {
      idleStart = now;
      windows += 1;
    }
    const gate = decideBotAnswerGate({
      nowMs: now,
      busy,
      paused: false,
      phaseDeadlineMs: now + remaining, // 残り時間から作る締切
      humanUnsentCount: 2, // 人間は最後まで送信しない
      tracker: t,
      graceMs,
    });
    if (!busy && idleStart !== null && now - idleStart < graceMs && gate.allow) violations += 1;
    if (!busy && gate.allow) {
      botAnswers += 1; // ボットが回答を送り、審査サイクルに入る
      busyUntil = now + judgeCycleMs;
    }
    if (!busy) remaining -= TICK; // 猶予中も持ち時間は消費される
    now += TICK;
  }
  assert.ok(remaining <= 0, `${profile}: 人間が送信しなくても期限に到達しない（永久停止）`);
  assert.equal(violations, 0, `${profile}: 送信可能時間帯の先頭${graceMs}msにボットが送信できてしまった`);
  assert.ok(windows >= 2, `${profile}: 複数の送信可能時間帯が通しで検証されていない(windows=${windows})`);
  console.log(`PASS: ${profile}: 持ち時間${answerMs / 1000}秒を通し、人間が最後まで送信しなくても期限に到達し、全${windows}回の送信可能時間帯で先頭${graceMs}msは人間用猶予（ボット回答${botAnswers}件）`);
}

// 7) 1tickで複数ボットが同時にINSERTしない（single-flight）／完了済みは再送しない。
{
  const g = createBotAnswerGuard();
  const bots = ["b1", "b2", "b3", "b4", "b5", "b6"];
  let began = 0;
  for (const b of bots) if (tryBeginBotAnswer(g, botAnswerKey("t1", b, 1), 0)) began += 1;
  assert.equal(began, 1, "同一tickで複数ボットが同時にINSERTを開始できてしまう");
  finishBotAnswer(g, botAnswerKey("t1", "b1", 1), "ok", 0);
  assert.equal(tryBeginBotAnswer(g, botAnswerKey("t1", "b1", 1), 10_000), false, "成功済みの同じ(turn,participant,seq)を再送しようとしている");
  assert.equal(tryBeginBotAnswer(g, botAnswerKey("t1", "b2", 1), 0), true, "1件完了後は別ボットが送れる");
  finishBotAnswer(g, botAnswerKey("t1", "b2", 1), "already-exists", 0);
  assert.equal(tryBeginBotAnswer(g, botAnswerKey("t1", "b2", 1), 10_000), false, "seq重複(既存)を再送しようとしている");
  console.log("PASS: ボット回答は全体で同時1件、成功・seq重複(既存)の同一キーは再送しない");
}

// 8) エラー分類：制約名まで見て、意味の違う23505を区別する。42501は永久禁止にしない。
{
  const seqErr = { code: "23505", message: 'duplicate key value violates unique constraint "answers_turn_id_participant_id_seq_key"' };
  const busyErr = { code: "23505", message: 'duplicate key value violates unique constraint "answers_one_unresolved_per_turn"' };
  const detailsOnly = { code: "23505", message: "duplicate key", details: 'Key ... violates "answers_one_unresolved_per_turn"' };
  assert.equal(classifyBotAnswerInsertError(null), "ok");
  assert.equal(classifyBotAnswerInsertError(seqErr), "already-exists", "同じボット回答の重複は成功相当のno-op");
  assert.equal(classifyBotAnswerInsertError(busyErr), "busy-conflict", "別の回答が審査中という競合は再試行が必要");
  assert.equal(classifyBotAnswerInsertError(detailsOnly), "busy-conflict", "details側の制約名も判別する");
  assert.equal(classifyBotAnswerInsertError({ code: "23505", message: 'violates unique constraint "some_other_key"' }), "unknown-conflict", "不明な23505を成功扱いにしている");
  assert.equal(classifyBotAnswerInsertError({ code: "23505" }), "unknown-conflict", "制約名の無い23505を成功扱いにしている");
  assert.equal(classifyBotAnswerInsertError({ code: "42501", message: "new row violates row-level security policy" }), "forbidden");
  assert.equal(classifyBotAnswerInsertError({ code: "PGRST000", message: "network" }), "transient");
  console.log("PASS: 23505は制約名で seq重複(no-op)／審査中競合(再試行)／不明(成功扱いにしない) に分類、42501は forbidden（永久禁止にしない）");
}

// 9) バックオフ：再試行は500ms tickの連打にならず、同じターンの時間内に再試行できる。
{
  const g = createBotAnswerGuard();
  const key = botAnswerKey("t1", "b1", 1);
  assert.equal(tryBeginBotAnswer(g, key, 0), true);
  finishBotAnswer(g, key, "busy-conflict", 0); // 別の回答が審査中
  for (let now = 0; now < botRetryBackoffMs("busy-conflict", 1); now += 500) {
    assert.equal(tryBeginBotAnswer(g, key, now), false, `バックオフ中(${now}ms)に再送している（500msごとの連打）`);
  }
  assert.equal(tryBeginBotAnswer(g, key, botRetryBackoffMs("busy-conflict", 1)), true, "バックオフ後に再試行できない");
  finishBotAnswer(g, key, "forbidden", 5_000); // 一時的な状態ずれ(paused/演出中)によるRLS拒否
  assert.equal(tryBeginBotAnswer(g, key, 5_000 + 500), false, "42501後の再試行が連打になっている");
  assert.equal(tryBeginBotAnswer(g, key, 5_000 + botRetryBackoffMs("forbidden", 2)), true, "42501が同じターンの時間内でも永久に再送禁止になっている");
  finishBotAnswer(g, key, "ok", 20_000);
  assert.equal(tryBeginBotAnswer(g, key, 99_999), false, "成功後に再送している");
  // バックオフは指数的に伸び、上限で頭打ち。
  assert.ok(botRetryBackoffMs("forbidden", 3) > botRetryBackoffMs("forbidden", 1));
  assert.ok(botRetryBackoffMs("forbidden", 30) <= 12_000);
  // 不明な23505は成功扱いにせず、上限回数で打ち切る（無限再試行しない）。
  const g2 = createBotAnswerGuard();
  const k2 = botAnswerKey("t1", "b2", 1);
  let now = 0;
  let attempts = 0;
  for (let i = 0; i < 20; i += 1) {
    if (tryBeginBotAnswer(g2, k2, now)) {
      attempts += 1;
      finishBotAnswer(g2, k2, "unknown-conflict", now);
    }
    now += 20_000;
  }
  assert.equal(attempts, BOT_UNKNOWN_CONFLICT_MAX_ATTEMPTS, "不明な23505の再試行回数が上限になっていない");
  console.log("PASS: 競合・拒否は指数バックオフで再試行（連打にならない）、成功後は再送せず、不明な23505は上限回数で打ち切る");
}

// 10) 複数司会タブが同時にINSERTした場合：DB（一意制約）を模したモデルで、各タブは独立した
//     guard（タブごとのメモリ）を持つ。最終的に回答は1件だけ、重複は no-op、競合は再試行で解消。
{
  type Row = { turn: string; participant: string; seq: number; resolved: boolean };
  const db: Row[] = [];
  const insert = (turn: string, participant: string, seq: number) => {
    if (db.some((r) => r.turn === turn && r.participant === participant && r.seq === seq)) {
      return { code: "23505", message: 'duplicate key value violates unique constraint "answers_turn_id_participant_id_seq_key"' };
    }
    if (db.some((r) => r.turn === turn && !r.resolved)) {
      return { code: "23505", message: 'duplicate key value violates unique constraint "answers_one_unresolved_per_turn"' };
    }
    db.push({ turn, participant, seq, resolved: false });
    return null;
  };
  const tabA = createBotAnswerGuard();
  const tabB = createBotAnswerGuard();
  const key = botAnswerKey("t1", "b1", 1);
  const key2 = botAnswerKey("t1", "b2", 1);
  // 同じボット・同じ回答順を、2つのタブが同じ瞬間に送る。
  assert.equal(tryBeginBotAnswer(tabA, key, 0), true);
  assert.equal(tryBeginBotAnswer(tabB, key, 0), true);
  const eA = insert("t1", "b1", 1);
  const eB = insert("t1", "b1", 1);
  finishBotAnswer(tabA, key, classifyBotAnswerInsertError(eA), 0);
  finishBotAnswer(tabB, key, classifyBotAnswerInsertError(eB), 0);
  assert.equal(classifyBotAnswerInsertError(eA), "ok");
  assert.equal(classifyBotAnswerInsertError(eB), "already-exists", "2つ目のタブの重複が成功相当のno-opになっていない");
  assert.equal(db.length, 1, "回答が重複して保存された");
  assert.equal(tryBeginBotAnswer(tabB, key, 10_000), false, "no-op済みの回答をタブBが再送しようとしている");
  // 別のボットの回答は、審査中の間は競合(busy-conflict)。解決後にバックオフを置いて再試行して成功する。
  assert.equal(tryBeginBotAnswer(tabB, key2, 1_000), true);
  const eC = insert("t1", "b2", 1);
  assert.equal(classifyBotAnswerInsertError(eC), "busy-conflict");
  finishBotAnswer(tabB, key2, "busy-conflict", 1_000);
  assert.equal(tryBeginBotAnswer(tabB, key2, 1_500), false, "競合直後（バックオフ中）に再送している");
  db[0].resolved = true; // 審査が終わる
  assert.equal(tryBeginBotAnswer(tabB, key2, 1_000 + botRetryBackoffMs("busy-conflict", 1)), true, "解決後に再試行できない");
  const eD = insert("t1", "b2", 1);
  finishBotAnswer(tabB, key2, classifyBotAnswerInsertError(eD), 3_000);
  assert.equal(eD, null, "解決後の再試行が成功していない");
  assert.equal(db.length, 2);
  console.log("PASS: 複数司会タブが同時にINSERTしても、同じ回答は1件・重複はno-op・審査中の競合は解決後に再試行して成功する");
}
