// grant_first_live_reward / _apply_first_live_reward / admin_regrant_first_live_reward
// （supabase/migrations/0081）はいずれもfirst_live_reward_result型
// （newly_granted: boolean, title_display_name: text）を返す。
// 2026-09-28（レビュー対応）：error=nullでもdataがnull・空オブジェクト・
// 型不正（newly_grantedがboolean以外、title_display_nameが空/非文字列）の場合を
// 「成功」として扱ってしまうと、completedKeysへ誤って記録したり、管理画面で
// 「既に付与済み」と誤表示したりする恐れがある。呼び出し元（ストア・管理画面）は
// 必ずこの関数で戻り値の形を確認してから使う。
export interface FirstLiveRewardRpcData {
  newly_granted: boolean;
  title_display_name: string;
}

export function isValidFirstLiveRewardRpcData(data: unknown): data is FirstLiveRewardRpcData {
  if (data === null || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return typeof d.newly_granted === "boolean" && typeof d.title_display_name === "string" && d.title_display_name.length > 0;
}
