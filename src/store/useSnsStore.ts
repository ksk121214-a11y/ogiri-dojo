// SNS簡易版（/sns）用のダミー状態管理（Zustand）。
// 大喜利SNS（姉妹プロジェクト）の簡易移植：お題投稿・回答投稿・いいね・ツッコミ（コメント）・
// フォローを持つ。通報・詳細な画像投稿等は持たない。永続化・Supabase接続はせず、
// このブラウザタブ内で完結するダミーデータとして扱う（useUserStore/useLiveDemoStoreと同方針）。

import { create } from "zustand";

import {
  INITIAL_SNS_ANSWERS,
  INITIAL_SNS_COMMENTS,
  INITIAL_SNS_TOPICS,
} from "@/data/snsData";
import type { SnsAnswer, SnsComment, SnsTopic } from "@/types/sns";

let idSeq = 0;
function genId(prefix: string) {
  idSeq += 1;
  return `${prefix}-local-${idSeq}`;
}

// 初期状態で「フォロー済み」にしておくダミー投稿者（フォロー中タブを試しやすくするため）。
const INITIAL_FOLLOWING_AUTHOR_IDS = [
  "author-raitoningu",
  "author-hina",
  "author-konbu",
];

interface SnsState {
  topics: SnsTopic[];
  answers: SnsAnswer[];
  comments: SnsComment[];
  likedAnswerIds: string[];
  followingAuthorIds: string[];
  addTopic: (body: string) => SnsTopic;
  addAnswer: (topicId: string, body: string) => SnsAnswer;
  addComment: (answerId: string, body: string) => SnsComment;
  toggleLike: (answerId: string) => void;
  toggleFollow: (authorId: string) => void;
  isFollowing: (authorId: string) => boolean;
}

export const useSnsStore = create<SnsState>()((set, get) => ({
  topics: INITIAL_SNS_TOPICS,
  answers: INITIAL_SNS_ANSWERS,
  comments: INITIAL_SNS_COMMENTS,
  likedAnswerIds: [],
  followingAuthorIds: INITIAL_FOLLOWING_AUTHOR_IDS,

  // 自分の投稿はauthorId固定の"me"とし、表示名・段位・アイコンはマイページと同じ
  // useUserStoreを表示側（SnsAuthorBadge）で参照する（演者名の二重管理を避けるため保存しない）。
  addTopic: (body) => {
    const topic: SnsTopic = {
      id: genId("sns-t"),
      body,
      authorId: "me",
      createdAtLabel: "たった今",
    };
    set((s) => ({ topics: [topic, ...s.topics] }));
    return topic;
  },

  addAnswer: (topicId, body) => {
    const answer: SnsAnswer = {
      id: genId("sns-a"),
      topicId,
      body,
      authorId: "me",
      likes: 0,
      createdAtLabel: "たった今",
    };
    set((s) => ({ answers: [...s.answers, answer] }));
    return answer;
  },

  addComment: (answerId, body) => {
    const comment: SnsComment = {
      id: genId("sns-c"),
      answerId,
      authorId: "me",
      body,
      createdAtLabel: "たった今",
    };
    set((s) => ({ comments: [...s.comments, comment] }));
    return comment;
  },

  toggleLike: (answerId) => {
    const alreadyLiked = get().likedAnswerIds.includes(answerId);
    set((s) => ({
      likedAnswerIds: alreadyLiked
        ? s.likedAnswerIds.filter((id) => id !== answerId)
        : [...s.likedAnswerIds, answerId],
      answers: s.answers.map((a) =>
        a.id === answerId
          ? { ...a, likes: Math.max(0, a.likes + (alreadyLiked ? -1 : 1)) }
          : a,
      ),
    }));
  },

  toggleFollow: (authorId) => {
    if (authorId === "me") return;
    const alreadyFollowing = get().followingAuthorIds.includes(authorId);
    set((s) => ({
      followingAuthorIds: alreadyFollowing
        ? s.followingAuthorIds.filter((id) => id !== authorId)
        : [...s.followingAuthorIds, authorId],
    }));
  },

  isFollowing: (authorId) => get().followingAuthorIds.includes(authorId),
}));
