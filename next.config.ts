import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: true,
  // 2026-08-27: ライブ演出の画像素材は既にパレット化で十分軽量(合計885KB程度)なため、
  // Vercelの画像最適化API(オンデマンド変換)を経由する遅延・コールドスタートを避け、
  // 素のファイルをそのまま配信する方が結果的に速い。読み込みが遅い/背景や回答席の
  // 画像が出てこない不具合の一因と考えられるため無効化する。
  images: { unoptimized: true },
  // 開発サーバーをスマホ実機からLAN経由（IPアドレス）で確認できるようにする設定。
  // next devにのみ影響し、本番ビルドには影響しない。
  allowedDevOrigins: ["192.168.10.13"],
};

export default nextConfig;
