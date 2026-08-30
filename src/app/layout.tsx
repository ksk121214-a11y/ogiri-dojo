import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP, Orbitron, Yuji_Syuku } from "next/font/google";

import AmbientBgmController from "@/components/app/AmbientBgmController";
import AudioProvider from "@/components/app/AudioProvider";
import StadiumSfxController from "@/components/app/StadiumSfxController";

import "./globals.css";

const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
});

const yujiSyuku = Yuji_Syuku({
  variable: "--font-yuji-syuku",
  weight: "400",
  subsets: ["latin"],
});

// ライブ体験モック（/live-demo）の採点デジタル表示用。数字だけの短い表示にしか
// 使わないブロック体フォント（他画面では使わないため既存フォントには影響しない）。
const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "爆笑スタジアム",
  description: "決まった時間にみんなで集まるオンライン大喜利ライブ「爆笑スタジアム」",
};

// ホームの下部固定ナビでenv(safe-area-inset-bottom)を効かせるにはviewport-fit=coverが必要
// （iOS Safariの仕様。無いとセーフエリア変数が常に0扱いになる）。
// interactiveWidget: "resizes-content"は、ソフトウェアキーボード表示時にvisual
// viewportではなくレイアウトビューポート自体をキーボード分縮めさせる指定
// （2026-08-31: ライブ画面の回答入力でキーボード表示時にレイアウトが崩れる対策の一環）。
export const viewport: Viewport = {
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${notoSansJP.variable} ${yujiSyuku.variable} ${orbitron.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <AudioProvider>
          <AmbientBgmController />
          <StadiumSfxController />
          {children}
        </AudioProvider>
      </body>
    </html>
  );
}
