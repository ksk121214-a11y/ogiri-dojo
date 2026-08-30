// SNS簡易版（/sns）用の状態管理（Zustand）。
// 大喜利SNS（姉妹プロジェクト）の簡易移植：お題投稿・回答投稿・いいね・ツッコミ（コメント）・
// フォローを持つ。通報・詳細な画像投稿等は持たない。
//
// 2026-08-30（運営者専用管理画面の追加・第3段階）：投稿・回答・コメントの本体データを
// Supabase（sns_topics/sns_answers/sns_comments）へ実際に保存するようにした。
// ただし以下は変更していない（既存動作の維持・スコープ限定のため）：
// - フォロー数・いいねの重複防止等の集計機能はDB化せず、従来どおりローカルのみ。
// - 既存の「author-xxx」ダミー投稿（src/data/snsData.ts）は表示用にそのまま残す。
// - 自分の投稿を指す特別値"me"の扱い（authorId==="me"を見て回るSnsAuthorBadge等の
//   既存ロジック）は一切変更しない。DBのauthor_id列には実際のユーザーIDを保存するが、
//   ローカルstateに載せる際は「閲覧者自身の投稿ならauthorId:'me'に変換する」ことで、
//   既存の判定ロジックとの整合を保っている。
// - 未ログイン時やDB書き込み失敗時は、従来どおりローカルのみのダミー投稿にフォールバックする
//   （寄合帳はログイン必須ページではないため、投稿自体をブロックしない）。
import { create } from "zustand";

import {
  INITIAL_SNS_ANSWERS,
  INITIAL_SNS_COMMENTS,
  INITIAL_SNS_TOPICS,
} from "@/data/snsData";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import type { SnsAnswer, SnsComment, SnsTopic } from "@/types/sns";

let idSeq = 0;
function genId(prefix: string) {
  idSeq += 1;
  return `${prefix}-local-${idSeq}`;
}

// DBのtimestamptzを表示用の相対時間ラベルに変換する（取得時点で1回だけ計算する
// ため、既存のcreatedAtLabel設計＝SSR/CSRのずれを避ける固定文字列と矛盾しない）。
function formatRelativeLabel(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}日前`;
  return `${Math.floor(diffDay / 7)}週間前`;
}

// 初期状態で「フォロー済み」にしておくダミー投稿者（フォロー中タブを試しやすくするため）。
const INITIAL_FOLLOWING_AUTHOR_IDS = [
  "author-raitoningu",
  "author-hina",
  "author-konbu",
];

export interface RealAuthorInfo {
  displayName: string;
  avatarIcon: string;
  avatarColor: string;
}

interface SnsState {
  topics: SnsTopic[];
  answers: SnsAnswer[];
  comments: SnsComment[];
  likedAnswerIds: string[];
  followingAuthorIds: string[];
  // "author-"にもマッチせず"me"でもない実データ投稿者（UUID）の表示名解決結果。
  // SnsAuthorBadge.tsx等がこれを見て、他ユーザーの実投稿の表示名・アイコンを出す。
  realAuthorNames: Record<string, RealAuthorInfo>;
  loaded: boolean;
  init: () => Promise<void>;
  addTopic: (body: string) => Promise<SnsTopic>;
  addAnswer: (topicId: string, body: string) => Promise<SnsAnswer>;
  addComment: (answerId: string, body: string) => Promise<SnsComment>;
  toggleLike: (answerId: string) => void;
  toggleFollow: (authorId: string) => void;
  isFollowing: (authorId: string) => boolean;
}

// 実データ投稿者ID一覧をまとめてsns_author_namesで解決し、storeにキャッシュする。
async function resolveRealAuthorNames(authorIds: string[]) {
  if (authorIds.length === 0) return;
  const { data } = await supabase.rpc("sns_author_names", { p_ids: authorIds });
  const map: Record<string, RealAuthorInfo> = {};
  for (const row of (data ?? []) as {
    id: string;
    display_name: string;
    avatar_icon: string;
    avatar_color: string;
  }[]) {
    map[row.id] = { displayName: row.display_name, avatarIcon: row.avatar_icon, avatarColor: row.avatar_color };
  }
  useSnsStore.setState((s) => ({ realAuthorNames: { ...s.realAuthorNames, ...map } }));
}

export const useSnsStore = create<SnsState>()((set, get) => ({
  topics: INITIAL_SNS_TOPICS,
  answers: INITIAL_SNS_ANSWERS,
  comments: INITIAL_SNS_COMMENTS,
  likedAnswerIds: [],
  followingAuthorIds: INITIAL_FOLLOWING_AUTHOR_IDS,
  realAuthorNames: {},
  loaded: false,

  // Supabaseから実データ（is_hidden=falseのみ）を取得し、既存のダミーデータの
  // 前に差し込む（新着優先）。呼び出しは何度でも安全（loaded済みなら何もしない）。
  init: async () => {
    if (get().loaded) return;
    set({ loaded: true }); // 二重初期化防止（await前にフラグを立てる）
    const myUserId = useAuthStore.getState().user?.id ?? null;
    const toAuthorId = (id: string) => (id === myUserId ? "me" : id);

    const [{ data: topicsData }, { data: answersData }, { data: commentsData }] = await Promise.all([
      supabase.from("sns_topics").select("*").eq("is_hidden", false).order("created_at", { ascending: false }),
      supabase.from("sns_answers").select("*").eq("is_hidden", false),
      supabase.from("sns_comments").select("*").eq("is_hidden", false),
    ]);

    const dbTopics: SnsTopic[] = (topicsData ?? []).map((t) => ({
      id: t.id,
      body: t.body,
      authorId: toAuthorId(t.author_id),
      createdAtLabel: formatRelativeLabel(t.created_at),
    }));
    const dbAnswers: SnsAnswer[] = (answersData ?? []).map((a) => ({
      id: a.id,
      topicId: a.topic_id,
      authorId: toAuthorId(a.author_id),
      body: a.body,
      likes: a.likes,
      createdAtLabel: formatRelativeLabel(a.created_at),
    }));
    const dbComments: SnsComment[] = (commentsData ?? []).map((c) => ({
      id: c.id,
      answerId: c.answer_id,
      authorId: toAuthorId(c.author_id),
      body: c.body,
      createdAtLabel: formatRelativeLabel(c.created_at),
    }));

    set((s) => ({
      topics: [...dbTopics, ...s.topics],
      answers: [...s.answers, ...dbAnswers],
      comments: [...s.comments, ...dbComments],
    }));

    const authorIds = new Set<string>();
    for (const t of dbTopics) if (t.authorId !== "me") authorIds.add(t.authorId);
    for (const a of dbAnswers) if (a.authorId !== "me") authorIds.add(a.authorId);
    for (const c of dbComments) if (c.authorId !== "me") authorIds.add(c.authorId);
    await resolveRealAuthorNames([...authorIds]);
  },

  // 自分の投稿はローカルstate上ではauthorId固定の"me"とし、表示名・段位・アイコンは
  // マイページと同じuseUserStoreを表示側（SnsAuthorBadge）で参照する（演者名の
  // 二重管理を避けるため保存しない）。ログイン中はSupabaseへも実データとして保存する。
  addTopic: async (body) => {
    const userId = useAuthStore.getState().user?.id;
    if (userId) {
      const { data, error } = await supabase
        .from("sns_topics")
        .insert({ author_id: userId, body })
        .select()
        .single();
      if (!error && data) {
        const topic: SnsTopic = { id: data.id, body: data.body, authorId: "me", createdAtLabel: "たった今" };
        set((s) => ({ topics: [topic, ...s.topics] }));
        return topic;
      }
      console.warn("[sns] お題投稿の保存に失敗、ローカルのみで継続", error);
    }
    const topic: SnsTopic = { id: genId("sns-t"), body, authorId: "me", createdAtLabel: "たった今" };
    set((s) => ({ topics: [topic, ...s.topics] }));
    return topic;
  },

  addAnswer: async (topicId, body) => {
    const userId = useAuthStore.getState().user?.id;
    if (userId) {
      const { data, error } = await supabase
        .from("sns_answers")
        .insert({ topic_id: topicId, author_id: userId, body })
        .select()
        .single();
      if (!error && data) {
        const answer: SnsAnswer = {
          id: data.id,
          topicId: data.topic_id,
          body: data.body,
          authorId: "me",
          likes: 0,
          createdAtLabel: "たった今",
        };
        set((s) => ({ answers: [...s.answers, answer] }));
        return answer;
      }
      console.warn("[sns] 回答投稿の保存に失敗、ローカルのみで継続", error);
    }
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

  addComment: async (answerId, body) => {
    const userId = useAuthStore.getState().user?.id;
    if (userId) {
      const { data, error } = await supabase
        .from("sns_comments")
        .insert({ answer_id: answerId, author_id: userId, body })
        .select()
        .single();
      if (!error && data) {
        const comment: SnsComment = {
          id: data.id,
          answerId: data.answer_id,
          authorId: "me",
          body: data.body,
          createdAtLabel: "たった今",
        };
        set((s) => ({ comments: [...s.comments, comment] }));
        return comment;
      }
      console.warn("[sns] コメント投稿の保存に失敗、ローカルのみで継続", error);
    }
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

if (typeof window !== "undefined") {
  useSnsStore.getState().init();
}
