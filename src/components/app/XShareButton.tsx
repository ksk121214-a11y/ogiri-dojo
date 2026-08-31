"use client";

// X(旧Twitter)の投稿画面をポップアップで開く共有ボタン。
// intent/tweetエンドポイントはURLパラメータで本文・リンクを渡すだけなので、
// アプリ側にX APIキー等は一切不要（ユーザー自身のXアカウントで投稿するかは
// 開いた投稿画面側でユーザーが判断・確定する）。
// urlを省略した場合は呼び出し時点のページURL(window.location.href)を使う。
export default function XShareButton({
  text,
  url,
  label = "Xでシェア",
  className,
}: {
  text: string;
  url?: string;
  label?: string;
  className?: string;
}) {
  const handleClick = () => {
    // urlが相対パス（例: "/live-schedule"）で渡された場合、Xの投稿画面はこのページの
    // オリジンを知らないため、window.location.originを補って絶対URLにする。
    const shareUrl =
      typeof window === "undefined"
        ? (url ?? "")
        : url
          ? new URL(url, window.location.origin).toString()
          : window.location.href;
    const params = new URLSearchParams({ text: shareUrl ? `${text}\n${shareUrl}` : text });
    window.open(
      `https://twitter.com/intent/tweet?${params.toString()}`,
      "_blank",
      "noopener,noreferrer,width=600,height=520",
    );
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        className ??
        "inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--ink)] bg-[var(--ink)] px-4 py-1.5 font-sans text-sm font-bold text-[var(--paper)] transition hover:opacity-90"
      }
    >
      <span aria-hidden>𝕏</span>
      {label}
    </button>
  );
}
