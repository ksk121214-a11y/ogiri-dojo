// SNS簡易版（/sns）用の状態管理（Zustand）。
// 大喜利SNS（姉妹プロジェクト）の簡易移植：お題投稿・回答投稿・いいね・ツッコミ（コメント）・
// フォローを持つ。通報・詳細な画像投稿等は持たない。
//
// 2026-08-30（運営者専用管理画面の追加・第3段階）：投稿・回答・コメントの本体データを
// Supabase（sns_topics/sns_answers/sns_comments）へ実際に保存するようにした。
// 2026-08-30（いいね・フォローの実データ化）：以下を追加で変更した。
// - いいね（sns_answer_likes）・フォロー（sns_follows）をSupabaseへ実際に保存するように
//   した（0030マイグレーション）。リロード後も状態・件数が残り、他ユーザーからも同じ
//   件数が見える。sns_answers.likesはトリガーで自動更新されるため、クライアントからは
//   直接updateしない。
// - お題・回答一覧の無条件全件取得をやめ、新着順にPAGE_SIZE件ずつ取得する方式にした
//   （「もっと見る」で追加ロード）。既存の「フィード内でのタブ切り替え・新着/人気ソート・
//   フォロー中フィルタ」はロード済みの範囲内でクライアント側フィルタ、という既存ロジック
//   自体は変更していない。
// - 本番環境（NODE_ENV==="production"）ではダミー投稿者・ダミー投稿（"author-xxx"）を
//   一切stateに載せない。開発環境では従来どおり動作確認用に残す。
// 変更していない前提：
// - 自分の投稿を指す特別値"me"の扱い（authorId==="me"を見て回るSnsAuthorBadge等の
//   既存ロジック）は一切変更しない。DBのauthor_id列には実際のユーザーIDを保存するが、
//   ローカルstateに載せる際は「閲覧者自身の投稿ならauthorId:'me'に変換する」ことで、
//   既存の判定ロジックとの整合を保っている。
// - 未ログイン時やDB書き込み失敗時、投稿（お題/回答/コメント）は従来どおりローカルのみの
//   ダミー投稿にフォールバックする（寄合帳はログイン必須ページではないため）。ただし
//   いいね・フォローは「ローカルに存在する」こと自体に意味が薄く、DB化した以上サイレント
//   にローカルへ逃がすとリロードで消えて体験を損なうため、未ログイン時は失敗を返して
//   ログインを促す（フォールバックしない）。
import { create } from "zustand";

import {
  INITIAL_SNS_ANSWERS,
  INITIAL_SNS_COMMENTS,
  INITIAL_SNS_TOPICS,
} from "@/data/snsData";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import type { SnsAnswer, SnsComment, SnsTopic } from "@/types/sns";

const PAGE_SIZE = 30;

// 本番環境ではダミー投稿者・ダミー投稿を一切表示しない。開発環境（next dev、プレビュー等）
// でのみ動作確認用に残す。NODE_ENV==="production"はVercelの本番ビルドで自動的に
// 設定されるため、専用の環境変数は増やさない。
const SHOW_DUMMY_DATA = process.env.NODE_ENV !== "production";

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
// 本番では表示されないダミー投稿者なので本番では空にする（ログイン中はinit()でDBの
// 実データによりすぐ上書きされる）。
const INITIAL_FOLLOWING_AUTHOR_IDS = SHOW_DUMMY_DATA
  ? ["author-raitoningu", "author-hina", "author-konbu"]
  : [];

export interface RealAuthorInfo {
  displayName: string;
  avatarIcon: string;
  avatarColor: string;
  // 2026-08-31（段位・ポイント・実績の実データ化）：他ユーザーのプロフィールに
  // 段位・一言コメントを表示するため、sns_author_names RPCの戻り値に追加した2列。
  masteryMeter: number;
  bio: string;
}

export type ActionResult = { ok: true } | { ok: false; message?: string };

// 寄合帳フィード（SnsFeedSection.tsx）のタブ選択状態。コンポーネントのローカルstate
// ではなくこのストアに持たせることで、「ライブ結果の詳細を見て戻るボタンで戻る」
// といった画面遷移でSnsFeedSectionが再マウントされても、選んでいたタブが
// お題/おすすめにリセットされず元の状態のまま復元される。
export type SnsFeedKind = "topics" | "answers" | "results";
export type SnsAudienceKind = "forYou" | "following";
export type SnsSortKind = "new" | "popular";

interface SnsState {
  topics: SnsTopic[];
  answers: SnsAnswer[];
  comments: SnsComment[];
  likedAnswerIds: string[];
  followingAuthorIds: string[];
  // 自分がフォローされている数（sns_followsの実カウント）。ログイン中のみinit()時に
  // 一度だけ取得する（マイページ・プロフィールカード双方から同じ値を参照させ、
  // 同じ集計を複数箇所で取得し直さないようにするため）。
  myFollowerCount: number | null;
  // "author-"にもマッチせず"me"でもない実データ投稿者（UUID）の表示名解決結果。
  // SnsAuthorBadge.tsx等がこれを見て、他ユーザーの実投稿の表示名・アイコンを出す。
  realAuthorNames: Record<string, RealAuthorInfo>;
  loaded: boolean;
  // ページネーション状態（お題・回答それぞれ、新着順のカーソル＝最後に取得した行のcreated_at）。
  topicsCursor: string | null;
  topicsHasMore: boolean;
  loadingMoreTopics: boolean;
  answersCursor: string | null;
  answersHasMore: boolean;
  loadingMoreAnswers: boolean;
  // 連打・二重送信防止（対象IDごとに処理中かどうか）。
  likePending: Record<string, boolean>;
  followPending: Record<string, boolean>;

  // フィードのタブ選択状態（上記コメント参照）。
  feedTab: SnsFeedKind;
  audienceTab: SnsAudienceKind;
  sortTab: SnsSortKind;
  setFeedTab: (tab: SnsFeedKind) => void;
  setAudienceTab: (tab: SnsAudienceKind) => void;
  setSortTab: (tab: SnsSortKind) => void;

  init: () => Promise<void>;
  loadMoreTopics: () => Promise<void>;
  loadMoreAnswers: () => Promise<void>;
  // ロード済みの範囲に無いお題/回答詳細ページに直接アクセスされた場合のフォールバック取得。
  fetchTopicById: (topicId: string) => Promise<SnsTopic | null>;
  fetchAnswerById: (answerId: string) => Promise<SnsAnswer | null>;
  // 投稿に一度も登場していない実ユーザー（フォロー関係だけで存在を知った場合等）の
  // 表示名・アイコンをその場で解決してrealAuthorNamesにキャッシュする。
  resolveAuthorName: (authorId: string) => Promise<void>;
  // プロフィールページ用：ページネーション導入後は一覧の1ページ目に無いその人の過去投稿が
  // 抜け落ちるため、プロフィールを開いた時点でそのauthorIdの投稿を別途まとめて取得する
  // （N+1ではなく、1ユーザーにつき2回のクエリで完結する）。
  fetchAuthorPosts: (authorId: string) => Promise<void>;
  addTopic: (body: string) => Promise<SnsTopic>;
  addAnswer: (topicId: string, body: string) => Promise<SnsAnswer>;
  addComment: (answerId: string, body: string) => Promise<SnsComment>;
  toggleLike: (answerId: string) => Promise<ActionResult>;
  toggleFollow: (authorId: string) => Promise<ActionResult>;
  isFollowing: (authorId: string) => boolean;
}

type DbTopicRow = {
  id: string;
  body: string;
  author_id: string;
  created_at: string;
};
type DbAnswerRow = {
  id: string;
  topic_id: string;
  author_id: string;
  body: string;
  likes: number;
  created_at: string;
};
type DbCommentRow = {
  id: string;
  answer_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

function toAuthorIdWith(myUserId: string | null) {
  return (id: string) => (id === myUserId ? "me" : id);
}

function mapTopicRow(t: DbTopicRow, toAuthorId: (id: string) => string): SnsTopic {
  return {
    id: t.id,
    body: t.body,
    authorId: toAuthorId(t.author_id),
    createdAtLabel: formatRelativeLabel(t.created_at),
  };
}
function mapAnswerRow(a: DbAnswerRow, toAuthorId: (id: string) => string): SnsAnswer {
  return {
    id: a.id,
    topicId: a.topic_id,
    authorId: toAuthorId(a.author_id),
    body: a.body,
    likes: a.likes,
    createdAtLabel: formatRelativeLabel(a.created_at),
  };
}
function mapCommentRow(c: DbCommentRow, toAuthorId: (id: string) => string): SnsComment {
  return {
    id: c.id,
    answerId: c.answer_id,
    authorId: toAuthorId(c.author_id),
    body: c.body,
    createdAtLabel: formatRelativeLabel(c.created_at),
  };
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
    mastery_meter: number;
    bio: string | null;
  }[]) {
    map[row.id] = {
      displayName: row.display_name,
      avatarIcon: row.avatar_icon,
      avatarColor: row.avatar_color,
      masteryMeter: row.mastery_meter,
      bio: row.bio ?? "",
    };
  }
  useSnsStore.setState((s) => ({ realAuthorNames: { ...s.realAuthorNames, ...map } }));
}

// Supabaseの一意制約違反（重複いいね・重複フォロー）のエラーコード。連打などで
// 「既に追加済みのものをもう一度追加しようとした」場合は実質成功として扱う。
const UNIQUE_VIOLATION = "23505";

export const useSnsStore = create<SnsState>()((set, get) => ({
  topics: SHOW_DUMMY_DATA ? INITIAL_SNS_TOPICS : [],
  answers: SHOW_DUMMY_DATA ? INITIAL_SNS_ANSWERS : [],
  comments: SHOW_DUMMY_DATA ? INITIAL_SNS_COMMENTS : [],
  likedAnswerIds: [],
  followingAuthorIds: INITIAL_FOLLOWING_AUTHOR_IDS,
  myFollowerCount: null,
  realAuthorNames: {},
  loaded: false,
  topicsCursor: null,
  topicsHasMore: true,
  loadingMoreTopics: false,
  answersCursor: null,
  answersHasMore: true,
  loadingMoreAnswers: false,
  likePending: {},
  followPending: {},

  feedTab: "topics",
  audienceTab: "forYou",
  sortTab: "new",
  setFeedTab: (tab) => set({ feedTab: tab }),
  setAudienceTab: (tab) => set({ audienceTab: tab }),
  setSortTab: (tab) => set({ sortTab: tab }),

  // Supabaseから実データ（is_hidden=falseのみ、新着順にPAGE_SIZE件）を取得し、開発環境では
  // 既存のダミーデータの前に差し込む（新着優先）。本番環境ではダミーデータ自体を持たない。
  // 呼び出しは何度でも安全（loaded済みなら何もしない）。
  init: async () => {
    if (get().loaded) return;
    set({ loaded: true }); // 二重初期化防止（await前にフラグを立てる）
    const myUserId = useAuthStore.getState().user?.id ?? null;
    const toAuthorId = toAuthorIdWith(myUserId);

    const [{ data: topicsData }, { data: answersData }] = await Promise.all([
      supabase
        .from("sns_topics")
        .select("*")
        .eq("is_hidden", false)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE),
      supabase
        .from("sns_answers")
        .select("*")
        .eq("is_hidden", false)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE),
    ]);

    const dbTopics: SnsTopic[] = ((topicsData ?? []) as DbTopicRow[]).map((t) => mapTopicRow(t, toAuthorId));
    const dbAnswers: SnsAnswer[] = ((answersData ?? []) as DbAnswerRow[]).map((a) => mapAnswerRow(a, toAuthorId));

    // 回答一覧の1ページ目に載った回答へのツッコミだけをまとめて取得する（全件取得はしない）。
    const answerIds = dbAnswers.map((a) => a.id);
    let dbComments: SnsComment[] = [];
    if (answerIds.length > 0) {
      const { data: commentsData } = await supabase
        .from("sns_comments")
        .select("*")
        .eq("is_hidden", false)
        .in("answer_id", answerIds);
      dbComments = ((commentsData ?? []) as DbCommentRow[]).map((c) => mapCommentRow(c, toAuthorId));
    }

    const lastTopicRow = (topicsData ?? [])[((topicsData ?? []).length || 1) - 1] as DbTopicRow | undefined;
    const lastAnswerRow = (answersData ?? [])[((answersData ?? []).length || 1) - 1] as DbAnswerRow | undefined;

    set((s) => ({
      // topics/answersはどちらも「先頭が最新」の並びに統一している。ダミーデータは
      // 開発環境でのみ、DB実データより後ろ（末尾寄り）に残す。
      topics: [...dbTopics, ...s.topics],
      answers: [...dbAnswers, ...s.answers],
      comments: [...dbComments, ...s.comments],
      topicsCursor: lastTopicRow ? lastTopicRow.created_at : null,
      topicsHasMore: (topicsData ?? []).length === PAGE_SIZE,
      answersCursor: lastAnswerRow ? lastAnswerRow.created_at : null,
      answersHasMore: (answersData ?? []).length === PAGE_SIZE,
    }));

    const authorIds = new Set<string>();
    for (const t of dbTopics) if (t.authorId !== "me") authorIds.add(t.authorId);
    for (const a of dbAnswers) if (a.authorId !== "me") authorIds.add(a.authorId);
    for (const c of dbComments) if (c.authorId !== "me") authorIds.add(c.authorId);
    await resolveRealAuthorNames([...authorIds]);

    // ログイン中なら、自分のいいね・フォロー状態をまとめて1回ずつ取得する
    // （投稿1件ごとに問い合わせるN+1を避ける）。
    if (myUserId) {
      const [{ data: likesData }, { data: followsData }, followerCountRes] = await Promise.all([
        supabase.from("sns_answer_likes").select("answer_id").eq("user_id", myUserId),
        supabase.from("sns_follows").select("following_id").eq("follower_id", myUserId),
        supabase.from("sns_follows").select("id", { count: "exact", head: true }).eq("following_id", myUserId),
      ]);
      set({
        likedAnswerIds: (likesData ?? []).map((r) => (r as { answer_id: string }).answer_id),
        followingAuthorIds: (followsData ?? []).map((r) => (r as { following_id: string }).following_id),
        myFollowerCount: followerCountRes.count ?? 0,
      });
    } else {
      // 未ログイン時は「…」のまま残らないよう0で確定させる。
      set({ myFollowerCount: 0 });
    }
  },

  // 「もっと見る」用の追加ロード。カーソル（前回取得した最後の行のcreated_at）より
  // 古いものだけを取得するため、スクロールのたびに同じ投稿を重複取得しない。
  loadMoreTopics: async () => {
    const { topicsCursor, topicsHasMore, loadingMoreTopics } = get();
    if (!topicsHasMore || loadingMoreTopics || !topicsCursor) return;
    set({ loadingMoreTopics: true });
    const myUserId = useAuthStore.getState().user?.id ?? null;
    const toAuthorId = toAuthorIdWith(myUserId);

    const { data, error } = await supabase
      .from("sns_topics")
      .select("*")
      .eq("is_hidden", false)
      .lt("created_at", topicsCursor)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (error || !data) {
      console.warn("[sns] お題の追加取得に失敗", error);
      set({ loadingMoreTopics: false });
      return;
    }

    const rows = data as DbTopicRow[];
    const newTopics = rows.map((t) => mapTopicRow(t, toAuthorId));
    const lastRow = rows[rows.length - 1];

    set((s) => ({
      // 新規に取得した分は末尾に追加する（開発環境ではダミーより後ろに来る場合があるが、
      // ダミーは動作確認用の固定表示のため実害はない）。
      topics: [...s.topics, ...newTopics],
      topicsCursor: lastRow ? lastRow.created_at : s.topicsCursor,
      topicsHasMore: rows.length === PAGE_SIZE,
      loadingMoreTopics: false,
    }));

    const authorIds = newTopics.filter((t) => t.authorId !== "me").map((t) => t.authorId);
    await resolveRealAuthorNames(authorIds);
  },

  loadMoreAnswers: async () => {
    const { answersCursor, answersHasMore, loadingMoreAnswers } = get();
    if (!answersHasMore || loadingMoreAnswers || !answersCursor) return;
    set({ loadingMoreAnswers: true });
    const myUserId = useAuthStore.getState().user?.id ?? null;
    const toAuthorId = toAuthorIdWith(myUserId);

    const { data, error } = await supabase
      .from("sns_answers")
      .select("*")
      .eq("is_hidden", false)
      .lt("created_at", answersCursor)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (error || !data) {
      console.warn("[sns] 回答の追加取得に失敗", error);
      set({ loadingMoreAnswers: false });
      return;
    }

    const rows = data as DbAnswerRow[];
    const newAnswers = rows.map((a) => mapAnswerRow(a, toAuthorId));
    const lastRow = rows[rows.length - 1];
    const newAnswerIds = newAnswers.map((a) => a.id);

    let newComments: SnsComment[] = [];
    if (newAnswerIds.length > 0) {
      const { data: commentsData } = await supabase
        .from("sns_comments")
        .select("*")
        .eq("is_hidden", false)
        .in("answer_id", newAnswerIds);
      newComments = ((commentsData ?? []) as DbCommentRow[]).map((c) => mapCommentRow(c, toAuthorId));
    }

    set((s) => ({
      answers: [...s.answers, ...newAnswers],
      comments: [...s.comments, ...newComments],
      answersCursor: lastRow ? lastRow.created_at : s.answersCursor,
      answersHasMore: rows.length === PAGE_SIZE,
      loadingMoreAnswers: false,
    }));

    const authorIds = new Set<string>();
    for (const a of newAnswers) if (a.authorId !== "me") authorIds.add(a.authorId);
    for (const c of newComments) if (c.authorId !== "me") authorIds.add(c.authorId);
    await resolveRealAuthorNames([...authorIds]);

    if (myUserId && newAnswerIds.length > 0) {
      const { data: likesData } = await supabase
        .from("sns_answer_likes")
        .select("answer_id")
        .eq("user_id", myUserId)
        .in("answer_id", newAnswerIds);
      const newLikedIds = (likesData ?? []).map((r) => (r as { answer_id: string }).answer_id);
      if (newLikedIds.length > 0) {
        set((s) => ({ likedAnswerIds: [...new Set([...s.likedAnswerIds, ...newLikedIds])] }));
      }
    }
  },

  // ページネーション導入後、1ページ目（ロード済み範囲）に無いお題/回答へ直接
  // アクセスされた場合（直リンク、共有URL等）のフォールバック取得。
  fetchTopicById: async (topicId) => {
    const existing = get().topics.find((t) => t.id === topicId);
    if (existing) return existing;
    const { data, error } = await supabase
      .from("sns_topics")
      .select("*")
      .eq("id", topicId)
      .eq("is_hidden", false)
      .maybeSingle();
    if (error || !data) return null;
    const myUserId = useAuthStore.getState().user?.id ?? null;
    const topic = mapTopicRow(data as DbTopicRow, toAuthorIdWith(myUserId));
    set((s) => (s.topics.some((t) => t.id === topic.id) ? s : { topics: [...s.topics, topic] }));
    if (topic.authorId !== "me") await resolveRealAuthorNames([topic.authorId]);
    return topic;
  },

  fetchAnswerById: async (answerId) => {
    const existing = get().answers.find((a) => a.id === answerId);
    if (existing) return existing;
    const { data, error } = await supabase
      .from("sns_answers")
      .select("*")
      .eq("id", answerId)
      .eq("is_hidden", false)
      .maybeSingle();
    if (error || !data) return null;
    const myUserId = useAuthStore.getState().user?.id ?? null;
    const toAuthorId = toAuthorIdWith(myUserId);
    const answer = mapAnswerRow(data as DbAnswerRow, toAuthorId);

    const { data: commentsData } = await supabase
      .from("sns_comments")
      .select("*")
      .eq("is_hidden", false)
      .eq("answer_id", answerId);
    const answerComments = ((commentsData ?? []) as DbCommentRow[]).map((c) => mapCommentRow(c, toAuthorId));

    set((s) => ({
      answers: s.answers.some((a) => a.id === answer.id) ? s.answers : [...s.answers, answer],
      comments: [...s.comments.filter((c) => c.answerId !== answerId), ...answerComments],
    }));

    const authorIds = new Set<string>();
    if (answer.authorId !== "me") authorIds.add(answer.authorId);
    for (const c of answerComments) if (c.authorId !== "me") authorIds.add(c.authorId);
    await resolveRealAuthorNames([...authorIds]);

    if (get().likedAnswerIds.length === 0) {
      const myUserId2 = useAuthStore.getState().user?.id;
      if (myUserId2) {
        const { data: likeRow } = await supabase
          .from("sns_answer_likes")
          .select("answer_id")
          .eq("user_id", myUserId2)
          .eq("answer_id", answerId)
          .maybeSingle();
        if (likeRow) set((s) => ({ likedAnswerIds: [...s.likedAnswerIds, answerId] }));
      }
    }

    return answer;
  },

  resolveAuthorName: async (authorId) => {
    if (authorId === "me" || get().realAuthorNames[authorId]) return;
    await resolveRealAuthorNames([authorId]);
  },

  fetchAuthorPosts: async (authorId) => {
    if (authorId === "me") return; // 自分の投稿は投稿した瞬間にstateへ入っているため不要。
    const myUserId = useAuthStore.getState().user?.id ?? null;
    const toAuthorId = toAuthorIdWith(myUserId);
    const [{ data: topicsData }, { data: answersData }] = await Promise.all([
      supabase
        .from("sns_topics")
        .select("*")
        .eq("author_id", authorId)
        .eq("is_hidden", false)
        .order("created_at", { ascending: false }),
      supabase
        .from("sns_answers")
        .select("*")
        .eq("author_id", authorId)
        .eq("is_hidden", false)
        .order("created_at", { ascending: false }),
    ]);
    const newTopics = ((topicsData ?? []) as DbTopicRow[]).map((t) => mapTopicRow(t, toAuthorId));
    const newAnswers = ((answersData ?? []) as DbAnswerRow[]).map((a) => mapAnswerRow(a, toAuthorId));
    set((s) => ({
      topics: [...s.topics, ...newTopics.filter((t) => !s.topics.some((x) => x.id === t.id))],
      answers: [...s.answers, ...newAnswers.filter((a) => !s.answers.some((x) => x.id === a.id))],
    }));
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
        set((s) => ({ answers: [answer, ...s.answers] }));
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
    set((s) => ({ answers: [answer, ...s.answers] }));
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

  // いいねの追加/解除。Supabase（sns_answer_likes）へ実際に保存し、リロード後も
  // 状態・件数が残るようにする。likes列自体はDBトリガーで自動更新されるため、
  // ここではUIの即時反映用に楽観的更新するのみで、直接updateはしない。
  toggleLike: async (answerId) => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) {
      return { ok: false, message: "いいねするにはログインが必要です。" };
    }
    if (get().likePending[answerId]) return { ok: false };

    const alreadyLiked = get().likedAnswerIds.includes(answerId);
    set((s) => ({
      likePending: { ...s.likePending, [answerId]: true },
      likedAnswerIds: alreadyLiked
        ? s.likedAnswerIds.filter((id) => id !== answerId)
        : [...s.likedAnswerIds, answerId],
      answers: s.answers.map((a) =>
        a.id === answerId ? { ...a, likes: Math.max(0, a.likes + (alreadyLiked ? -1 : 1)) } : a,
      ),
    }));

    const { error } = alreadyLiked
      ? await supabase.from("sns_answer_likes").delete().eq("answer_id", answerId).eq("user_id", userId)
      : await supabase.from("sns_answer_likes").insert({ answer_id: answerId, user_id: userId });

    set((s) => {
      const rest = { ...s.likePending };
      delete rest[answerId];
      return { likePending: rest };
    });

    if (error) {
      // 連打等による重複いいねの一意制約違反は、既に狙った状態になっているので成功扱いにする。
      if (!alreadyLiked && error.code === UNIQUE_VIOLATION) return { ok: true };
      // それ以外の失敗は楽観的更新をロールバックする。
      set((s) => ({
        likedAnswerIds: alreadyLiked
          ? [...s.likedAnswerIds, answerId]
          : s.likedAnswerIds.filter((id) => id !== answerId),
        answers: s.answers.map((a) =>
          a.id === answerId ? { ...a, likes: Math.max(0, a.likes + (alreadyLiked ? 1 : -1)) } : a,
        ),
      }));
      console.warn("[sns] いいねの更新に失敗", error);
      return { ok: false, message: "通信に失敗しました。もう一度お試しください。" };
    }
    return { ok: true };
  },

  // フォロー/フォロー解除。Supabase（sns_follows）へ実際に保存する。
  toggleFollow: async (authorId) => {
    if (authorId === "me") return { ok: false };
    const userId = useAuthStore.getState().user?.id;
    if (!userId) {
      return { ok: false, message: "フォローするにはログインが必要です。" };
    }
    if (get().followPending[authorId]) return { ok: false };

    const alreadyFollowing = get().followingAuthorIds.includes(authorId);
    set((s) => ({
      followPending: { ...s.followPending, [authorId]: true },
      followingAuthorIds: alreadyFollowing
        ? s.followingAuthorIds.filter((id) => id !== authorId)
        : [...s.followingAuthorIds, authorId],
    }));

    const { error } = alreadyFollowing
      ? await supabase.from("sns_follows").delete().eq("follower_id", userId).eq("following_id", authorId)
      : await supabase.from("sns_follows").insert({ follower_id: userId, following_id: authorId });

    set((s) => {
      const rest = { ...s.followPending };
      delete rest[authorId];
      return { followPending: rest };
    });

    if (error) {
      if (!alreadyFollowing && error.code === UNIQUE_VIOLATION) return { ok: true };
      set((s) => ({
        followingAuthorIds: alreadyFollowing
          ? [...s.followingAuthorIds, authorId]
          : s.followingAuthorIds.filter((id) => id !== authorId),
      }));
      console.warn("[sns] フォローの更新に失敗", error);
      return { ok: false, message: "通信に失敗しました。もう一度お試しください。" };
    }
    return { ok: true };
  },

  isFollowing: (authorId) => get().followingAuthorIds.includes(authorId),
}));

// 2026-08-30（不具合修正）：モジュールロード直後に即座にinit()を呼んでいたため、
// useAuthStore側のセッション復元（supabase.auth.getSession()、非同期）がまだ完了して
// おらず、ログイン済みなのに「未ログイン」と誤判定してlikedAnswerIds/followingAuthorIds/
// myFollowerCountをDBから取得できないレースコンディションがあった（リロードのたびに
// フォロー中・フォロワー数が0に見えたり、フォローボタンの状態が戻ったりする不具合の原因）。
// useAuthStoreのセッション確定（loading:falseになった時点）を待ってからinit()を呼ぶ。
if (typeof window !== "undefined") {
  const authState = useAuthStore.getState();
  if (!authState.loading) {
    useSnsStore.getState().init();
  } else {
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (!state.loading) {
        unsubscribe();
        useSnsStore.getState().init();
      }
    });
  }
}
