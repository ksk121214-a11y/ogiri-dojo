// SNS簡易版（/sns）用のダミーお題・回答データ。
// ランキング（rankingData.ts）・過去のライブ（archiveData.ts）と同じ演者名を一部再利用しつつ、
// 道場らしい「弟子入り・楽屋・高座」ネタでお題・回答を新規に用意する。
// 投稿者は authorId で snsAuthors.ts のダミープロフィール（演者名・段位・アイコン）を参照する。

import type { SnsAnswer, SnsComment, SnsTopic } from "@/types/sns";

export const INITIAL_SNS_TOPICS: SnsTopic[] = [
  {
    id: "sns-t1",
    body: "新弟子が入門初日に渡された『道場の心得』、まさかの内容とは",
    authorId: "author-raitoningu",
    createdAtLabel: "3日前",
  },
  {
    id: "sns-t2",
    body: "師匠の楽屋に貼ってあった張り紙、何が書いてあった？",
    authorId: "author-hina",
    createdAtLabel: "4日前",
  },
  {
    id: "sns-t3",
    body: "高座に上がった瞬間、客席がざわついた理由とは",
    authorId: "author-tetsuya",
    createdAtLabel: "5日前",
  },
  {
    id: "sns-t4",
    body: "二ツ目に昇進した途端、変わったこととは",
    authorId: "author-sakura",
    createdAtLabel: "6日前",
  },
  {
    id: "sns-t5",
    body: "稽古用の座布団、実はとんでもない機能付きだった",
    authorId: "author-konbu",
    createdAtLabel: "1週間前",
  },
  {
    id: "sns-t6",
    body: "番付表に載った瞬間、家族の反応が変わった。何が起きた？",
    authorId: "author-akira",
    createdAtLabel: "1週間前",
  },
  {
    id: "sns-t7",
    body: "幕が開く直前、舞台袖でこっそりやっていることとは",
    authorId: "author-syrup",
    createdAtLabel: "9日前",
  },
  {
    id: "sns-t8",
    body: "この道場、実は変わったルールがある。それは？",
    authorId: "author-kana",
    createdAtLabel: "10日前",
  },
  {
    id: "sns-t9",
    body: "打ち上げで師匠が一番喜ぶお土産とは",
    authorId: "author-kenta",
    createdAtLabel: "12日前",
  },
  {
    id: "sns-t10",
    body: "破門寸前だった弟子が土壇場で許された理由とは",
    authorId: "author-jirou",
    createdAtLabel: "2週間前",
  },
];

export const INITIAL_SNS_ANSWERS: SnsAnswer[] = [
  // sns-t1
  { id: "sns-a1", topicId: "sns-t1", authorId: "author-raitoningu", body: "一日一回、必ず誰かを笑わせること。できなければ正座", likes: 88, createdAtLabel: "3日前" },
  { id: "sns-a2", topicId: "sns-t1", authorId: "author-konbu", body: "スマホの着信音は全部落語の出囃子に統一", likes: 54, createdAtLabel: "3日前" },
  { id: "sns-a3", topicId: "sns-t1", authorId: "author-kenta", body: "先輩への挨拶は必ず一発ギャグ付き", likes: 33, createdAtLabel: "2日前" },
  { id: "sns-a4", topicId: "sns-t1", authorId: "author-jirou", body: "心得その1『とにかく笑わせろ』心得その2『以下同文』", likes: 21, createdAtLabel: "2日前" },

  // sns-t2
  { id: "sns-a5", topicId: "sns-t2", authorId: "author-hina", body: "『お茶は3杯目からが本番』", likes: 76, createdAtLabel: "4日前" },
  { id: "sns-a6", topicId: "sns-t2", authorId: "author-akira", body: "『愚痴を言う前に一句詠め』", likes: 61, createdAtLabel: "4日前" },
  { id: "sns-a7", topicId: "sns-t2", authorId: "author-masa", body: "『鏡の前で30分笑う練習をすること』", likes: 40, createdAtLabel: "3日前" },
  { id: "sns-a8", topicId: "sns-t2", authorId: "author-minami", body: "『忘れ物：弟子の存在感』", likes: 15, createdAtLabel: "3日前" },

  // sns-t3
  { id: "sns-a9", topicId: "sns-t3", authorId: "author-tetsuya", body: "羽織の下がパジャマだった", likes: 102, createdAtLabel: "5日前" },
  { id: "sns-a10", topicId: "sns-t3", authorId: "author-syrup", body: "まくらが長すぎて出囃子が2周した", likes: 67, createdAtLabel: "5日前" },
  { id: "sns-a11", topicId: "sns-t3", authorId: "author-ryou", body: "座布団の上に小さい座布団がもう一枚あった", likes: 45, createdAtLabel: "4日前" },
  { id: "sns-a12", topicId: "sns-t3", authorId: "author-kana", body: "開口一番『すみません道に迷いました』", likes: 29, createdAtLabel: "4日前" },
  { id: "sns-a13", topicId: "sns-t3", authorId: "author-ginji", body: "客席の最前列が全員師匠だった", likes: 18, createdAtLabel: "3日前" },

  // sns-t4
  { id: "sns-a14", topicId: "sns-t4", authorId: "author-sakura", body: "楽屋でお茶を注ぐ側から注がれる側になった", likes: 58, createdAtLabel: "6日前" },
  { id: "sns-a15", topicId: "sns-t4", authorId: "author-yuu", body: "名刺の肩書きだけやたら達筆になった", likes: 37, createdAtLabel: "5日前" },
  { id: "sns-a16", topicId: "sns-t4", authorId: "author-raitoningu", body: "後輩からの「兄さん」呼びに毎回照れる", likes: 24, createdAtLabel: "5日前" },

  // sns-t5
  { id: "sns-a17", topicId: "sns-t5", authorId: "author-konbu", body: "正座して30分経つと自動で正座を採点してくる", likes: 71, createdAtLabel: "1週間前" },
  { id: "sns-a18", topicId: "sns-t5", authorId: "author-kenta", body: "滑ると師匠のダメ出しが再生される", likes: 49, createdAtLabel: "6日前" },
  { id: "sns-a19", topicId: "sns-t5", authorId: "author-jirou", body: "裏返すとポイントカードになっている", likes: 30, createdAtLabel: "6日前" },

  // sns-t6
  { id: "sns-a20", topicId: "sns-t6", authorId: "author-hina", body: "親戚一同が急に敬語になった", likes: 63, createdAtLabel: "1週間前" },
  { id: "sns-a21", topicId: "sns-t6", authorId: "author-akira", body: "実家の座布団が急に新調された", likes: 41, createdAtLabel: "1週間前" },
  { id: "sns-a22", topicId: "sns-t6", authorId: "author-masa", body: "父が名刺代わりに番付表のコピーを配りだした", likes: 28, createdAtLabel: "1週間前" },
  { id: "sns-a23", topicId: "sns-t6", authorId: "author-minami", body: "母が近所に『うちの子、番付です』と貼り紙した", likes: 19, createdAtLabel: "6日前" },

  // sns-t7
  { id: "sns-a24", topicId: "sns-t7", authorId: "author-tetsuya", body: "小声でネタ帳の最終確認、実は白紙", likes: 55, createdAtLabel: "9日前" },
  { id: "sns-a25", topicId: "sns-t7", authorId: "author-syrup", body: "出囃子に合わせて全力の発声練習", likes: 38, createdAtLabel: "8日前" },
  { id: "sns-a26", topicId: "sns-t7", authorId: "author-ryou", body: "後輩と本番前ジャンケンでネタ順を決め直している", likes: 22, createdAtLabel: "8日前" },

  // sns-t8
  { id: "sns-a27", topicId: "sns-t8", authorId: "author-kana", body: "ウケなかった回答は座布団没収ではなく正座で供養", likes: 47, createdAtLabel: "10日前" },
  { id: "sns-a28", topicId: "sns-t8", authorId: "author-ginji", body: "入門3年目までは出囃子を自分で口ずさみながら登場", likes: 35, createdAtLabel: "9日前" },
  { id: "sns-a29", topicId: "sns-t8", authorId: "author-sakura", body: "師匠より先に笑ったら反則負け", likes: 26, createdAtLabel: "9日前" },
  { id: "sns-a30", topicId: "sns-t8", authorId: "author-yuu", body: "番付が上がるたびにお茶請けのグレードが上がる", likes: 14, createdAtLabel: "8日前" },

  // sns-t9
  { id: "sns-a31", topicId: "sns-t9", authorId: "author-raitoningu", body: "弟子のネタ帳、ただしダメ出し用", likes: 39, createdAtLabel: "12日前" },
  { id: "sns-a32", topicId: "sns-t9", authorId: "author-konbu", body: "番付表に自分の名前を書き足したお品書き", likes: 27, createdAtLabel: "11日前" },
  { id: "sns-a33", topicId: "sns-t9", authorId: "author-kenta", body: "一番弟子からの手作り座布団カバー", likes: 20, createdAtLabel: "11日前" },

  // sns-t10
  { id: "sns-a34", topicId: "sns-t10", authorId: "author-jirou", body: "土下座の姿勢があまりに美しく師匠が感動した", likes: 84, createdAtLabel: "2週間前" },
  { id: "sns-a35", topicId: "sns-t10", authorId: "author-hina", body: "反省文が思わず笑ってしまうほど面白かった", likes: 57, createdAtLabel: "2週間前" },
  { id: "sns-a36", topicId: "sns-t10", authorId: "author-akira", body: "破門を言い渡す前に弟子が先に「ありがとうございました」と三段オチで返した", likes: 33, createdAtLabel: "13日前" },
];

// 回答へのツッコミ（コメント）のダミー初期データ。
export const INITIAL_SNS_COMMENTS: SnsComment[] = [
  { id: "sns-c1", answerId: "sns-a1", authorId: "author-hina", body: "正座で覚える心得、逆に忘れなさそう", createdAtLabel: "3日前" },
  { id: "sns-c2", answerId: "sns-a1", authorId: "author-kenta", body: "初日からハードモードすぎる", createdAtLabel: "2日前" },
  { id: "sns-c3", answerId: "sns-a9", authorId: "author-kana", body: "羽織の下パジャマは事故りすぎ", createdAtLabel: "5日前" },
  { id: "sns-c4", answerId: "sns-a9", authorId: "author-ginji", body: "客席も一緒にざわつく気持ち分かる", createdAtLabel: "4日前" },
  { id: "sns-c5", answerId: "sns-a5", authorId: "author-akira", body: "3杯目からが本番、深すぎる格言", createdAtLabel: "4日前" },
  { id: "sns-c6", answerId: "sns-a17", authorId: "author-jirou", body: "正座を採点する座布団、道場でしか通用しない発明", createdAtLabel: "1週間前" },
  { id: "sns-c7", answerId: "sns-a20", authorId: "author-masa", body: "親戚一同が敬語になる現象、うちにもあった", createdAtLabel: "1週間前" },
  { id: "sns-c8", answerId: "sns-a24", authorId: "author-ryou", body: "ネタ帳が白紙、それもう伝説の一席", createdAtLabel: "9日前" },
  { id: "sns-c9", answerId: "sns-a27", authorId: "author-yuu", body: "座布団没収より正座で供養の方が味がある", createdAtLabel: "10日前" },
  { id: "sns-c10", answerId: "sns-a31", authorId: "author-syrup", body: "ダメ出し専用ネタ帳、師匠の愛が重い", createdAtLabel: "12日前" },
  { id: "sns-c11", answerId: "sns-a34", authorId: "author-hina", body: "土下座が美しいって新しい褒め方すぎる", createdAtLabel: "2週間前" },
  { id: "sns-c12", answerId: "sns-a34", authorId: "author-tetsuya", body: "破門寸前からの美しい土下座、逆転劇として完璧", createdAtLabel: "2週間前" },
  { id: "sns-c13", answerId: "sns-a14", authorId: "author-konbu", body: "お茶を注ぐ側から注がれる側、出世を実感する瞬間", createdAtLabel: "6日前" },
  { id: "sns-c14", answerId: "sns-a10", authorId: "author-sakura", body: "まくらが長すぎて出囃子2周、時間感覚どうなってるの", createdAtLabel: "5日前" },
];
