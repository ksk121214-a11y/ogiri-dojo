// 絵文字は端末フォントごとに色付きグリフになり、チャコール×生成り×赤オレンジの
// 2〜3色設計から浮いてしまうため使わない。ボタン内の小さな装飾アイコンは
// すべてここに集約したモノクロSVG（currentColor）で統一する。

export function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" className={className} fill="currentColor" aria-hidden>
      <path d="M3 1.5 14 8 3 14.5Z" />
    </svg>
  );
}

export function TicketGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" className={className} fill="none" aria-hidden>
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
    <svg viewBox="0 0 24 24" width="14" height="14" className={className} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5.2l3.6 2.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EditGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" className={className} fill="none" aria-hidden>
      <path
        d="m14.5 4.5 5 5L8 21H3v-5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" className={className} fill="none" aria-hidden>
      <rect x="3.5" y="5.5" width="17" height="15" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M7.5 3v3M16.5 3v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// 遊び方ページ「①開催通知を確認」用。カレンダーの右上に通知バッジ（丸）を添える。
export function CalendarBellGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" className={className} fill="none" aria-hidden>
      <rect x="2.5" y="5.5" width="16" height="14.5" rx="1.8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M2.5 9.5h16M6.5 3v3M14.5 3v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10.5" cy="15" r="2.6" fill="currentColor" />
      <circle cx="18.5" cy="16.5" r="4.5" fill="currentColor" stroke="var(--paper)" strokeWidth="1.4" />
      <path
        d="M18.5 14.3v2.4l1.5 1"
        stroke="var(--paper)"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 遊び方ページ「②ライブに参加」用。開いたドアと、そこへ向かう人。
export function DoorEnterGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" className={className} fill="none" aria-hidden>
      <path d="M14 2.5v19H5.5v-19Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
      <circle cx="4" cy="8" r="1.7" fill="currentColor" />
      <path
        d="M4 10.4c-1.4 0-2.5 1.1-2.5 2.6v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M17 6.5c1 .6 1.8 1.3 2.4 2.2M18 3.8c1.6.9 2.8 2.2 3.6 3.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// 遊び方ページ「③参加者と観客」「④5人×3組で勝負」用の人アイコン（1人分、繰り返して使う）。
export function PersonGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" className={className} fill="none" aria-hidden>
      <circle cx="12" cy="7.2" r="3.4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 20c0-3.6 3.1-6.3 7-6.3s7 2.7 7 6.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

// 遊び方ページ「⑤回答・採点」用。回答用紙＋ペンと、採点の吹き出し。
export function DocumentPencilGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" className={className} fill="none" aria-hidden>
      <rect x="3" y="2.5" width="13" height="17" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 7.5h7M6 11.5h7M6 15.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="m14.5 15.5 6-6 2 2-6 6-2.6.6Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 遊び方ページ「⑤回答・採点」の採点側用。吹き出しの中に0〜3の点数を示す。
export function ScoreBubbleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" className={className} fill="none" aria-hidden>
      <path
        d="M3 5.5h18v10H10.5L6 19v-3.5H3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <text x="12" y="12.2" textAnchor="middle" fontSize="7" fontWeight={700} fill="currentColor">
        0-3
      </text>
    </svg>
  );
}

// 遊び方ページ「⑥結果発表」用。トロフィーと、獲得ポイントを示す「P」バッジ。
export function TrophyGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" className={className} fill="none" aria-hidden>
      <path
        d="M7 3.5h10v5a5 5 0 0 1-10 0Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M7 5H4v1.5A3.5 3.5 0 0 0 7.5 10M17 5h3v1.5A3.5 3.5 0 0 1 16.5 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 13.5V17M8.5 20.5h7M9.5 17h5v3.5h-5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="19" cy="18" r="3.6" fill="currentColor" stroke="var(--paper)" strokeWidth="1.2" />
      <text x="19" y="19.6" textAnchor="middle" fontSize="4.6" fontWeight={700} fill="var(--paper)">
        P
      </text>
    </svg>
  );
}
