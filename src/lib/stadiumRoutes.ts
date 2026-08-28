// Stadium系トンマナ（地下ライブハウス風、StadiumAppShell/StadiumPageShellを使う画面）の
// パス判定。MainLayout（ヘッダー/下部ナビの出し分け）とStadiumSfxController（効果音を
// 適用する範囲）の両方から参照する単一の判定ロジックにし、判定基準が食い違わないようにする。
//
// next.config側でtrailingSlash: trueのため実際のpathnameは"/sns"ではなく"/sns/"になる。
// これを考慮せず`startsWith("/sns/")`だけで判定すると寄合帳トップ自身（"/sns/"）まで
// Stadium側に誤って含まれてしまうため、"/sns/"ちょうど（トップ自身）は明示的に除外する。
export function isStadiumRoute(pathname: string): boolean {
  const isSnsSubPage =
    pathname.startsWith("/sns/") &&
    pathname !== "/sns/" &&
    !pathname.startsWith("/sns/u/");
  return (
    pathname === "/" ||
    pathname.startsWith("/mypage") ||
    pathname.startsWith("/how-to-play") ||
    pathname.startsWith("/live-schedule") ||
    isSnsSubPage
  );
}
