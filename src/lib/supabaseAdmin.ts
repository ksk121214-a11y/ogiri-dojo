// サーバー専用（Next.js API Route等、"use server"文脈）のSupabase管理クライアント。
// service_roleキーはブラウザに一切送られない環境変数（SUPABASE_SERVICE_ROLE_KEY、
// NEXT_PUBLIC_を付けない）からのみ読み込む。このファイル自体を"use client"な
// コンポーネント・ストアからimportしないこと（他のsrc/lib/supabase.tsはanonキーの
// クライアントで、通常の画面表示・書き込みは引き続きそちらを使う）。
//
// 現時点ではアカウント完全削除（auth.admin.deleteUser、GoTrue管理APIが必要で
// security definer関数だけでは代替できない）専用に使う想定で、他の管理操作は
// 従来どおりRPC/RLSで完結させる。
import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY（またはNEXT_PUBLIC_SUPABASE_URL）が設定されていません");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
