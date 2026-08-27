import type { Metadata } from "next";
import { Noto_Sans_JP, Orbitron, Yuji_Syuku } from "next/font/google";
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
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
