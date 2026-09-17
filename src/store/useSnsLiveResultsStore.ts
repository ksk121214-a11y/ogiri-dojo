// 寄合帳「ライブ結果」タブ用の状態管理（Zustand）。
// useSnsStore.ts（お題・回答・いいね・フォロー）とは別ストアに分離している。
// 対象データ（終了ライブの1〜3位代表・満点・運営ベスト回答）が全く別の系統
// （lives/turns/answers等のライブ進行テーブル＋sns_live_results系の新規テーブル）で、
// 既存のstoreを肥大化・複雑化させたくないため。
//
// ページネーション・楽観的更新・連打防止の作りはuseSnsStore.tsのパターン
// （PAGE_SIZE件ずつカーソル取得、pendingマップ、失敗時ロールバック）を踏襲している。
import { create } from "zustand";

import { isGuestUser } from "@/lib/guestStatus";
import { toLiveScheduleDate } from "@/lib/liveDateFormat";
import type { AnswerRow, TopicRow, TurnRow } from "@/lib/liveRoomTypes";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileStore } from "@/store/useProfileStore";
import { useSnsStore } from "@/store/useSnsStore";
import type {
  SnsLiveResultAnswerCard,
  SnsLiveResultComment,
  SnsLiveResultDetail,
  SnsLiveResultLabel,
  SnsLiveResultSummary,
} from "@/types/snsLiveResults";

const PAGE_SIZE = 10;

function formatEndedAtLabel(iso: string | null): string {
  if (!iso) return "日時未定";
  const d = toLiveScheduleDate(iso);
  return `${d.year}/${d.month}/${d.day}(${d.weekday}) ${d.time}`;
}

function formatCommentLabel(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}日前`;
}

// 表示名・アイコンの解決結果はuseSnsStore.realAuthorNames（SnsAuthorBadgeが参照する
// キャッシュ）へ直接書き込む。sns_author_names RPCの結果形はuseSnsStore.ts内の
// resolveRealAuthorNames()と同じで、ここだけの専用キャッシュを別途持たない。
async function resolveAuthorNamesIntoSnsStore(profileIds: string[]): Promise<void> {
  if (profileIds.length === 0) return;
  const { data } = await supabase.rpc("sns_author_names", { p_ids: profileIds });
  if (!data) return;
  const map: Record<string, { displayName: string; avatarIcon: string; avatarColor: string; masteryMeter: number; bio: string }> = {};
  for (const row of data as {
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

interface LiveRowLite {
  id: string;
  // 0068追加：寄合帳に出るライブ結果はresults_published=trueかつ
  // live_mode='official'の行に限られる（DB制約・RLSで保証される）ため、
  // 表示用の番号は必ず本番専用の official_sequence_number を使う
  // （レガシーのsequence_numberはtest/official問わず増え続ける内部カウンター
  // のため、寄合帳の表示には使わない）。
  official_sequence_number: number;
  title: string | null;
  ended_at: string | null;
  results_published: boolean;
}

interface LiveResultRow {
  id: string;
  live_id: string;
  manager_best_answer_id: string | null;
  manager_comment: string | null;
}

interface LiveResultAnswerRow {
  id: string;
  live_result_id: string;
  answer_id: string;
  rank: 1 | 2 | 3 | null;
  included: boolean;
  likes: number;
}

type ActionResult = { ok: true } | { ok: false; message?: string };

interface SnsLiveResultsState {
  summaries: SnsLiveResultSummary[];
  cursor: string | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  loaded: boolean;
  details: Record<string, SnsLiveResultDetail>;
  detailLoading: Record<string, boolean>;
  likedResultAnswerIds: string[];
  likePending: Record<string, boolean>;
  commentPending: Record<string, boolean>;
  // 2026-09-13（再々レビュー対応）：認証userIdが変わるたびに+1する世代カウンター。
  // detailsのauthorId="me"変換・commentsの「me」判定・likedResultAnswerIdsは
  // 「誰が見ているか」に依存する値のため、取得中に別の利用者へ切り替わっていたら
  // 遅れて届いた結果を反映しないためのガードに使う（useSnsStore.tsと同じ設計）。
  generation: number;

  init: () => Promise<void>;
  loadMore: () => Promise<void>;
  // force:true は運営画面のプレビュー用。掲載可否・運営ベストを変更した直後に
  // キャッシュを無視して最新状態を取り直すために使う。
  fetchDetail: (liveResultId: string, force?: boolean) => Promise<void>;
  toggleLike: (resultAnswerId: string) => Promise<ActionResult>;
  addComment: (resultAnswerId: string, body: string) => Promise<ActionResult>;
}

// 公開済みライブ一覧（ended_at降順）をPAGE_SIZE件取得し、sns_live_results・要約値
// （1〜3位のプレイヤー名・満点件数・いいね数・コメント数）まで組み立てる。
// N+1を避けるため、対象ページ分のlive_result_idをまとめて使って各テーブルへ
// 一度ずつ問い合わせる（1ライブごとに問い合わせ直したりしない）。
async function fetchSummaryPage(beforeEndedAt: string | null): Promise<{
  summaries: SnsLiveResultSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  let liveQuery = supabase
    .from("lives")
    .select("id, official_sequence_number, title, ended_at, results_published")
    .eq("results_published", true)
    // 0068追加：DB制約・RLS側で既にlive_mode='official'以外はresults_published=trueに
    // なり得ないが、クライアント側でも同じ条件を明示して多層防御にする。
    .eq("live_mode", "official")
    .eq("current_phase", "closed")
    .order("ended_at", { ascending: false, nullsFirst: false })
    .limit(PAGE_SIZE);
  if (beforeEndedAt) liveQuery = liveQuery.lt("ended_at", beforeEndedAt);
  const { data: livesData, error: livesError } = await liveQuery;
  if (livesError || !livesData || livesData.length === 0) {
    return { summaries: [], nextCursor: null, hasMore: false };
  }
  const lives = livesData as LiveRowLite[];
  const liveIds = lives.map((l) => l.id);

  const { data: resultsData } = await supabase
    .from("sns_live_results")
    .select("id, live_id, manager_best_answer_id, manager_comment")
    .in("live_id", liveIds);
  const results = (resultsData ?? []) as LiveResultRow[];
  const resultIds = results.map((r) => r.id);
  if (resultIds.length === 0) {
    const lastLive = lives[lives.length - 1];
    return { summaries: [], nextCursor: lastLive.ended_at, hasMore: lives.length === PAGE_SIZE };
  }

  const { data: raData } = await supabase
    .from("sns_live_result_answers")
    .select("id, live_result_id, answer_id, rank, included, likes")
    .eq("included", true)
    .in("live_result_id", resultIds);
  const resultAnswers = (raData ?? []) as LiveResultAnswerRow[];
  const answerIds = resultAnswers.map((ra) => ra.answer_id);

  const { data: answersData } = answerIds.length
    ? await supabase.from("answers").select("id, participant_id, judge_count, top_score_votes").in("id", answerIds)
    : { data: [] as { id: string; participant_id: string; judge_count: number; top_score_votes: number }[] };
  const answerById = new Map((answersData ?? []).map((a) => [a.id, a]));

  // 1〜3位の代表回答のプレイヤー名解決用。rankが同じ行は必ず同一プレイヤーのため
  // （タイは「そのプレイヤー自身の複数回答が同点」の意味で、順位を複数人が共有することはない）、
  // 順位ごとに代表行を1つ選べば十分。
  const podiumRows = resultAnswers.filter((ra) => ra.rank !== null);
  const podiumParticipantIds = [
    ...new Set(podiumRows.map((ra) => answerById.get(ra.answer_id)?.participant_id).filter((v): v is string => !!v)),
  ];
  // 2026-09-13（3回目レビュー対応）：participantsテーブル自体は本人・司会/運営の
  // 行しか直接SELECTできなくなったため（0072）、掲載確定済みの公開結果に限って
  // participant_id→user_idを解決する安全なRPCへ切り替える。
  const { data: participantsData } = podiumParticipantIds.length
    ? await supabase.rpc("sns_result_participant_user_ids", { p_participant_ids: podiumParticipantIds })
    : { data: [] as { participant_id: string; user_id: string }[] | null };
  const userIdByParticipantId = new Map(
    ((participantsData ?? []) as { participant_id: string; user_id: string }[]).map((p) => [
      p.participant_id,
      p.user_id,
    ]),
  );
  const profileIds = [...new Set([...userIdByParticipantId.values()])];
  await resolveAuthorNamesIntoSnsStore(profileIds);
  const realAuthorNames = useSnsStore.getState().realAuthorNames;
  const nameOfParticipant = (participantId: string): string => {
    const userId = userIdByParticipantId.get(participantId);
    if (!userId) return "（不明）";
    return realAuthorNames[userId]?.displayName ?? "（名前未設定）";
  };

  const resultAnswerIds = resultAnswers.map((ra) => ra.id);
  const { data: commentsData } = resultAnswerIds.length
    ? await supabase
        .from("sns_live_result_comments")
        .select("result_answer_id")
        .eq("is_hidden", false)
        .in("result_answer_id", resultAnswerIds)
    : { data: [] as { result_answer_id: string }[] };

  const commentCountByRaId = new Map<string, number>();
  for (const c of commentsData ?? []) {
    commentCountByRaId.set(c.result_answer_id, (commentCountByRaId.get(c.result_answer_id) ?? 0) + 1);
  }

  const summaries: SnsLiveResultSummary[] = lives
    .map((live) => {
      const result = results.find((r) => r.live_id === live.id);
      if (!result) return null;
      const ownRows = resultAnswers.filter((ra) => ra.live_result_id === result.id);
      const podiumNames = ([1, 2, 3] as const)
        .map((rank) => {
          const row = ownRows.find((ra) => ra.rank === rank);
          const participantId = row ? answerById.get(row.answer_id)?.participant_id : undefined;
          if (!participantId) return null;
          return { rank, name: nameOfParticipant(participantId) };
        })
        .filter((v): v is { rank: 1 | 2 | 3; name: string } => v !== null);
      const perfectCount = ownRows.filter((ra) => {
        const a = answerById.get(ra.answer_id);
        return a && a.judge_count > 0 && a.top_score_votes === a.judge_count;
      }).length;
      const likeCount = ownRows.reduce((sum, ra) => sum + ra.likes, 0);
      const commentCount = ownRows.reduce((sum, ra) => sum + (commentCountByRaId.get(ra.id) ?? 0), 0);
      const summary: SnsLiveResultSummary = {
        id: result.id,
        liveId: live.id,
        sequenceNumber: live.official_sequence_number,
        title: live.title,
        endedAtLabel: formatEndedAtLabel(live.ended_at),
        podiumNames,
        perfectCount,
        likeCount,
        commentCount,
      };
      return summary;
    })
    .filter((s): s is SnsLiveResultSummary => s !== null);

  const lastLive = lives[lives.length - 1];
  return { summaries, nextCursor: lastLive.ended_at, hasMore: lives.length === PAGE_SIZE };
}

export const useSnsLiveResultsStore = create<SnsLiveResultsState>()((set, get) => ({
  summaries: [],
  cursor: null,
  hasMore: true,
  loading: false,
  loadingMore: false,
  loaded: false,
  details: {},
  detailLoading: {},
  likedResultAnswerIds: [],
  likePending: {},
  commentPending: {},
  generation: 0,

  init: async () => {
    if (get().loaded) return;
    set({ loaded: true, loading: true });
    const { summaries, nextCursor, hasMore } = await fetchSummaryPage(null);
    set({ summaries, cursor: nextCursor, hasMore, loading: false });
  },

  loadMore: async () => {
    const { hasMore, loadingMore, cursor } = get();
    if (!hasMore || loadingMore || !cursor) return;
    set({ loadingMore: true });
    const { summaries, nextCursor, hasMore: more } = await fetchSummaryPage(cursor);
    set((s) => ({
      summaries: [...s.summaries, ...summaries],
      cursor: nextCursor,
      hasMore: more,
      loadingMore: false,
    }));
  },

  fetchDetail: async (liveResultId, force = false) => {
    if (!force && get().details[liveResultId]) return;
    if (get().detailLoading[liveResultId]) return;
    // 2026-09-13（再々レビュー対応）：この呼び出し開始時点の世代を記録し、
    // 取得完了時に世代が変わっていたら（＝取得中に別ユーザーへ切り替わった）
    // detailsへ書き込まない（authorId="me"変換・コメントの「me」判定・
    // いいね済み状態が古い利用者基準のまま反映されるのを防ぐ）。
    const myGeneration = get().generation;
    set((s) => ({ detailLoading: { ...s.detailLoading, [liveResultId]: true } }));

    const { data: resultData } = await supabase
      .from("sns_live_results")
      .select("id, live_id, manager_best_answer_id, manager_comment")
      .eq("id", liveResultId)
      .maybeSingle();
    if (!resultData) {
      // 2026-09-13（再々レビュー2回目対応）：世代が変わっていたら（＝取得中に
      // 別ユーザーへ切り替わった）、このliveResultId向けのdetailLoadingを
      // 一切触れずに終了する。切替後の新しい世代が同じliveResultIdへの
      // fetchDetail()を既に開始していた場合、その新しいpendingフラグを
      // この古い処理が誤って消してしまわないようにするため（所有権を失った
      // 処理は、pendingの解除も含めて一切stateを変更しない）。
      if (get().generation === myGeneration) {
        set((s) => {
          const rest = { ...s.detailLoading };
          delete rest[liveResultId];
          return { detailLoading: rest };
        });
      }
      return;
    }
    const result = resultData as LiveResultRow;

    // 0068追加：一覧取得と同じく、DB制約・RLS側で既に保証されている
    // live_mode='official'をクライアント側でも明示して多層防御にする。
    // 万一test側のlive_idが渡ってきた場合はliveがnullになり、下の既存の
    // null安全なフォールバック（sequenceNumber:0等）にそのまま合流する。
    const { data: liveData } = await supabase
      .from("lives")
      .select("id, official_sequence_number, title, ended_at, results_published")
      .eq("id", result.live_id)
      .eq("live_mode", "official")
      .maybeSingle();
    const live = liveData as LiveRowLite | null;
    if (!live) {
      console.warn("[sns] 公開結果詳細に対応する本番ライブが見つかりません（live_mode不一致の疑い）", liveResultId);
    }

    const { data: raData } = await supabase
      .from("sns_live_result_answers")
      .select("id, live_result_id, answer_id, rank, included, likes")
      .eq("live_result_id", liveResultId)
      .eq("included", true);
    const resultAnswers = (raData ?? []) as LiveResultAnswerRow[];
    const answerIds = resultAnswers.map((ra) => ra.answer_id);

    const { data: answersData } = answerIds.length
      ? await supabase.from("answers").select("*").in("id", answerIds)
      : { data: [] as AnswerRow[] };
    const answers = (answersData ?? []) as AnswerRow[];
    const answerById = new Map(answers.map((a) => [a.id, a]));

    const turnIds = [...new Set(answers.map((a) => a.turn_id))];
    const { data: turnsData } = turnIds.length
      ? await supabase.from("turns").select("id, topic_id").in("id", turnIds)
      : { data: [] as Pick<TurnRow, "id" | "topic_id">[] };
    const topicIdByTurnId = new Map((turnsData ?? []).map((t) => [t.id, t.topic_id]));
    const topicIds = [...new Set([...topicIdByTurnId.values()])];
    const { data: topicsData } = topicIds.length
      ? await supabase.from("topics").select("id, body").in("id", topicIds)
      : { data: [] as Pick<TopicRow, "id" | "body">[] };
    const topicBodyById = new Map((topicsData ?? []).map((t) => [t.id, t.body]));

    // 2026-09-13（3回目レビュー対応）：participantsテーブル自体は本人・司会/運営の
    // 行しか直接SELECTできなくなったため（0072）、掲載確定済みの公開結果に限って
    // participant_id→user_idを解決する安全なRPCへ切り替える。
    const participantIds = [...new Set(answers.map((a) => a.participant_id))];
    const { data: participantsData } = participantIds.length
      ? await supabase.rpc("sns_result_participant_user_ids", { p_participant_ids: participantIds })
      : { data: [] as { participant_id: string; user_id: string }[] | null };
    const userIdByParticipantId = new Map(
      ((participantsData ?? []) as { participant_id: string; user_id: string }[]).map((p) => [
        p.participant_id,
        p.user_id,
      ]),
    );

    const myUserId = useAuthStore.getState().user?.id ?? null;
    const authorIdOf = (participantId: string): string => {
      const userId = userIdByParticipantId.get(participantId);
      if (!userId) return "";
      return userId === myUserId ? "me" : userId;
    };

    const profileIdsToResolve = [...userIdByParticipantId.values()].filter(
      (id) => id && id !== myUserId,
    );
    await resolveAuthorNamesIntoSnsStore(profileIdsToResolve);

    const resultAnswerIds = resultAnswers.map((ra) => ra.id);
    const { data: commentsData } = resultAnswerIds.length
      ? await supabase
          .from("sns_live_result_comments")
          .select("*")
          .eq("is_hidden", false)
          .in("result_answer_id", resultAnswerIds)
          .order("created_at", { ascending: true })
      : { data: [] as { id: string; result_answer_id: string; author_id: string; body: string; created_at: string }[] };
    const commentsByRaId: Record<string, SnsLiveResultComment[]> = {};
    for (const c of commentsData ?? []) {
      const comment: SnsLiveResultComment = {
        id: c.id,
        resultAnswerId: c.result_answer_id,
        authorId: c.author_id === myUserId ? "me" : c.author_id,
        body: c.body,
        createdAtLabel: formatCommentLabel(c.created_at),
      };
      (commentsByRaId[c.result_answer_id] ??= []).push(comment);
    }
    const commentCountByRaId = new Map<string, number>();
    for (const [raId, list] of Object.entries(commentsByRaId)) commentCountByRaId.set(raId, list.length);

    let likedIds: string[] = [];
    if (myUserId && resultAnswerIds.length > 0) {
      const { data: likeRows } = await supabase
        .from("sns_live_result_likes")
        .select("result_answer_id")
        .eq("user_id", myUserId)
        .in("result_answer_id", resultAnswerIds);
      likedIds = (likeRows ?? []).map((r) => r.result_answer_id as string);
    }

    const buildCard = (ra: LiveResultAnswerRow, labels: SnsLiveResultLabel[]): SnsLiveResultAnswerCard | null => {
      const answer = answerById.get(ra.answer_id);
      if (!answer) return null;
      return {
        resultAnswerId: ra.id,
        answerId: ra.answer_id,
        authorId: authorIdOf(answer.participant_id),
        topicBody: topicBodyById.get(topicIdByTurnId.get(answer.turn_id) ?? "") ?? null,
        body: answer.body,
        score: answer.score_total,
        labels,
        likes: ra.likes,
        liked: likedIds.includes(ra.id),
        commentCount: commentCountByRaId.get(ra.id) ?? 0,
      };
    };

    const isPerfect = (ra: LiveResultAnswerRow) => {
      const a = answerById.get(ra.answer_id);
      return !!a && a.judge_count > 0 && a.top_score_votes === a.judge_count;
    };

    const podium: { rank: 1 | 2 | 3; cards: SnsLiveResultAnswerCard[] }[] = [1, 2, 3]
      .map((rank) => {
        const rows = resultAnswers.filter((ra) => ra.rank === rank);
        const cards = rows
          .map((ra) => {
            const labels: SnsLiveResultLabel[] = [
              rank === 1 ? "rank1" : rank === 2 ? "rank2" : "rank3",
            ];
            if (isPerfect(ra)) labels.push("perfect");
            return buildCard(ra, labels);
          })
          .filter((c): c is SnsLiveResultAnswerCard => c !== null);
        return { rank: rank as 1 | 2 | 3, cards };
      })
      .filter((g) => g.cards.length > 0);

    const managerBestRow = result.manager_best_answer_id
      ? resultAnswers.find((ra) => ra.answer_id === result.manager_best_answer_id)
      : undefined;
    const managerBest = managerBestRow ? buildCard(managerBestRow, ["managerBest"]) : null;

    const perfect = resultAnswers
      .filter((ra) => ra.rank === null && ra.answer_id !== result.manager_best_answer_id && isPerfect(ra))
      .map((ra) => buildCard(ra, ["perfect"]))
      .filter((c): c is SnsLiveResultAnswerCard => c !== null);

    const detail: SnsLiveResultDetail = {
      id: result.id,
      liveId: result.live_id,
      sequenceNumber: live?.official_sequence_number ?? 0,
      title: live?.title ?? null,
      endedAtLabel: formatEndedAtLabel(live?.ended_at ?? null),
      managerComment: result.manager_comment,
      podium,
      managerBest,
      perfect,
      comments: commentsByRaId,
    };

    if (get().generation !== myGeneration) {
      // 2026-09-13（再々レビュー2回目対応）：取得中に別ユーザーへ切り替わって
      // いたら、このdetailは古い利用者基準のauthorId="me"変換を含むため反映
      // しない。以前はここでdetailLoading[liveResultId]を無条件に消していたが、
      // 切替後の新しい世代が同じliveResultIdへのfetchDetail()を既に開始して
      // いた場合、その新しいpendingフラグ（true）をこの古い処理が誤って消して
      // しまい、新しい処理が「pending中」のはずなのに完了前にpendingが解除
      // されたように見えてしまう不具合があった。所有権（世代）を失った処理は
      // pendingの解除も含めて一切stateを変更しない（reset時点で既にdetailLoading
      // 自体が空にされているため、ここで消さなくても取りこぼしは無い）。
      return;
    }
    set((s) => {
      const rest = { ...s.detailLoading };
      delete rest[liveResultId];
      return {
        details: { ...s.details, [liveResultId]: detail },
        detailLoading: rest,
        likedResultAnswerIds: [...new Set([...s.likedResultAnswerIds, ...likedIds])],
      };
    });
  },

  toggleLike: async (resultAnswerId) => {
    const authUser = useAuthStore.getState().user;
    const userId = authUser?.id;
    if (!userId) return { ok: false, message: "いいねするにはログインが必要です。" };
    // 2026-09-13（再レビュー対応）：sns_live_result_likes_insert_own（RLS）が
    // ゲストのINSERTを拒否するため、事前に弾いてDB往復せず即座に案内する
    // （useSnsStore.tsのtoggleLike/toggleFollowと同じ方針）。
    if (isGuestUser(authUser, useProfileStore.getState().profile)) {
      return { ok: false, message: "ゲストはいいねできません。ログインしてください。" };
    }
    if (get().likePending[resultAnswerId]) return { ok: false };
    // 2026-09-13（再々レビュー対応）：await中に別ユーザーへ切り替わっていたら、
    // 遅れて届いたこの結果を新しい利用者のlikedResultAnswerIds/detailsへ
    // 反映しない。
    const myGeneration = get().generation;

    const alreadyLiked = get().likedResultAnswerIds.includes(resultAnswerId);
    const applyDelta = (delta: number) => {
      set((s) => ({
        details: Object.fromEntries(
          Object.entries(s.details).map(([id, detail]) => [
            id,
            {
              ...detail,
              podium: detail.podium.map((g) => ({
                ...g,
                cards: g.cards.map((c) =>
                  c.resultAnswerId === resultAnswerId ? { ...c, likes: Math.max(0, c.likes + delta) } : c,
                ),
              })),
              managerBest:
                detail.managerBest?.resultAnswerId === resultAnswerId
                  ? { ...detail.managerBest, likes: Math.max(0, detail.managerBest.likes + delta) }
                  : detail.managerBest,
              perfect: detail.perfect.map((c) =>
                c.resultAnswerId === resultAnswerId ? { ...c, likes: Math.max(0, c.likes + delta) } : c,
              ),
            },
          ]),
        ),
      }));
    };

    set((s) => ({
      likePending: { ...s.likePending, [resultAnswerId]: true },
      likedResultAnswerIds: alreadyLiked
        ? s.likedResultAnswerIds.filter((id) => id !== resultAnswerId)
        : [...s.likedResultAnswerIds, resultAnswerId],
    }));
    applyDelta(alreadyLiked ? -1 : 1);

    const { error } = alreadyLiked
      ? await supabase
          .from("sns_live_result_likes")
          .delete()
          .eq("result_answer_id", resultAnswerId)
          .eq("user_id", userId)
      : await supabase.from("sns_live_result_likes").insert({ result_answer_id: resultAnswerId, user_id: userId });

    if (get().generation !== myGeneration) return { ok: false };

    set((s) => {
      const rest = { ...s.likePending };
      delete rest[resultAnswerId];
      return { likePending: rest };
    });

    if (error) {
      if (!alreadyLiked && error.code === "23505") return { ok: true };
      set((s) => ({
        likedResultAnswerIds: alreadyLiked
          ? [...s.likedResultAnswerIds, resultAnswerId]
          : s.likedResultAnswerIds.filter((id) => id !== resultAnswerId),
      }));
      applyDelta(alreadyLiked ? 1 : -1);
      console.warn("[snsLiveResults] いいねの更新に失敗", error);
      return { ok: false, message: "通信に失敗しました。もう一度お試しください。" };
    }
    return { ok: true };
  },

  addComment: async (resultAnswerId, body) => {
    const authUser = useAuthStore.getState().user;
    const userId = authUser?.id;
    if (!userId) return { ok: false, message: "コメントするにはログインが必要です。" };
    if (isGuestUser(authUser, useProfileStore.getState().profile)) {
      return { ok: false, message: "ゲストはコメントできません。ログインしてください。" };
    }
    if (get().commentPending[resultAnswerId]) return { ok: false };
    // 2026-09-13（再々レビュー対応）：await中に別ユーザーへ切り替わっていたら、
    // このコメントのauthorId:"me"は古い利用者基準のため新しい利用者のdetailsへ
    // 反映しない。
    const myGeneration = get().generation;
    set((s) => ({ commentPending: { ...s.commentPending, [resultAnswerId]: true } }));

    const { data, error } = await supabase
      .from("sns_live_result_comments")
      .insert({ result_answer_id: resultAnswerId, author_id: userId, body })
      .select()
      .single();

    if (get().generation !== myGeneration) {
      // 2026-09-13（再々レビュー2回目対応）：所有権（世代）を失った処理は
      // pendingの解除も含めて一切stateを変更しない。切替後の新しい世代が
      // 同じresultAnswerIdへのコメント投稿を既に開始していた場合、その
      // pendingフラグをこの古い処理が誤って消してしまわないようにするため
      // （resetForUserSwitch側で既にcommentPendingは空にされている）。
      return { ok: false };
    }

    set((s) => {
      const rest = { ...s.commentPending };
      delete rest[resultAnswerId];
      return { commentPending: rest };
    });

    if (error || !data) {
      console.warn("[snsLiveResults] コメントの保存に失敗", error);
      return { ok: false, message: "通信に失敗しました。もう一度お試しください。" };
    }

    const comment: SnsLiveResultComment = {
      id: data.id,
      resultAnswerId,
      authorId: "me",
      body: data.body,
      createdAtLabel: "たった今",
    };
    set((s) => {
      const details = { ...s.details };
      for (const [id, detail] of Object.entries(details)) {
        const list = detail.comments[resultAnswerId] ?? [];
        if (list.some((c) => c.id === comment.id)) continue;
        details[id] = {
          ...detail,
          comments: { ...detail.comments, [resultAnswerId]: [...list, comment] },
        };
      }
      return { details };
    });
    return { ok: true };
  },
}));

// 2026-09-13（再々レビュー対応）：認証userIdが変わるたび（ゲスト→Xログイン、
// 会員A→会員B、ログアウトを含む）に、detailsのauthorId="me"変換・コメントの
// 「me」判定・いいね済み状態（likedResultAnswerIds）を作り直す。summaries
// （1〜3位のプレイヤー名等）は「誰が見ているか」に依存しないため、そのまま
// 保持する（クリア・再取得は不要）。detailsを空にすれば、開いている詳細画面
// （SnsLiveResultDetail.tsx）の既存useEffectが自動的にfetchDetail()を再実行し、
// 新しい利用者向けの内容へ作り直される（このファイル自身がinit()を呼び直す
// 必要は無い）。
// 2026-09-13（再々レビュー2回目対応）：以前はuseAuthStore.subscribeのコールバック内で
// 初めてlastSeenUserIdを設定していたため、「認証が既に確定した状態（loading:false）
// でこのモジュールが読み込まれた」場合、その時点の実際の認証userIdを一度も
// 観測しないまま「まだ未確定」の扱いになっていた。その状態でfetchDetail()が
// 実行されて会員Aのdetails・いいね状態が溜まった後、最初のアカウント切替
// （A→B）が発生すると、その切替が「初期値の確定」として処理されてしまい
// （lastSeenUserId===undefinedの分岐に入りresetされない）、Aのdetails・
// いいね済み状態が残ったままBの画面に漏れる可能性があった。
// useSnsStore.tsのhandleAuthSettledと同じ設計にし、モジュール読み込み時点で
// 既にauthUserStoreのセッションが確定していれば、その場でlastSeenUserIdを
// 現在値に合わせる（この最初の観測ではresetしない＝まだ何もfetchしていない
// 状態のresetは無意味なため）。以後の「実際にuserIdが変わった」タイミングから
// 確実にgenerationを進めてリセットする。
if (typeof window !== "undefined") {
  // undefined＝まだ一度も認証状態を観測していない（起動直後）ことを表す。
  let lastSeenUserId: string | null | undefined;
  const handleAuthSettled = (userId: string | null) => {
    if (lastSeenUserId === undefined) {
      lastSeenUserId = userId;
      return;
    }
    if (userId === lastSeenUserId) return;
    lastSeenUserId = userId;
    useSnsLiveResultsStore.setState((s) => ({
      generation: s.generation + 1,
      details: {},
      detailLoading: {},
      likedResultAnswerIds: [],
      likePending: {},
      commentPending: {},
    }));
  };

  const authState = useAuthStore.getState();
  if (!authState.loading) {
    handleAuthSettled(authState.user?.id ?? null);
  } else {
    const unsubscribeInitial = useAuthStore.subscribe((state) => {
      if (!state.loading) {
        unsubscribeInitial();
        handleAuthSettled(state.user?.id ?? null);
      }
    });
  }

  useAuthStore.subscribe((state) => {
    if (state.loading) return; // セッション確定前の中間状態は無視する。
    handleAuthSettled(state.user?.id ?? null);
  });
}
