// 他人（ダミーの演者・審査参加者）の簡易アイコン：頭文字＋グラデーション円。
// StageCharactersの舞台キャラ表示と同系統の配色ローテーションを流用し、
// アイコン画像を持たないダミー参加者でも一貫した「顔」を持たせる。
const GRADIENTS = [
  "from-dojo-curtain-red to-dojo-deep-crimson",
  "from-dojo-curtain-gold to-dojo-spotlight-orange",
  "from-dojo-cheer-pink to-dojo-deep-crimson",
  "from-dojo-spotlight-orange to-dojo-curtain-gold",
  "from-dojo-gray-purple to-dojo-backstage-navy",
];

export default function InitialAvatar({
  name,
  seed,
  size = 32,
}: {
  name: string;
  seed: number;
  size?: number;
}) {
  const idx = ((seed % GRADIENTS.length) + GRADIENTS.length) % GRADIENTS.length;
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full border border-dojo-washi-white/20 bg-gradient-to-br font-brush text-dojo-washi-white ${GRADIENTS[idx]}`}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {name.slice(0, 1)}
    </span>
  );
}
