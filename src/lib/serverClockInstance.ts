// アプリ全体で共有するサーバー同期時計の実体（Supabaseのget_live_server_time RPCを使う）。
import { createServerClock } from "./serverClock";
import { supabase } from "./supabase";

export const serverClock = createServerClock({
  perfNow: () => performance.now(),
  fallbackNow: () => Date.now(),
  fetchServerEpochMs: async () => {
    const { data, error } = await supabase.rpc("get_live_server_time");
    if (error || typeof data !== "string") throw error ?? new Error("invalid server time");
    const ms = new Date(data).getTime();
    if (!Number.isFinite(ms)) throw new Error("invalid server time");
    return ms;
  },
});
