import type { CSSProperties } from "react";

import { BASE_PATH } from "@/lib/basePath";

// アイコン線画の共通レンダリング。円の外側は透過したまま、円の内側（白い部分）は
// 透過させず白いシルエットとして塗り、その上に選んだ色で線画を重ねる2層構造。
// 2026-08-29:「アイコンの丸の中の白い部分を背景透過しないでそのまま素材として使って」
// の要望対応。以前はmask-imageで線だけを単色に塗る1層構造だったため、線以外の部分
// （円の中の背景）は透明のままで、下の背景（ライブ舞台の暗い色等）が透けて見えていた。
// MyIconAvatar・ParticipantIconAvatar・StageCharactersView・StageCharacters・
// MyProfileEditModalのプレビューなど、アイコンを描画する箇所はすべてこれを使う。
export default function AvatarGlyph({
  iconSrc,
  silhouetteSrc,
  color,
  size,
  fill = false,
}: {
  iconSrc: string;
  silhouetteSrc: string;
  color: string;
  // 固定サイズで使う場合はsizeを指定する。呼び出し元の要素いっぱいに広げたい場合
  // （StageCharactersView等、親の可変サイズに追従させたい箇所）はfillを使う。
  size?: number;
  fill?: boolean;
}) {
  const maskStyle = (src: string): CSSProperties => ({
    position: "absolute",
    inset: 0,
    WebkitMaskImage: `url(${BASE_PATH}${src})`,
    maskImage: `url(${BASE_PATH}${src})`,
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
  });

  const outerStyle: CSSProperties = fill
    ? { position: "absolute", inset: 0 }
    : { width: size, height: size };

  return (
    <span aria-hidden className="relative block shrink-0" style={outerStyle}>
      <span style={{ ...maskStyle(silhouetteSrc), backgroundColor: "#ffffff" }} />
      <span style={{ ...maskStyle(iconSrc), backgroundColor: color }} />
    </span>
  );
}
