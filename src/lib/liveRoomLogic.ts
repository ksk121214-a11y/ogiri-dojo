// 実バックエンド版ライブ（フェーズB）の組分け・お題割当に使う純粋ロジック。
// src/lib/liveDemoLogic.ts（ローカルモック用）と同じ考え方だが、
// 実際にDBへ書き込む行の形（group_order・topic_id等）に合わせて作り直したもの。
import { TOPIC_POOL } from "@/data/liveDemoData";

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 参加者IDの配列を、指定した組数にランダムかつ均等に振り分ける（余りは前の組から1人ずつ）。
export function assignParticipantsToGroups(
  participantIds: string[],
  groupCount: number,
): string[][] {
  const shuffled = shuffle(participantIds);
  const total = shuffled.length;
  const base = Math.floor(total / groupCount);
  const remainder = total % groupCount;

  const groups: string[][] = [];
  let cursor = 0;
  for (let i = 0; i < groupCount; i += 1) {
    const size = base + (i < remainder ? 1 : 0);
    groups.push(shuffled.slice(cursor, cursor + size));
    cursor += size;
  }
  return groups;
}

// 組数×周回数ぶんのお題本文をランダムに選ぶ。
export function pickTopicBodies(count: number): string[] {
  return shuffle(TOPIC_POOL).slice(0, count);
}
