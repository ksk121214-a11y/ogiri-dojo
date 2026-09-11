// ライブ番号（「第n回開催」を表す表示用の文字列）の組み立て。
// lives.official_sequence_numberはDBの専用カウンター(official_live_counter)で
// 本番ライブだけに採番される整数（1, 2, 3...）で、表示側でこの関数を通して
// 「#0001」形式のゼロ埋め4桁に変換する。
export function formatLiveTicketNo(sequenceNumber: number): string {
  return `#${String(sequenceNumber).padStart(4, "0")}`;
}

// 0068追加：「テスト／本番」の選択に伴い、掲示用の番号表示を1箇所にまとめる。
// テストライブは本番の開催番号を持たない（lives.official_sequence_numberは常に
// null）ため、旧sequence_number（レガシー列）やnullをformatLiveTicketNoへ渡さず、
// 必ずこの関数経由で「テスト」という文字列に倒す。
export function formatLiveTicketLabel(
  liveMode: "test" | "official",
  officialSequenceNumber: number | null,
): string {
  if (liveMode !== "official" || officialSequenceNumber == null) return "テスト";
  return formatLiveTicketNo(officialSequenceNumber);
}
