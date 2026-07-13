# 大喜利道場

決まった時間にみんなで集まる、オンライン大喜利ライブ大会アプリ「大喜利道場」。

詳細な企画・仕様・デザイン方針は以下を参照。

- `企画書.md`
- `仕様書.md`
- `デザイン方針.md`

## 技術スタック

- [Next.js](https://nextjs.org)（App Router） + React + TypeScript
- Tailwind CSS v4
- [Framer Motion](https://motion.dev/)（幕間演出・エフェクト等のアニメーション）
- [Supabase](https://supabase.com)（PostgreSQL + Auth + Realtime）

## セットアップ

依存パッケージをインストール：

```bash
npm install
```

Supabaseのプロジェクトを作成し、`.env.local.example` をコピーして `.env.local` を作成、値を設定する：

```bash
cp .env.local.example .env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## 開発サーバー起動

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開いて確認する。`src/app/page.tsx` を編集すると自動的に更新される。

## ビルド

```bash
npm run build
```

## Lint

```bash
npm run lint
```
