// 実ライブ（src/components/live-room）と体験版（src/components/live-demo）で、同じ表示計算を
// 使うための純粋関数。体験版だけ別の計算になる乖離を防ぐため、両方からここを呼ぶ。
// 実ライブ側の挙動を変えない（式そのものは従来のインライン計算と同じ）。

// 採点ボードの玉の数（審査員数×3。最低3）。
export function maxBallsFor(eligibleJudgeCount: number): number {
  return Math.max(3, eligibleJudgeCount * 3);
}

// 審査員の数：プレイヤー（参加者）のうち、このターンの組（舞台）に出ていない人の数。
export function eligibleJudgeCountFor(playerIds: string[], stageMemberIds: string[]): number {
  return playerIds.filter((id) => !stageMemberIds.includes(id)).length;
}

// 確定済みの回答が満点か（評価権のある全員が、最高点を付けたか）。未確定はnull（判定しない）。
//   judgeCount：評価権のある人数（回答者本人・組に出ている人は含まない）。0人なら満点ではない。
//   topScoreVotes：最高点を付けた人数。評価していない人は含まれないため、
//   topScoreVotes === judgeCount は「評価権のある全員が評価済みで、全員が最高点」を意味する。
export function confirmedPerfectFor(resolved: boolean, judgeCount: number, topScoreVotes: number): boolean | null {
  if (!resolved) return null;
  return judgeCount > 0 && topScoreVotes === judgeCount;
}

// 採点ボードが金色の満点演出をしてよいか。確定前（null）や満点でない（false）は金色にしない。
export function isConfirmedPerfect(confirmed: boolean | null): boolean {
  return confirmed === true;
}

// 体験版の満点判定。採点開始時点で評価権を持つ全員（eligibleJudgeIds）を分母にする。
// 評価を送信しなかった人は0点として扱い、分母から消さない。未評価者が1人でもいれば満点ではない。
// 未確定はnull（判定しない）。
export const MAX_JUDGE_POINTS = 3;

export function perfectFromEligibleJudges(
  resolved: boolean,
  eligibleJudgeIds: string[],
  scoresByJudgeId: Record<string, number>,
): boolean | null {
  if (!resolved) return null;
  if (eligibleJudgeIds.length === 0) return false;
  return eligibleJudgeIds.every((id) => scoresByJudgeId[id] === MAX_JUDGE_POINTS);
}
