// SNS簡易版（寄合帳）に登場するダミー投稿者のプロフィール。
// 自分（authorId === "me"）以外の投稿者に、道場らしい段位ラベル・アイコン絵文字・
// 丸背景色（dojoカラー）を割り当てる。大喜利SNS本家のAvatar（丸背景+絵文字/頭文字）の
// 構造を踏まえつつ、道場の段位表示を組み合わせた道場オリジナルの表現として作り直したもの。

export interface SnsAuthorProfile {
  id: string;
  displayName: string;
  rankLabel: string;
  emoji: string;
  bgColorClass: string;
  followerCount: number;
  followingCount: number;
}

export const DUMMY_SNS_AUTHORS: SnsAuthorProfile[] = [
  { id: "author-raitoningu", displayName: "笑福亭ライトニング", rankLabel: "真打", emoji: "⚡", bgColorClass: "bg-dojo-curtain-red", followerCount: 342, followingCount: 58 },
  { id: "author-hina", displayName: "座布団ヒナ", rankLabel: "二ツ目", emoji: "🌸", bgColorClass: "bg-dojo-cheer-pink", followerCount: 128, followingCount: 96 },
  { id: "author-tetsuya", displayName: "早口テツヤ", rankLabel: "前座", emoji: "🎤", bgColorClass: "bg-dojo-spotlight-orange", followerCount: 41, followingCount: 73 },
  { id: "author-sakura", displayName: "花形亭サクラ", rankLabel: "花形真打", emoji: "🎀", bgColorClass: "bg-dojo-deep-crimson", followerCount: 512, followingCount: 44 },
  { id: "author-konbu", displayName: "扇子亭こんぶ", rankLabel: "二ツ目", emoji: "🪭", bgColorClass: "bg-dojo-tatami-green", followerCount: 156, followingCount: 112 },
  { id: "author-akira", displayName: "三日月アキラ", rankLabel: "大看板", emoji: "🌙", bgColorClass: "bg-dojo-dark-brown", followerCount: 890, followingCount: 23 },
  { id: "author-syrup", displayName: "落語亭シロップ", rankLabel: "前座", emoji: "🍯", bgColorClass: "bg-dojo-curtain-gold", followerCount: 37, followingCount: 65 },
  { id: "author-kana", displayName: "めくり札カナ", rankLabel: "見習い", emoji: "🎴", bgColorClass: "bg-dojo-cheer-pink", followerCount: 12, followingCount: 88 },
  { id: "author-kenta", displayName: "招き猫ケンタ", rankLabel: "二ツ目", emoji: "🐱", bgColorClass: "bg-dojo-curtain-gold", followerCount: 174, followingCount: 130 },
  { id: "author-jirou", displayName: "べらんめえ次郎", rankLabel: "名人", emoji: "🥋", bgColorClass: "bg-dojo-deep-crimson", followerCount: 620, followingCount: 51 },
  { id: "author-masa", displayName: "太鼓持ちマサ", rankLabel: "前座", emoji: "🥁", bgColorClass: "bg-dojo-spotlight-orange", followerCount: 29, followingCount: 47 },
  { id: "author-minami", displayName: "楽屋裏ミナミ", rankLabel: "見習い", emoji: "🍡", bgColorClass: "bg-dojo-tatami-green", followerCount: 18, followingCount: 61 },
  { id: "author-ryou", displayName: "半纏のリョウ", rankLabel: "二ツ目", emoji: "🏮", bgColorClass: "bg-dojo-curtain-red", followerCount: 143, followingCount: 99 },
  { id: "author-ginji", displayName: "大看板・銀次", rankLabel: "達人", emoji: "👑", bgColorClass: "bg-dojo-dark-brown", followerCount: 758, followingCount: 33 },
  { id: "author-yuu", displayName: "高座のユウ", rankLabel: "真打", emoji: "🎭", bgColorClass: "bg-dojo-cheer-pink", followerCount: 298, followingCount: 84 },
];

// 自分（"me"）のフォロワー一覧を仮表示する際に使う人数（マイページのサマリー表示とも一致させる）。
export const MY_FOLLOWER_DISPLAY_COUNT = 6;

const AUTHOR_MAP = new Map(DUMMY_SNS_AUTHORS.map((author) => [author.id, author]));

export function getDummySnsAuthor(authorId: string): SnsAuthorProfile | undefined {
  return AUTHOR_MAP.get(authorId);
}

// seed文字列から決定的な擬似シャッフルを行う（Math.random()だとSSR/CSRで結果が
// 変わりハイドレーション不一致になるため、フォロー中/フォロワー一覧の簡易表示に使う）。
function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ダミー投稿者のフォロー中/フォロワー一覧の簡易表示用に、指定人数分だけ
// 他のダミー投稿者を（seedに応じて決定的に）ランダム抽出する。
// 厳密なフォロー関係は管理しないため、雰囲気が出れば十分という簡易実装。
export function getRandomOtherAuthors(
  excludeId: string,
  count: number,
  seed: string = excludeId,
): SnsAuthorProfile[] {
  const pool = DUMMY_SNS_AUTHORS.filter((author) => author.id !== excludeId);
  return seededShuffle(pool, seed).slice(0, Math.min(count, pool.length));
}
