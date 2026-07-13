// 過去のライブアーカイブ画面（L7）用のダミーデータ。
// 仕様書§11「アーカイブ機能」を踏まえ、過去のお題・回答・獲得いいね数（スコア相当）を持たせる。
// 実際のスコアはeq0/1/2点の合計だが、アーカイブ閲覧者向けには分かりやすく「いいね数」として見せる。

export interface ArchiveAnswer {
  id: string;
  author: string;
  body: string;
  likes: number;
}

export interface ArchiveTopic {
  id: string;
  body: string;
  answers: ArchiveAnswer[];
}

export interface ArchiveLive {
  id: string;
  title: string;
  dateLabel: string;
  topics: ArchiveTopic[];
}

export const ARCHIVE_LIVES: ArchiveLive[] = [
  {
    id: "live-20260706",
    title: "第12回 大喜利道場",
    dateLabel: "2026年7月6日（月）21:00開演",
    topics: [
      {
        id: "t-20260706-1",
        body: "新装開店した激安ラーメン屋『激安』。値段以外にヤバいところがあるとしたら？",
        answers: [
          { id: "a-1", author: "笑福亭ライトニング", body: "店員が全員無銭修行中の弟子だった", likes: 342 },
          { id: "a-2", author: "扇子亭こんぶ", body: "スープの出汁が前世の記憶", likes: 198 },
          { id: "a-3", author: "べらんめえ次郎", body: "替え玉すると住民票が動く", likes: 121 },
          { id: "a-4", author: "招き猫ケンタ", body: "餃子が正座して出てくる", likes: 76 },
        ],
      },
      {
        id: "t-20260706-2",
        body: "師匠に弟子入りしたら、まさかの修行内容だった。何をさせられた？",
        answers: [
          { id: "a-5", author: "三日月アキラ", body: "師匠の代わりにネタ帳へ査定を書かされた", likes: 289 },
          { id: "a-6", author: "座布団ヒナ", body: "毎朝、座布団を10枚投げる素振り", likes: 154 },
          { id: "a-7", author: "太鼓持ちマサ", body: "楽屋の湯呑みの温度当てクイズ", likes: 88 },
        ],
      },
    ],
  },
  {
    id: "live-20260629",
    title: "第11回 大喜利道場",
    dateLabel: "2026年6月29日（月）21:00開演",
    topics: [
      {
        id: "t-20260629-1",
        body: "宇宙人が地球に来て、一番最初に驚いたこととは？",
        answers: [
          { id: "a-8", author: "早口テツヤ", body: "自販機がすでに接客業だったこと", likes: 411 },
          { id: "a-9", author: "落語亭シロップ", body: "道場が寄席の実況を24時間流していたこと", likes: 233 },
          { id: "a-10", author: "半纏のリョウ", body: "座布団に序列があること", likes: 140 },
          { id: "a-11", author: "めくり札カナ", body: "挨拶より先に大喜利をやらされたこと", likes: 62 },
        ],
      },
      {
        id: "t-20260629-2",
        body: "実は幽霊だった落語家。バレたきっかけは？",
        answers: [
          { id: "a-12", author: "高座のユウ", body: "楽屋の出席簿に名前だけずっと残っていた", likes: 301 },
          { id: "a-13", author: "楽屋裏ミナミ", body: "座布団に一切座った跡がなかった", likes: 177 },
        ],
      },
    ],
  },
];

export function getAllArchiveAnswers(): ArchiveAnswer[] {
  return ARCHIVE_LIVES.flatMap((live) => live.topics.flatMap((topic) => topic.answers));
}
