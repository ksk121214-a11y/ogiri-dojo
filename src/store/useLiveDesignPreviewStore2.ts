"use client";

// /live/design-preview-2 専用のモックストア。src/store/useLiveDesignPreviewStore.ts
// （1個目のdesign-preview用、2組・結果発表なしの無限周回フロー）をベースに、
// 本番仕様(3組・1組5人・審査員兼観客は残り2組=10人・組が終わるごとに組結果発表・
// 3組終わったら最終結果発表)を追加した別ファイル。1個目と状態の形は共通だが、
// グループ構成とターン終了後の遷移ロジックが異なるため、共有ファイルの挙動を
// 変えないよう完全に複製して独立させてある(1個目には一切手を加えない)。
import { create } from "zustand";

import { BOT_ANSWER_POOL, BOT_NAMES, TOPIC_POOL } from "@/data/liveDemoData";
import { LIVE_ROOM_TIMING, MAX_ANSWERS_PER_PLAYER } from "@/data/liveRoomTiming";
import { getBestAnswer, getGroupTurnRanking, getOverallRanking } from "@/lib/liveRoomSelectors";
import type {
  AnswerRow,
  GroupRow,
  LiveRow,
  ParticipantRow,
  ScoreRow,
  TopicRow,
  TurnRow,
} from "@/lib/liveRoomTypes";
import type { FinalResultData, GroupResultData } from "@/store/useLiveFollowerStore";

const PREVIEW_LIVE_ID = "preview-live-2";
const MY_PARTICIPANT_ID = "preview-me";
const MY_DISPLAY_NAME = "プレビュー花子";

// 本番仕様(3組・1組5人・審査員兼観客10人)をこのプレビュー内だけで再現するための数字。
// BOT_NAMESは他のデモ系統(liveDemoLogic/useLiveBotStore/1個目のdesign-preview)も
// 参照する共有データで、全件をmapで使っている箇所があるため、このファイル専用の
// 追加名をローカルで用意して連結する(共有ファイル自体は変更しない)。
const PREVIEW_GROUP_COUNT = 3;
const PREVIEW_MEMBERS_PER_GROUP = 5;
const PREVIEW_ROUNDS = 1;
const EXTRA_BOT_NAMES = ["三味線のジロウ", "紙吹雪のレイ"] as const;

let idSeq = 0;
function genId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randomBotScore(): 0 | 1 | 2 | 3 {
  const r = Math.random();
  if (r < 0.15) return 0;
  if (r < 0.45) return 1;
  if (r < 0.8) return 2;
  return 3;
}

function randomDelay(minMs: number, maxMs: number): number {
  return minMs + Math.random() * Math.max(0, maxMs - minMs);
}

// 回答の演出フロー用の間隔（design-preview限定。矢継ぎ早に進めず、各段階の
// 切り替わりが見て分かるよう間を空けるためのもの）。
// 送信→(演壇が光り始める、この間フリップはまだ)→間→フリップ表示→審査→
// (玉が溜まる)→間→フリップが消える(演壇の光も消える)→(少し遅れて)玉が消える→
// 送信可能に戻る→間→次の回答、の順で使う。演壇の光は「送信〜フリップが消える」の
// 全期間ずっと継続するので、光る専用の時間(旧ANSWER_GLOW_MS)は存在しない。
const POST_GLOW_DELAY_MS = 1300;
const POST_JUDGE_DELAY_MS = 1000;
const POST_ANSWER_HIDE_DELAY_MS = 600;
// ScoringPhysicsBoardは resolved:true を受けてから
// RESOLVED_POP_DELAY_DEFAULT_MS(700ms)後に弾け始め、POP_DURATION_MS(320ms)かけて
// 消える（ScoringPhysicsBoardPreview.tsx参照）。ロック解除はその後にしたいので、
// 実際に玉が消え切るまでの尺(700+320ms)に余裕を足した値にしておく。
const POP_TO_NEXT_DELAY_MS = 1150;
const POST_POP_DELAY_MS = 900;
// useJudgingDisplayの猶予（本番の3600msだと「フリップが消える」より先に
// 玉が弾けてしまう）。design-previewではフリップの退場アニメーション分だけ
// 確保できれば十分なので短くする。呼び出し側のuseJudgingDisplayに渡す。
export const DESIGN_PREVIEW_POP_GRACE_MS = 350;

interface TsukkomiEvent {
  id: number;
  kind: "clap" | "stamp";
  text: string;
}

// 「フリップが消えてから玉が消える」の順序を保証するためのトリガー。
// ScoringPhysicsBoardのresolved/roundKeyはactiveAnswer（消えるのが早い）ではなく
// こちらを見るようにし、design-previewストア側が「フリップの退場アニメーションが
// 終わったタイミング」で明示的にresolved:trueへ切り替える。
interface BallTrigger {
  answerId: string;
  resolved: boolean;
}

interface LiveDesignPreviewState {
  live: LiveRow | null;
  myParticipant: ParticipantRow | null;
  participants: ParticipantRow[];
  groups: GroupRow[];
  participantNames: Record<string, string>;
  currentTurn: TurnRow | null;
  currentTopic: TopicRow | null;
  activeAnswer: AnswerRow | null;
  turnAnswers: AnswerRow[];
  activeAnswerScores: ScoreRow[];
  myAnswerCount: number;
  myScore: number | null;
  tsukkomiSeq: number;
  lastTsukkomi: TsukkomiEvent | null;
  // 送信直後、「演壇が光る」演出の対象participant_id。
  glowingParticipantId: string | null;
  ballTrigger: BallTrigger | null;
  // ライブ全体を通じて確定(resolved)した回答の累積ログ。最終結果発表の
  // 総合ランキング・本日のベストアンサー集計に使う(turnAnswersはターンごとに
  // リセットされるため、これとは別に持つ必要がある)。
  allAnswers: AnswerRow[];
  groupResult: GroupResultData | null;
  finalResult: FinalResultData | null;

  // myGroupSize: 自分がいる1組目の人数(1〜5)。省略時は既定の5人。
  // スタート画面の「参加人数」選択に対応するためのオプション。
  initPreview: (myGroupSize?: number) => void;
  beginFirstTurn: () => void;
  resetPreview: (myGroupSize?: number) => void;
  stopPreview: () => void;
  submitMyAnswer: (body: string) => Promise<{ ok: boolean; reason?: string }>;
  submitMyScore: (points: 0 | 1 | 2 | 3) => Promise<{ ok: boolean; reason?: string }>;
  sendTsukkomi: (kind: "clap" | "stamp", text: string) => void;
}

// そのターンの回答受付を締め切る「本当の」壁時計締切(絶対に延長しない)。
// live.phase_deadline/answering_remaining_msは審査中に見た目のタイマー表示を
// 一時停止し、再開時に残り時間から再計算する仕組み(演出のための一時停止)なので、
// 審査サイクルが続く限りいくらでも先延ばしになってしまう。「時間になったら
// 予約なしで強制終了」を実現するには、この見た目用の一時停止機構とは別に、
// startTurnで一度だけセットして以後変更しない締切が必要。
let answeringHardDeadlineAt = 0;

// このプレビュー内で発生する進行タイマー（ボット回答・reveal・採点・次ターン移行）は
// 全部ここで一元管理し、リセット時にまとめて片付ける。
let timers: ReturnType<typeof setTimeout>[] = [];
function clearAllTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}
function after(ms: number, fn: () => void) {
  timers.push(setTimeout(fn, Math.max(0, ms)));
}

let tsukkomiIdCounter = 0;
// participantId -> 残り送信可能回数（このターンのボットのみ）
let botAnswerRemaining = new Map<string, number>();

// myGroupSize: 自分がいる組(1組目)だけ人数を変えてレイアウト確認できるように
// するための引数(スタート画面の「参加人数」選択に対応)。省略時は既定の5人。
// 2組目・3組目は審査員数の見た目確認とは無関係なため、常に既定人数のまま。
function buildRoster(myGroupSize: number = PREVIEW_MEMBERS_PER_GROUP): {
  participants: ParticipantRow[];
  groups: GroupRow[];
  participantNames: Record<string, string>;
} {
  const participantNames: Record<string, string> = { [MY_PARTICIPANT_ID]: MY_DISPLAY_NAME };
  const nowIso = new Date().toISOString();
  const groups: GroupRow[] = Array.from({ length: PREVIEW_GROUP_COUNT }, (_, i) => ({
    id: genId("group"),
    live_id: PREVIEW_LIVE_ID,
    group_order: i + 1,
  }));

  const makeBot = (name: string, groupId: string): ParticipantRow => {
    const id = genId("participant");
    participantNames[id] = name;
    return {
      id,
      live_id: PREVIEW_LIVE_ID,
      user_id: id,
      group_id: groupId,
      role: "player",
      preferred_role: "player",
      joined_at: nowIso,
    };
  };

  const me: ParticipantRow = {
    id: MY_PARTICIPANT_ID,
    live_id: PREVIEW_LIVE_ID,
    user_id: MY_PARTICIPANT_ID,
    group_id: groups[0].id,
    role: "player",
    preferred_role: "player",
    joined_at: nowIso,
  };

  // 自分の枠(1人)を差し引いた残り全員ぶんの名前をシャッフルして各組に配分する。
  const names = shuffle([...BOT_NAMES, ...EXTRA_BOT_NAMES]);
  const totalBotsNeeded = myGroupSize - 1 + (PREVIEW_GROUP_COUNT - 1) * PREVIEW_MEMBERS_PER_GROUP;
  const bots: ParticipantRow[] = [];
  let nameCursor = 0;
  groups.forEach((group, groupIndex) => {
    const seatsInGroup =
      groupIndex === 0 ? Math.max(0, myGroupSize - 1) : PREVIEW_MEMBERS_PER_GROUP;
    for (let i = 0; i < seatsInGroup; i += 1) {
      bots.push(makeBot(names[nameCursor % names.length], group.id));
      nameCursor += 1;
    }
  });
  // totalBotsNeededと実際に配ったbots.lengthは一致するはず(組数×人数の割り付けが
  // ずれていないことの確認用。ずれていたら配分ロジックのバグなので開発時に気づける)。
  if (bots.length !== totalBotsNeeded && process.env.NODE_ENV !== "production") {
    console.warn("[design-preview-2] roster配分が想定人数と一致していません", {
      expected: totalBotsNeeded,
      actual: bots.length,
    });
  }

  return { participants: [me, ...bots], groups, participantNames };
}

function buildTurn(round: number, group: GroupRow): { turn: TurnRow; topic: TopicRow } {
  const body = TOPIC_POOL[Math.floor(Math.random() * TOPIC_POOL.length)];
  const topic: TopicRow = {
    id: genId("topic"),
    live_id: PREVIEW_LIVE_ID,
    body,
    format: "text",
    created_at: new Date().toISOString(),
    topic_bank_id: null,
    locked: false,
  };
  const turn: TurnRow = {
    id: genId("turn"),
    live_id: PREVIEW_LIVE_ID,
    round,
    group_id: group.id,
    topic_id: topic.id,
    status: "active",
  };
  return { turn, topic };
}

// ターンの中身(お題・回答者組)だけを用意して画面に出す。回答受付の時計は
// まだ動かさない(組分け発表→お題大写しの間、締切が消費されてしまわないように)。
function prepareTurn(round: number, group: GroupRow): TurnRow {
  const { turn, topic } = buildTurn(round, group);
  useLiveDesignPreviewStore2.setState(() => ({
    currentTurn: turn,
    currentTopic: topic,
    activeAnswer: null,
    turnAnswers: [],
    activeAnswerScores: [],
    myAnswerCount: 0,
    myScore: null,
    glowingParticipantId: null,
    ballTrigger: null,
  }));
  return turn;
}

// prepareTurnで用意済みのターンについて、回答受付の時計(締切・ボット送信)を
// 実際に動かし始める。呼ばれた瞬間から答え受付が始まる。
function beginAnsweringClock(turn: TurnRow) {
  const { participants } = useLiveDesignPreviewStore2.getState();
  const members = participants.filter((p) => p.group_id === turn.group_id);
  botAnswerRemaining = new Map(
    members
      .filter((p) => p.id !== MY_PARTICIPANT_ID)
      .map((p) => [p.id, 1 + Math.floor(Math.random() * MAX_ANSWERS_PER_PLAYER)]),
  );

  const deadline = new Date(Date.now() + LIVE_ROOM_TIMING.answerMs).toISOString();
  answeringHardDeadlineAt = Date.now() + LIVE_ROOM_TIMING.answerMs;
  useLiveDesignPreviewStore2.setState((s) => ({
    live: s.live
      ? {
          ...s.live,
          current_turn_id: turn.id,
          current_phase: "answering",
          phase_deadline: deadline,
          answering_paused: false,
          answering_remaining_ms: null,
        }
      : s.live,
  }));

  // 持ち時間ちょうどで強制終了する（予約送信はしない）。ちょうどその瞬間に
  // 誰かの回答が処理中(answering_paused)なら、それを中断させず自然に
  // 終わるのを待つ(finalizeAnswer側のonAnswerCycleSettledが締切超過を
  // 検知して代わりに終了させる)。
  after(LIVE_ROOM_TIMING.answerMs, () => onAnswerDeadline(turn.id));

  scheduleNextBotAnswer(turn.id);
}

function startTurn(round: number, group: GroupRow) {
  beginAnsweringClock(prepareTurn(round, group));
}

// answeringHardDeadlineAt(壁時計、絶対に延長しない)を見る。live.phase_deadlineは
// あくまで見た目のタイマー表示用で、審査中は一時停止→残り時間ぶん延長を
// 繰り返すため、「新しい回答をもう受け付けない」判定には使えない
// (審査サイクルが続く限りいつまでも延び続けてしまう)。
function isAnsweringDeadlinePassed(): boolean {
  return Date.now() >= answeringHardDeadlineAt;
}

// 締切ちょうどに呼ばれる。その瞬間、進行中の回答が無ければ即座にターンを
// 終了する。進行中の回答があれば何もせず、その回答が一区切りついた時点
// (onAnswerCycleSettled)で締切超過を検知してターンを終了させる。
function onAnswerDeadline(turnId: string) {
  const state = useLiveDesignPreviewStore2.getState();
  if (state.currentTurn?.id !== turnId) return;
  if (state.activeAnswer || state.live?.answering_paused) return;
  finishCurrentTurnAndShowGroupResult();
}

function scheduleNextBotAnswer(turnId: string) {
  const remaining = [...botAnswerRemaining.entries()].filter(([, n]) => n > 0);
  if (remaining.length === 0) return;
  after(randomDelay(2600, 6000), () => {
    const state = useLiveDesignPreviewStore2.getState();
    if (state.currentTurn?.id !== turnId) return; // ターンが切り替わっていたら中止
    // 締切を過ぎたら新しい回答は予約せず、このボットの送信チェーンをここで止める
    // (「時間切れでも何故か回答が出る」を防ぐ)。
    if (isAnsweringDeadlinePassed()) return;
    const candidates = [...botAnswerRemaining.entries()].filter(([, n]) => n > 0);
    if (candidates.length === 0) return;
    const [participantId] = candidates[Math.floor(Math.random() * candidates.length)];
    const body = BOT_ANSWER_POOL[Math.floor(Math.random() * BOT_ANSWER_POOL.length)];
    const ok = pushAnswer(turnId, participantId, body);
    // 他の誰かに先を越された（早押しで負けた）場合は回数を消費せず、
    // 次のタイミングでまた挑戦させる。
    if (ok) {
      botAnswerRemaining.set(participantId, (botAnswerRemaining.get(participantId) ?? 1) - 1);
    }
    scheduleNextBotAnswer(turnId);
  });
}

// 回答の送信（自分・ボット問わず、この関数を必ず通る）。「予約送信」を防ぐため
// ここで排他制御を行う：既に誰かの回答が処理中（送信〜フリップが消えて玉が消えるまで）
// なら、この呼び出し自体を即座に拒否する（戻り値false）。呼び出し元がJSの
// シングルスレッド性を利用して同期的にロックを立てるので、ほぼ同時の複数送信でも
// 「早押し」的に最初の1件だけが通る。負けた側（自分の場合）は何もしない＝
// 呼び出し元のtextareaに入力内容がそのまま残る。
function pushAnswer(turnId: string, participantId: string, body: string): boolean {
  const state = useLiveDesignPreviewStore2.getState();
  if (state.currentTurn?.id !== turnId) return false;
  if (state.live?.answering_paused) return false;
  // 締切を過ぎた回答は自分・ボット問わず一切受け付けない(予約送信なし)。
  if (isAnsweringDeadlinePassed()) return false;
  const seq = state.turnAnswers.filter((a) => a.participant_id === participantId).length + 1;
  const answer: AnswerRow = {
    id: genId("answer"),
    turn_id: turnId,
    live_id: PREVIEW_LIVE_ID,
    participant_id: participantId,
    seq,
    body,
    score_total: 0,
    top_score_votes: 0,
    judge_count: 0,
    laugh_triggered: false,
    revealed_at: null,
    judging_ends_at: null,
    resolved: false,
    created_at: new Date().toISOString(),
  };
  const remainingMs = state.live?.phase_deadline
    ? Math.max(0, new Date(state.live.phase_deadline).getTime() - Date.now())
    : 0;
  // 送信された瞬間、即座にロック（他の回答者は送信できなくなる）。演壇は
  // フリップが消える(finalizeAnswer)までずっと光ったまま。
  useLiveDesignPreviewStore2.setState((s) => ({
    turnAnswers: [...s.turnAnswers, answer],
    myAnswerCount: participantId === MY_PARTICIPANT_ID ? s.myAnswerCount + 1 : s.myAnswerCount,
    glowingParticipantId: participantId,
    live: s.live
      ? { ...s.live, answering_paused: true, answering_remaining_ms: remainingMs }
      : s.live,
  }));
  after(POST_GLOW_DELAY_MS, () => {
    const s2 = useLiveDesignPreviewStore2.getState();
    if (s2.currentTurn?.id !== turnId) return;
    revealAnswer(turnId, answer.id);
  });
  return true;
}

function revealAnswer(turnId: string, answerId: string) {
  const state = useLiveDesignPreviewStore2.getState();
  const answer = state.turnAnswers.find((a) => a.id === answerId);
  if (!answer) return;
  const judgingEndsAt = new Date(Date.now() + LIVE_ROOM_TIMING.judgeMs).toISOString();
  const revealed: AnswerRow = {
    ...answer,
    revealed_at: new Date().toISOString(),
    judging_ends_at: judgingEndsAt,
  };
  useLiveDesignPreviewStore2.setState((s) => {
    const remainingMs = s.live?.phase_deadline
      ? Math.max(0, new Date(s.live.phase_deadline).getTime() - Date.now())
      : 0;
    return {
      activeAnswer: revealed,
      turnAnswers: s.turnAnswers.map((a) => (a.id === answerId ? revealed : a)),
      activeAnswerScores: [],
      myScore: null,
      // お題ボードの玉はこのラウンド用にリセット（次の回答が来るまでresolvedはfalse）。
      ballTrigger: { answerId, resolved: false },
      live: s.live
        ? { ...s.live, answering_paused: true, answering_remaining_ms: remainingMs }
        : s.live,
    };
  });
  scheduleBotScores(turnId, answerId);
  after(LIVE_ROOM_TIMING.judgeMs + LIVE_ROOM_TIMING.judgeGraceMs, () =>
    judgingComplete(turnId, answerId),
  );
}

function scheduleBotScores(turnId: string, answerId: string) {
  const state = useLiveDesignPreviewStore2.getState();
  if (!state.currentTurn) return;
  const judges = state.participants.filter(
    (p) => p.id !== MY_PARTICIPANT_ID && p.group_id !== state.currentTurn!.group_id,
  );
  judges.forEach((judge) => {
    after(randomDelay(700, LIVE_ROOM_TIMING.judgeMs - 800), () => {
      addScore(turnId, answerId, judge.id, randomBotScore());
    });
  });
}

function addScore(turnId: string, answerId: string, judgeId: string, points: 0 | 1 | 2 | 3) {
  const state = useLiveDesignPreviewStore2.getState();
  if (state.currentTurn?.id !== turnId || state.activeAnswer?.id !== answerId) return;
  if (state.activeAnswerScores.some((s) => s.judge_participant_id === judgeId)) return;
  const row: ScoreRow = {
    answer_id: answerId,
    judge_participant_id: judgeId,
    points,
    created_at: new Date().toISOString(),
  };
  useLiveDesignPreviewStore2.setState((s) => ({
    activeAnswerScores: [...s.activeAnswerScores, row],
    myScore: judgeId === MY_PARTICIPANT_ID ? points : s.myScore,
  }));
  checkAllJudged(turnId, answerId);
}

function checkAllJudged(turnId: string, answerId: string) {
  const state = useLiveDesignPreviewStore2.getState();
  if (state.currentTurn?.id !== turnId || !state.currentTurn) return;
  const judgeCount = state.participants.filter(
    (p) => p.group_id !== state.currentTurn!.group_id,
  ).length;
  if (state.activeAnswerScores.length >= judgeCount) {
    after(LIVE_ROOM_TIMING.earlyConfirmDelayMs, () => judgingComplete(turnId, answerId));
  }
}

// 審査が全員終わる、または審査時間切れになった瞬間。玉は採点の度に
// 即座に降っており、この時点で既にお題ボードに溜まっている。
// ここでは即座にフリップを消さず、少し間を置いてから finalizeAnswer を呼ぶ。
function judgingComplete(turnId: string, answerId: string) {
  const state = useLiveDesignPreviewStore2.getState();
  if (state.currentTurn?.id !== turnId || state.activeAnswer?.id !== answerId) return;
  after(POST_JUDGE_DELAY_MS, () => finalizeAnswer(turnId, answerId));
}

// 「少し間」の後、フリップ（回答）を消す。演壇の光もここで一緒に消える
// （「回答席が光ったら回答が終わるまでその席は光ったまま」）。玉を弾けさせるのは
// この関数ではなく、フリップの退場アニメーションが終わった頃合いにballTriggerを
// resolved:trueへ切り替えることで行う（「回答が消えると玉が消える」の順序）。
// 送信ロック(answering_paused)はまだ解除しない。「玉が消えるまで送信ボタンは
// 押せない」ため、解除は玉が消えた後（このあとのPOP_TO_NEXT_DELAY_MS経過時点）。
function finalizeAnswer(turnId: string, answerId: string) {
  const state = useLiveDesignPreviewStore2.getState();
  if (state.currentTurn?.id !== turnId || state.activeAnswer?.id !== answerId) return;
  const scores = state.activeAnswerScores;
  const scoreTotal = scores.reduce((sum, s) => sum + s.points, 0);
  const topScoreVotes = scores.filter((s) => s.points === 3).length;
  const laughTriggered = scores.length > 0 && topScoreVotes / scores.length > 0.5;
  const finalized: AnswerRow = {
    ...(state.turnAnswers.find((a) => a.id === answerId) as AnswerRow),
    score_total: scoreTotal,
    top_score_votes: topScoreVotes,
    judge_count: scores.length,
    laugh_triggered: laughTriggered,
    // 組結果・最終結果のランキング集計(getGroupTurnRanking/getOverallRanking)は
    // resolved:trueの回答だけを合算対象にするため、確定したらここで立てる
    // (本番のresolveIfDueに相当する箇所)。
    resolved: true,
  };
  useLiveDesignPreviewStore2.setState((s) => ({
    activeAnswer: null,
    glowingParticipantId: null,
    turnAnswers: s.turnAnswers.map((a) => (a.id === answerId ? finalized : a)),
  }));

  // フリップの退場アニメーション（+useJudgingDisplayの短い猶予）が
  // 終わった頃合いで、玉を弾けさせる。
  after(POST_ANSWER_HIDE_DELAY_MS, () => {
    const s2 = useLiveDesignPreviewStore2.getState();
    if (s2.currentTurn?.id !== turnId) return;
    useLiveDesignPreviewStore2.setState({ ballTrigger: { answerId, resolved: true } });

    // 玉が弾けて消えるアニメーションぶんの尺を見込んでから、送信ロックを解除する。
    after(POP_TO_NEXT_DELAY_MS, () => {
      const s3 = useLiveDesignPreviewStore2.getState();
      if (s3.currentTurn?.id !== turnId) return;
      useLiveDesignPreviewStore2.setState((s) => {
        const remaining = s.live?.answering_remaining_ms ?? 0;
        const newDeadline = new Date(Date.now() + remaining).toISOString();
        return {
          live: s.live
            ? {
                ...s.live,
                answering_paused: false,
                answering_remaining_ms: null,
                phase_deadline: newDeadline,
              }
            : s.live,
        };
      });

      // ロック解除の直後、既に締切を過ぎていれば(＝この回答の処理中に時間切れに
      // なっていた場合)、次の回答を待たずにここでターンを終了する。締切前なら
      // 何もしない(scheduleNextBotAnswerのチェーンが引き続き回答を送ってくる)。
      after(POST_POP_DELAY_MS, () => {
        const s4 = useLiveDesignPreviewStore2.getState();
        if (s4.currentTurn?.id !== turnId || s4.live?.answering_paused) return;
        if (isAnsweringDeadlinePassed()) finishCurrentTurnAndShowGroupResult();
      });
    });
  });
}

// 本番(useLiveHostStore.advanceIfDue)のanswering→group_result→(次turnがあれば
// topic_reveal相当/なければfinal_result)という流れを、このモックストア内だけで
// 再現する。turnPlan/turnPlanIndexで「round→組順」に並べた全turnをあらかじめ
// 用意しておき、本番のorderedTurns()+findIndexと同じ考え方で「次のturnがあるか」を
// 判定する。
let turnPlan: { round: number; group: GroupRow }[] = [];
let turnPlanIndex = -1;

function buildTurnPlan(groups: GroupRow[]): { round: number; group: GroupRow }[] {
  const ordered = [...groups].sort((a, b) => a.group_order - b.group_order);
  const plan: { round: number; group: GroupRow }[] = [];
  for (let round = 1; round <= PREVIEW_ROUNDS; round += 1) {
    for (const group of ordered) plan.push({ round, group });
  }
  return plan;
}

function finishCurrentTurnAndShowGroupResult() {
  const state = useLiveDesignPreviewStore2.getState();
  const { currentTurn, currentTopic, groups, participants, participantNames, turnAnswers, allAnswers } =
    state;
  if (!currentTurn || !currentTopic) return;
  clearAllTimers();

  const groupOrder = groups.find((g) => g.id === currentTurn.group_id)?.group_order ?? 1;
  const ranking = getGroupTurnRanking(
    turnAnswers,
    participants,
    currentTurn.id,
    currentTurn.group_id,
    participantNames,
  );
  const laughCount = turnAnswers.filter((a) => a.resolved && a.laugh_triggered).length;
  const groupResult: GroupResultData = {
    round: currentTurn.round,
    groupOrder,
    topicBody: currentTopic.body,
    ranking,
    laughCount,
  };
  const deadline = new Date(Date.now() + LIVE_ROOM_TIMING.groupResultMs).toISOString();

  useLiveDesignPreviewStore2.setState((s) => ({
    allAnswers: [...allAnswers, ...turnAnswers.filter((a) => a.resolved)],
    groupResult,
    currentTurn: null,
    currentTopic: null,
    activeAnswer: null,
    live: s.live
      ? { ...s.live, current_phase: "group_result", current_turn_id: null, phase_deadline: deadline }
      : s.live,
  }));

  after(LIVE_ROOM_TIMING.groupResultMs, proceedAfterGroupResult);
}

function proceedAfterGroupResult() {
  turnPlanIndex += 1;
  const next = turnPlan[turnPlanIndex];
  if (next) {
    useLiveDesignPreviewStore2.setState((s) => ({
      groupResult: null,
      live: s.live ? { ...s.live, current_phase: "answering" } : s.live,
    }));
    startTurn(next.round, next.group);
    return;
  }
  showFinalResult();
}

function showFinalResult() {
  const state = useLiveDesignPreviewStore2.getState();
  const { allAnswers, participants, participantNames } = state;
  const ranking = getOverallRanking(allAnswers, participants, participantNames);
  const best = getBestAnswer(allAnswers);
  const myRankIndex = ranking.findIndex((r) => r.participantId === MY_PARTICIPANT_ID);
  const finalResult: FinalResultData = {
    bestAnswer: best
      ? {
          participantId: best.participant_id,
          name: participantNames[best.participant_id] ?? "（名前未設定）",
          body: best.body,
          scoreTotal: best.score_total,
        }
      : null,
    ranking,
    myRank: myRankIndex === -1 ? null : myRankIndex + 1,
  };
  useLiveDesignPreviewStore2.setState((s) => ({
    groupResult: null,
    finalResult,
    live: s.live
      ? { ...s.live, current_phase: "final_result", current_turn_id: null, phase_deadline: null }
      : s.live,
  }));
}

export const useLiveDesignPreviewStore2 = create<LiveDesignPreviewState>()((set, get) => ({
  live: null,
  myParticipant: null,
  participants: [],
  groups: [],
  participantNames: {},
  currentTurn: null,
  currentTopic: null,
  activeAnswer: null,
  turnAnswers: [],
  activeAnswerScores: [],
  myAnswerCount: 0,
  myScore: null,
  tsukkomiSeq: 0,
  lastTsukkomi: null,
  glowingParticipantId: null,
  ballTrigger: null,
  allAnswers: [],
  groupResult: null,
  finalResult: null,

  initPreview: (myGroupSize) => {
    clearAllTimers();
    idSeq = 0;
    tsukkomiIdCounter = 0;
    const { participants, groups, participantNames } = buildRoster(myGroupSize);
    turnPlan = buildTurnPlan(groups);
    turnPlanIndex = 0;
    const live: LiveRow = {
      id: PREVIEW_LIVE_ID,
      scheduled_at: new Date().toISOString(),
      rounds_per_live: PREVIEW_ROUNDS,
      // 組分け発表・お題大写しの間はまだ回答受付前なので"topic_reveal"のまま
      // にしておく(実際に回答を受け付け始めるのはbeginFirstTurn()が呼ばれてから)。
      current_phase: "topic_reveal",
      current_turn_id: null,
      phase_deadline: null,
      answering_paused: false,
      answering_remaining_ms: null,
      reveal_sequence_until: null,
      created_at: new Date().toISOString(),
      sequence_number: 0,
      title: null,
      description: null,
      max_players: null,
      planned_group_count: null,
      reception_starts_at: null,
      reception_ends_at: null,
      results_published: false,
      ended_at: null,
      announcement_message: null,
      announcement_scope: null,
      announcement_sent_at: null,
      created_by: null,
    };
    set({
      live,
      myParticipant: participants.find((p) => p.id === MY_PARTICIPANT_ID) ?? null,
      participants,
      groups,
      participantNames,
      currentTurn: null,
      currentTopic: null,
      activeAnswer: null,
      turnAnswers: [],
      activeAnswerScores: [],
      myAnswerCount: 0,
      myScore: null,
      tsukkomiSeq: 0,
      lastTsukkomi: null,
      glowingParticipantId: null,
      ballTrigger: null,
      allAnswers: [],
      groupResult: null,
      finalResult: null,
    });
    // お題は組分け発表・お題大写し画面で表示する分をここで用意するが、
    // 回答受付の時計はまだ動かさない(呼び出し側がイントロ演出を終えてから
    // beginFirstTurn()を呼ぶ)。
    prepareTurn(turnPlan[0].round, turnPlan[0].group);
  },

  // イントロ演出(スタート→組分け発表→お題大写し)が終わったタイミングで
  // 呼び、initPreviewで用意済みの最初のターンの回答受付を開始する。
  beginFirstTurn: () => {
    const { currentTurn } = get();
    if (!currentTurn) return;
    beginAnsweringClock(currentTurn);
  },

  resetPreview: (myGroupSize) => {
    get().initPreview(myGroupSize);
  },

  stopPreview: () => {
    clearAllTimers();
  },

  submitMyAnswer: async (body: string) => {
    const { currentTurn, myAnswerCount } = get();
    if (!currentTurn) return { ok: false, reason: "ターンがありません" };
    const trimmed = body.trim();
    if (!trimmed) return { ok: false, reason: "回答を入力してください" };
    if (myAnswerCount >= MAX_ANSWERS_PER_PLAYER) {
      return { ok: false, reason: "回答できる回数の上限に達しました" };
    }
    const ok = pushAnswer(currentTurn.id, MY_PARTICIPANT_ID, trimmed);
    if (!ok) {
      // 早押しで他の人に先を越された：入力内容は消さずそのまま残す。
      return { ok: false, reason: "他の人が先に送信しました。少し待ってからもう一度送信してね" };
    }
    return { ok: true };
  },

  submitMyScore: async (points) => {
    const { activeAnswer, myScore, currentTurn } = get();
    if (!activeAnswer || !currentTurn) return { ok: false, reason: "採点対象がありません" };
    if (myScore !== null) return { ok: false, reason: "採点済みです" };
    addScore(currentTurn.id, activeAnswer.id, MY_PARTICIPANT_ID, points);
    return { ok: true };
  },

  sendTsukkomi: (kind, text) => {
    tsukkomiIdCounter += 1;
    set((s) => ({
      tsukkomiSeq: s.tsukkomiSeq + 1,
      lastTsukkomi: { id: tsukkomiIdCounter, kind, text },
    }));
  },
}));
