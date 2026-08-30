// アカウント完全削除の専用エンドポイント（運営者専用管理画面・第3段階）。
// ブラウザは直接Supabaseのservice_roleキーを使わず、この1エンドポイントのみを
// 経由する。ここではNode.jsランタイムで動くAPI Routeとして、
// 1) 呼び出し元のアクセストークンを検証し、
// 2) そのユーザーがprofiles.role==='admin'であることをサーバー側で確認してから、
// 3) service_roleクライアントでauth.admin.deleteUser()を呼ぶ。
// 他の管理操作（警告・停止・非表示等）は全てRPC/RLSで完結させており、
// service_roleを必要とするのはこの「auth.usersそのものの削除」だけ。
import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: targetUserId } = await params;

  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!accessToken) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ error: "サーバー設定が不足しています" }, { status: 500 });
  }

  // 呼び出し元のトークンでユーザーを検証する（anonキー+ユーザーのトークンなので、
  // 検証結果は本人のものだけが返る＝なりすまし不可）。
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return NextResponse.json({ error: "認証情報が無効です" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await callerClient
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();
  if (profileError || profile?.role !== "admin") {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  let adminClient;
  try {
    adminClient = createSupabaseAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "サーバー設定エラー" }, { status: 500 });
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetUserId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
