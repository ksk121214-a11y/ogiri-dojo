import Link from "next/link";

// 運営者専用管理画面のトップ（メニュー一覧）。要件の7項目構成を維持しつつ、
// 実装済みの項目だけをリンクにする（未実装分は「準備中」表示、段階実装が
// 進むごとにこのファイルを更新する）。
const MENU: {
  label: string;
  description: string;
  href?: string;
}[] = [
  {
    label: "ライブ準備・操作",
    description: "ライブの準備・参加受付・組分け・進行・終了までを行う司会コンソール。",
    href: "/live/host",
  },
  {
    label: "ライブ予定",
    description: "ホーム画面・次回ライブ画面に表示する日付やライブ番号を管理します。",
    href: "/admin/schedule",
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
  },
  {
    label: "投稿・回答管理",
    description: "SNS投稿・回答・コメントの非表示/削除を行います。",
    href: "/admin/posts",
  },
  {
    label: "ユーザー管理",
    description: "警告・利用停止・アカウント削除等を行います。",
    href: "/admin/users",
  },
  {
    label: "運営操作履歴",
    description: "重要な運営操作の履歴を確認します。",
    href: "/admin/logs",
  },
];

export default function AdminHomePage() {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-lg flex-col gap-4 px-4 py-8">
      <h1 className="font-brush text-2xl text-dojo-curtain-red">運営者専用管理画面</h1>
      <div className="flex flex-col gap-3">
        {MENU.map((item) =>
          item.href ? (
            <Link
              key={item.label}
              href={item.href}
              className="rounded-xl border border-dojo-dark-brown/20 p-4 text-left transition hover:bg-dojo-light-brown"
            >
              <p className="font-sans text-sm font-bold text-dojo-ink">{item.label}</p>
              <p className="mt-1 font-sans text-xs text-dojo-dark-brown">{item.description}</p>
            </Link>
          ) : (
            <div
              key={item.label}
              className="rounded-xl border border-dojo-dark-brown/10 p-4 text-left opacity-50"
            >
              <p className="font-sans text-sm font-bold text-dojo-ink">
                {item.label}
                <span className="ml-2 rounded bg-dojo-dark-brown/10 px-1.5 py-0.5 text-[10px] font-bold">
                  準備中
                </span>
              </p>
              <p className="mt-1 font-sans text-xs text-dojo-dark-brown">{item.description}</p>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
