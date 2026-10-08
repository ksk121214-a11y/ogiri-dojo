// 2周制・90秒化の配線検査（0085で2周固定・自動進行から、運営者が周ごとに
// 次へ進むか終了するかを選ぶ動的な周回追加へ変更したため、1〜6はその変更後の
// 値（初期1周・上限10周）がTS(定数)とDB(0085の関数)で一致していることを検証する
// ように更新した。7以降は周回数の仕組みと無関係な既存項目のため0084のまま検証する）。
// 回答時間(90秒)の値がTS(定数)とDB(0084の関数)で一致していること、
// お題必要数（組数×周回数）の計算と不足案内が正しいことを確認する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AnswerRow, ParticipantRow } from "../liveRoomTypes";
import { getGroupTurnRanking, getOverallRanking } from "../liveRoomSelectors";
import {
  manualTopicSelectionMessage,
  randomTopicShortageMessage,
  requiredTopicCount,
} from "../liveTopicRequirement";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// 1) お題必要数：ライブ作成時点では組数×1周（0085で2周目以降は動的追加へ変更）
{
  assert.equal(requiredTopicCount(2, 2), 4);
  assert.equal(requiredTopicCount(3, 2), 6);
  assert.equal(requiredTopicCount(5, 2), 10);
  const timingForInitial = read("src/data/liveRoomTiming.ts");
  const initialMatch = /export const ROUNDS_PER_LIVE_INITIAL = (\d+);/.exec(timingForInitial);
  assert.ok(initialMatch, "TSにROUNDS_PER_LIVE_INITIALが見つからない");
  const initialRounds = Number(initialMatch![1]);
  assert.equal(requiredTopicCount(2, initialRounds), 2, "ライブ作成時点の必要お題数が組数×1周になっていない");
  console.log("PASS: requiredTopicCountは組数×周回数の汎用計算で、ライブ作成時点はROUNDS_PER_LIVE_INITIAL(1)を使うため組数と同数になる");
}

// 2) ランダム選択の不足案内
{
  assert.equal(randomTopicShortageMessage(6, 6), null);
  assert.equal(randomTopicShortageMessage(6, 9), null);
  assert.equal(randomTopicShortageMessage(6, 4), "お題バンクが不足しています。あと2件必要です（必要6件）。");
  console.log("PASS: ランダム選択は不足件数を「あと○件必要です」で案内し、足りていれば案内しない");
}

// 3) 手動選択のちょうど一致
{
  assert.equal(manualTopicSelectionMessage(6, 6), null);
  assert.equal(manualTopicSelectionMessage(6, 4), "あと2件選んでください（必要6件）。");
  assert.equal(manualTopicSelectionMessage(6, 8), "2件多く選んでいます（必要6件）。");
  console.log("PASS: 手動選択は必要数ちょうどだけを受け付け、不足・超過を案内する");
}

// 4) TS定数とDB(0085)の初期周回数・上限周回数・回答時間が一致している
{
  const timing = read("src/data/liveRoomTiming.ts");
  assert.match(timing, /export const ROUNDS_PER_LIVE_INITIAL = 1;/, "TSの初期周回数が1になっていない");
  assert.match(timing, /export const MAX_ROUNDS_PER_LIVE = 10;/, "TSの周回数上限が10になっていない");
  assert.match(timing, /answerMs: 90_000,/, "TSの本番回答時間が90秒になっていない");

  const sql85 = read("supabase/migrations/0085_staging_operations_and_dynamic_rounds.sql");
  assert.match(sql85, /v_initial_rounds constant int := 1;/, "0085のcreate_live_preparationの初期周回数が1になっていない");
  assert.match(sql85, /v_expected_initial_rounds constant int := 1;/, "0085のbegin_gameの初期周回数が1になっていない");
  assert.match(sql85, /v_max_rounds constant int := 10;/, "0085のhost_add_next_roundの周回数上限が10になっていない");

  const sql84 = read("supabase/migrations/0084_live_limited_rewards_to_round5_and_timing.sql");
  assert.match(sql84, /when 'answering' then 90000/, "0084の本番回答時間が90秒になっていない");
  console.log("PASS: 初期周回数(1)・周回数上限(10)・本番回答時間(90秒)はTSとDB(0085)で一致している");
}

// 5) 保存値の統一：新規作成はrounds_per_live=1を明示保存し、begin_gameは保存値が1でなければ
//    開始しない。host_add_next_roundは周を追加するたびにrounds_per_liveを増やす。
{
  const sql = read("supabase/migrations/0085_staging_operations_and_dynamic_rounds.sql");
  const insertStart = sql.indexOf("insert into public.lives (");
  assert.ok(insertStart >= 0, "0085にlivesのINSERT文が見つからない");
  const insertBlock = sql.slice(insertStart, sql.indexOf(";", insertStart));
  assert.match(insertBlock, /rounds_per_live/, "create_live_preparationのINSERTがrounds_per_liveを保存していない");
  assert.match(insertBlock, /v_timing_profile, v_initial_rounds\s*$/m, "rounds_per_liveに関数内の初期周回数定数を入れていない");
  assert.match(sql, /if v_saved_rounds is distinct from v_expected_initial_rounds then/, "begin_gameが保存された周回数を検証していない");
  assert.match(sql, /rounds_per_live = v_new_round/, "host_add_next_roundが周追加のたびにrounds_per_liveを更新していない");
  console.log("PASS: 新規作成はlives.rounds_per_live=1を明示保存し、begin_gameは保存値が1でなければ開始しない。host_add_next_roundは追加ごとにrounds_per_liveを増やす");
}

// 6) 権限の明示（0084末尾）：公開RPCはauthenticatedのみ、内部ヘルパーは直接実行不可
{
  const sql = read("supabase/migrations/0084_live_limited_rewards_to_round5_and_timing.sql");
  const tail = sql.slice(sql.lastIndexOf("9) 実行権限の明示"));
  assert.match(tail, /revoke all on function public\.create_live_preparation\(timestamptz, text, int, int, uuid\[\], text, int, text\) from public, anon;/);
  assert.match(tail, /grant execute on function public\.create_live_preparation\(timestamptz, text, int, int, uuid\[\], text, int, text\) to authenticated;/);
  assert.match(tail, /revoke all on function public\.begin_game\(uuid\) from public, anon;/);
  assert.match(tail, /grant execute on function public\.begin_game\(uuid\) to authenticated;/);
  assert.match(tail, /revoke all on function public\.mark_final_result_presence\(uuid, uuid\) from public, anon;/);
  assert.match(tail, /grant execute on function public\.mark_final_result_presence\(uuid, uuid\) to authenticated;/);
  assert.match(tail, /revoke all on function public\._apply_first_live_reward\(uuid, uuid\) from public, anon, authenticated;/);
  console.log("PASS: 0084末尾で公開RPCの実行権限を明示（authenticatedのみ）し、内部ヘルパーは誰からも直接実行させない");
}

// 7) 限定特典の付与行は、マイグレーションが一括で作らない（insertは_apply_first_live_rewardの中だけ）
{
  const sql = read("supabase/migrations/0084_live_limited_rewards_to_round5_and_timing.sql");
  const fnStart = sql.indexOf("create or replace function public._apply_first_live_reward");
  const fnEnd = sql.indexOf("$$;", fnStart);
  const titleInserts = [...sql.matchAll(/insert into public\.user_titles/g)].map((m) => m.index ?? -1);
  const iconInserts = [...sql.matchAll(/insert into public\.user_limited_icons/g)].map((m) => m.index ?? -1);
  assert.equal(titleInserts.length, 1, "0084に称号の付与INSERTが複数ある（一括付与の疑い）");
  assert.equal(iconInserts.length, 1, "0084に限定アイコンの付与INSERTが複数ある（一括付与の疑い）");
  assert.ok(titleInserts[0] > fnStart && titleInserts[0] < fnEnd, "称号の付与INSERTが_apply_first_live_reward以外にある");
  assert.ok(iconInserts[0] > fnStart && iconInserts[0] < fnEnd, "アイコンの付与INSERTが_apply_first_live_reward以外にある");
  assert.doesNotMatch(sql, /update public\.user_titles|update public\.user_limited_icons|delete from public\.user_titles|delete from public\.user_limited_icons/, "0084が既存の所有行を更新・削除している");
  console.log("PASS: 0084は称号・限定アイコンを_apply_first_live_reward以外で付与せず、既存の所有行を更新・削除しない");
}

// 8) 利用者向け文言：「初回ライブ限定」の表記が残っていない（内部識別子・コメントを除く）
{
  const copyFiles = [
    "src/components/live-room/FirstLiveRewardModal.tsx",
    "src/components/live-room/FirstLiveRewardAnnouncement.tsx",
    "src/lib/limitedIcons.ts",
    "src/app/admin/page.tsx",
  ];
  for (const f of copyFiles) {
    const body = read(f)
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    assert.doesNotMatch(body, /初回ライブ/, `${f}に利用者向けの「初回ライブ」表記が残っている`);
  }
  const sql = read("supabase/migrations/0084_live_limited_rewards_to_round5_and_timing.sql");
  assert.match(sql, /'初期ライブ限定特典を獲得しました'/, "0084の通知タイトルが初期ライブ表記になっていない");
  assert.match(sql, /初期ライブ限定アイコンを獲得しました。マイページで選択できます。/, "0084の通知本文が初期ライブ表記になっていない");
  assert.doesNotMatch(sql, /'初回ライブ限定特典を獲得しました'/, "0084に旧い通知タイトルが残っている");
  // 称号名の括弧は「」に統一（『』は使わない）
  for (const f of ["src/components/live-room/FirstLiveRewardModal.tsx", "src/components/live-room/FirstLiveRewardAnnouncement.tsx"]) {
    assert.doesNotMatch(read(f), /限定称号『/, `${f}の称号名の括弧が『』のまま`);
  }
  assert.doesNotMatch(sql, /限定称号『/, "0084の通知本文の括弧が『』のまま");
  assert.match(sql, /限定称号「' \|\| v_title_name \|\| '」と初期ライブ限定アイコン/, "0084の通知本文が「」になっていない");
  console.log("PASS: 利用者向けの限定特典文言は「初期ライブ」に統一され、「初回ライブ」の表記は残っていない");
}

// 9) 2周分の合算（クライアントの順位計算）：総合順位は全ターンの回答を合算し、
//    組結果の順位は当該ターンの回答だけで決まる
{
  const participants = [
    { id: "pA", role: "player", group_id: "g1" },
    { id: "pB", role: "player", group_id: "g1" },
    { id: "pC", role: "player", group_id: "g2" },
    { id: "pD", role: "player", group_id: "g2" },
  ] as unknown as ParticipantRow[];
  const answer = (turnId: string, participantId: string, score: number) =>
    ({ turn_id: turnId, participant_id: participantId, score_total: score, resolved: true }) as unknown as AnswerRow;
  // 1周目：A=5、B=10（1周目だけならBが1位）、C=0、D=2。2周目：A=7、D=1、C=0
  const answers = [
    answer("t11", "pA", 5),
    answer("t11", "pB", 10),
    answer("t12", "pC", 0),
    answer("t12", "pD", 2),
    answer("t21", "pA", 7),
    answer("t22", "pD", 1),
    answer("t22", "pC", 0),
  ];
  const names: Record<string, string> = { pA: "A", pB: "B", pC: "C", pD: "D" };
  const overall = getOverallRanking(answers, participants, names);
  assert.deepEqual(
    overall.map((r) => [r.name, r.total, r.rank]),
    [["A", 12, 1], ["B", 10, 2], ["D", 3, 3], ["C", 0, 4]],
    "総合順位が2周分の合計で決まっていない",
  );
  console.log("PASS: 総合順位はライブ全体の回答（1周目＋2周目）の合計で決まる（A=12で1位、1周目最高点のBは2位）");

  const round2Group1 = getGroupTurnRanking(answers, participants, "t21", "g1", names);
  assert.deepEqual(
    round2Group1.map((r) => [r.name, r.total]),
    [["A", 7], ["B", 0]],
    "組結果が当該ターン（2周目第1組）以外の得点を含んでいる",
  );
  const round1Group1 = getGroupTurnRanking(answers, participants, "t11", "g1", names);
  assert.deepEqual(round1Group1.map((r) => [r.name, r.total]), [["B", 10], ["A", 5]], "1周目の組結果が2周目の得点を含んでいる");
  console.log("PASS: 組結果の得点は当該ターンの回答だけで集計し、前周・後周の得点を混ぜない");
}

// 10) 回答時間（本番standard=90秒・short_test=20秒）と周回数（2周）の一貫性。
//     TS（本番・短縮・デモ）・SQL（0084の_live_phase_duration_ms）・説明文で食い違わないこと。
{
  const timing = read("src/data/liveRoomTiming.ts");
  assert.match(timing, /export const STANDARD_TIMING = \{[\s\S]*?answerMs: 90_000,/, "本番standardの回答時間が90秒でない");
  assert.match(timing, /export const SHORT_TEST_TIMING = \{[\s\S]*?answerMs: 20_000,/, "short_testの回答時間が20秒でない");

  const demo = read("src/data/liveDemoData.ts");
  assert.match(demo, /answerMs: 90_000,/, "デモの回答時間が本番standardと一致していない");
  assert.match(demo, /export const ROUNDS_PER_LIVE = 2;/, "デモの周回数が2でない");

  const sql = read("supabase/migrations/0084_live_limited_rewards_to_round5_and_timing.sql");
  const standardBranch = sql.slice(sql.indexOf("else\n      case p_phase"));
  assert.match(standardBranch, /when 'answering' then 90000/, "0084の本番回答時間が90秒でない");
  const shortBranch = sql.slice(sql.indexOf("when 'short_test' then"), sql.indexOf("else\n      case p_phase"));
  assert.match(shortBranch, /when 'answering' then 20000/, "0084のshort_test回答時間が20秒でない");

  const howto = read("src/app/(main)/how-to-play/page.tsx");
  assert.match(howto, /各組90秒で回答します/, "遊び方ページの回答時間説明が90秒でない");
  assert.doesNotMatch(howto, /各組60秒|持ち時間60秒/, "遊び方ページに60秒の説明が残っている");

  const types = read("src/types/liveDemo.ts");
  assert.match(types, /持ち時間90秒/, "デモ型定義のanswerコメントが90秒になっていない");

  // 回答時間を60秒として説明している箇所が残っていない（回答と無関係な60秒は対象外）
  for (const f of ["src/store/useLiveHostStore.ts", "src/data/liveDemoData.ts", "src/types/liveDemo.ts", "src/app/(main)/how-to-play/page.tsx"]) {
    assert.doesNotMatch(read(f), /(持ち時間|回答フェーズ|各組)[^\n]{0,8}60秒/, `${f}に回答時間の60秒説明が残っている`);
  }
  console.log("PASS: 本番standard=90秒・short_test=20秒・2周は、TS（本番・短縮・デモ）・SQL（0084）・説明文で一致している");
}
