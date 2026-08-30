// Stadium系トンマナ（地下ライブハウス風、StadiumAppShell/StadiumPageShellを使う画面）の
// パス判定。MainLayout（ヘッダー/下部ナビの出し分け）とStadiumSfxController（効果音を
// 適用する範囲）の両方から参照する単一の判定ロジックにし、判定基準が食い違わないようにする。
//
// 2026-08-30：寄合帳（/sns配下）は当初トップ自身(/sns)とプロフィール系(/sns/u/*)だけ
// 旧デザイン（AppHeaderの和風テーマ）のまま残っていたが、新デザインの画面から
// アイコン・名前を押すと旧デザインに切り替わってしまう問題があったため、/sns配下は
// すべてStadium対象に統一した（各ページ・コンポーネント側もStadiumPageShellを使うよう
// 揃えてある）。「楽屋（着せ替え）/backstage-room」「番付表/ranking」「ガチャ/gacha」は
// 今回のスコープ外のため、明示的にStadium対象へは含めていない。
export function isStadiumRoute(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname.startsWith("/mypage") ||
    pathname.startsWith("/how-to-play") ||
    pathname.startsWith("/live-schedule") ||
    pathname.startsWith("/sns")
  );
}
