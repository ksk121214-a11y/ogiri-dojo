// マイページ用の仮キャラクターアバター（プレースホルダー）。
// デザイン方針§5「芸人風の人型SDキャラ」の簡易版（顔＋肩から上）の方向性を踏まえた、
// 本実装（ガチャ・衣装レイヤー）導入までのシンプルなCSS/SVG表示。
export default function AvatarPlaceholder({ size = 96 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      className="shrink-0"
      role="img"
      aria-label="仮の演者アバター"
    >
      <circle cx="48" cy="48" r="47" fill="#5B4530" fillOpacity={0.15} />
      {/* 肩から上のシルエット（衣装レイヤーの土台） */}
      <path
        d="M6 94 C6 66 24 54 48 54 C72 54 90 66 90 94 Z"
        fill="#5B4530"
      />
      {/* 首 */}
      <rect x="40" y="46" width="16" height="16" rx="4" fill="#EEC79A" />
      {/* 顔 */}
      <circle cx="48" cy="34" r="24" fill="#F3D2A6" />
      {/* 目 */}
      <circle cx="39" cy="33" r="2.6" fill="#2E2A24" />
      <circle cx="57" cy="33" r="2.6" fill="#2E2A24" />
      {/* 口（穏やかな笑み） */}
      <path
        d="M39 42 Q48 49 57 42"
        stroke="#2E2A24"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
      {/* 手ぬぐい風のワンポイント（羽織の襟） */}
      <path
        d="M30 62 L48 72 L66 62"
        stroke="#E8B84C"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
