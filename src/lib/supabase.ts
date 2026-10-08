import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// output: "export"の完全静的サイトのため、@supabase/ssr(Cookie+Middleware前提)は使わず、
// ブラウザ標準のセッション永続化(localStorage)のままクライアント完結で認証を扱う。
// detectSessionInUrlは無効：X認証のフラグメント（implicitフロー）は、/auth/callbackページが
// src/lib/authCallback.tsの処理で明示的に読み取り・保存する。ライブラリの自動検出と競合させない。
// （Xログイン以外でURLのトークンを使う経路は無い。ボットのクライアントも同じ理由で無効。）
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
