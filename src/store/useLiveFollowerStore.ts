// 実バックエンド版ライブ（フェーズB）の参加者（司会以外）用ストア。
// 参加登録・現在のターン/お題/表示中の回答の購読・回答送信・採点送信・
// 組結果発表/最終結果発表のランキング集計までを扱う。
import { create } from "zustand";

import {
  getBestAnswer,
  getGroupTurnRanking,
  getOverallRanking,
  type RoomRankingEntry,
} from "@/lib/liveRoomSelectors";
import { useAuthStore } from "@/store/useAuthStore";
import { supabase } from "@/lib/supabase";
import type {
  AnswerRow,
  GroupRow,
  LiveRow,
  ParticipantRole,
  ParticipantRow,
  ScoreRow,
  TopicRow,
  TurnRow,
} from "@/lib/liveRoomTypes";

export interface GroupResultData {
  round: number;
  groupOrder: number;
  topicBody: string;
  ranking: RoomRankingEntry[];
  laughCount: number;
}

export interface FinalResultData {
  bestAnswer: { participantId: string; name: string; body: string; scoreTotal: number } | null;
  ranking: RoomRankingEntry[];
  myRank: number | null;
}

export interface TsukkomiEvent {
  id: number;
  kind: "clap" | "stamp";
  text: string;
}

// 2026-08-29:「ライブ中、自分のアイコンが他の参加者の画面ではランダムなアイコンに
// なる」対応。participant_display_names RPCがavatar_icon/avatar_colorも返すように
// なったため、表示名と同じ経路でアイコン設定も取得する。
export interface ParticipantAvatarInfo {
  icon: string;
  color: string;
}

interface LiveFollowerState {
  live: LiveRow | null;
  myParticipant: ParticipantRow | null;
  participants: ParticipantRow[];
  groups: GroupRow[];
  participantNames: Record<string, string>; // participant_id → display_name
  participantAvatars: Record<string, ParticipantAvatarInfo>; // participant_id → 絵柄・色
  currentTurn: TurnRow | null;
  currentTopic: TopicRow | null;
  activeAnswer: AnswerRow | null;
  turnAnswers: AnswerRow[]; // このターンの全員ぶんの回答（誰の回答が確定したかを見せるため保持）
  activeAnswerScores: ScoreRow[]; // 表示中の回答についた採点全員分（採点ボードの玉演出用）
  myAnswerCount: number;
  myScore: number | null;
  groupResult: GroupResultData | null;
  finalResult: FinalResultData | null;
  tsukkomiSeq: number; // つっこみ/拍手のブロードキャストを受け取るたびに増える通し番号
  lastTsukkomi: TsukkomiEvent | null;
  laughEventSeq: number; // 誰かの回答が笑いエフェクト付きで確定するたびに増える通し番号
  loading: boolean;
  error: string | null;

  subscribe: () => () => void;
  joinLive: (preferredRole: ParticipantRole) => Promise<void>;
  submitMyAnswer: (body: string) => Promise<{ ok: boolean; reason?: string }>;
  submitMyScore: (points: 0 | 1 | 2 | 3) => Promise<{ ok: boolean; reason?: string }>;
  sendTsukkomi: (kind: "clap" | "stamp", text: string) => void;
}

let channels: ReturnType<typeof supabase.channel>[] = [];
let tsukkomiChannel: ReturnType<typeof supabase.channel> | null = null;
let tsukkomiIdCounter = 0;
// ツッコミ・爆笑・拍手ボタンの連打制限（1秒に1回まで）。ボタン自体の見た目は
// 変えず、裏で黙って間引く。ボタンはUIから常にsendTsukkomiを直接呼ぶだけなので、
// ここ1箇所でガードすれば全ボタンに効く。
const TSUKKOMI_COOLDOWN_MS = 1_000;
let lastTsukkomiSentAt = 0;

function cleanupChannels() {
  for (const ch of channels) supabase.removeChannel(ch);
  channels = [];
  tsukkomiChannel = null;
}

// ホーム画面の「次回ライブ」チケット（参加ボタン押下時に「既に参加済みか」を確認する
// 用途、src/components/home/useLiveJoinFlow.ts参照）でも使うためexportしている。
export async function fetchActiveLive(): Promise<LiveRow | null> {
  const { data } = await supabase
    .from("lives")
    .select("*")
    .neq("current_phase", "closed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as LiveRow | null;
}

export async function fetchMyParticipant(liveId: string, userId: string): Promise<ParticipantRow | null> {
  const { data } = await supabase
    .from("participants")
    .select("*")
    .eq("live_id", liveId)
    .eq("user_id", userId)
    .maybeSingle();
  return data as ParticipantRow | null;
}

async function fetchParticipantsForLive(liveId: string): Promise<ParticipantRow[]> {
  const { data } = await supabase.from("participants").select("*").eq("live_id", liveId);
  return (data ?? []) as ParticipantRow[];
}

async function fetchGroupsForLive(liveId: string): Promise<GroupRow[]> {
  const { data } = await supabase.from("groups").select("*").eq("live_id", liveId);
  return (data ?? []) as GroupRow[];
}

// 組結果・最終結果で他人の表示名を出すための安全な経路（生のprofilesは自分の行しか読めないため）。
// 2026-08-29: 表示名と同じ経路でavatar_icon/avatar_colorも取得するようにした
// （participant_display_names RPC自体を拡張、詳しくはsupabase/migrations/0015参照）。
async function fetchParticipantProfiles(liveId: string): Promise<{
  names: Record<string, string>;
  avatars: Record<string, ParticipantAvatarInfo>;
}> {
  const { data } = await supabase.rpc("participant_display_names", { p_live_id: liveId });
  const names: Record<string, string> = {};
  const avatars: Record<string, ParticipantAvatarInfo> = {};
  for (const row of (data ?? []) as {
    participant_id: string;
    display_name: string;
    avatar_icon: string;
    avatar_color: string;
  }[]) {
    names[row.participant_id] = row.display_name;
    avatars[row.participant_id] = { icon: row.avatar_icon, color: row.avatar_color };
  }
  return { names, avatars };
}

async function fetchResolvedAnswersForLive(liveId: string): Promise<AnswerRow[]> {
  const { data } = await supabase
    .from("answers")
    .select("*")
    .eq("live_id", liveId)
    .eq("resolved", true)
    .order("created_at", { ascending: true });
  return (data ?? []) as AnswerRow[];
}

async function fetchTurnAndTopic(
  turnId: string,
): Promise<{ turn: TurnRow | null; topic: TopicRow | null }> {
  const { data: turn } = await supabase.from("turns").select("*").eq("id", turnId).maybeSingle();
  if (!turn) return { turn: null, topic: null };
  const { data: topic } = await supabase
    .from("topics")
    .select("*")
    .eq("id", (turn as TurnRow).topic_id)
    .maybeSingle();
  return { turn: turn as TurnRow, topic: topic as TopicRow | null };
}

async function fetchAnswersAndScoreForTurn(
  turnId: string,
  myParticipantId: string | undefined,
): Promise<{
  answers: AnswerRow[];
  activeAnswer: AnswerRow | null;
  myScore: number | null;
  myAnswerCount: number;
  activeAnswerScores: ScoreRow[];
}> {
  const { data: answersData } = await supabase.from("answers").select("*").eq("turn_id", turnId);
  const rows = (answersData ?? []) as AnswerRow[];
  const activeAnswer = rows.find((a) => a.revealed_at && !a.resolved) ?? null;
  const myAnswerCount = myParticipantId
    ? rows.filter((a) => a.participant_id === myParticipantId).length
    : 0;

  // 採点ボードの玉演出は全員分の採点を見る必要がある（自分の分だけでなく）ため、
  // 表示中の回答についたscores行を丸ごと取得する。myScoreはその中から自分の分を拾う。
  let activeAnswerScores: ScoreRow[] = [];
  if (activeAnswer) {
    const { data } = await supabase.from("scores").select("*").eq("answer_id", activeAnswer.id);
    activeAnswerScores = (data ?? []) as ScoreRow[];
  }
  const myScore = myParticipantId
    ? (activeAnswerScores.find((s) => s.judge_participant_id === myParticipantId)?.points ?? null)
    : null;
  return { answers: rows, activeAnswer, myScore, myAnswerCount, activeAnswerScores };
}

async function refreshFinalResult() {
  const { live, myParticipant, participants, participantNames } =
    useLiveFollowerStore.getState();
  if (!live) return;
  const resolvedAnswers = await fetchResolvedAnswersForLive(live.id);
  const ranking = getOverallRanking(resolvedAnswers, participants, participantNames);
  const bestAnswerRow = getBestAnswer(resolvedAnswers);
  const bestAnswer = bestAnswerRow
    ? {
        participantId: bestAnswerRow.participant_id,
        name: participantNames[bestAnswerRow.participant_id] ?? "（名前未設定）",
        body: bestAnswerRow.body,
        scoreTotal: bestAnswerRow.score_total,
      }
    : null;
  const myRankIndex = myParticipant
    ? ranking.findIndex((r) => r.participantId === myParticipant.id)
    : -1;
  useLiveFollowerStore.setState({
    finalResult: { bestAnswer, ranking, myRank: myRankIndex >= 0 ? myRankIndex + 1 : null },
  });
}

// answers/scoresのRealtimeイベントはほぼ同時に複数飛んでくることがあり、
// refreshTurnDerivedの非同期取得が並行して走ると、後発の呼び出しの結果が先に返ってきて
// 反映された直後に、先発の呼び出しの（今となっては古い）結果が遅れて届いて上書きしてしまう
// ことがあった（採点ハイライトが遅延・消える・前の回答の点数を引きずる不具合の原因）。
// 「今から始める呼び出しが最新か」を通し番号で管理し、追い越された古い結果は捨てる。
let turnDerivedRequestId = 0;

async function refreshTurnDerived() {
  const requestId = ++turnDerivedRequestId;
  const {
    live,
    myParticipant,
    participants,
    participantNames,
    turnAnswers: prevTurnAnswers,
    currentTurn: prevTurn,
  } = useLiveFollowerStore.getState();
  if (!live?.current_turn_id) {
    if (requestId !== turnDerivedRequestId) return;
    useLiveFollowerStore.setState({
      currentTurn: null,
      currentTopic: null,
      activeAnswer: null,
      turnAnswers: [],
      activeAnswerScores: [],
      myScore: null,
      myAnswerCount: 0,
      groupResult: null,
    });
    return;
  }
  const { turn, topic } = await fetchTurnAndTopic(live.current_turn_id);
  const { answers, activeAnswer, myScore, myAnswerCount, activeAnswerScores } =
    await fetchAnswersAndScoreForTurn(live.current_turn_id, myParticipant?.id);
  if (requestId !== turnDerivedRequestId) return; // より新しい呼び出しに追い越された

  let groupResult: GroupResultData | null = null;
  if (live.current_phase === "group_result" && turn && topic) {
    const { groups } = useLiveFollowerStore.getState();
    const groupOrder = groups.find((g) => g.id === turn.group_id)?.group_order ?? 0;
    const ranking = getGroupTurnRanking(
      answers,
      participants,
      turn.id,
      turn.group_id,
      participantNames,
    );
    const laughCount = answers.filter(
      (a) => a.turn_id === turn.id && a.resolved && a.laugh_triggered,
    ).length;
    groupResult = { round: turn.round, groupOrder, topicBody: topic.body, ranking, laughCount };
  }

  const prevResolvedIds = new Set(prevTurnAnswers.filter((a) => a.resolved).map((a) => a.id));
  const newlyLaughed = answers.some(
    (a) => a.resolved && a.laugh_triggered && !prevResolvedIds.has(a.id),
  );

  // ターン（組）自体が切り替わったら、前のターンの採点内訳を持ち越さない。
  // 「activeAnswerが無い間は前の値を保持する」のは同一ターン内で次の回答が
  // 表示されるまでの一瞬の猶予のためであり、組が変わった後まで残ると、
  // 新しい組の1件目の回答に前の組の最後の得点ぶんの玉がいきなり降ってくる
  // 不具合になる。
  const turnChanged = (prevTurn?.id ?? null) !== (turn?.id ?? null);

  useLiveFollowerStore.setState((s) => ({
    currentTurn: turn,
    currentTopic: topic,
    activeAnswer,
    turnAnswers: answers,
    // 確定した直後はactiveAnswerがnullになるが、玉が弾けるアニメーションぶんの猶予中は
    // 直前の採点内訳を表示し続けたいので、activeAnswerが無い間は前の値を保持する
    // （次のactiveAnswerが立った瞬間に新しい内訳へ自然に置き換わる）。
    activeAnswerScores: activeAnswer ? activeAnswerScores : turnChanged ? [] : s.activeAnswerScores,
    myScore,
    myAnswerCount,
    groupResult,
    laughEventSeq: newlyLaughed ? s.laughEventSeq + 1 : s.laughEventSeq,
  }));

  if (live.current_phase === "final_result") {
    await refreshFinalResult();
  }
}

export const useLiveFollowerStore = create<LiveFollowerState>()((set, get) => ({
  live: null,
  myParticipant: null,
  participants: [],
  groups: [],
  participantNames: {},
  participantAvatars: {},
  currentTurn: null,
  currentTopic: null,
  activeAnswer: null,
  turnAnswers: [],
  activeAnswerScores: [],
  myAnswerCount: 0,
  myScore: null,
  groupResult: null,
  finalResult: null,
  tsukkomiSeq: 0,
  lastTsukkomi: null,
  laughEventSeq: 0,
  loading: true,
  error: null,

  subscribe: () => {
    let cancelled = false;

    const refetchAll = async () => {
      const live = await fetchActiveLive();
      if (cancelled) return;
      const userId = useAuthStore.getState().user?.id ?? null;
      const myParticipant = live && userId ? await fetchMyParticipant(live.id, userId) : null;
      if (cancelled) return;

      let participants: ParticipantRow[] = [];
      let groups: GroupRow[] = [];
      let participantNames: Record<string, string> = {};
      let participantAvatars: Record<string, ParticipantAvatarInfo> = {};
      if (live) {
        const [participantsResult, groupsResult, profiles] = await Promise.all([
          fetchParticipantsForLive(live.id),
          fetchGroupsForLive(live.id),
          fetchParticipantProfiles(live.id),
        ]);
        participants = participantsResult;
        groups = groupsResult;
        participantNames = profiles.names;
        participantAvatars = profiles.avatars;
      }
      if (cancelled) return;
      set({ live, myParticipant, participants, groups, participantNames, participantAvatars, loading: false });
      await refreshTurnDerived();
    };

    refetchAll();

    // チャンネルが(再)接続できた瞬間に必ず最新スナップショットを取り直す。
    // Realtimeは切断中に起きた変更を後から届けてくれないため、visibilitychange等の
    // イベントだけでなく、購読状態そのものの復帰でも明示的に再取得する。
    const onSubscribeStatus = (status: string) => {
      if (status === "SUBSCRIBED") refetchAll();
    };

    cleanupChannels();
    const livesCh = supabase
      .channel("follower-lives")
      .on("postgres_changes", { event: "*", schema: "public", table: "lives" }, refetchAll)
      .subscribe(onSubscribeStatus);
    const participantsCh = supabase
      .channel("follower-participants")
      .on("postgres_changes", { event: "*", schema: "public", table: "participants" }, refetchAll)
      .subscribe(onSubscribeStatus);
    const answersCh = supabase
      .channel("follower-answers")
      .on("postgres_changes", { event: "*", schema: "public", table: "answers" }, refreshTurnDerived)
      .subscribe(onSubscribeStatus);
    const scoresCh = supabase
      .channel("follower-scores")
      .on("postgres_changes", { event: "*", schema: "public", table: "scores" }, refreshTurnDerived)
      .subscribe(onSubscribeStatus);

    // つっこみ/拍手はDBに残さない演出専用のイベントなので、postgres_changesではなく
    // Realtimeのブロードキャストで飛ばす(誰が送っても全員の画面にその場で浮かぶ)。
    tsukkomiChannel = supabase
      .channel("follower-tsukkomi", { config: { broadcast: { self: true } } })
      .on("broadcast", { event: "tsukkomi" }, ({ payload }) => {
        const data = payload as { liveId: string; kind: "clap" | "stamp"; text: string };
        const currentLive = useLiveFollowerStore.getState().live;
        if (!currentLive || data.liveId !== currentLive.id) return;
        tsukkomiIdCounter += 1;
        useLiveFollowerStore.setState((s) => ({
          tsukkomiSeq: s.tsukkomiSeq + 1,
          lastTsukkomi: { id: tsukkomiIdCounter, kind: data.kind, text: data.text },
        }));
      })
      .subscribe(onSubscribeStatus);

    channels = [livesCh, participantsCh, answersCh, scoresCh, tsukkomiChannel];

    const handleVisibility = () => {
      if (document.visibilityState === "visible") refetchAll();
    };
    const handleOnline = () => refetchAll();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
      cleanupChannels();
    };
  },

  joinLive: async (preferredRole) => {
    const { live } = get();
    const userId = useAuthStore.getState().user?.id;
    if (!live || !userId) return;
    // 運営者専用管理画面の追加（第1段階）：最大参加人数(lives.max_players)を
    // Supabase側で安全に守るため、直接INSERTではなくsecurity definer RPC
    // (join_live)経由にした。RPC内でlives行をfor updateロックしてから
    // 人数を数えるため、同時押しでも上限を超えない。既存行があれば
    // on conflictでpreferred_roleだけ更新して返す（二重登録防止、
    // ページ再読み込み・再接続時も同じ結果になる）。
    const { data, error } = await supabase.rpc("join_live", {
      p_live_id: live.id,
      p_preferred_role: preferredRole,
    });
    if (error) {
      const reason =
        error.message.includes("PLAYER_LIMIT_REACHED")
          ? "参加人数が上限に達しました"
          : error.message;
      set({ error: reason });
      return;
    }
    set({ myParticipant: data as ParticipantRow, error: null });
  },

  submitMyAnswer: async (body: string) => {
    const { currentTurn, myParticipant, myAnswerCount } = get();
    if (!currentTurn || !myParticipant) return { ok: false, reason: "参加登録がまだです" };
    const trimmed = body.trim();
    if (!trimmed) return { ok: false, reason: "回答を入力してください" };

    const { error } = await supabase.from("answers").insert({
      turn_id: currentTurn.id,
      participant_id: myParticipant.id,
      seq: myAnswerCount + 1,
      body: trimmed,
    });
    if (error) {
      // answers_one_unresolved_per_turn（1ターンにつき未確定の回答は常に1件だけ）の
      // 一意制約違反(23505)。ちょうど他の人と送信が重なった場合にここに来る。
      // lives.answering_pausedの伝搬（ホスト側ポーリング経由）が間に合わず、UI上は
      // まだ送信可能に見えていたタイミングでの衝突なので、分かりやすい文言に変える。
      if (error.code === "23505") {
        return { ok: false, reason: "ちょうど他の人の回答と重なりました。少し待ってからもう一度送信してください" };
      }
      return { ok: false, reason: error.message };
    }
    await refreshTurnDerived();
    return { ok: true };
  },

  submitMyScore: async (points) => {
    const { activeAnswer, myParticipant, myScore } = get();
    if (!activeAnswer || !myParticipant) return { ok: false, reason: "採点対象がありません" };
    // 採点は一発勝負：一度投票したら本人でも変更できない（玉が落ちてくる演出と対応）。
    // DB側もscores_update_own_as_playerを廃止し、primary key(answer_id, judge_participant_id)で
    // 二重投票そのものを弾くようにしてある。ここではUIを素早く止めるためのガード。
    if (myScore !== null) return { ok: false, reason: "採点済みです" };

    // サーバーの往復を待たずに押した瞬間、自分の玉も落ち始めるように楽観的更新する。
    // 失敗した場合は元に戻す。
    const optimisticRow: ScoreRow = {
      answer_id: activeAnswer.id,
      judge_participant_id: myParticipant.id,
      points,
      created_at: new Date().toISOString(),
    };
    set((s) => ({
      myScore: points,
      activeAnswerScores: [...s.activeAnswerScores, optimisticRow],
    }));

    const { error } = await supabase.from("scores").insert({
      answer_id: activeAnswer.id,
      judge_participant_id: myParticipant.id,
      points,
    });
    if (error) {
      set((s) => ({
        myScore: null,
        activeAnswerScores: s.activeAnswerScores.filter(
          (row) =>
            !(row.answer_id === activeAnswer.id && row.judge_participant_id === myParticipant.id),
        ),
      }));
      return { ok: false, reason: error.message };
    }
    await refreshTurnDerived();
    return { ok: true };
  },

  sendTsukkomi: (kind, text) => {
    const now = Date.now();
    if (now - lastTsukkomiSentAt < TSUKKOMI_COOLDOWN_MS) return;
    const { live } = get();
    if (!live || !tsukkomiChannel) return;
    lastTsukkomiSentAt = now;
    tsukkomiChannel.send({
      type: "broadcast",
      event: "tsukkomi",
      payload: { liveId: live.id, kind, text },
    });
  },
}));
