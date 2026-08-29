// 自分以外の参加者（ボット含む）のアイコン絵柄・色を決定的に割り当てるためのヘルパー。
//
// 2026-08-29: profiles.avatar_icon/avatar_colorの追加により、本人が実際に選んだ
// 絵柄・色は他の参加者にも公開されるようになった（participant_display_names RPC
// 経由、参照: src/store/useLiveFollowerStore.ts）。このファイルの決定的ハッシュは、
// ①ボット作成時にprofilesへ書き込む初期値（useLiveBotStore.ts、getParticipantAvatarIconId
// を使う）、②何らかの理由でSupabase側の値がまだ取得できていない場合のフォールバック
// （ParticipantIconAvatar/StageCharactersView）、の2用途にのみ使う。
// participant_id（同じ人ならライブ中ずっと不変のID）から常に同じ絵柄・色が一意に
// 決まるようハッシュ化しているため、同じparticipantIdなら誰の画面で見ても
// 同じ見た目になる（Supabase未取得時の一時的な見た目としても破綻しない）。
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

// ボット作成時（useLiveBotStore.ts）に、profiles.avatar_iconへ書き込む初期値として使う
// （AVATAR_ICON_PRESETSのid文字列、例: "afro"）。
export function getParticipantAvatarIconId(participantId: string): string {
  return pickParticipantIconPreset(participantId).id;
}

export function getParticipantAvatarSilhouetteSrc(participantId: string): string {
  return pickParticipantIconPreset(participantId).silhouetteSrc;
}

export function getParticipantAvatarColor(participantId: string): string {
  // 絵柄と別のシード文字列にして、同じインデックス選択にならないようにする。
  const idx = hashString(`color:${participantId}`) % AVATAR_COLOR_PRESETS.length;
  return AVATAR_COLOR_PRESETS[idx].value;
}
