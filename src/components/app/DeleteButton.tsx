"use client";

import { TrashGlyph } from "@/components/home/icons";
import { useSnsStore, type SnsDeleteTargetType } from "@/store/useSnsStore";

const CONFIRM_MESSAGE: Record<SnsDeleteTargetType, string> = {
  sns_topic:
    "このお題を削除しますか？\n\nこのお題への回答とツッコミもすべて表示されなくなります。\n使用した寄合券は戻りません。\nこの操作は取り消せません。",
  sns_answer:
    "この回答を削除しますか？\n\nこの回答へのツッコミも表示されなくなります。\n使用した寄合券は戻りません。\nこの操作は取り消せません。",
  sns_comment:
    "このツッコミを削除しますか？\n\n使用した寄合券は戻りません。\nこの操作は取り消せません。",
};

// 自分の投稿（お題・回答・ツッコミ）だけに出す削除ボタン。ReportButtonと同じ
// 見た目・配置パターン（カード右端中央に絶対配置）で、他人の投稿ではこちらの
// 代わりにReportButtonを表示する（呼び出し元がauthorId==="me"かどうかで出し分ける）。
// 削除は論理削除（is_hidden化）で、寄合券は戻らない・巻き込まれた他人の投稿の
// 寄合券にも触れない（supabase/migrations/0067参照）。
export default function DeleteButton({
  size = 22,
  className = "",
  targetType,
  targetId,
  onDeleted,
}: {
  size?: number;
  className?: string;
  targetType: SnsDeleteTargetType;
  targetId: string;
  // 削除成功後に呼び出し元が行う追加処理（詳細ページからの離脱等）。
  onDeleted?: () => void;
}) {
  const deleteTopic = useSnsStore((s) => s.deleteTopic);
  const deleteAnswer = useSnsStore((s) => s.deleteAnswer);
  const deleteComment = useSnsStore((s) => s.deleteComment);
  const pending = useSnsStore((s) => s.deletePending[targetId] ?? false);

  const handleDelete = async () => {
    if (pending) return; // 連打・二重送信防止
    const confirmed = window.confirm(CONFIRM_MESSAGE[targetType]);
    if (!confirmed) return;

    const action =
      targetType === "sns_topic" ? deleteTopic : targetType === "sns_answer" ? deleteAnswer : deleteComment;
    const result = await action(targetId);
    if (!result.ok) {
      // 失敗時は表示を消さず（呼び出し元のローカルstateには一切触れない）、
      // 利用者向けの短い日本語エラーだけを出す（生のPostgres/Supabaseエラーは出さない）。
      window.alert(result.reason);
      return;
    }
    onDeleted?.();
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
