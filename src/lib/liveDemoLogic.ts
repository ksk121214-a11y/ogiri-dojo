// ライブ体験モックの純粋ロジック（組分け・お題割当・ボット挙動の生成）。
// ストア（状態管理）から呼び出される副作用のない関数群。

import {
  BOT_ANSWER_POOL,
  BOT_NAMES,
  GROUP_COUNT,
  MAX_ANSWERS_PER_PLAYER,
  MY_DISPLAY_NAME,
  MY_PARTICIPANT_ID,
  ROUNDS_PER_LIVE,
  TOPIC_POOL,
} from "@/data/liveDemoData";
import type {
  DemoGroup,
  DemoParticipant,
  DemoTopic,
  DemoTurn,
} from "@/types/liveDemo";

let idCounter = 0;
export function genId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 参加者・組分けを生成する（仕様書 §2・§3：完全ランダム自動割当、均等割り、余りは前の組から配分）
export function buildParticipantsAndGroups(): {
  participants: DemoParticipant[];
  groups: DemoGroup[];
} {
  const botParticipants: DemoParticipant[] = BOT_NAMES.map((name) => ({
    id: genId("p"),
    displayName: name,
    isTestUser: false,
    groupId: "", // 後で割当
  }));
  const me: DemoParticipant = {
    id: MY_PARTICIPANT_ID,
    displayName: MY_DISPLAY_NAME,
    isTestUser: true,
    groupId: "",
  };
  const shuffledMembers = shuffle([...botParticipants, me]);
  const total = shuffledMembers.length;
  const base = Math.floor(total / GROUP_COUNT);
  const remainder = total % GROUP_COUNT;

  const groupOrders = shuffle(
    Array.from({ length: GROUP_COUNT }, (_, i) => i + 1),
  );

  const groups: DemoGroup[] = [];
  let cursor = 0;
  for (let i = 0; i < GROUP_COUNT; i += 1) {
    const size = base + (i < remainder ? 1 : 0); // 余りは前の組から1人ずつ配分
    const groupId = genId("g");
    const members = shuffledMembers.slice(cursor, cursor + size);
    members.forEach((p) => {
      p.groupId = groupId;
    });
    groups.push({
      id: groupId,
      order: groupOrders[i],
      memberIds: members.map((p) => p.id),
    });
    cursor += size;
  }
  groups.sort((a, b) => a.order - b.order);

  return { participants: [...botParticipants, me], groups };
}

// お題セットを生成する（組数×周回数ぶん §8.1）
export function buildTopics(): DemoTopic[] {
  const need = GROUP_COUNT * ROUNDS_PER_LIVE;
  const pool = shuffle(TOPIC_POOL).slice(0, need);
  return pool.map((body) => ({ id: genId("t"), body }));
}

// ターン（組×周の登壇）を round → group.order の順で生成する（§1.3・§13）
export function buildTurns(
  groups: DemoGroup[],
  topics: DemoTopic[],
): DemoTurn[] {
  const orderedGroups = [...groups].sort((a, b) => a.order - b.order);
  const turns: DemoTurn[] = [];
  let topicCursor = 0;
  for (let round = 1; round <= ROUNDS_PER_LIVE; round += 1) {
    for (const group of orderedGroups) {
      const topic = topics[topicCursor];
      topicCursor += 1;
      turns.push({
        id: genId("turn"),
        round,
        groupId: group.id,
        groupOrder: group.order,
        topicId: topic.id,
      });
    }
  }
  return turns;
}

// 採点のランダム分布（多少の偏りをつける：0点よりは1〜2点が出やすい寄席らしい甘め判定、
// 3点は「大ウケ」枠のため出現率を絞る。2026-07-14改訂：0〜2点の3段階→0〜3点の4段階に変更）
export function randomBotScore(): 0 | 1 | 2 | 3 {
  const r = Math.random();
  if (r < 0.15) return 0;
  if (r < 0.45) return 1;
  if (r < 0.8) return 2;
  return 3;
}

export function randomBotAnswerBody(): string {
  return BOT_ANSWER_POOL[Math.floor(Math.random() * BOT_ANSWER_POOL.length)];
}

// ボット回答者の送信スケジュールを生成する。
// 「持ち時間の残りms」がしきい値を下回った時点で送信させることで、
// 審査サイクルによるタイマー停止（pause）を自然に考慮できる（§1.1・§1.4）。
export function generateBotAnswerSchedule(
  botMemberIds: string[],
  answerMs: number,
): { participantId: string; targetRemainingMs: number }[] {
  const schedule: { participantId: string; targetRemainingMs: number }[] = [];
  for (const participantId of botMemberIds) {
    // 1〜最大回答数の範囲でランダムに送信回数を決める（多め寄りに偏らせる）
    const count = 1 + Math.floor(Math.random() * MAX_ANSWERS_PER_PLAYER);
    const targets = new Set<number>();
    while (targets.size < count) {
      // 持ち時間のうち序盤〜終盤にランダムに散らす（あまり終了間際に集中しすぎないよう余白を残す）
      const targetRemaining = Math.floor(
        Math.random() * answerMs * 0.85 + answerMs * 0.05,
      );
      targets.add(targetRemaining);
    }
    for (const targetRemainingMs of targets) {
      schedule.push({ participantId, targetRemainingMs });
    }
  }
  // 残り時間が多い（＝早く送信する）順に並べておく
  return schedule.sort((a, b) => b.targetRemainingMs - a.targetRemainingMs);
}

export function randomDelay(minMs: number, maxMs: number): number {
  return minMs + Math.random() * Math.max(0, maxMs - minMs);
}
