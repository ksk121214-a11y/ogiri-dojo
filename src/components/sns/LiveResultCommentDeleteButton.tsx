"use client";

import { TrashGlyph } from "@/components/home/icons";
import { useSnsLiveResultsStore } from "@/store/useSnsLiveResultsStore";

// ライブ結果コメントは寄合券を消費していないため、既存のDeleteButton（寄合帳の
// お題・回答・ツッコミ用）の確認文とは異なり「寄合券は戻りません」は入れない。
const CONFIRM_MESSAGE = "このコメントを削除しますか？\n\nこの操作は取り消せません。";

// 自分のライブ結果コメントだけに出す削除ボタン。見た目・確認ダイアログ・連打防止の
// 挙動はsrc/components/app/DeleteButton.tsxへ揃えているが、ライブ結果は別ストア
// (useSnsLiveResultsStore)で管理されているため、寄合帳のDeleteButton（useSnsStore
// 専用）を拡張せず専用コンポーネントとして分離している。
export default function LiveResultCommentDeleteButton({
  size = 22,
  className = "",
  commentId,
}: {
  size?: number;
  className?: string;
  commentId: string;
}) {
  const deleteComment = useSnsLiveResultsStore((s) => s.deleteComment);
  const pending = useSnsLiveResultsStore((s) => s.commentDeletePending[commentId] ?? false);

  const handleDelete = async () => {
    if (pending) return; // 連打・二重送信防止
    const confirmed = window.confirm(CONFIRM_MESSAGE);
    if (!confirmed) return;
    const result = await deleteComment(commentId);
    if (!result.ok && result.message) {
      window.alert(result.message);
    }
  };

  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void handleDelete();
      }}
      title="削除する"
      aria-label="削除する"
      className={`flex shrink-0 items-center justify-center rounded-full text-dojo-gray-purple transition hover:text-dojo-curtain-red disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      style={{ width: size, height: size }}
    >
      <TrashGlyph className="h-[75%] w-[75%]" />
    </button>
  );
}
