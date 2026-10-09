// 次の周のお題を「登録済みのお題（topic_bank）から選ぶ」ときの候補一覧を組み立てる
// 純粋関数（src/app/live/host/page.tsxのRoundDecisionPanelから使う）。
//
// 重複防止のルール：
// ・このライブで既に使われた登録済みのお題（topic_bank_idで判定）は候補から除外する。
// ・旧データ・手入力経由で登録済みのお題と同じ本文になっている既存topicsも、
//   trim済み本文で重複と見なして候補から除外する（topic_bank_idが無くても防ぐ）。
// ・同じ次回ラウンド内では、1つの登録済みのお題を複数の組へ重複選択できないように、
//   他の組が今まさに選んでいるtopic_bank_idも候補から除外する。
// 手入力（topic_bank_idを選ばない）は、この絞り込みの対象外として常に可能。
export interface ExistingTopicRef {
  topic_bank_id: string | null;
  body: string;
}

export function usedTopicBankIdSet(existingTopics: readonly ExistingTopicRef[]): Set<string> {
  return new Set(existingTopics.map((t) => t.topic_bank_id).filter((id): id is string => id !== null));
}

export function usedBodySet(existingTopics: readonly ExistingTopicRef[]): Set<string> {
  return new Set(existingTopics.map((t) => t.body.trim()));
}

export function candidatesForGroup<T extends { id: string; body: string }>(
  topicBank: readonly T[],
  usedTopicBankIds: ReadonlySet<string>,
  usedBodies: ReadonlySet<string>,
  pickedByOtherGroups: ReadonlySet<string>,
): T[] {
  return topicBank.filter(
    (tb) => !usedTopicBankIds.has(tb.id) && !usedBodies.has(tb.body.trim()) && !pickedByOtherGroups.has(tb.id),
  );
}
