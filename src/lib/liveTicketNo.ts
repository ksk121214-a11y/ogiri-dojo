// ライブ番号（「第n回開催」を表す表示用の文字列）の組み立て。
// lives.sequence_numberはDBのシーケンスで自動採番される整数（1, 2, 3...）で、
// 表示側でこの関数を通して「#0001」形式のゼロ埋め4桁に変換する。
export function formatLiveTicketNo(sequenceNumber: number): string {
  return `#${String(sequenceNumber).padStart(4, "0")}`;
}
