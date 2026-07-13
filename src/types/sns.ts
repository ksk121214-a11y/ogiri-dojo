// SNS簡易版（お題投稿・回答投稿・いいね）で扱うダミーデータの型。
// 大喜利SNS（姉妹プロジェクト）のTopic/Answerを参考にしつつ、フォロー・通報等は持たない簡易版のため型も絞っている。
// createdAtはDate.now()起点で計算するとSSR/CSRのずれでハイドレーション不一致を起こすため、
// 表示用の固定ラベル文字列（例："3日前"）として持たせる。
//
// authorIdは投稿者を一意に識別するID。自分の投稿は"me"固定とし、マイページ（useUserStore）と
// 同じ情報源（演者名・段位・装備アイコン）を表示時に参照する。それ以外はsnsAuthors.tsのダミー
// 投稿者プロフィール（演者名・段位・アイコン絵文字）をauthorIdで引いて表示する。

export interface SnsTopic {
  id: string;
  body: string;
  authorId: string;
  createdAtLabel: string;
}

export interface SnsAnswer {
  id: string;
  topicId: string;
  authorId: string;
  body: string;
  likes: number;
  createdAtLabel: string;
}

// 回答へのツッコミ（コメント）。大喜利SNS本家のCommentを踏まえた道場版の型。
export interface SnsComment {
  id: string;
  answerId: string;
  authorId: string;
  body: string;
  createdAtLabel: string;
}
