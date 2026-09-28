// 参加登録受付画面の「現在の参加者」を、プレイヤー希望／観客希望に分ける純粋関数。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { splitParticipantsByPreferredRole } from "../participantRoleSplit";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

type P = { id: string; preferred_role: "player" | "audience"; is_guest?: boolean };
const p = (id: string, preferred_role: "player" | "audience", is_guest = false): P => ({ id, preferred_role, is_guest });

// 0人・複数人・ゲスト観客の分類
{
  const { players, audience } = splitParticipantsByPreferredRole<P>([]);
  assert.deepEqual(players, []);
  assert.deepEqual(audience, []);
}
{
  const list = [p("1", "player"), p("2", "audience"), p("3", "player"), p("4", "audience", true), p("5", "player")];
  const { players, audience } = splitParticipantsByPreferredRole(list);
  assert.deepEqual(players.map((x) => x.id), ["1", "3", "5"]);
  assert.deepEqual(audience.map((x) => x.id), ["2", "4"], "ゲスト観客が観客の一覧に含まれていない");
}
// 集合自体は変えない（分けるだけ）：合計件数が保たれる
{
  const list = Array.from({ length: 9 }, (_, i) => p(String(i), i % 3 === 0 ? "player" : "audience"));
  const { players, audience } = splitParticipantsByPreferredRole(list);
  assert.equal(players.length + audience.length, list.length, "分割前後で参加者の総数が変わっている");
}

// 配線：OpeningViewが最大人数との比率(x/y)を出さず、プレイヤー/観客を分けて見出し・0人表示を出す。
const view = read("src", "components", "live-room", "OpeningView.tsx");
assert.ok(/splitParticipantsByPreferredRole\(participants\)/.test(view), "OpeningViewが分割関数を使っていない");
assert.ok(/現在のプレイヤー/.test(view) && /現在の観客/.test(view), "プレイヤー・観客の見出しが無い");
assert.ok(/まだいません/.test(view), "0人の場合の表示が無い");
assert.ok(!/\{playerCount\}\s*\/\s*\{live\.max_players\}/.test(view), "最大人数との比率(x/y)表示が残っている");
assert.ok(!/participants\.length\}人/.test(view), "分けずに全体人数だけを表示する古い実装が残っている");
// 自分自身の強調・アニメーションは維持されている。
// 2026-09-28（レビュー対応）：参加登録受付画面は横幅に余裕があるため、演者名は
// もう5文字で省略しない（truncateLiveDisplayNameを使わず全文表示する）。
// 詳しくはsrc/lib/__tests__/titlesAndFirstLiveRewardWiring.check.tsの26番・27番参照
// （全文表示へ変更した画面／5文字制限を維持する画面の一覧）。
assert.ok(/isMe \? "border-\[#3b5bff\]/.test(view), "自分自身の強調表示が維持されていない");
assert.ok(!/truncateLiveDisplayName/.test(view), "参加登録受付画面がまだ演者名を5文字に省略している（全文表示へ変更する対象）");
assert.ok(/\{participantNames\[p\.id\] \?\? "（名前未設定）"\}/.test(view), "参加登録受付画面が演者名を全文表示していない");
assert.ok(/motion\.div/.test(view), "参加者一覧のアニメーションが維持されていない");

// 最大参加人数はプレイヤーだけに適用される（表示用のisPlayerFull判定）。観客には適用しない。
assert.ok(/const playerCount = participants\.filter\(\(p\) => p\.preferred_role === "player"\)\.length;/.test(view));
assert.ok(/const isPlayerFull = live\.max_players != null && playerCount >= live\.max_players;/.test(view));
assert.ok(!/audienceCount >= live\.max_players/.test(view), "観客数にも上限が適用されている");

// DB側（join_live、0074が最新の再定義）でも上限判定がプレイヤーだけに適用されている。
const joinLiveSql = read("supabase", "migrations", "0074_referral_source_survey.sql");
assert.ok(
  /if v_max is not null and p_preferred_role = 'player' then/.test(joinLiveSql),
  "join_liveの上限判定がp_preferred_role='player'条件に限定されていない",
);
assert.ok(
  /and preferred_role = 'player'/.test(joinLiveSql),
  "join_liveの上限カウントがpreferred_role='player'に限定されていない",
);
console.log("PASS: 参加者のプレイヤー/観客分割・OpeningViewの表示配線・最大人数はプレイヤーのみに適用");
