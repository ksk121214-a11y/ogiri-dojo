// 第3段階（ステージング運営環境）：クライアントの接続先が本番Supabaseと誤って
// 一致していないかを確認するための補助。
// - NEXT_PUBLIC_APP_ENV="staging" のときだけ以下の確認を行う（本番ビルド・通常の
//   開発環境では何もしない。既存の挙動には一切影響しない）。
// - URL・キーの全文は一切ログへ出さない（Project Refだけを抜き出して使う。
//   Project Ref自体はNEXT_PUBLIC_SUPABASE_URLに元々含まれる公開情報で秘密情報ではない）。
// - クライアント側の確認（Project Refの一致）だけに頼らず、DB側のpublic._environment_marker
//   （0085で追加。リモートのステージングSupabaseへは運営がDashboard/psqlから手動で
//   1行だけ設定する想定。本番やこのmigration適用直後は空のまま）も確認する。
import { supabase } from "@/lib/supabase";

export type AppEnv = "production" | "staging" | "development";

export function getAppEnv(): AppEnv {
  const raw = process.env.NEXT_PUBLIC_APP_ENV;
  if (raw === "staging") return "staging";
  if (raw === "production") return "production";
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

export function isStagingMode(): boolean {
  return getAppEnv() === "staging";
}

// "https://<ref>.supabase.co" からProject Ref部分だけを抜き出す（それ以外は非公開情報として扱わない）。
function extractProjectRef(url: string | undefined | null): string | null {
  if (!url) return null;
  const match = /^https?:\/\/([a-z0-9-]+)\.supabase\.co/i.exec(url.trim());
  return match ? match[1].toLowerCase() : null;
}

export function getConfiguredProjectRef(): string | null {
  return extractProjectRef(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function getExpectedStagingProjectRef(): string | null {
  const ref = process.env.NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF;
  return ref ? ref.trim().toLowerCase() : null;
}

// ステージングモードで、接続先が「ローカルだけに置いた期待Project Ref」と一致しているか。
// 期待値・実際値のいずれかが取得できない場合も安全側（false）に倒す。
export function stagingProjectRefMatches(): boolean {
  const expected = getExpectedStagingProjectRef();
  const actual = getConfiguredProjectRef();
  if (!expected || !actual) return false;
  return expected === actual;
}

// DB側の確認：public._environment_marker に 'staging' 行があるか。
// テーブル自体が無い（0085未適用）・読み取り失敗の場合もok:falseにする。
export async function fetchEnvironmentMarker(): Promise<{ ok: boolean; environment: string | null }> {
  try {
    const { data, error } = await supabase
      .from("_environment_marker")
      .select("environment")
      .eq("environment", "staging")
      .maybeSingle();
    if (error) return { ok: false, environment: null };
    return { ok: true, environment: (data as { environment: string } | null)?.environment ?? null };
  } catch {
    return { ok: false, environment: null };
  }
}

// ステージング運営操作（ライブ作成・進行・周回追加・終了等）の前に必ず呼ぶ。
// staging以外のappEnvでは常にok:true（既存の本番・通常開発の挙動に影響しない）。
export async function assertStagingOperationAllowed(): Promise<{ ok: boolean; reason?: string }> {
  if (!isStagingMode()) return { ok: true };

  if (!stagingProjectRefMatches()) {
    return {
      ok: false,
      reason:
        "接続先のSupabaseプロジェクトが、ステージング用として設定した値(NEXT_PUBLIC_STAGING_SUPABASE_PROJECT_REF)と一致しません。本番への誤接続の可能性があるため運営操作を停止しました。",
    };
  }

  const marker = await fetchEnvironmentMarker();
  if (!marker.ok || marker.environment !== "staging") {
    return {
      ok: false,
      reason:
        "接続先がステージング環境であることをデータベース側(_environment_marker)で確認できませんでした。運営操作を停止しました。",
    };
  }

  return { ok: true };
}
