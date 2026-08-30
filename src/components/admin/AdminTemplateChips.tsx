"use client";

// 定型文チップ。ユーザーへのメッセージ入力欄（警告・お知らせ配信・ライブ中の運営
// メッセージ）で共通利用する「よく使う文面をワンタップで入力欄にセットし、その後
// 自由に書き換えられる」ためのUI。テンプレート自体の中身は呼び出し側が持つ
// （画面ごとに文面が異なるため、テンプレート一覧は共通化しない）。
export default function AdminTemplateChips<T extends { label: string }>({
  templates,
  onSelect,
}: {
  templates: readonly T[];
  onSelect: (template: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {templates.map((t, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(t)}
          className="rounded-full border border-gray-300 bg-gray-50 px-2.5 py-1 text-[11px] font-bold text-gray-600 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
