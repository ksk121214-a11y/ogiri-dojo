import { supabase } from "@/lib/supabase";

// Xシェアボタンが押された回数の記録（share_click_events）。
// 集客施策の効果測定用の裏側の記録に過ぎないため、失敗してもシェア自体は
// 止めない（logAdminActionと同じ「補助記録はconsole.warnに留める」方針）。
// 2026-09-02: 直接INSERTだとuser_idを自由に指定でき分析データを偽装できたため、
// log_share_click RPC（0045）経由に変更した。user_idはRPC側がauth.uid()から
// 自分で取得するため、クライアントからは一切渡さない（渡せない）。
export type ShareClickContext = "live_schedule" | "live_result" | "final_result";

export function logShareClick(context: ShareClickContext): void {
  supabase.rpc("log_share_click", { p_context: context }).then(({ error }) => {
    if (error) console.warn("[shareAnalytics] 記録に失敗", { context, error });
  });
}
