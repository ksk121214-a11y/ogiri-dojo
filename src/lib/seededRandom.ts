// 動画撮影用モードの再現性のための乱数。同じ種（seed）からは毎回同じ数列が出る。
// 種の文字列をFNV-1aで32bitへ変換し、mulberry32で0以上1未満の値を順に返す。
// 体験版の通常モード（開発確認）は使わず、Math.randomのままにする。

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
