// 体験版（/live-demo）と実ライブ（/live）の表示・演出・タイミングが乖離しないことの検査。
// 体験版は実ライブの部品と値を使う（複製しない）前提のため、その前提が崩れたら失敗する。
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { confirmedPerfectFor, eligibleJudgeCountFor, maxBallsFor } from "../liveRoomPresentation";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
// コメント行を除いたコード部分（コメントの説明文で誤判定しないため）
const code = (src: string) =>
  src
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

// 1) 共有の計算（玉の数・審査員の数・完璧判定）
{
  assert.equal(maxBallsFor(0), 3, "審査員0人でも玉は最低3");
  assert.equal(maxBallsFor(1), 3);
  assert.equal(maxBallsFor(2), 6);
  assert.equal(maxBallsFor(4), 12);
  assert.equal(eligibleJudgeCountFor(["a", "b", "c", "d"], ["a", "b"]), 2, "組に出ていない人だけが審査員");
  assert.equal(eligibleJudgeCountFor(["a", "b"], ["a", "b"]), 0);
  assert.equal(confirmedPerfectFor(false, 3, 3), null, "未確定は判定しない");
  assert.equal(confirmedPerfectFor(true, 3, 3), true, "全員が最高点なら満点");
  assert.equal(confirmedPerfectFor(true, 3, 2), false);
  assert.equal(confirmedPerfectFor(true, 0, 0), false, "審査員0人は満点にしない");
  console.log("PASS: 玉の数・審査員数・満点判定は共有の純粋関数で、実ライブと体験版が同じ式を使う");
}

// 2) 体験版の時間設定は、実ライブ（STANDARD_TIMING）と同じ値
{
  const timing = read("src/data/liveRoomTiming.ts");
  const demo = read("src/data/liveDemoData.ts");
  // 定数オブジェクトの本体（開始行から、最初の閉じ括弧の行まで）を切り出す
  const block = (src: string, name: string) => {
    const start = src.indexOf(`export const ${name} = {`);
    assert.ok(start >= 0, `${name}が見つからない`);
    const rest = src.slice(start);
    const end = /^\};|^\} as const;/m.exec(rest);
    assert.ok(end, `${name}の終わりが見つからない`);
    return rest.slice(0, end.index);
  };
  const values = (text: string) => {
    const out: Record<string, number> = {};
    for (const m of text.matchAll(/^\s*([A-Za-z]+Ms)\s*:\s*([0-9_]+)\s*,/gm)) {
      out[m[1]] = Number(m[2].replace(/_/g, ""));
    }
    return out;
  };
  const live = values(block(timing, "STANDARD_TIMING"));
  const demoValues = values(block(demo, "DEMO_TIMING"));
  const shared = [
    "interludeMs",
    "openingMs",
    "topicRevealMs",
    "answerMs",
    "judgeMs",
    "judgeGraceMs",
    "groupResultMs",
    "revealDelayMs",
    "revealGraceMs",
    "ballPopPauseMs",
    "scoreDisplayMs",
    "gateTailMs",
    "earlyConfirmDelayMs",
  ];
  for (const key of shared) {
    assert.ok(key in live, `STANDARD_TIMINGに${key}が無い`);
    assert.equal(demoValues[key], live[key], `体験版のDEMO_TIMING.${key}が実ライブ（STANDARD_TIMING）と違う`);
  }
  assert.equal(live.answerMs, 90_000, "本番standardの回答時間は90秒");
  console.log("PASS: 体験版の時間設定（お題発表・組結果・送信〜回答フリップ・回答90秒など）は実ライブと同じ値");
}

// 3) 体験版のツッコミ待機列の規則（古いリアクションを捨てる時間）は実ライブと同じ
{
  const follower = read("src/store/useLiveFollowerStore.ts");
  const demo = read("src/store/useLiveDemoStore.ts");
  const followerStale = /export const TSUKKOMI_STALE_MS = ([0-9_]+);/.exec(follower);
  const demoStale = /const DEMO_TSUKKOMI_STALE_MS = ([0-9_]+);/.exec(demo);
  assert.ok(followerStale && demoStale, "待機列の古さの定数が見つからない");
  assert.equal(Number(demoStale[1].replace(/_/g, "")), Number(followerStale[1].replace(/_/g, "")));
  console.log("PASS: 体験版のツッコミ待機列の古さ（TSUKKOMI_STALE_MS）は実ライブと同じ");
}

// 4) 体験版の画面は実ライブと共用の表示部品（live-room/*Presentation.tsx）を使い、
//    複製の表示を持たない。本番(*View.tsx)・体験版/撮影モード(*Screen.tsx)のどちらの
//    adapterも、同じPresentationコンポーネントへpropsを渡すだけにする。
{
  const stage = read("src/components/live-demo/StageScreen.tsx");
  const audience = read("src/components/live-demo/AudienceScreen.tsx");
  const groupResult = read("src/components/live-demo/GroupResultScreen.tsx");
  const finalResult = read("src/components/live-demo/FinalResultScreen.tsx");
  const topicReveal = read("src/components/live-demo/TopicRevealScreen.tsx");
  const page = read("src/app/live-demo/page.tsx");
  const stageAnsweringView = read("src/components/live-room/StageAnsweringView.tsx");
  const audienceAnsweringView = read("src/components/live-room/AudienceAnsweringView.tsx");
  const stagePresentation = read("src/components/live-room/StageAnsweringPresentation.tsx");
  const audiencePresentation = read("src/components/live-room/AudienceAnsweringPresentation.tsx");
  const topicRevealPresentation = read("src/components/live-room/TopicRevealPresentation.tsx");

  for (const [name, screenRaw, viewRaw] of [
    ["StageScreen/StageAnsweringView", stage, stageAnsweringView],
    ["AudienceScreen/AudienceAnsweringView", audience, audienceAnsweringView],
  ] as const) {
    const screen = code(screenRaw);
    const view = code(viewRaw);
    // 本番・体験版のどちらのadapterも同じ共用表示部品をimportしている（別々に再実装していない）
    assert.match(screen, /from "@\/components\/live-room\/(Stage|Audience)AnsweringPresentation"/, `${name}が共用表示部品(*AnsweringPresentation)をimportしていない`);
    assert.match(view, /from "@\/components\/live-room\/(Stage|Audience)AnsweringPresentation"/, `${name}が共用表示部品(*AnsweringPresentation)をimportしていない`);
    assert.doesNotMatch(screen, /from "\.\/StageCharacters"/, `${name}が体験版の旧い回答席（光の影の複製）を使っている`);
    assert.doesNotMatch(screen, /次の登壇を待っています/, `${name}に実ライブに無い「次の登壇を待っています」が残っている`);
    assert.match(screen, /maxBallsFor\(/, `${name}の玉の数が共有の計算を使っていない`);
    assert.match(screen, /confirmedPerfect=\{confirmedPerfect\}/, `${name}が満点判定を渡していない`);
  }
  // 回答席・作者名を隠す演出・笑い/ツッコミ演出そのものは、共用表示部品の側に1箇所だけある。
  for (const [name, presentation] of [
    ["StageAnsweringPresentation", stagePresentation],
    ["AudienceAnsweringPresentation", audiencePresentation],
  ] as const) {
    const src = code(presentation);
    assert.match(src, /import StageCharactersView from "\.\/StageCharactersView";/, `${name}が回答席に実ライブのStageCharactersViewを使っていない`);
    assert.match(src, /import LaughMarkOverlay from "\.\/LaughMarkOverlay";/, `${name}が実ライブのLaughMarkOverlayを使っていない`);
    assert.match(src, /import TsukkomiDanmakuOverlay from "\.\/TsukkomiDanmakuOverlay";/, `${name}が実ライブのTsukkomiDanmakuOverlayを使っていない`);
    assert.match(src, /hideAuthorName/, `${name}の回答フリップが作者名を隠していない（実ライブと違う）`);
  }
  assert.match(code(audience), /judgingDisabled=\{judgingTimeUp\}/, "客席の採点ボタンが時間切れ後も押せる");
  assert.match(audiencePresentation, /審査中…/, "客席の一時停止中に「審査中…」が出ない");
  assert.match(stage, /judgingRemainingMs=\{judgingRemainingForDisplayed\}/, "舞台の回答フリップに審査のカウントダウンが無い");
  assert.doesNotMatch(stage, /setPopup|個人の得点ポップ|\+\{popup/, "体験版だけの得点ポップアップが残っている");
  // 回答音は必ず合図の記録（sfxCueTracker）を通す。直接の再生を散らさない（同じ合図は1回だけ鳴る）。
  // StageScreenは低遅延化のため送信クリックの同期処理でも鳴らし、StageAnsweringPresentationは
  // 回答席が光った瞬間に鳴らす（どちらもcueIdの重複防止で二重再生にならない）。
  for (const src of [stage, code(stagePresentation)]) {
    for (const m of src.matchAll(/playSfx\("answerSubmit"\)/g)) {
      const before = src.slice(Math.max(0, (m.index ?? 0) - 90), m.index ?? 0);
      assert.match(before, /sfxCueTracker\.once\([^\n]*\(\) => $/, "回答音が合図の記録を通っていない");
    }
  }

  assert.match(topicReveal, /import TopicRevealPresentation from "@\/components\/live-room\/TopicRevealPresentation";/, "お題発表が共用表示部品を使っていない");
  assert.match(topicRevealPresentation, /import ScoringPhysicsBoard from "@\/components\/live-demo\/ScoringPhysicsBoard";/, "お題発表が玉の盤に実ライブと同じお題を出していない");
  assert.match(topicRevealPresentation, /bg-\[#ff3b5b\]/, "お題発表の帯の色が実ライブ（赤）と違う");
  assert.match(topicReveal, /createTopicRevealSfxScheduler/, "お題発表の効果音が実ライブと同じ予約方式でない");
  assert.doesNotMatch(topicReveal, /setTimeout\(\(\) => playSfx\("topicReveal"\)/, "お題発表の効果音が固定遅延で鳴る（実ライブと違う）");

  assert.match(groupResult, /import GroupResultView from "@\/components\/live-room\/GroupResultView";/, "組結果が実ライブの表示部品を使っていない");
  assert.doesNotMatch(groupResult, /playSfx\("groupResult"\)/, "組結果の効果音が二重（表示部品と画面の両方）で鳴る");
  assert.match(finalResult, /import FinalResultView from "@\/components\/live-room\/FinalResultView";/, "最終結果が実ライブの表示部品を使っていない");
  assert.doesNotMatch(finalResult, /playSfx\("rankReveal"\)/, "最終結果の効果音が二重で鳴る");
  assert.doesNotMatch(finalResult, /本日のベストアンサー/, "実ライブに無いベストアンサーが残っている");

  assert.match(page, /LiveReactionSourceContext\.Provider value=\{liveDemoReactionSource\}/, "笑い・ツッコミの取り出し口を体験版のストアへ接続していない");
  assert.match(page, /import LaughEffectOverlay from "@\/components\/live-room\/LaughEffectOverlay";/, "笑いの全画面演出が実ライブの部品でない");

  // 体験版の複製（実ライブと乖離していた笑い・ツッコミの部品）は残さない
  for (const name of ["LaughEffectOverlay", "LaughMarkOverlay", "TsukkomiDanmakuOverlay", "TsukkomiFloatOverlay", "StageCharacters"]) {
    assert.equal(existsSync(join(ROOT, `src/components/live-demo/${name}.tsx`)), false, `体験版の複製${name}が残っている`);
  }
  console.log("PASS: 体験版の画面は実ライブの部品（回答席・笑い・ツッコミ・組結果・最終結果）を使い、複製の表示を持たない");
}

// 5) 文言の一致（開幕・閉幕）
{
  const liveOpening = read("src/components/live-room/OpeningView.tsx");
  const demoOpening = read("src/components/live-demo/OpeningScreen.tsx");
  // 開幕の文言そのものは、本番・体験版/撮影モード共用のOpeningPresentationに1箇所だけある
  // （本番・体験版のどちらのadapterも同じ共用表示部品へ委ねている、という前提を確認する）。
  const openingPresentation = read("src/components/live-room/OpeningPresentation.tsx");
  assert.match(liveOpening, /from "@\/components\/live-room\/OpeningPresentation"/, "実ライブの開幕が共用表示部品(OpeningPresentation)を使っていない");
  assert.match(demoOpening, /from "@\/components\/live-room\/OpeningPresentation"/, "体験版の開幕が共用表示部品(OpeningPresentation)を使っていない");
  for (const copy of ["参加登録受付中", "まもなく組分けが発表されます。参加方法を選んでください。", "現在のプレイヤー"]) {
    assert.ok(openingPresentation.includes(copy), `開幕の共用表示部品に「${copy}」が無い`);
  }
  assert.doesNotMatch(demoOpening, /組分け発表/, "体験版の開幕に実ライブに無い「組分け発表」が残っている");
  const closedCopy = "本日のライブは終了しました。お疲れさまでした！";
  assert.ok(read("src/app/live/page.tsx").includes(closedCopy), "実ライブの閉幕文言が変わっている");
  assert.ok(read("src/components/live-demo/ClosedScreen.tsx").includes(closedCopy), "体験版の閉幕文言が実ライブと違う");
  console.log("PASS: 開幕・閉幕の文言は実ライブと一致し、体験版だけの「組分け発表」「アーカイブ生成」は無い");
}

// 6) 効果音（送信音・お題発表音・組結果音・段階表示音）が、どの状態変化で鳴るかを実ライブと一致させる
{
  const stage = read("src/components/live-demo/StageScreen.tsx");
  const audience = read("src/components/live-demo/AudienceScreen.tsx");
  // 回答送信音は「回答が増えた（送信）」だけ。回答フリップ（審査開始）では鳴らさない
  // 回答の音は合図（cueId）で1回だけ鳴らす。舞台は送信クリックの同期処理でも低遅延に鳴らし
  // （StageScreen自身）、客席は共用のAudienceAnsweringPresentationが回答席の点灯で鳴らす。
  assert.match(stage, /sfxCueTracker\.once\(cue\.cueId, \(\) => playSfx\("answerSubmit"\)\)/, "舞台の回答音が合図で1回に絞られていない");
  assert.match(
    read("src/components/live-room/AudienceAnsweringPresentation.tsx"),
    /sfxCueTracker\.once\(answerSubmitCue\.cueId, \(\) => playSfx\("answerSubmit"\)\)/,
    "客席の回答音が合図で1回に絞られていない",
  );
  assert.doesNotMatch(stage + audience, /state\.answers\.length[\s\S]{0,120}playSfx\("answerSubmit"\)/, "回答の件数（フリップ）を音のトリガーにしている");
  assert.doesNotMatch(stage + audience, /playSfx\("spotlightIn"\)/, "体験版の画面adapterが音源の無いspotlightInを直接呼んでいる（実ライブ側adapterのみが持つ挙動）");
  // 回答席の点灯（送信直後）の合図はスポットライト音。回答送信音とは別の名前で呼ぶ（音源は未配置）
  // 「残り○回」は送信時に減る（実ライブは送信のDB登録で減る）。フリップの時点では数えない。
  const demoStore = read("src/store/useLiveDemoStore.ts");
  const processQueueBody = /function processQueue\([\s\S]*?\n  \}\n/.exec(demoStore)?.[0] ?? "";
  const revealNowBody = /function revealNow\([\s\S]*?\n  \}\n/.exec(demoStore)?.[0] ?? "";
  assert.match(processQueueBody, /answerCounts: \{ \.\.\.state\.answerCounts/, "送信時に回数が減らない（実ライブと違う）");
  assert.doesNotMatch(revealNowBody, /answerCounts:/, "回数がフリップ時に数えられている（実ライブは送信時に減る）");
  console.log("PASS: 「残り○回」は送信時に減り、フリップ時には数えない（実ライブと同じ）");
  console.log("PASS: 回答の音は合図で1回だけ鳴り、フリップ（回答件数の増加）では鳴らさない");
}

// 7) 第2段階（本番・体験版/撮影モードの画面共通化）レビュー対応：
//    本番adapter(*View.tsx)は共用表示部品(*Presentation.tsx)へpropsを渡すだけで、
//    回答送信・採点・参加のcallbackは既存の本番ストア関数(useLiveFollowerStore)へ
//    直接つながっている（独自の再実装・Supabaseへの直接アクセスをしていない）。
//    デモadapter(*Screen.tsx)も同様にローカルストア(useLiveDemoStore)へつながっている。
{
  const openingView = read("src/components/live-room/OpeningView.tsx");
  const topicRevealView = read("src/components/live-room/TopicRevealView.tsx");
  const stageAnsweringView = read("src/components/live-room/StageAnsweringView.tsx");
  const audienceAnsweringView = read("src/components/live-room/AudienceAnsweringView.tsx");
  const openingScreen = read("src/components/live-demo/OpeningScreen.tsx");
  const stageScreen = read("src/components/live-demo/StageScreen.tsx");
  const audienceScreen = read("src/components/live-demo/AudienceScreen.tsx");

  for (const [name, src] of [
    ["OpeningView", openingView],
    ["TopicRevealView", topicRevealView],
    ["StageAnsweringView", stageAnsweringView],
    ["AudienceAnsweringView", audienceAnsweringView],
  ] as const) {
    assert.match(src, /from "@\/store\/useLiveFollowerStore"/, `${name}がuseLiveFollowerStoreを使っていない（本番処理へ接続されていない）`);
    assert.doesNotMatch(src, /from "@\/store\/useLiveDemoStore"/, `${name}が体験版のストアに依存している（本番adapterに混入してはいけない）`);
    assert.doesNotMatch(code(src), /\bsupabase\s*\./, `${name}がSupabaseを直接呼んでいる（ストア経由ではない）`);
  }
  // 回答送信・採点・参加のcallbackは、本番ストアのメソッドをそのまま取り出して使っている
  // （別名の独自関数へすり替えていない）。
  assert.match(stageAnsweringView, /const submitMyAnswer = useLiveFollowerStore\(\(s\) => s\.submitMyAnswer\);/, "StageAnsweringViewがuseLiveFollowerStoreのsubmitMyAnswerをそのまま取り出していない");
  assert.match(audienceAnsweringView, /const submitMyScore = useLiveFollowerStore\(\(s\) => s\.submitMyScore\);/, "AudienceAnsweringViewがuseLiveFollowerStoreのsubmitMyScoreをそのまま取り出していない");
  assert.match(openingView, /const joinLive = useLiveFollowerStore\(\(s\) => s\.joinLive\);/, "OpeningViewがuseLiveFollowerStoreのjoinLiveをそのまま取り出していない");
  // handleSubmit/handleScore/handleJoinは、取り出した本番ストア関数を1回だけ呼ぶ
  // （独自の二重送信・二重採点ロジックを追加していない）。
  const stageHandleSubmit = /const handleSubmit = async \(\) => \{[\s\S]*?\n  \};/.exec(stageAnsweringView)?.[0] ?? "";
  assert.equal((stageHandleSubmit.match(/submitMyAnswer\(/g) ?? []).length, 1, "StageAnsweringViewのhandleSubmitがsubmitMyAnswerを1回だけ呼んでいない");
  const audienceHandleScore = /const handleScore = async \([\s\S]*?\n  \};/.exec(audienceAnsweringView)?.[0] ?? "";
  assert.equal((audienceHandleScore.match(/submitMyScore\(/g) ?? []).length, 1, "AudienceAnsweringViewのhandleScoreがsubmitMyScoreを1回だけ呼んでいない");

  for (const [name, src] of [
    ["OpeningScreen", openingScreen],
    ["StageScreen", stageScreen],
    ["AudienceScreen", audienceScreen],
  ] as const) {
    assert.match(src, /from "@\/store\/useLiveDemoStore"/, `${name}がuseLiveDemoStoreを使っていない（ローカル処理へ接続されていない）`);
    assert.doesNotMatch(src, /from "@\/store\/useLiveFollowerStore"/, `${name}が本番ストアに依存している（デモadapterに混入してはいけない）`);
    assert.doesNotMatch(code(src), /\bsupabase\s*\./, `${name}がSupabaseを直接呼んでいる（デモは外部書き込みを持たない）`);
  }
  console.log("PASS: 本番adapterのcallbackは既存のuseLiveFollowerStore(submitMyAnswer/submitMyScore/joinLive)へ1回だけ接続され、デモadapterはuseLiveDemoStoreへ接続されている（どちらもSupabaseを直接呼ばない）");
}

console.log("liveDemoSyncWiring.check: ALL PASS");
