import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "danger" | "secondary";

// ボタンの重要度を色で区別する：primary=主操作（青）、danger=削除・永久停止・
// ライブ終了などの危険操作のみ（赤）、secondary=それ以外の補助操作（枠線グレー）。
const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  danger: "border border-red-300 text-red-600 hover:bg-red-50",
  secondary: "border border-gray-300 text-gray-700 hover:bg-gray-50",
};

export default function AdminButton({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={`rounded px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASS[variant]} ${className}`}
      {...props}
    />
  );
}
