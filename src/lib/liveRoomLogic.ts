// 実バックエンド版ライブ（フェーズB）の組分け・お題割当に使うロジック。
// src/lib/liveDemoLogic.ts（ローカルモック用）と同じ考え方だが、
// 実際にDBへ書き込む行の形（group_order・topic_id等）に合わせて作り直したもの。
import { supabase } from "@/lib/supabase";
import type { TopicBankRow } from "@/lib/liveRoomTypes";

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

// 運営者専用管理画面の追加（第1段階）：お題の出典を、ハードコードの
// TOPIC_POOL(src/data/liveDemoData.ts)から、運営者が管理する
// topic_bankテーブル（お題管理画面から追加・編集・使用停止できるマスター）に
// 変更した。使用停止(is_active=false)されたお題は対象から除外する。
export async function pickRandomTopicBankEntries(
  count: number,
): Promise<Pick<TopicBankRow, "id" | "body" | "format">[]> {
  const { data, error } = await supabase
    .from("topic_bank")
    .select("id, body, format")
    .eq("is_active", true);
  if (error || !data) return [];
  return shuffle(data as Pick<TopicBankRow, "id" | "body" | "format">[]).slice(0, count);
}
