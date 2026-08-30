"use client";

// /live/design-preview 専用：Supabaseに一切接続しないローカル完結のモックストア。
// state shapeは useLiveFollowerStore と同一にし、本番の StageAnsweringView/AudienceAnsweringView を
// 複製した design-preview 版コンポーネントがそのまま同じ見た目・同じ操作感で動くようにする。
// 本番の useLiveFollowerStore.ts には一切手を加えない（デザインが固まるまでは意図的に完全別ファイルにしておく）。
//
// 注意：このファイルは /live/design-preview（1個目）と /live/design-preview-2（2個目、
// 組結果発表・最終結果発表つきの本番仕様フロー）の両方から参照される共有ファイル。
// 2個目用に「3組・組ごとの結果発表・最終結果発表」を追加した版は、この挙動を
// 変えずに src/store/useLiveDesignPreviewStore2.ts へ別ファイルとして複製してある。
import { create } from "zustand";

import { BOT_ANSWER_POOL, BOT_NAMES, TOPIC_POOL } from "@/data/liveDemoData";
import { LIVE_ROOM_TIMING, MAX_ANSWERS_PER_PLAYER } from "@/data/liveRoomTiming";
import type {
  AnswerRow,
  GroupRow,
  LiveRow,
  ParticipantRow,
  ScoreRow,
  TopicRow,
  TurnRow,
} from "@/lib/liveRoomTypes";

const PREVIEW_LIVE_ID = "preview-live";
const MY_PARTICIPANT_ID = "preview-me";
const MY_DISPLAY_NAME = "プレビュー花子";

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

  initPreview: () => void;
  resetPreview: () => void;
  stopPreview: () => void;
  submitMyAnswer: (body: string) => Promise<{ ok: boolean; reason?: string }>;
  submitMyScore: (points: 0 | 1 | 2 | 3) => Promise<{ ok: boolean; reason?: string }>;
  sendTsukkomi: (kind: "clap" | "stamp", text: string) => void;
}

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

function buildRoster(): {
  participants: ParticipantRow[];
  groups: GroupRow[];
  participantNames: Record<string, string>;
} {
  const participantNames: Record<string, string> = { [MY_PARTICIPANT_ID]: MY_DISPLAY_NAME };
  const groupA = genId("group");
  const groupB = genId("group");
  const names = shuffle([...BOT_NAMES]);
  const nowIso = new Date().toISOString();

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
    group_id: groupA,
    role: "player",
    preferred_role: "player",
    joined_at: nowIso,
  };
  const botsA = names.slice(0, 4).map((n) => makeBot(n, groupA));
  const botsB = names.slice(4, 9).map((n) => makeBot(n, groupB));

  const groups: GroupRow[] = [
    { id: groupA, live_id: PREVIEW_LIVE_ID, group_order: 1 },
    { id: groupB, live_id: PREVIEW_LIVE_ID, group_order: 2 },
  ];
  return { participants: [me, ...botsA, ...botsB], groups, participantNames };
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

function startTurn(round: number, group: GroupRow) {
  const { turn, topic } = buildTurn(round, group);
  const { participants } = useLiveDesignPreviewStore.getState();
  const members = participants.filter((p) => p.group_id === group.id);
  botAnswerRemaining = new Map(
    members
      .filter((p) => p.id !== MY_PARTICIPANT_ID)
      .map((p) => [p.id, 1 + Math.floor(Math.random() * MAX_ANSWERS_PER_PLAYER)]),
  );

  const deadline = new Date(Date.now() + LIVE_ROOM_TIMING.answerMs).toISOString();
  useLiveDesignPreviewStore.setState((s) => ({
    currentTurn: turn,
    currentTopic: topic,
    activeAnswer: null,
    turnAnswers: [],
    activeAnswerScores: [],
    myAnswerCount: 0,
    myScore: null,
    glowingParticipantId: null,
    ballTrigger: null,
    live: s.live
      ? {
          ...s.live,
          current_turn_id: turn.id,
          phase_deadline: deadline,
          answering_paused: false,
          answering_remaining_ms: null,
        }
      : s.live,
  }));

  // 持ち時間切れの安全弁：自分が何も操作しなくても、いずれ次のターンへ進むようにしておく。
  // answering_pausedの間（回答が処理中〜玉が消えるまで）はまだ進行中なので、
  // その途中でこの安全弁が誤って割り込まないようにする。
  after(LIVE_ROOM_TIMING.answerMs + 500, () => {
    const s = useLiveDesignPreviewStore.getState();
    if (s.currentTurn?.id !== turn.id || s.activeAnswer || s.live?.answering_paused) return;
    advanceTurn();
  });

  scheduleNextBotAnswer(turn.id);
}

function scheduleNextBotAnswer(turnId: string) {
  const remaining = [...botAnswerRemaining.entries()].filter(([, n]) => n > 0);
  if (remaining.length === 0) return;
  after(randomDelay(2600, 6000), () => {
    const state = useLiveDesignPreviewStore.getState();
    if (state.currentTurn?.id !== turnId) return; // ターンが切り替わっていたら中止
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
  const state = useLiveDesignPreviewStore.getState();
  if (state.currentTurn?.id !== turnId) return false;
  if (state.live?.answering_paused) return false;
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
  useLiveDesignPreviewStore.setState((s) => ({
    turnAnswers: [...s.turnAnswers, answer],
    myAnswerCount: participantId === MY_PARTICIPANT_ID ? s.myAnswerCount + 1 : s.myAnswerCount,
    glowingParticipantId: participantId,
    live: s.live
      ? { ...s.live, answering_paused: true, answering_remaining_ms: remainingMs }
      : s.live,
  }));
  after(POST_GLOW_DELAY_MS, () => {
    const s2 = useLiveDesignPreviewStore.getState();
    if (s2.currentTurn?.id !== turnId) return;
    revealAnswer(turnId, answer.id);
  });
  return true;
}

function revealAnswer(turnId: string, answerId: string) {
  const state = useLiveDesignPreviewStore.getState();
  const answer = state.turnAnswers.find((a) => a.id === answerId);
  if (!answer) return;
  const judgingEndsAt = new Date(Date.now() + LIVE_ROOM_TIMING.judgeMs).toISOString();
  const revealed: AnswerRow = {
    ...answer,
    revealed_at: new Date().toISOString(),
    judging_ends_at: judgingEndsAt,
  };
  useLiveDesignPreviewStore.setState((s) => {
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
  const state = useLiveDesignPreviewStore.getState();
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
  const state = useLiveDesignPreviewStore.getState();
  if (state.currentTurn?.id !== turnId || state.activeAnswer?.id !== answerId) return;
  if (state.activeAnswerScores.some((s) => s.judge_participant_id === judgeId)) return;
  const row: ScoreRow = {
    answer_id: answerId,
    judge_participant_id: judgeId,
    points,
    created_at: new Date().toISOString(),
  };
  useLiveDesignPreviewStore.setState((s) => ({
    activeAnswerScores: [...s.activeAnswerScores, row],
    myScore: judgeId === MY_PARTICIPANT_ID ? points : s.myScore,
  }));
  checkAllJudged(turnId, answerId);
}

function checkAllJudged(turnId: string, answerId: string) {
  const state = useLiveDesignPreviewStore.getState();
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
  const state = useLiveDesignPreviewStore.getState();
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
  const state = useLiveDesignPreviewStore.getState();
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
  };
  useLiveDesignPreviewStore.setState((s) => ({
    activeAnswer: null,
    glowingParticipantId: null,
    turnAnswers: s.turnAnswers.map((a) => (a.id === answerId ? finalized : a)),
  }));

  // フリップの退場アニメーション（+useJudgingDisplayの短い猶予）が
  // 終わった頃合いで、玉を弾けさせる。
  after(POST_ANSWER_HIDE_DELAY_MS, () => {
    const s2 = useLiveDesignPreviewStore.getState();
    if (s2.currentTurn?.id !== turnId) return;
    useLiveDesignPreviewStore.setState({ ballTrigger: { answerId, resolved: true } });

    // 玉が弾けて消えるアニメーションぶんの尺を見込んでから、送信ロックを解除する。
    after(POP_TO_NEXT_DELAY_MS, () => {
      const s3 = useLiveDesignPreviewStore.getState();
      if (s3.currentTurn?.id !== turnId) return;
      useLiveDesignPreviewStore.setState((s) => {
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

      // 誰も次を送信してこない場合の安全弁：少し待って、まだ誰も送信していなければ
      // （＝ロックが再びかかっていなければ）ターン終了判定へ進む。
      after(POST_POP_DELAY_MS, () => {
        const s4 = useLiveDesignPreviewStore.getState();
        if (s4.currentTurn?.id !== turnId || s4.live?.answering_paused) return;
        maybeAdvanceTurn();
      });
    });
  });
}

function maybeAdvanceTurn() {
  const stillPending = [...botAnswerRemaining.values()].some((n) => n > 0);
  if (stillPending) return; // ボットの送信予定がまだ残っていれば待つ
  advanceTurn();
}

function advanceTurn() {
  const state = useLiveDesignPreviewStore.getState();
  const { groups, currentTurn } = state;
  clearAllTimers();
  const currentGroupOrder = groups.find((g) => g.id === currentTurn?.group_id)?.group_order ?? 1;
  const nextGroup = groups.find((g) => g.group_order !== currentGroupOrder) ?? groups[0];
  const nextRound =
    currentGroupOrder >= groups.length ? (currentTurn?.round ?? 1) + 1 : currentTurn?.round ?? 1;
  startTurn(nextRound, nextGroup);
}

export const useLiveDesignPreviewStore = create<LiveDesignPreviewState>()((set, get) => ({
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

  initPreview: () => {
    clearAllTimers();
    idSeq = 0;
    tsukkomiIdCounter = 0;
    const { participants, groups, participantNames } = buildRoster();
    const live: LiveRow = {
      id: PREVIEW_LIVE_ID,
      scheduled_at: new Date().toISOString(),
      rounds_per_live: 99,
      current_phase: "answering",
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
    });
    startTurn(1, groups[0]);
  },

  resetPreview: () => {
    get().initPreview();
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
