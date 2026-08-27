// このブラウザタブでの滞在中に、開幕の緞帳(カーテン)演出を一度でも見たかどうかの共有フラグ。
// 通常はinterludeフェーズ(InterludeScreen)で1回見るが、interludeを過ぎてから
// openingフェーズに途中参加した人はそれを見る機会が無いため、OpeningView側でも
// 「まだ見ていなければここで1回見せる」ために参照する。
let seen = false;

export function hasSeenCurtain(): boolean {
  return seen;
}

export function markCurtainSeen(): void {
  seen = true;
}
