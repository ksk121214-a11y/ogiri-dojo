// 自分以外の参加者（ボット含む）のアイコン絵柄・色を決定的に割り当てるためのヘルパー。
//
// マイページのアイコン設定（avatarIcon/avatarColor）はこのブラウザのlocalStorageにしか
// 保存されておらず、他の参加者からは見えない（Supabaseのprofilesテーブルには
// avatar関連のカラムが無い）。そのため「ボットのアイコンも編集画面にあるどれかの
// アイコンと色にしてほしい」という要望に対しては、participant_id（同じ人なら
// ライブ中ずっと不変のID）から常に同じ絵柄・色が一意に決まるようハッシュ化して
// 割り当てる。同じparticipantIdなら誰の画面で見ても同じ見た目になる。
import { AVATAR_COLOR_PRESETS } from "@/lib/avatarColors";
import { AVATAR_ICON_PRESETS } from "@/lib/avatarIcons";

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickParticipantIconPreset(participantId: string) {
  const idx = hashString(`icon:${participantId}`) % AVATAR_ICON_PRESETS.length;
  return AVATAR_ICON_PRESETS[idx];
}

export function getParticipantAvatarIconSrc(participantId: string): string {
  return pickParticipantIconPreset(participantId).src;
}

export function getParticipantAvatarSilhouetteSrc(participantId: string): string {
  return pickParticipantIconPreset(participantId).silhouetteSrc;
}

export function getParticipantAvatarColor(participantId: string): string {
  // 絵柄と別のシード文字列にして、同じインデックス選択にならないようにする。
  const idx = hashString(`color:${participantId}`) % AVATAR_COLOR_PRESETS.length;
  return AVATAR_COLOR_PRESETS[idx].value;
}
