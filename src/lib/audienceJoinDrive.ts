import type { IntentAction, IntentContext } from "./audienceJoinIntent";

// 意図を評価し、joinと判定された場合だけjoin_liveを1回呼ぶ。完了（成功・失敗・例外）で必ず意図を終える。
export function driveAudienceJoin(
  ctx: IntentContext,
  deps: {
    evaluate: (ctx: IntentContext) => IntentAction;
    finishJoin: (token: number) => void;
    joinAudience: () => Promise<void>;
  },
): Promise<void> | null {
  const action = deps.evaluate(ctx);
  if (action.kind !== "join") return null;
  return deps
    .joinAudience()
    .catch(() => {})
    .finally(() => deps.finishJoin(action.token));
}
