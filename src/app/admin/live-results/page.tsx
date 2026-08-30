"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AdminCard from "@/components/admin/AdminCard";
import AdminHeader from "@/components/admin/AdminHeader";
import AdminShell from "@/components/admin/AdminShell";
import { formatLiveTicketNo } from "@/lib/liveTicketNo";
import { toLiveScheduleDate } from "@/lib/liveDateFormat";
import { supabase } from "@/lib/supabase";

interface LiveRowLite {
  id: string;
  sequence_number: number;
  title: string | null;
  scheduled_at: string;
  ended_at: string | null;
  results_published: boolean;
}

// ライブ結果（SNS掲載）管理画面・一覧。終了済み(current_phase='closed')のライブだけを
// 新しい順に出し、各行から詳細（掲載内容の設定・公開）へ進む。
// 終了前のライブはそもそもここに出てこないため、完了条件1（終了前は公開できない）は
// この一覧の絞り込みと詳細ページ側の両方で担保される。
export default function AdminLiveResultsPage() {
  const [lives, setLives] = useState<LiveRowLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("lives")
        .select("id, sequence_number, title, scheduled_at, ended_at, results_published")
        .eq("current_phase", "closed")
        .order("scheduled_at", { ascending: false })
        .limit(50);
      if (!cancelled) {
        setLives((data ?? []) as LiveRowLite[]);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AdminShell wide>
      <AdminHeader title="ライブ結果（SNS掲載）" />

      <AdminCard title={`終了済みライブ（${lives.length}件）`}>
        {loading ? (
          <p className="text-sm text-gray-500">読み込み中…</p>
        ) : lives.length === 0 ? (
          <p className="text-sm text-gray-500">終了したライブがありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lives.map((live) => (
              <li key={live.id}>
                <Link
                  href={`/admin/live-results/${live.id}`}
                  className="flex items-center justify-between gap-2 rounded border border-gray-200 p-2.5 transition hover:border-gray-300 hover:bg-gray-50"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900">
                      {formatLiveTicketNo(live.sequence_number)}
                      {live.title ? `　${live.title}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {(() => {
                        const d = toLiveScheduleDate(live.scheduled_at);
                        return `${d.year}/${d.month}/${d.day}(${d.weekday}) ${d.time}`;
                      })()}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      live.results_published
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {live.results_published ? "SNS公開中" : "未公開"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>
    </AdminShell>
  );
}
