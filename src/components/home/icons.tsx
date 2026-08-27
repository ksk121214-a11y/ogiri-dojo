// 絵文字は端末フォントごとに色付きグリフになり、チャコール×生成り×赤オレンジの
// 2〜3色設計から浮いてしまうため使わない。ボタン内の小さな装飾アイコンは
// すべてここに集約したモノクロSVG（currentColor）で統一する。

export function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="10" height="10" className={className} fill="currentColor" aria-hidden>
      <path d="M3 1.5 14 8 3 14.5Z" />
    </svg>
  );
}

export function TicketGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className={className} fill="none" aria-hidden>
      <path
        d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.2a1.6 1.6 0 0 0 0 5.6V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.2a1.6 1.6 0 0 0 0-5.6V8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M13 6.5v2M13 15.5v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ClockGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" className={className} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5.2l3.6 2.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
