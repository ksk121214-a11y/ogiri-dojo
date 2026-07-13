// ランキング画面用のダミー参加者データ。
// 仕様書§6.4「実数は控えめに段位という称号で見せる」方針を踏まえ、主役は段位表示。
// スコアは補足情報として小さく添える程度に留める。

import type { RankKey } from "@/types/economy";

export interface DummyRankingEntry {
  id: string;
  name: string;
  rank: RankKey;
  score: number; // 通算スコア（演出用のダミー値）
}

export const DUMMY_RANKING: DummyRankingEntry[] = [
  { id: "r1", name: "笑福亭ライトニング", rank: "tatsujin", score: 12480 },
  { id: "r2", name: "扇子亭こんぶ", rank: "meijin", score: 8210 },
  { id: "r3", name: "三日月アキラ", rank: "meijin", score: 6890 },
  { id: "r4", name: "大看板・銀次", rank: "ookanban", score: 4520 },
  { id: "r5", name: "べらんめえ次郎", rank: "ookanban", score: 3760 },
  { id: "r6", name: "花形亭サクラ", rank: "hanagata_shinuchi", score: 2380 },
  { id: "r7", name: "落語亭シロップ", rank: "hanagata_shinuchi", score: 2010 },
  { id: "r8", name: "太鼓持ちマサ", rank: "shinuchi", score: 1150 },
  { id: "r9", name: "座布団ヒナ", rank: "shinuchi", score: 980 },
  { id: "r10", name: "招き猫ケンタ", rank: "futatsume", score: 520 },
  { id: "r11", name: "楽屋裏ミナミ", rank: "futatsume", score: 410 },
  { id: "r12", name: "早口テツヤ", rank: "zenza", score: 190 },
  { id: "r13", name: "半纏のリョウ", rank: "zenza", score: 160 },
  { id: "r14", name: "めくり札カナ", rank: "minarai", score: 40 },
];
