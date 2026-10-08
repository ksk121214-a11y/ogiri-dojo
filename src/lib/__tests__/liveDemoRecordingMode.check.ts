// 動画撮影モード（/live-demo?mode=recording）の検査。
// ①URLの解釈・乱数の再現性（純粋関数）②撮影モードが本番へ書き込む経路を持たないこと（静的）
// ③本番と同じBGM・効果音の規則になっていること（静的）④撮影用の操作・体験版だけの文言が
// 撮影モードで出ないこと（静的）を確かめる。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { botAnswersAllowedForTurn, BOT_ANSWER_MAX_PER_TURN } from "../botAnswerPolicy";
import { confirmedPerfectFor, eligibleJudgeCountFor, isConfirmedPerfect, perfectFromEligibleJudges } from "../liveRoomPresentation";
import { createCueTracker } from "../cuePlayback";
import {
  canStartRecording,
  DEFAULT_RECORDING_SEED,
  DEFAULT_RECORDING_SETTINGS,
  normalizeRecordingSettings,
  parseLiveDemoMode,
  RECORDING_DEFAULT_NAME,
  RECORDING_NAME_MAX_LENGTH,
  RECORDING_TOPIC_MAX_LENGTH,
} from "../liveDemoMode";
import { createSeededRandom } from "../seededRandom";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
// コメント行を除いたコード部分（説明文の語で誤判定しないため）
const code = (src: string) =>
  src
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

// 1) URLの解釈：既定は開発確認モード（従来どおり）
{
  const dev = parseLiveDemoMode("");
  assert.equal(dev.recording, false, "既定は開発確認モード");
  assert.equal(dev.hud, true);
  assert.equal(parseLiveDemoMode("?mode=dev").recording, false);
  const rec = parseLiveDemoMode("?mode=recording");
  assert.equal(rec.recording, true);
  assert.equal(rec.seed, DEFAULT_RECORDING_SEED, "既定の種は固定");
  assert.equal(parseLiveDemoMode("?mode=recording&seed=abc").seed, "abc");
  assert.equal(parseLiveDemoMode("?mode=recording&seed=%20%20").seed, DEFAULT_RECORDING_SEED, "空白だけの種は既定");
  assert.equal(parseLiveDemoMode("?seed=abc").seed, DEFAULT_RECORDING_SEED, "開発確認モードでは種を使わない");
  assert.equal(parseLiveDemoMode("?mode=recording&hud=0").hud, false);
  console.log("PASS: URLの解釈（既定は開発確認、撮影は既定の固定種、hud=0で操作を隠す）");
}

// 2) 乱数：同じ種は同じ数列、違う種は違う数列、0以上1未満
{
  const a = createSeededRandom("abc");
  const b = createSeededRandom("abc");
  const seqA = Array.from({ length: 50 }, () => a());
  const seqB = Array.from({ length: 50 }, () => b());
  assert.deepEqual(seqA, seqB, "同じ種は同じ数列");
  const c = createSeededRandom("abd");
  assert.notDeepEqual(seqA, Array.from({ length: 50 }, () => c()), "違う種は違う数列");
  assert.ok(seqA.every((v) => v >= 0 && v < 1), "0以上1未満");
  console.log("PASS: 同じ種なら同じ乱数列（撮り直しで同じ組分け・お題・回答・得点を再現する前提）");
}

// 3) 乱数の出所の配線：体験版の抽選はすべて切り替え可能な乱数を通る（Math.randomの直書きが無い）
{
  const logic = code(read("src/lib/liveDemoLogic.ts"));
  const store = code(read("src/store/useLiveDemoStore.ts"));
  const page = code(read("src/app/live-demo/page.tsx"));
  const scoring = code(read("src/components/live-demo/ScoringPhysicsBoard.tsx"));
  assert.equal((logic.match(/Math\.random/g) ?? []).length, 1, "liveDemoLogic.tsのMath.randomは既定値の1箇所だけ");
  assert.equal((store.match(/Math\.random/g) ?? []).length, 1, "useLiveDemoStoreのMath.randomは開始時の既定値の1箇所だけ");
  assert.match(store, /setLiveDemoRandom\(options\?\.recording \? createSeededRandom\(options\.seed\) : Math\.random\)/, "撮影モードの開始時に種の乱数へ切り替えていない");
  // 拍手は時間で発生する純演出。ゲームの種の乱数を使うと、時間のずれで後の結果が変わる（再現性が崩れる）
  assert.match(page, /if \(Math\.random\(\) < 0\.5\) sendTsukkomi\("clap"/, "拍手演出がゲームの乱数を使っている（再現性が崩れる）");
  assert.doesNotMatch(page, /liveDemoRandom/, "ページがゲームの乱数を時間で消費している");
  // 玉の落ち方（ScoringPhysicsBoard）は見た目だけで、得点・回答・組分けには影響しない（意図的に乱数のまま）
  assert.match(scoring, /Math\.random/, "玉の見た目の乱数が無いのは想定外");
  console.log("PASS: 体験版の抽選（組分け・お題・ボットの回答・得点・審査）は種から作る乱数を通る（玉の見た目だけ乱数のまま）");
}

// 4) 撮影モードは本番へ書き込まない（体験版の経路に通信・DB・ユーザー保存が無い）
{
  const demoFiles = [
    "src/lib/liveDemoLogic.ts",
    "src/lib/liveDemoSelectors.ts",
    "src/lib/liveDemoMode.ts",
    "src/lib/seededRandom.ts",
    "src/lib/liveDemoReactionSource.ts",
    "src/store/useLiveDemoStore.ts",
    "src/app/live-demo/page.tsx",
    "src/components/live-demo/RecordingHud.tsx",
    "src/components/live-demo/StartScreen.tsx",
    "src/components/live-demo/ClosedScreen.tsx",
    "src/components/live-demo/FinalResultScreen.tsx",
    "src/components/live-demo/StageScreen.tsx",
    "src/components/live-demo/AudienceScreen.tsx",
    "src/components/live-demo/OpeningScreen.tsx",
    "src/components/live-demo/TopicRevealScreen.tsx",
    "src/components/live-demo/GroupResultScreen.tsx",
    "src/components/live-demo/InterludeScreen.tsx",
    "src/components/live-demo/CurtainOverlay.tsx",
    "src/components/live-demo/SoundToggle.tsx",
    // 本番・体験版/撮影モード共用の表示部品も、Supabase・いずれのストアにも
    // 直接依存してはならない（データ供給元を知らない、という共通化の前提）。
    "src/components/live-room/OpeningPresentation.tsx",
    "src/components/live-room/TopicRevealPresentation.tsx",
    "src/components/live-room/StageAnsweringPresentation.tsx",
    "src/components/live-room/AudienceAnsweringPresentation.tsx",
  ];
  const forbidden = [
    /from "@\/lib\/supabase"/,
    /useLiveFollowerStore/,
    /useFirstLiveRewardStore/,
    /useSnsStore/,
    /useAuthStore/,
    /useProfileStore/,
    /useAudienceJoinIntentStore/,
    /\.rpc\(/,
    /\.from\("[a-z_]+"\)/, // Supabaseのテーブル操作（Array.from等は対象外）
    /\bfetch\(/,
    /localStorage\.setItem/,
  ];
  for (const file of demoFiles) {
    // 型だけのimport（import type { ... } from "@/store/..."）はコンパイル時に消え、
    // 実行時の依存を生まない。既存の共用表示部品（GroupResultView・FinalResultView・
    // StageCharactersView）も型だけはストアからimportしており、それ自体は
    // 「本番ストアに直接依存しない」という制約の対象ではない。
    const src = code(read(file))
      .split("\n")
      .filter((line) => !/^\s*import\s+type\s*\{/.test(line))
      .join("\n");
    for (const pattern of forbidden) {
      assert.doesNotMatch(src, pattern, `${file} に本番への書き込み・通信の経路がある: ${pattern}`);
    }
  }
  // 最終結果の初回ライブ特典は liveId を渡さない限り動かない（渡すと本番DBへ到達記録・付与が走る）
  const finalScreen = code(read("src/components/live-demo/FinalResultScreen.tsx"));
  assert.doesNotMatch(finalScreen, /liveId=/, "体験版の最終結果にliveIdを渡すと初回ライブ特典が本番DBへ書き込まれる");
  // ポイント・熟練度は撮影モードでは端末に保存しない（addPointsより前に return する）
  assert.match(finalScreen, /if \(recording\) return;\s*\n\s*addPoints/, "撮影モードでポイントを加算する経路がある");
  console.log("PASS: 体験版の画面・ストア・ロジックに本番DB・Realtime・認証・ユーザー保存への経路が無い");
}

// 5) 撮影モードに体験版だけの文言・操作を出さない
{
  const start = code(read("src/components/live-demo/StartScreen.tsx"));
  const recordingBlock = /if \(mode\.recording[^)]*\) \{([\s\S]*?)\n  \}\n\n  return \(\n    <ScreenShell>\n      <BackToHomeLink/.exec(start)?.[1] ?? "";
  assert.ok(recordingBlock.length > 0, "撮影モードの開始画面が無い");
  for (const word of ["ライブ体験モック", "LIVE OGIRI SHOW", "あなたは13人", "BackToHomeLink", "playSfx"]) {
    assert.ok(!recordingBlock.includes(word), `撮影モードの開始画面に「${word}」が残っている`);
  }
  const closed = code(read("src/components/live-demo/ClosedScreen.tsx"));
  assert.match(closed, /\{recording \? null : \(/, "撮影モードの閉幕に体験版のやり直しボタンが出る");
  const finalScreen = code(read("src/components/live-demo/FinalResultScreen.tsx"));
  assert.match(finalScreen, /\{recording \? null : <button/, "撮影モードの最終結果に体験版のやり直しボタンが出る");
  // 撮影用の操作パネルは撮影モードの時だけ、hud=0で消える
  const page = code(read("src/app/live-demo/page.tsx"));
  assert.match(page, /\{mode\.recording && hudVisible \? \(\s*<RecordingHud/, "撮影用の操作パネルが撮影モード・hud条件の外にある");
  for (const file of ["src/app/live/page.tsx", "src/components/live-room/StageAnsweringView.tsx", "src/components/live-room/AudienceAnsweringView.tsx", "src/components/live-room/TopicRevealView.tsx", "src/components/live-room/OpeningView.tsx"]) {
    assert.doesNotMatch(read(file), /RecordingHud|liveDemoMode|seededRandom/, `${file} に撮影モードの仕組みが入っている（本番を変えてはいけない）`);
  }
  console.log("PASS: 撮影モードでは体験版だけの文言・やり直し・効果音を出さず、撮影用の操作は隠せる。本番の画面は撮影用の仕組みを持たない");
}

// 6) BGMの規則：本番（/live/page.tsx）と撮影モードで同じフェーズに同じ曲
{
  const live = code(read("src/app/live/page.tsx"));
  const demo = code(read("src/app/live-demo/page.tsx"));
  const rules: [string, RegExp, RegExp][] = [
    ["お題発表→出囃子", /currentPhase === "topic_reveal"[\s\S]{0,40}"entrance"/, /phase === "topic_reveal"[\s\S]{0,40}"entrance"/],
    ["回答→ライブ中", /currentPhase === "answering"[\s\S]{0,40}"live"/, /phase === "answering"[\s\S]{0,40}"live"/],
    ["組結果→待機", /currentPhase === "group_result"[\s\S]{0,40}"waiting"/, /phase === "group_result" \|\| phase === "final_result"[\s\S]{0,40}"waiting"/],
    ["最終結果→待機", /currentPhase === "final_result"[\s\S]{0,40}"waiting"/, /phase === "group_result" \|\| phase === "final_result"[\s\S]{0,40}"waiting"/],
    ["開幕前→2回目以降は待機", /currentPhase === "interlude" \|\| currentPhase === "opening"[\s\S]{0,400}hasSeenCurtain\(\)\) playBgm\("waiting"\)/, /phase === "interlude" \|\| phase === "opening"[\s\S]{0,200}hasSeenCurtain\(\)\) playBgm\("waiting"\)/],
    ["閉幕→停止", /currentPhase === "closed"[\s\S]{0,120}stopBgm\(\)/, /phase === "closed"[\s\S]{0,40}stopBgm\(\)/],
  ];
  for (const [name, liveRule, demoRule] of rules) {
    assert.match(live, liveRule, `本番のBGM規則が見つからない: ${name}`);
    assert.match(demo, demoRule, `撮影モードのBGM規則が本番と違う: ${name}`);
  }
  // 撮り直し（リセット）時は曲を止める（前の回の曲が残って重なるのを防ぐ）
  assert.match(demo, /onReset=\{\(\) => \{\s*stopBgm\(\);\s*resetLive\(\);/, "撮り直し時に前の回のBGMが止まらない");
  console.log("PASS: BGMの規則（出囃子・ライブ中・待機・閉幕停止・2回目以降の開幕前）は本番と撮影モードで一致");
}

// 7) 効果音：撮影モードの画面が鳴らす効果音は、本番にも同じ名前がある（体験版だけの効果音は開発確認に限る）
{
  const liveSounds = new Set<string>();
  const liveFiles = ["src/app/live/page.tsx", "src/components/live-room/StageAnsweringView.tsx", "src/components/live-room/AudienceAnsweringView.tsx", "src/components/live-room/TopicRevealView.tsx", "src/components/live-room/GroupResultView.tsx", "src/components/live-room/FinalResultView.tsx", "src/components/live-room/OpeningView.tsx", "src/components/live-room/LaughEffectOverlay.tsx", "src/components/live-demo/CurtainOverlay.tsx", "src/components/live-demo/TimerRing.tsx", "src/components/live-demo/ScoreButtons.tsx", "src/components/live-demo/MasteryGauge.tsx",
    // 回答送信音・回答公開の合図は、本番・体験版/撮影モード共用のStageAnsweringPresentation・
    // AudienceAnsweringPresentationが唯一の再生箇所になった（StageAnsweringView/
    // AudienceAnsweringView自身はpropsを組み立てるだけで鳴らさない）。
    "src/components/live-room/StageAnsweringPresentation.tsx", "src/components/live-room/AudienceAnsweringPresentation.tsx"];
  for (const f of liveFiles) for (const m of read(f).matchAll(/playSfx\("([A-Za-z]+)"\)/g)) liveSounds.add(m[1]);
  const demoScreens = ["StageScreen", "AudienceScreen", "OpeningScreen", "TopicRevealScreen", "GroupResultScreen", "FinalResultScreen", "StartScreen", "InterludeScreen"];
  for (const name of demoScreens) {
    for (const m of code(read(`src/components/live-demo/${name}.tsx`)).matchAll(/playSfx\("([A-Za-z]+)"\)/g)) {
      const sound = m[1];
      if (sound === "startLive") {
        // 開発確認モードだけの開始音（撮影モードの開演では鳴らさない）
        assert.match(read(`src/components/live-demo/${name}.tsx`), /if \(mode\.recording[^)]*\) \{[\s\S]*?\}\n\s*\n?\s*return \(\n\s*<ScreenShell>\n\s*<BackToHomeLink/, "開始音が撮影モードの分岐の外にある");
        continue;
      }
      assert.ok(liveSounds.has(sound), `${name} の効果音「${sound}」が本番側にない（体験版だけの効果音）`);
    }
  }
  // 送信音とフリップ（審査開始）の音は別々に鳴らす：送信音は送信の1箇所だけ
  const stage = code(read("src/components/live-demo/StageScreen.tsx"));
  for (const m of stage.matchAll(/playSfx\("answerSubmit"\)/g)) {
    const before = stage.slice(Math.max(0, (m.index ?? 0) - 90), m.index ?? 0);
    assert.match(before, /sfxCueTracker\.once\([^\n]*\(\) => $/, "送信音が合図の記録を通っていない（二重再生の恐れ）");
  }
  console.log("PASS: 効果音の名前は本番と一致（体験版だけの開始音は開発確認モードに限る）");
}

// 8) 撮影モードの配線：本番側（/live と本番の表示部品）へ撮影用の依存を入れていない（上で確認済み）と
// 体験版の開き方（npmコマンド）が存在する
{
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  const script = pkg.scripts["dev:recording"];
  assert.ok(script, "dev:recording のnpmコマンドが無い");
  assert.match(script, /-H 0\.0\.0\.0/, "同一Wi-Fiのスマホから開けるように待ち受けアドレスを開いていない");
  assert.doesNotMatch(script, /(SUPABASE|KEY|SECRET|TOKEN)/i, "npmコマンドに秘密情報らしき文字がある");
  console.log("PASS: 撮影用のnpmコマンド（dev:recording）があり、同一Wi-Fiからの接続を受け付ける");
}

// 9) 効果音：回答の合図（cueId）ごとに1回だけ鳴る。送信の瞬間と回答席の点灯で同じ合図を2回呼んでも1回。
{
  const cue = createCueTracker();
  const played: string[] = [];
  const play = (id: string) => cue.once(id, () => played.push(id));
  play("c1"); // 送信の瞬間（自分の回答）
  play("c1"); // 回答席の点灯（同じ合図）
  play("c1"); // 再描画・Strict Modeの二重実行
  assert.deepEqual(played, ["c1"], "同じ合図は1回だけ鳴る");
  play("c2");
  assert.deepEqual(played, ["c1", "c2"], "別の回答の合図は別に鳴る");
  console.log("PASS: 回答の音は合図（cueId）ごとに1回だけ鳴る（送信・点灯・再描画で二重にならない）");
}

// 10) 満点：評価権のある全員が評価済みで、全員が最高評価の時だけ満点。確定前は判定しない。
{
  assert.equal(confirmedPerfectFor(true, 5, 2), false, "5人中2人だけ評価し2人とも最高：満点ではない");
  assert.equal(confirmedPerfectFor(true, 5, 5), true, "5人全員が最高評価：満点");
  assert.equal(confirmedPerfectFor(true, 5, 4), false, "5人中4人が最高、1人未評価：満点ではない");
  assert.equal(confirmedPerfectFor(true, 5, 4), false, "5人全員評価で1人だけ最高以外：満点ではない（最高は4人）");
  assert.equal(confirmedPerfectFor(true, 0, 0), false, "評価者0人：満点ではない");
  assert.equal(confirmedPerfectFor(false, 5, 5), null, "確定前は判定しない（暫定の満点を出さない）");
  assert.equal(isConfirmedPerfect(null), false, "確定前は金色にしない");
  assert.equal(isConfirmedPerfect(false), false, "満点でなければ金色にしない");
  assert.equal(isConfirmedPerfect(true), true);
  console.log("PASS: 満点は評価権のある全員が評価済みで全員が最高評価の時だけ。確定前・評価者0人・未評価者ありは金色にしない");
}

// 11) 満点の分母：回答者本人と組に出ている人は評価権が無い（評価権の人数は、組に出ていない人だけ）
{
  assert.equal(eligibleJudgeCountFor(["me", "a", "b", "c", "d"], ["me", "a"]), 3, "組に出ている人（回答者本人を含む）は分母から除く");
  console.log("PASS: 満点の分母は評価権のある人（組に出ていない人）だけ。回答者本人は含まない");
}

// 12) ボットの回答：撮影モードの既定はOFF。本番は1組・1周あたり最大2件（ボット全員の合計）
{
  assert.equal(BOT_ANSWER_MAX_PER_TURN, 2);
  assert.equal(botAnswersAllowedForTurn(0), true);
  assert.equal(botAnswersAllowedForTurn(1), true);
  assert.equal(botAnswersAllowedForTurn(2), false, "2件に達したら、それ以上ボットは送らない");
  assert.equal(normalizeRecordingSettings({ displayName: "", topic: "", botAnswers: false }).botAnswers, false, "撮影モードの既定はボット回答OFF");
  assert.equal(DEFAULT_RECORDING_SETTINGS.botAnswers, false);
  const host = code(read("src/store/useLiveHostStore.ts"));
  assert.match(host, /botAnswersAllowedForTurn\(botAnswersThisTurn\)/, "本番のボット送信に1組・1周の上限が無い");
  console.log("PASS: 撮影モードのボット回答は既定OFF。本番のボット回答は1組・1周あたり最大2件（人間の回答には影響しない）");
}

// 13) 撮影設定：名前・お題は前後の空白を除き、空欄は既定値、長すぎる入力は切り詰める。HTMLとして解釈しない。
{
  const n = normalizeRecordingSettings({ displayName: "  テスト名  ", topic: "  お題  ", botAnswers: true });
  assert.equal(n.displayName, "テスト名");
  assert.equal(n.topic, "お題");
  assert.equal(n.botAnswers, true);
  assert.equal(normalizeRecordingSettings({ displayName: "   ", topic: "", botAnswers: false }).displayName, RECORDING_DEFAULT_NAME);
  assert.equal(Array.from(normalizeRecordingSettings({ displayName: "あ".repeat(20), topic: "い".repeat(80), botAnswers: false }).displayName).length, RECORDING_NAME_MAX_LENGTH);
  assert.equal(Array.from(normalizeRecordingSettings({ displayName: "x", topic: "い".repeat(80), botAnswers: false }).topic).length, RECORDING_TOPIC_MAX_LENGTH);
  assert.equal(normalizeRecordingSettings({ displayName: "<b>太字</b>", topic: "a", botAnswers: false }).displayName, "<b>太字</b>", "HTMLとして解釈せず、そのまま文字として扱う（描画はReactが文字として出す）");
  assert.equal(canStartRecording({ displayName: " ", topic: "x" }), false, "名前が空なら開始できない");
  assert.equal(canStartRecording({ displayName: "x", topic: "" }), false, "お題が空なら開始できない");
  assert.equal(canStartRecording({ displayName: "x", topic: "y" }), true);
  const page = code(read("src/app/live-demo/page.tsx"));
  const store = code(read("src/store/useLiveDemoStore.ts"));
  assert.doesNotMatch(page + store, /localStorage|dangerouslySetInnerHTML/, "撮影設定をlocalStorageへ保存している、またはHTMLとして描画している");
  console.log("PASS: 撮影の名前・お題は前後の空白を除き、空欄は既定値・長い入力は切り詰め、HTMLとして解釈せず、保存しない");
}

// 14) ボット名：普通の単語の造語（人名・実在人物・和風の人名を使わない）。本番と体験版で同じ一覧
{
  const data = read("src/data/liveDemoData.ts");
  const m = /export const BOT_NAMES = \[([\s\S]*?)\] as const;/.exec(data);
  assert.ok(m, "BOT_NAMESが見つからない");
  const names = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.equal(names.length, 12, "ボット名は12件");
  assert.equal(new Set(names).size, names.length, "ボット名が重複している");
  const oldNames = ["べらんめえ次郎", "扇子亭こんぶ", "三日月アキラ", "落語亭シロップ", "太鼓持ちマサ", "座布団ヒナ", "招き猫ケンタ", "楽屋裏ミナミ", "早口テツヤ", "半纏のリョウ", "めくり札カナ", "高座のユウ"];
  for (const old of oldNames) assert.ok(!names.includes(old), `旧い和風の人名「${old}」が残っている`);
  for (const name of names) assert.ok(!/次郎|マサ|ヒナ|ユウ|アキラ|テツヤ|リョウ|カナ|ミナミ|ケンタ|ヒロシ|太郎/.test(name), `人名らしい名前が残っている: ${name}`);
  console.log("PASS: ボット名は造語12件（和風の人名・実在人物らしい名前なし）。本番のボット参加と体験版で同じ一覧");
}

// 15) 撮影用の開発サーバーだけ、開発インジケーター（Nマーク）を消す
{
  const cfg = read("next.config.ts");
  assert.match(cfg, /const isRecordingDev = process\.env\.LIVE_DEMO_RECORDING === "1";/);
  assert.match(cfg, /\.\.\.\(isRecordingDev \? \{ devIndicators: false \} : \{\}\)/, "Nマークを撮影用の開発サーバーだけで消していない");
  const pkg = read("package.json");
  assert.match(pkg, /"dev:recording": "LIVE_DEMO_RECORDING=1 next dev -H 0\.0\.0\.0 -p 3100"/);
  assert.match(pkg, /"dev": "next dev"/, "通常のnpm run devは従来どおり");
  console.log("PASS: Nマークは npm run dev:recording（LIVE_DEMO_RECORDING=1）のときだけ消え、通常の npm run dev は変わらない");
}

// 16) 採点ボード：金色化は「満点が確定した瞬間」に起こり、「弾ける瞬間」ではない。
//     弾ける処理（落下・静止・待機）とは完全に分離し、確定前に積み上がり数で推定しない。二重発火も防ぐ。
{
  const board = code(read("src/components/live-demo/ScoringPhysicsBoard.tsx"));
  // 金色化は confirmedPerfect が true になった「その瞬間」の1回だけ（弾ける処理を待たない）
  assert.match(board, /if \(confirmedPerfect === true && wasConfirmedPerfect !== true && !isGoldRoundRef\.current\) \{/, "金色化が「確定した瞬間」のガードになっていない");
  assert.match(board, /isGoldRoundRef\.current = true;/, "確定した瞬間に金色化の状態を立てていない");
  // 既存の玉（静止・落下を問わずMatterのworldにいる全部）を、確定の瞬間に金色へ塗り替える
  assert.match(board, /for \(const body of engine\.world\.bodies\) \{\s*\n\s*if \(body\.circleRadius\) ballColorsRef\.current\.set\(body\.id, PERFECT_BALL_COLOR\);/, "確定した瞬間に既存の玉（静止・落下中）を金色に塗り替えていない");
  // 確定後に生成される玉は、生成された瞬間から金色（弾ける瞬間に初めて差し替えない）
  assert.match(board, /isGoldRoundRef\.current \? PERFECT_BALL_COLOR : BALL_COLORS\[/, "確定後に生成される玉が最初から金色になっていない");
  // 弾ける瞬間はisGoldRoundRefをそのまま使う（弾ける時に改めてconfirmedPerfectから推定し直さない）
  assert.match(board, /const isPerfectScore = isGoldRoundRef\.current;/, "弾ける瞬間の色が、確定した瞬間に決めた金色の状態と別に判定されている");
  assert.doesNotMatch(board, /confirmedPerfectRef\.current \?\?/, "確定前に積み上がり数で満点と推定している");
  assert.doesNotMatch(board, /goldProgress|GOLD_TRANSITION_MS|perfectReachedAtRef/, "弾ける前の積み上がり量に応じた金色の染まり演出が残っている（確定の瞬間に即座に金色化する仕様と矛盾する）");
  assert.match(board, /if \(confirmedPerfectRef\.current === null\) return;/, "確定前に弾けてしまう（弾ける条件に確定前の状態が使われている）");
  assert.match(board, /if \(perfectTriggeredRef\.current\) return;/, "満点の演出（弾ける処理）の二重発火を防いでいない");
  // 1回答（roundKey）が切り替わったら、金色の状態を次の回答へ持ち越さない
  assert.match(board, /isGoldRoundRef\.current = false;/, "回答が切り替わった時に金色の状態をリセットしていない");
  console.log("PASS: 満点の金色化は「確定した瞬間」に起こり、弾ける処理（落下・静止・待機）とは分離されている。確定前の推定・弾ける瞬間の再判定・持ち越しは無い");
}

// 17) 体験版の満点の分母は「評価権のある人数」（届いた採点の件数で代用しない）。1人未採点でも満点にしない。
{
  for (const file of ["src/components/live-demo/StageScreen.tsx", "src/components/live-demo/AudienceScreen.tsx"]) {
    const src = code(read(file));
    assert.doesNotMatch(src, /boardScores\.length,/, `${file} が採点の件数を満点の分母にしている（未採点者がいても満点になる）`);
    assert.match(src, /perfectFromEligibleJudges\([\s\S]{0,200}boardAnswer\?\.eligibleJudgeIds/, `${file} の満点の分母が評価権の一覧になっていない`);
  }
  console.log("PASS: 体験版の満点の分母は評価権のある人数（1人未採点なら満点にならない）");
}

// 18) 満点（体験版）：採点開始時点の評価権の一覧を分母にする。未評価者は0点。ケースA〜G。
{
  const judges = ["j1", "j2", "j3", "j4", "j5"];
  const max = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, 3]));
  // ケースA：評価権5人、4人が最高評価、1人未評価
  assert.equal(perfectFromEligibleJudges(true, judges, { j1: 3, j2: 3, j3: 3, j4: 3 }), false, "A：未評価者は0点、満点ではない");
  // ケースB：評価権5人、2人が最高、3人未評価
  assert.equal(perfectFromEligibleJudges(true, judges, { j1: 3, j2: 3 }), false, "B：未評価が多い、満点ではない");
  // ケースC：評価権5人、全員が最高評価
  assert.equal(perfectFromEligibleJudges(true, judges, max(judges)), true, "C：全員が最高評価なら満点");
  // ケースD：評価権5人、全員評価、1人だけ最高以外
  assert.equal(perfectFromEligibleJudges(true, judges, { ...max(judges), j5: 2 }), false, "D：1人だけ最高以外は満点ではない");
  // ケースE：評価権0人
  assert.equal(perfectFromEligibleJudges(true, [], {}), false, "E：評価権0人は満点ではない");
  // ケースF：回答者本人は評価権の一覧に入らない（入れないことは store の eligibleJudgeIds で担保）。一覧に無い人の点数は分母に入らない
  assert.equal(perfectFromEligibleJudges(true, judges, { ...max(judges), answerer: 0 }), true, "F：評価権の無い人（回答者本人）は分母に入らず、評価権の全員が最高なら満点");
  // ケースG：利用者本人が評価権を持ち、評価ボタンを押さず、ほかの全員が最高評価
  const withMe = [...judges, "me"];
  assert.equal(perfectFromEligibleJudges(true, withMe, max(judges)), false, "G：利用者本人は0点として分母に残り、満点ではない");
  // 確定前は判定しない
  assert.equal(perfectFromEligibleJudges(false, judges, max(judges)), null, "確定前はnull（暫定の満点を出さない）");
  console.log("PASS: 満点の判定（ケースA〜G）：評価権の全員を分母にし、未評価者は0点。全員が最高評価の時だけ満点");
}

console.log("liveDemoRecordingMode.check: ALL PASS");
