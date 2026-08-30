"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import AdminButton from "@/components/admin/AdminButton";
import AdminCard from "@/components/admin/AdminCard";
import AdminShell from "@/components/admin/AdminShell";
import { supabase } from "@/lib/supabase";

const PHASE_LABEL: Record<string, string> = {
  scheduled: "準備中（受付前）",
  interlude: "幕間（受付中）",
  opening: "開幕（参加登録受付中）",
  topic_reveal: "お題発表",
  answering: "回答受付中",
  group_result: "組結果発表",
  final_result: "最終結果発表",
};

interface DashboardState {
  loading: boolean;
  phase: string | null;
  scheduledAt: string | null;
  playerCount: number;
  maxPlayers: number | null;
  openReportCount: number;
  postsNeedingReviewCount: number;
  suspendedUserCount: number;
}

async function loadDashboard(): Promise<DashboardState> {
  const [liveRes, reportsOpenRes, reportsForPostsRes, suspendedRes] = await Promise.all([
    supabase
      .from("lives")
      .select("id, current_phase, scheduled_at, max_players")
      .neq("current_phase", "closed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("reports").select("target_id").eq("status", "open"),
    supabase
      .from("profiles")
      .select("id, is_permanently_suspended, suspended_until"),
  ]);

  let playerCount = 0;
  if (liveRes.data) {
    const { count } = await supabase
      .from("participants")
      .select("id", { count: "exact", head: true })
      .eq("live_id", liveRes.data.id)
      .eq("role", "player");
    playerCount = count ?? 0;
  }

  const postsNeedingReviewCount = new Set(
    ((reportsForPostsRes.data ?? []) as { target_id: string }[]).map((r) => r.target_id),
  ).size;

  const now = Date.now();
  const suspendedUserCount = ((suspendedRes.data ?? []) as {
    is_permanently_suspended: boolean;
    suspended_until: string | null;
  }[]).filter(
    (p) => p.is_permanently_suspended || (p.suspended_until && new Date(p.suspended_until).getTime() > now),
  ).length;

  return {
    loading: false,
    phase: liveRes.data?.current_phase ?? null,
    scheduledAt: liveRes.data?.scheduled_at ?? null,
    playerCount,
    maxPlayers: liveRes.data?.max_players ?? null,
    openReportCount: reportsOpenRes.count ?? 0,
    postsNeedingReviewCount,
    suspendedUserCount,
  };
}

// 運営者専用管理画面のトップ。上部に現在のライブ状況・未対応通報件数のサマリーを
// 出し、各メニューには必要な時だけ件数バッジを添える（要件どおり、無い時は
// バッジ自体を出さない）。
export default function AdminHomePage() {
  const [state, setState] = useState<DashboardState>({
    loading: true,
    phase: null,
    scheduledAt: null,
    playerCount: 0,
    maxPlayers: null,
    openReportCount: 0,
    postsNeedingReviewCount: 0,
    suspendedUserCount: 0,
  });

  useEffect(() => {
    let cancelled = false;
    loadDashboard().then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const menu: { label: string; description: string; href: string; badge?: string }[] = [
    {
      label: "ライブ予定",
      description: "ホーム画面・次回ライブ画面に表示する日付やライブ番号を管理します。",
      href: "/admin/schedule",
    },
    {
      label: "お知らせ配信",
      description: "全ユーザーのヘッダー通知ベルにお知らせを一斉配信します。",
      href: "/admin/notifications",
    },
    {
      label: "お題管理",
      description: "お題の追加・編集・使用停止・検索ができます。",
      href: "/admin/topics",
    },
    {
      label: "通報管理",
      description: "ユーザーからの通報を確認・対応します。",
      href: "/admin/reports",
      badge: state.openReportCount > 0 ? `未対応${state.openReportCount}件` : undefined,
    },
    {
      label: "投稿・回答管理",
      description: "SNS投稿・回答・コメントの非表示/削除を行います。",
      href: "/admin/posts",
      badge: state.postsNeedingReviewCount > 0 ? `要確認${state.postsNeedingReviewCount}件` : undefined,
    },
    {
      label: "ユーザー管理",
      description: "警告・利用停止・アカウント削除等を行います。",
      href: "/admin/users",
      badge: state.suspendedUserCount > 0 ? `停止中${state.suspendedUserCount}人` : undefined,
    },
    {
      label: "運営操作履歴",
      description: "重要な運営操作の履歴を確認します。",
      href: "/admin/logs",
    },
  ];

  return (
    <AdminShell wide>
      <h1 className="text-lg font-bold text-gray-900">運営者専用管理画面</h1>

      <AdminCard title="現在のライブ状況">
        {state.loading ? (
          <p className="text-sm text-gray-500">読み込み中…</p>
        ) : state.phase ? (
          <div className="flex flex-col gap-1 text-sm text-gray-900">
            <p className="font-bold">{PHASE_LABEL[state.phase] ?? state.phase}</p>
            {state.scheduledAt && (
              <p className="text-gray-600">
                開催日時：{new Date(state.scheduledAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
              </p>
            )}
            <p className="text-gray-600">
              参加人数：{state.playerCount}
              {state.maxPlayers != null ? ` / ${state.maxPlayers}人` : "人（上限なし）"}
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">準備中のライブはありません。</p>
        )}
        <Link href="/live/host" className="mt-3 inline-block">
          <AdminButton variant="primary">ライブ準備・操作を開く</AdminButton>
        </Link>
      </AdminCard>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {menu.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="rounded-lg border border-gray-200 bg-white p-4 text-left transition hover:border-gray-300 hover:bg-gray-50"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-gray-900">{item.label}</p>
              {item.badge && (
                <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
                  {item.badge}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500">{item.description}</p>
          </Link>
        ))}
      </div>
    </AdminShell>
  );
}
