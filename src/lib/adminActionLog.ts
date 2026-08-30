// 運営操作履歴(admin_action_logs)への記録ヘルパー。
// 管理画面の各操作（ライブ作成・受付開始・ゲーム開始・終了・組分け・お題変更・
// 運営メッセージ送信 等）の末尾から呼ぶ。一覧表示UIは第3段階(/admin/logs)で作るが、
// 記録自体は第1段階の実装から行っておく。
// 失敗してもその操作自体を失敗させたくないため、エラーはconsole.warnに留める
// （運営操作履歴はあくまで補助記録であり、これが原因で本来の操作が止まると
// 本末転倒なため）。
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

export async function logAdminAction(params: {
  action: string;
  targetType?: string;
  targetId?: string;
  reason?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const actorId = useAuthStore.getState().user?.id ?? null;
  const { error } = await supabase.from("admin_action_logs").insert({
    actor_id: actorId,
    action: params.action,
    target_type: params.targetType ?? null,
    target_id: params.targetId ?? null,
    reason: params.reason ?? null,
    detail: params.detail ?? null,
  });
  if (error) {
    console.warn("[adminActionLog] 記録に失敗", { params, error });
  }
}
