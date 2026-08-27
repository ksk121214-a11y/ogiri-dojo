import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: true,
  // 開発サーバーをスマホ実機からLAN経由（IPアドレス）で確認できるようにする設定。
  // next devにのみ影響し、本番ビルドには影響しない。
  allowedDevOrigins: ["192.168.10.13"],
};

export default nextConfig;
