// 「今この曲を、この位置から鳴らしたい」という最新の意図（6回目レビュー対応）。
// BGMがOFF・音源読込中・Web Audio未デコードの間も、サーバー同期後に求めた正しい開始
// 位置をここへ保存し、実際の再生開始時（ONにした時・読込完了時）に最新値を読む。
// 非同期の読込完了処理は「開始時の引数」ではなくここを読み、別の曲へ切り替わっていれば
// （世代gen不一致）新しい曲を上書きしない。
// gen：曲名が変わる要求・clear()で増える（同じ曲への再要求では増やさない＝読込中の
// 同じ曲の開始処理が自分の再要求で無効化されない）。
// 7回目レビュー対応：保存する位置は固定値ではなく「基準位置＋保存した時点の単調増加時計」。
// startAtMsは読み出した瞬間の有効な位置（基準＋経過）を返す。OFFのまま待った時間・読込にかかった
// 時間・OFF→ONまでの時間が自動的に加算される。端末の絶対時刻(Date.now)には依存せず、
// 単調増加時計(perfNow、本番はperformance.now())を注入する（テスト可能）。曲の長さに対する
// moduloは使用側(resolveBgmOffsetSec)が行う。
export function createBgmStartIntent(perfNow: () => number = () => performance.now()) {
  let name: string | null = null;
  let baseStartAtMs: number | undefined;
  let savedAtPerf = 0;
  let gen = 0;
  const save = (s: number | undefined) => {
    baseStartAtMs = s;
    savedAtPerf = perfNow();
  };
  return {
    request(n: string, s: number | undefined): number {
      if (name !== n) gen += 1;
      name = n;
      save(s);
      return gen;
    },
    clear() {
      name = null;
      save(undefined);
      gen += 1;
    },
    // 予定曲が一致する時だけ、最新の開始位置へ更新する。
    updateStart(n: string, s: number): boolean {
      if (name !== n) return false;
      save(s);
      return true;
    },
    isCurrent(g: number): boolean {
      return g === gen && name !== null;
    },
    get name() {
      return name;
    },
    get startAtMs(): number | undefined {
      if (baseStartAtMs === undefined) return undefined;
      return baseStartAtMs + Math.max(0, perfNow() - savedAtPerf);
    },
    get gen() {
      return gen;
    },
  };
}
export type BgmStartIntent = ReturnType<typeof createBgmStartIntent>;
