import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

// Xシェアボタンが押された回数の記録（share_click_events）。
// 集客施策の効果測定用の裏側の記録に過ぎないため、失敗してもシェア自体は
// 止めない（logAdminActionと同じ「補助記録はconsole.warnに留める」方針）。
export type ShareClickContext = "live_schedule" | "live_result" | "final_result";

export function logShareClick(context: ShareClickContext): void {
  const userId = useAuthStore.getState().user?.id ?? null;
  supabase
    .from("share_click_events")
    .insert({ context, user_id: userId })
    .then(({ error }) => {
      if (error) console.warn("[shareAnalytics] 記録に失敗", { context, error });
    });
}
