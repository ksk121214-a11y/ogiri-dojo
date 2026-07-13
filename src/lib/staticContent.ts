// GitHub Pages等の静的サイト公開では、ビルド時に存在するIDのページしか
// 生成されない。ブラウザ上でユーザーが新規作成したお題/回答(idに"-local-"を含む、
// useSnsStoreのgenId参照)には対応する詳細ページが無いため、遷移すると404になる。
// この関数でその場合を判定し、詳細ページへの遷移を無効化する。
export function isLocallyCreated(id: string): boolean {
  return id.includes("-local-");
}
