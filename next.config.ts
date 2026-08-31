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

  // 2026-08-29:「ライブ画面の必須素材が表示の瞬間に読み込み待ちにならないように」対応の一環。
  // public/配下の画像・音声は秘密でない共通ゲーム素材で、ビルドのたびに内容が変わる
  // ものではないため、長期間のCache-Controlを明示する（Vercelの静的配信のデフォルトに
  // 任せず確実にブラウザ・CDN双方でキャッシュさせる）。
  // 注意：immutableを指定しているため、同じファイル名のまま中身だけ差し替えると、
  // 既にキャッシュ済みのブラウザ・CDNには古い内容が長期間残り続ける。素材を更新する
  // 場合は、ファイル名またはパスに新しいバージョンを付けて別URLにすること
  // （既存ファイルの上書きはしない）。
  async headers() {
    const immutableCacheHeaders = [
      { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
    ];
    // 2026-09-01：初回ライブ実開催前のセキュリティ点検で追加。Vercelはこの種の
    // セキュリティヘッダーを自動では付与しないため明示する。script-src/style-src
    // を縛る本格的なContent-Security-Policyは、Framer Motion等の実行時インライン
    // スタイルを壊すリスクを実機確認なしに判断できないため今回は見送り、壊れる
    // 心配のない項目（クリックジャッキング対策・MIMEスニッフィング対策・
    // リファラー漏洩対策・不要な端末機能へのアクセス無効化）だけを追加する。
    const securityHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
      },
    ];
    return [
      { source: "/images/:path*", headers: immutableCacheHeaders },
      { source: "/sounds/:path*", headers: immutableCacheHeaders },
      { source: "/:path*", headers: securityHeaders },
    ];
  },
};

export default nextConfig;
