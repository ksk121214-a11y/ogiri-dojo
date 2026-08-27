import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// output: "export"の完全静的サイトのため、@supabase/ssr(Cookie+Middleware前提)は使わず、
// ブラウザ標準のセッション永続化(localStorage)のままクライアント完結で認証を扱う。
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
