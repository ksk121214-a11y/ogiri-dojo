// 限定特典（称号「最初の目撃者」・限定アイコン first-witness）の対象ライブ判定。
// DB側の判定（supabase/migrations/0084 の _apply_first_live_reward / mark_final_result_presence）と
// 必ず同じ範囲にすること（official・開催番号1〜5・緊急中止されていない）。
export const LIMITED_REWARD_MAX_OFFICIAL_SEQUENCE = 5;

export function isLimitedRewardLive(
  liveMode: string | null | undefined,
  officialSequenceNumber: number | null | undefined,
  emergencyClosed: boolean | null | undefined,
): boolean {
  return (
    liveMode === "official" &&
    typeof officialSequenceNumber === "number" &&
    Number.isInteger(officialSequenceNumber) &&
    officialSequenceNumber >= 1 &&
    officialSequenceNumber <= LIMITED_REWARD_MAX_OFFICIAL_SEQUENCE &&
    !emergencyClosed
  );
}
