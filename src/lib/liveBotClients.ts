// ボット参加者ごとに独立したSupabaseクライアントを作るヘルパー。
// persistSession:falseが必須条件：trueだと司会自身のログインセッションと同じ
// localStorageキーを奪い合って壊れてしまう（/Users/keisuke/.claude/plans/typed-popping-cerf.md参照）。
// ボットは自分自身の認証済みクライアントとして参加者・回答・採点を書き込むため、
// service_role等の特別な権限は一切不要（既存のRLSにそのまま合致する）。
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function createBotClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

export interface BotSession {
  participantId: string;
  userId: string;
  displayName: string;
  client: SupabaseClient;
}
