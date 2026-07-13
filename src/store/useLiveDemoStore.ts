// 「大喜利道場」ライブ体験モックのローカル状態管理（Zustand）。
// 本来はSupabase Realtimeでサーバ基準のライブ状態を同期する想定（仕様書 §1.4・§13）だが、
// このモックでは1台のブラウザ内でステートマシンとボットの挙動をすべてシミュレートする。
// 画面側は必ずこのストアの操作関数経由で状態を変更する（大喜利育成のuseGameStoreと同様の方針）。

import { create } from "zustand";

import {
  DEMO_TIMING,
  MAX_ANSWERS_PER_PLAYER,
  MY_PARTICIPANT_ID,
} from "@/data/liveDemoData";
import {
  buildParticipantsAndGroups,
  buildTopics,
  buildTurns,
  genId,
  generateBotAnswerSchedule,
  randomBotAnswerBody,
  randomBotScore,
  randomDelay,
} from "@/lib/liveDemoLogic";
import type {
  DemoAnswer,
  DemoGroup,
  DemoParticipant,
  DemoScore,
  DemoTopic,
  DemoTurn,
  JudgingState,
  LivePhase,
  RevealPending,
} from "@/types/liveDemo";

interface QueueItem {
  participantId: string;
  body: string;
}

interface BotScheduleEvent {
  participantId: string;
  targetRemainingMs: number;
}

// 客席のツッコミ・拍手演出。舞台・客席の両画面で購読して表示するためグローバルに持つ（§9）
export interface TsukkomiEvent {
  id: number;
  kind: "clap" | "stamp";
  text: string;
}

export interface LiveDemoState {
  status: "idle" | "running";
  phase: LivePhase;
  phaseEndsAt: number | null; // interlude/opening/topic_reveal/group_resultの自動送りに使う締切時刻

  participants: DemoParticipant[];
  groups: DemoGroup[];
  topics: DemoTopic[];
  turns: DemoTurn[];
  currentTurnIndex: number;

  answers: DemoAnswer[];
  scores: DemoScore[];

  answeringRemainingMs: number; // 持ち時間の残り（審査サイクル中はpauseする§1.1）
  answerCounts: Record<string, number>;
  submissionQueue: QueueItem[]; // 送信の排他キュー §1.4
  botAnswerSchedule: BotScheduleEvent[];

  judging: JudgingState | null;
  revealPending: RevealPending | null; // 送信直後・前の審査サイクル終了直後の「一呼吸」（§1.1改訂）
  myPendingScore: 0 | 1 | 2 | 3 | null;

  laughEventSeq: number; // 発生のたびに+1、演出コンポーネントの再トリガーに使う
  lastLaughAnswerId: string | null;

  tsukkomiSeq: number; // 発生のたびに+1、舞台・客席どちらの演出コンポーネントも購読して再トリガーする
  lastTsukkomi: TsukkomiEvent | null;

  lastTickAt: number | null;

  startLive: () => void;
  resetLive: () => void;
  closeLive: () => void;
  tick: (nowMs: number) => void;
  submitMyAnswer: (body: string) => { ok: boolean; reason?: string };
  submitMyScore: (points: 0 | 1 | 2 | 3) => void;
  scoreAnswer: (
    judgeParticipantId: string,
    answerId: string,
    points: 0 | 1 | 2 | 3,
  ) => void;
  sendTsukkomi: (kind: "clap" | "stamp", text: string) => void;
}

const IDLE_STATE = {
  status: "idle" as const,
  phase: "interlude" as LivePhase,
  phaseEndsAt: null,
  participants: [],
  groups: [],
  topics: [],
  turns: [],
  currentTurnIndex: -1,
  answers: [],
  scores: [],
  answeringRemainingMs: DEMO_TIMING.answerMs,
  answerCounts: {},
  submissionQueue: [],
  botAnswerSchedule: [],
  judging: null,
  revealPending: null,
  myPendingScore: null,
  laughEventSeq: 0,
  lastLaughAnswerId: null,
  tsukkomiSeq: 0,
  lastTsukkomi: null,
  lastTickAt: null,
};

export const useLiveDemoStore = create<LiveDemoState>()((set, get) => {
  // ---- 内部ヘルパー（審査サイクル・キュー処理・フェーズ送り） ----

  // 送信済みキューの先頭を「一呼吸」の待機状態に移すだけで、まだ回答は作らない・審査も始めない。
  // 実際の回答生成と審査開始はrevealDelayMs経過後にrevealNow()が行う（§1.1改訂：一呼吸置いてから回答表示）。
  function processQueue(now: number) {
    const state = get();
    if (state.judging !== null) return;
    if (state.revealPending !== null) return;
    if (state.submissionQueue.length === 0) return;

    const [item, ...rest] = state.submissionQueue;
    set({
      submissionQueue: rest,
      revealPending: {
        participantId: item.participantId,
        body: item.body,
        revealAt: now + DEMO_TIMING.revealDelayMs,
      },
    });
  }

  // 一呼吸の待機が明けたら実際に回答を生成し、審査サイクルを開始する。
  function revealNow(now: number) {
    const state = get();
    const pending = state.revealPending;
    if (!pending) return;
    const turn = state.turns[state.currentTurnIndex];
    if (!turn) {
      set({ revealPending: null });
      return;
    }
    const stageGroup = state.groups.find((g) => g.id === turn.groupId);
    if (!stageGroup) {
      set({ revealPending: null });
      return;
    }

    const seq = (state.answerCounts[pending.participantId] ?? 0) + 1;
    const judgeCount = state.participants.filter(
      (p) => !stageGroup.memberIds.includes(p.id),
    ).length;

    const answer: DemoAnswer = {
      id: genId("a"),
      turnId: turn.id,
      groupId: turn.groupId,
      participantId: pending.participantId,
      seq,
      body: pending.body,
      scoreTotal: 0,
      topScoreVotes: 0,
      judgeCount,
      laughTriggered: false,
      createdAt: now,
    };
    const endsAt = now + DEMO_TIMING.judgeMs;

    set({
      revealPending: null,
      answers: [...state.answers, answer],
      answerCounts: { ...state.answerCounts, [pending.participantId]: seq },
      judging: { answerId: answer.id, endsAt, judgeCount },
      myPendingScore: null,
    });

    // ボット審査員が0〜10秒（デモは6秒）以内にランダムなタイミングで採点する §4.1
    const botJudges = state.participants.filter(
      (p) => !stageGroup.memberIds.includes(p.id) && !p.isTestUser,
    );
    for (const judge of botJudges) {
      const delay = randomDelay(400, DEMO_TIMING.judgeMs - 600);
      setTimeout(() => {
        get().scoreAnswer(judge.id, answer.id, randomBotScore());
      }, delay);
    }
  }

  function resolveJudging(now: number) {
    const state = get();
    const judging = state.judging;
    if (!judging) return;

    const relevantScores = state.scores.filter(
      (s) => s.answerId === judging.answerId,
    );
    const scoreTotal = relevantScores.reduce((sum, s) => sum + s.points, 0);
    // 2026-07-14改訂：採点を0〜2点の3段階から0〜3点の4段階に変更。
    // 笑いエフェクトのトリガーも「2点」から最高点の「3点（大ウケ）」の過半数に変更 §4.3
    const topScoreVotes = relevantScores.filter((s) => s.points === 3).length;
    const laughTriggered = topScoreVotes > Math.floor(judging.judgeCount / 2);

    const answers = state.answers.map((a) =>
      a.id === judging.answerId
        ? { ...a, scoreTotal, topScoreVotes, laughTriggered }
        : a,
    );

    set({
      answers,
      judging: null,
      myPendingScore: null,
      ...(laughTriggered
        ? {
            lastLaughAnswerId: judging.answerId,
            laughEventSeq: state.laughEventSeq + 1,
          }
        : {}),
    });

    // キューに次の送信が残っていれば続けて審査サイクルへ
    processQueue(now);
  }

  function startTurn(index: number, now: number) {
    set({
      currentTurnIndex: index,
      phase: "topic_reveal",
      phaseEndsAt: now + DEMO_TIMING.topicRevealMs,
      judging: null,
      revealPending: null,
      myPendingScore: null,
    });
  }

  function startAnswering() {
    const state = get();
    const turn = state.turns[state.currentTurnIndex];
    if (!turn) return;
    const stageGroup = state.groups.find((g) => g.id === turn.groupId);
    if (!stageGroup) return;

    const botMemberIds = stageGroup.memberIds.filter(
      (id) => id !== MY_PARTICIPANT_ID,
    );
    const schedule = generateBotAnswerSchedule(
      botMemberIds,
      DEMO_TIMING.answerMs,
    );
    const counts: Record<string, number> = {};
    stageGroup.memberIds.forEach((id) => {
      counts[id] = 0;
    });

    set({
      phase: "answering",
      phaseEndsAt: null,
      answeringRemainingMs: DEMO_TIMING.answerMs,
      answerCounts: counts,
      submissionQueue: [],
      botAnswerSchedule: schedule,
      judging: null,
      revealPending: null,
      myPendingScore: null,
    });
  }

  function advancePhase(now: number) {
    const state = get();
    switch (state.phase) {
      case "interlude": {
        set({ phase: "opening", phaseEndsAt: now + DEMO_TIMING.openingMs });
        break;
      }
      case "opening": {
        startTurn(0, now);
        break;
      }
      case "topic_reveal": {
        startAnswering();
        break;
      }
      case "group_result": {
        const nextIndex = state.currentTurnIndex + 1;
        if (nextIndex < state.turns.length) {
          startTurn(nextIndex, now);
        } else {
          set({ phase: "final_result", phaseEndsAt: null });
        }
        break;
      }
      default:
        break;
    }
  }

  function tickAnswering(now: number, dt: number) {
    const state = get();
    const turn = state.turns[state.currentTurnIndex];
    if (!turn) return;
    const stageGroup = state.groups.find((g) => g.id === turn.groupId);
    if (!stageGroup) return;

    const remainingMs = Math.max(0, state.answeringRemainingMs - dt);

    // しきい値を過ぎたボット回答者を送信キューへ積む
    const ready = state.botAnswerSchedule.filter(
      (ev) => ev.targetRemainingMs >= remainingMs,
    );
    const rest = state.botAnswerSchedule.filter(
      (ev) => ev.targetRemainingMs < remainingMs,
    );
    let queue = state.submissionQueue;
    if (ready.length > 0) {
      const additions = ready
        .filter((ev) => {
          const already =
            (state.answerCounts[ev.participantId] ?? 0) +
            queue.filter((q) => q.participantId === ev.participantId).length;
          return already < MAX_ANSWERS_PER_PLAYER;
        })
        .map((ev) => ({
          participantId: ev.participantId,
          body: randomBotAnswerBody(),
        }));
      queue = [...queue, ...additions];
    }

    set({
      answeringRemainingMs: remainingMs,
      botAnswerSchedule: rest,
      submissionQueue: queue,
    });

    processQueue(now);

    const after = get();
    const allExhausted = stageGroup.memberIds.every(
      (id) => (after.answerCounts[id] ?? 0) >= MAX_ANSWERS_PER_PLAYER,
    );
    if (
      after.judging === null &&
      after.revealPending === null &&
      after.submissionQueue.length === 0 &&
      (remainingMs <= 0 || allExhausted)
    ) {
      set({ phase: "group_result", phaseEndsAt: now + DEMO_TIMING.groupResultMs });
    }
  }

  return {
    ...IDLE_STATE,

    startLive: () => {
      const { participants, groups } = buildParticipantsAndGroups();
      const topics = buildTopics();
      const turns = buildTurns(groups, topics);
      const now = Date.now();
      set({
        ...IDLE_STATE,
        status: "running",
        phase: "interlude",
        phaseEndsAt: now + DEMO_TIMING.interludeMs,
        participants,
        groups,
        topics,
        turns,
        lastTickAt: now,
      });
    },

    resetLive: () => {
      set({ ...IDLE_STATE });
    },

    closeLive: () => {
      set({ phase: "closed", phaseEndsAt: null });
    },

    tick: (now: number) => {
      const state = get();
      if (state.status !== "running") return;
      const lastTickAt = state.lastTickAt ?? now;
      const dt = Math.max(0, now - lastTickAt);
      set({ lastTickAt: now });

      if (state.judging) {
        // 表示上のカウントダウンはendsAtで0になるが、実際に締め切るのはjudgeGraceMsぶん後。
        // 「0になった瞬間でもギリギリ滑り込みで採点できる」余地を持たせる（2026-07-14追加）。
        if (now >= state.judging.endsAt + DEMO_TIMING.judgeGraceMs) {
          resolveJudging(now);
        }
        return; // 採点中は持ち時間タイマーを進めない（pause方式 §1.1）
      }

      if (state.revealPending) {
        if (now >= state.revealPending.revealAt) {
          revealNow(now);
        }
        return; // 一呼吸置いている間も持ち時間タイマーを止める（審査中と同様の扱い）
      }

      if (state.phase === "answering") {
        tickAnswering(now, dt);
        return;
      }

      if (state.phaseEndsAt !== null && now >= state.phaseEndsAt) {
        advancePhase(now);
      }
    },

    submitMyAnswer: (body: string) => {
      const state = get();
      if (state.phase !== "answering") {
        return { ok: false, reason: "今は回答できません" };
      }
      const turn = state.turns[state.currentTurnIndex];
      if (!turn) return { ok: false, reason: "進行エラーです" };
      const stageGroup = state.groups.find((g) => g.id === turn.groupId);
      if (!stageGroup || !stageGroup.memberIds.includes(MY_PARTICIPANT_ID)) {
        return { ok: false, reason: "あなたの組の番ではありません" };
      }
      const used = state.answerCounts[MY_PARTICIPANT_ID] ?? 0;
      const queuedByMe = state.submissionQueue.filter(
        (q) => q.participantId === MY_PARTICIPANT_ID,
      ).length;
      if (used + queuedByMe >= MAX_ANSWERS_PER_PLAYER) {
        return { ok: false, reason: "回答できる回数の上限です" };
      }
      const trimmed = body.trim();
      if (!trimmed) return { ok: false, reason: "回答を入力してください" };

      // 入力・編集はいつでも可能。排他制御されるのは送信（キュー投入）のみ §6：
      // 審査サイクル中でもキューには積み、processQueueは審査中は何もせず待機する。
      set({
        submissionQueue: [
          ...state.submissionQueue,
          { participantId: MY_PARTICIPANT_ID, body: trimmed },
        ],
      });
      processQueue(Date.now());
      return { ok: true };
    },

    scoreAnswer: (judgeParticipantId, answerId, points) => {
      const state = get();
      // 締切済み・対象が入れ替わっている採点は破棄する（§4.6：枠外の採点は破棄）
      if (!state.judging || state.judging.answerId !== answerId) return;
      const judging = state.judging;
      const filtered = state.scores.filter(
        (s) =>
          !(s.answerId === answerId && s.judgeParticipantId === judgeParticipantId),
      );
      const nextScores = [...filtered, { answerId, judgeParticipantId, points }];
      set({
        scores: nextScores,
        ...(judgeParticipantId === MY_PARTICIPANT_ID
          ? { myPendingScore: points }
          : {}),
      });

      // 早期確定：採点権を持つ審査員全員が投票し終えたら10秒を待たず即座に締め切る（§1.1・§4.1）
      const votedJudgeCount = new Set(
        nextScores
          .filter((s) => s.answerId === answerId)
          .map((s) => s.judgeParticipantId),
      ).size;
      if (votedJudgeCount >= judging.judgeCount) {
        resolveJudging(Date.now());
      }
    },

    submitMyScore: (points) => {
      const state = get();
      if (!state.judging) return;
      const turn = state.turns[state.currentTurnIndex];
      if (!turn) return;
      const stageGroup = state.groups.find((g) => g.id === turn.groupId);
      // 自分が舞台に立っている間は採点しない §4.1
      if (stageGroup && stageGroup.memberIds.includes(MY_PARTICIPANT_ID)) return;
      get().scoreAnswer(MY_PARTICIPANT_ID, state.judging.answerId, points);
    },

    sendTsukkomi: (kind, text) => {
      const state = get();
      const id = state.tsukkomiSeq + 1;
      set({
        tsukkomiSeq: id,
        lastTsukkomi: { id, kind, text },
      });
    },
  };
});
