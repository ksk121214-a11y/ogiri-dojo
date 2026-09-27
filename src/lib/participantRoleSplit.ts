// 参加登録受付画面の「現在の参加者」を、プレイヤー希望／観客希望に分ける。
// 分類はpreferred_role基準（ゲスト観客もaudience側preferred_roleのため自然に観客に入る）。
// 対象となる参加者の集合（呼び出し元が渡した配列）自体は変えず、2つに分けるだけ。
// alias importに依存しないよう独立したファイルにする（src/lib/__tests__/run.shの
// plain tsc実行はpathエイリアスを解決できないため）。
export function splitParticipantsByPreferredRole<T extends { preferred_role: "player" | "audience" }>(
  participants: T[],
): { players: T[]; audience: T[] } {
  const players: T[] = [];
  const audience: T[] = [];
  for (const p of participants) {
    if (p.preferred_role === "player") players.push(p);
    else audience.push(p);
  }
  return { players, audience };
}
