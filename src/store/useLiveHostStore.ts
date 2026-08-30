// 実バックエンド版ライブ（フェーズB）の司会専用ストア。
// フェーズAの「フェーズ・タイマー同期だけ」から、組分け確定・お題割当・ターン進行・
// 回答のreveal（表示）・採点の集計resolveまで担うように拡張した。
//
// 設計メモ:
// - 審査サイクル中（未表示の回答がある、または表示中で未確定の回答がある間）は
//   lives.answering_paused/answering_remaining_msを使って持ち時間を一時停止する。
//   実テストで「審査に時間がかかっている間に60秒が経過し、その後の送信がRLSで
//   弾かれる」不具合が見つかったため、一時停止の配線を実装した。
// - 採点ボタンを押した本人向けの「光る演出のための猶予」(earlyConfirmDelayMs)は
//   各クライアントのUI側の関心事であり、ホスト側の確定タイミングには含めない。
import { create } from "zustand";

import { TSUKKOMI_TEMPLATES } from "@/data/liveDemoData";
import { LIVE_ROOM_TIMING, REVEAL_SEQUENCE_MS, ROUNDS_PER_LIVE_DEFAULT } from "@/data/liveRoomTiming";
import { logAdminAction } from "@/lib/adminActionLog";
import { randomBotAnswerBody, randomBotScore, randomDelay } from "@/lib/liveDemoLogic";
import { assignParticipantsToGroups, pickRandomTopicBankEntries } from "@/lib/liveRoomLogic";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { useLiveBotStore } from "@/store/useLiveBotStore";
import type {
  AnswerRow,
  GroupRow,
  LivePhase,
  LiveRow,
  ParticipantRow,
  ProfileRow,
  ScoreRow,
  TopicBankRow,
  TopicRow,
  TurnRow,
} from "@/lib/liveRoomTypes";

const PHASE_DURATIONS_MS: Partial<Record<LivePhase, number>> = {
  interlude: LIVE_ROOM_TIMING.interludeMs,
  opening: LIVE_ROOM_TIMING.openingMs,
  topic_reveal: LIVE_ROOM_TIMING.topicRevealMs,
  answering: LIVE_ROOM_TIMING.answerMs,
  group_result: LIVE_ROOM_TIMING.groupResultMs,
};

// 運営者専用管理画面の追加（第1段階）：ライブ準備画面のフォーム入力値。
// 2026-08-30：「簡単な説明」「受付開始/終了時刻」はどの画面にも表示に使われて
// いなかった（ホーム画面・次回ライブ画面は/admin/scheduleの別データを見るため）
// ことが判明し、フォームから削除した。lives.description/reception_starts_at/
// reception_ends_at列自体は残し、createLivePreparationでnullを渡す。
export interface LivePreparationInput {
  title: string;
  scheduledAt: string; // ISO文字列
  maxPlayers: number | null;
  groupCount: number;
  // お題の選び方："random"ならtopic_bankから必要数(groupCount×ROUNDS_PER_LIVE_DEFAULT)を
  // 自動抽選、"manual"なら指定したtopic_bank行のIDをそのまま使う。
  topicSelection: { mode: "random" } | { mode: "manual"; topicBankIds: string[] };
}

interface LiveHostState {
  live: LiveRow | null;
  participants: ParticipantRow[];
  profiles: ProfileRow[]; // 参加者の表示名解決用（is_hostのみ全件読める）
  groups: GroupRow[];
  topics: TopicRow[];
  turns: TurnRow[];
  answers: AnswerRow[]; // 現在のターンぶんだけ保持
  scores: ScoreRow[]; // 現在表示中の回答ぶんだけ保持
  resolvedAnswers: AnswerRow[]; // このライブ全体で確定済みの回答履歴（ログ表示用）
  resolvedScoresByAnswer: Record<string, ScoreRow[]>; // 確定済み回答ごとの採点内訳(answer_id→scores)
  topicBank: TopicBankRow[]; // お題管理・準備画面での選定用（is_active=trueのみ）
  loading: boolean;
  error: string | null;
  // 事故防止・操作性改善：最後に正常に最新状態を取得できた時刻（refresh()・init()で更新）。
  lastRefreshedAt: string | null;

  init: () => Promise<void>;
  // 画面全体をリロードせず、現在表示中のライブ情報一式（フェーズ・参加人数・組分け・
  // お題・回答/採点状況）だけを再取得する。「最新状態を取得」ボタンから呼ぶ。
  refresh: () => Promise<{ ok: boolean; reason?: string }>;
  loadTopicBank: () => Promise<void>;
  // ライブ準備〜開始（第1段階で新設）。
  createLivePreparation: (input: LivePreparationInput) => Promise<{ ok: boolean; reason?: string }>;
  openReception: () => Promise<{ ok: boolean; reason?: string }>; // 「参加受付を開始する」
  randomizeGroups: () => Promise<{ ok: boolean; reason?: string }>; // 「（もう一度）ランダムに振り分ける」
  setParticipantGroup: (participantId: string, groupId: string | null) => Promise<{ ok: boolean; reason?: string }>;
  changeTopicAssignment: (
    topicId: string,
    entry: Pick<TopicBankRow, "id" | "body" | "format">,
  ) => Promise<{ ok: boolean; reason?: string }>;
  sendAnnouncement: (message: string, scope: "player" | "all") => Promise<{ ok: boolean; reason?: string }>;
  clearAnnouncement: () => Promise<{ ok: boolean; reason?: string }>;
  // 参加者個別への運営メッセージ（警告用）。全員向けのsendAnnouncementとは別に、
  // 特定の参加者本人の画面にだけ表示する。
  sendPrivateMessage: (participantId: string, message: string) => Promise<{ ok: boolean; reason?: string }>;
  clearPrivateMessage: (participantId: string) => Promise<{ ok: boolean; reason?: string }>;
  // ライブからの退場（本人はブロック画面になり、以降の参加・回答ができなくなる）。
  // 誤操作の事故防止のため解除もできるようにする。
  kickParticipant: (participantId: string) => Promise<{ ok: boolean; reason?: string }>;
  unkickParticipant: (participantId: string) => Promise<{ ok: boolean; reason?: string }>;
  // 受付中（interlude/opening）でも組数・最大参加人数を調整できるようにする。
  // 組数を変えた場合は、既存のgroupsとの整合を取るため「ランダムに振り分ける」を
  // 呼び直す必要がある旨をUI側で案内する（ここでは列の更新のみ行う）。
  updateCapacity: (input: { maxPlayers: number | null; groupCount: number }) => Promise<{ ok: boolean; reason?: string }>;
  beginGame: () => Promise<{ ok: boolean; reason?: string }>; // 「ゲームを開始する」
  closeLive: () => Promise<{ ok: boolean; reason?: string }>;
}

let tickTimer: ReturnType<typeof setInterval> | null = null;
let channels: ReturnType<typeof supabase.channel>[] = [];
// ボット観客がたまにツッコミ/爆笑/拍手を送るためのブロードキャストチャンネル。
// useLiveFollowerStore.tsと同じ"follower-tsukkomi"チャンネルに直接送るため、
// 参加者としての書き込み(bot.client)は不要で、司会クライアント自身の
// supabaseクライアントから送るだけでよい(誰が送ったかは表示に使わないため)。
let tsukkomiChannel: ReturnType<typeof supabase.channel> | null = null;
let lastBotTsukkomiAt = 0;
let pendingRevealAt: number | null = null; // 次の回答をrevealする予定時刻（ホスト内メモリのみ）
// 回答受付フェーズの「本当の残り持ち時間」（ホスト内メモリのみ）。src/store/useLiveDemoStore.tsの
// answeringRemainingMs/tickAnsweringと同じ考え方：審査サイクル中(busy)はここを減算しない
// （＝審査時間は持ち時間の予算を消費しない、という元々の仕様どおり）ことで、一時停止・再開を
// 挟んでも正しく減っていく。以前は「一度だけ計算した絶対締切時刻」を使っていたが、それだと
// 一時停止で消費される時間ぶんが締切に反映されず、実際にはまだ60秒経っていないのに
// （審査で一時停止していた時間の分だけ）早く締切扱いになってしまっていた。
// 一方、lives.phase_deadline/answering_remaining_ms（DBの一時停止スナップショット）だけに
// 頼ると、審査サイクルが途切れず連続する場合に「本来の締切をとうに過ぎている」ことに
// 気づけず、逆に終わらなくなる問題があった。この値は両方の問題を避けるため、tickのたびに
// 実際の経過時間(dt)を使って自前で減算し、busy中は減らさない。
let answeringRemainingMsTrue: number | null = null;
let lastAnsweringTickAt: number | null = null; // 上のdt計算用
const botCooldownUntil = new Map<string, number>(); // 参加者ID(ボット) → 次の行動を許可する時刻
// 回答ID → その回答をボット審査員全員が満点(3点)にする「パーフェクト回」かどうか。
// ボットは1tickごとに低確率で個別に採点するため、抽選を毎回独立にすると全員一致で
// 満点になることは実質起こらない。同じ回答に対する最初のボット採点時に1回だけ抽選し、
// 以降その回答への全ボットの採点をその結果で揃えることで、ScoringPhysicsBoard側の
// 満点演出（玉が金色に染まって弾ける）を実際に発生させられるようにする。
const answerPerfectRoundIds = new Map<string, boolean>();
// resolveIfDue中の回答ID。DB更新〜再取得が500msのtick間隔をまたぐと、次のtickがまだ
// resolved=falseのままのstate.answersを見て同じ回答をもう一度確定処理してしまう
// (確定済みログに同じ回答が2件入り、Reactのkey重複や表示順崩れの原因になっていた)。
// 処理中のIDを覚えておき、二重着手を防ぐ。
const resolvingAnswerIds = new Set<string>();

function cleanupChannels() {
  for (const ch of channels) supabase.removeChannel(ch);
  channels = [];
  tsukkomiChannel = null;
}

async function fetchActiveLive(): Promise<LiveRow | null> {
  const { data, error } = await supabase
    .from("lives")
    .select("*")
    .neq("current_phase", "closed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data as LiveRow | null;
}

async function fetchLiveChildren(liveId: string) {
  const [participantsRes, groupsRes, topicsRes, turnsRes] = await Promise.all([
    supabase.from("participants").select("*").eq("live_id", liveId),
    supabase.from("groups").select("*").eq("live_id", liveId),
    supabase.from("topics").select("*").eq("live_id", liveId),
    supabase.from("turns").select("*").eq("live_id", liveId),
  ]);
  return {
    participants: (participantsRes.data ?? []) as ParticipantRow[],
    groups: (groupsRes.data ?? []) as GroupRow[],
    topics: (topicsRes.data ?? []) as TopicRow[],
    turns: (turnsRes.data ?? []) as TurnRow[],
  };
}

async function fetchProfilesFor(participants: ParticipantRow[]): Promise<ProfileRow[]> {
  const userIds = [...new Set(participants.map((p) => p.user_id))];
  if (userIds.length === 0) return [];
  const { data } = await supabase.from("profiles").select("*").in("id", userIds);
  return (data ?? []) as ProfileRow[];
}

async function fetchAnswersForTurn(turnId: string): Promise<AnswerRow[]> {
  const { data } = await supabase
    .from("answers")
    .select("*")
    .eq("turn_id", turnId)
    .order("created_at", { ascending: true });
  return (data ?? []) as AnswerRow[];
}

async function fetchScoresForAnswer(answerId: string): Promise<ScoreRow[]> {
  const { data } = await supabase
    .from("scores")
    .select("*")
    .eq("answer_id", answerId);
  return (data ?? []) as ScoreRow[];
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

// 確定済み回答ログの「誰が何点つけたか」内訳の再構築用（リロード復帰時のみ使う）。
async function fetchScoresForAnswers(answerIds: string[]): Promise<Record<string, ScoreRow[]>> {
  if (answerIds.length === 0) return {};
  const { data } = await supabase.from("scores").select("*").in("answer_id", answerIds);
  const map: Record<string, ScoreRow[]> = {};
  for (const row of (data ?? []) as ScoreRow[]) {
    (map[row.answer_id] ??= []).push(row);
  }
  return map;
}

// round → group.group_order の順に並べたターン一覧。
function orderedTurns(turns: TurnRow[], groups: GroupRow[]): TurnRow[] {
  const orderOf = new Map(groups.map((g) => [g.id, g.group_order]));
  return [...turns].sort((a, b) => {
    if (a.round !== b.round) return a.round - b.round;
    return (orderOf.get(a.group_id) ?? 0) - (orderOf.get(b.group_id) ?? 0);
  });
}

async function subscribeLiveChannels(liveId: string) {
  cleanupChannels();

  const refetchChildren = async () => {
    const children = await fetchLiveChildren(liveId);
    const profiles = await fetchProfilesFor(children.participants);
    useLiveHostStore.setState({ ...children, profiles });
  };

  const refetchAnswersAndScores = async () => {
    const { live } = useLiveHostStore.getState();
    if (!live?.current_turn_id) return;
    await refreshAnswersForTurn(live.current_turn_id);
    const active = useLiveHostStore
      .getState()
      .answers.find((a) => a.revealed_at && !a.resolved);
    if (active) {
      const scores = await fetchScoresForAnswer(active.id);
      useLiveHostStore.setState({ scores });
    }
  };

  // チャンネルが(再)接続できた瞬間に必ず最新スナップショットを取り直す
  // （Realtimeは切断中に起きた変更を後から届けてくれないため）。
  const onSubscribeStatus = (status: string) => {
    if (status === "SUBSCRIBED") {
      refetchChildren();
      refetchAnswersAndScores();
    }
  };

  const participantsCh = supabase
    .channel(`host-participants-${liveId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "participants", filter: `live_id=eq.${liveId}` },
      refetchChildren,
    )
    .subscribe(onSubscribeStatus);

  const turnsCh = supabase
    .channel(`host-turns-${liveId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "turns", filter: `live_id=eq.${liveId}` },
      refetchChildren,
    )
    .subscribe(onSubscribeStatus);

  const answersCh = supabase
    .channel(`host-answers-${liveId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "answers", filter: `live_id=eq.${liveId}` },
      async () => {
        const { live } = useLiveHostStore.getState();
        if (!live?.current_turn_id) return;
        await refreshAnswersForTurn(live.current_turn_id);
      },
    )
    .subscribe(onSubscribeStatus);

  // scoresにはlive_idが無いため、絞り込まず購読し現在の回答分だけ都度取り直す
  // （リハ規模の件数なので問題にならない）。
  const scoresCh = supabase
    .channel(`host-scores-${liveId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "scores" }, async () => {
      const active = useLiveHostStore
        .getState()
        .answers.find((a) => a.revealed_at && !a.resolved);
      if (!active) return;
      const scores = await fetchScoresForAnswer(active.id);
      useLiveHostStore.setState({ scores });
    })
    .subscribe(onSubscribeStatus);

  // ボット観客のツッコミ/爆笑/拍手を送るための送信専用チャンネル
  // （useLiveFollowerStore.tsと同じチャンネル名。ここでは受信は不要）。
  tsukkomiChannel = supabase
    .channel("follower-tsukkomi", { config: { broadcast: { self: true } } })
    .subscribe();

  channels = [participantsCh, turnsCh, answersCh, scoresCh, tsukkomiChannel];
}

// current_turn_idが切り替わった直後は、Realtimeイベントを待たずに即座に
// そのターンぶんのanswers/scoresへ入れ替える（前のターンの古いデータが
// 一時的にでも残っていると、stillBusy判定を誤らせるため）。
async function refreshAnswersForTurn(turnId: string | null) {
  const answers = turnId ? await fetchAnswersForTurn(turnId) : [];
  useLiveHostStore.setState({ answers, scores: [] });
}

async function updateLive(id: string, patch: Partial<LiveRow>) {
  const { data, error } = await supabase
    .from("lives")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (!error && data) {
    useLiveHostStore.setState({ live: data as LiveRow });
  } else if (error) {
    // ここが失敗すると進行そのものが止まってしまう（例：フェーズ遷移とマイグレーション
    // 未適用の列を同じ更新に混ぜてしまい、UPDATE全体が失敗する等）。エラーが黙って
    // 握りつぶされて原因調査ができなくなるのを防ぐため、必ずコンソールに出す。
    console.error("updateLive failed", { patch, error });
  }
  return { data: data as LiveRow | null, error };
}

// 現在のターンの回答キューを処理する：表示中(revealed)の回答が無く、
// 未表示の回答があれば、一呼吸(revealDelayMs)置いてから1件だけrevealする。
async function processRevealQueue() {
  const { answers, live } = useLiveHostStore.getState();
  const active = answers.find((a) => a.revealed_at && !a.resolved);
  if (active) return; // 既に表示中の回答があるので何もしない

  // 直前の採点確定演出（フリップが消える→間を置いて玉が消える→得点表示→しばらく
  // 見せる→間を置く）が終わるまでは、キューに残っていても次を表示しない
  // （useLiveDemoStoreのprocessQueueがrevealGateUntilを見るのと同じ役割）。
  if (live?.reveal_sequence_until && Date.now() < new Date(live.reveal_sequence_until).getTime()) {
    return;
  }

  // 持ち時間切れ後も、既にキューに積まれている(=時間内に投稿済みの)回答は打ち切らず、
  // 通常どおり一件ずつ表示・審査する（ギリギリで滑り込んできた回答も、ちゃんと表示されて
  // 評価が終わるまでは次のフェーズに進めない）。時間切れ後に新規のボット回答が
  // キューに追加されなくなるのはrunBotBehavior側のガードで担保しており、その結果
  // このキュー自体は時間切れ後は増えず、いずれ必ず空になる。

  const queued = answers.filter((a) => !a.revealed_at).sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  if (queued.length === 0) {
    pendingRevealAt = null;
    return;
  }

  if (pendingRevealAt === null) {
    pendingRevealAt = Date.now() + LIVE_ROOM_TIMING.revealDelayMs;
    return;
  }
  if (Date.now() < pendingRevealAt) return;

  const target = queued[0];
  const now = Date.now();
  const { error } = await supabase
    .from("answers")
    .update({
      revealed_at: new Date(now).toISOString(),
      judging_ends_at: new Date(now + LIVE_ROOM_TIMING.judgeMs).toISOString(),
    })
    .eq("id", target.id);
  pendingRevealAt = null;
  if (!error && useLiveHostStore.getState().live?.current_turn_id) {
    const refreshed = await fetchAnswersForTurn(
      useLiveHostStore.getState().live!.current_turn_id!,
    );
    useLiveHostStore.setState({ answers: refreshed, scores: [] });
  }
}

// 表示中の回答の採点が出揃った、または締切(judgeMs+judgeGraceMs)を過ぎていれば確定する。
async function resolveIfDue() {
  const state = useLiveHostStore.getState();
  const active = state.answers.find((a) => a.revealed_at && !a.resolved);
  if (!active || !active.judging_ends_at) return;
  if (resolvingAnswerIds.has(active.id)) return; // 前のtickの確定処理がまだ進行中

  const turn = state.turns.find((t) => t.id === active.turn_id);
  if (!turn) return;

  const eligibleJudges = state.participants.filter(
    (p) => p.role === "player" && p.group_id !== turn.group_id,
  );
  const votedJudgeIds = new Set(state.scores.map((s) => s.judge_participant_id));
  const allVoted =
    eligibleJudges.length > 0 &&
    eligibleJudges.every((p) => votedJudgeIds.has(p.id));
  const deadlinePassed =
    Date.now() >= new Date(active.judging_ends_at).getTime() + LIVE_ROOM_TIMING.judgeGraceMs;

  if (!allVoted && !deadlinePassed) return;

  resolvingAnswerIds.add(active.id);
  try {
    // 2026-08-30:「ボットの回答席が光って音が鳴った直後、実際にはまだ全員の採点が
    // 揃っていないのに別の人の回答席に切り替わる」不具合対策。scoresはRealtimeイベント
    // 経由で更新されるため、直前の判定に使ったstate.scoresがまだ最新でないことがある。
    // 実際に確定する直前でDBから直接最新の採点一覧を取得し直し、本当に確定条件
    // （全員投票済み、または審査時間切れ）を満たしているか再確認してから確定する。
    const freshScores = await fetchScoresForAnswer(active.id);
    const freshVotedJudgeIds = new Set(freshScores.map((s) => s.judge_participant_id));
    const freshAllVoted =
      eligibleJudges.length > 0 && eligibleJudges.every((p) => freshVotedJudgeIds.has(p.id));
    const freshDeadlinePassed =
      Date.now() >= new Date(active.judging_ends_at).getTime() + LIVE_ROOM_TIMING.judgeGraceMs;
    if (!freshAllVoted && !freshDeadlinePassed) {
      // まだ確定できない。取得し直した最新の採点をstateに反映し、次のtickで
      // 正しい状態から続きを判定できるようにする。
      useLiveHostStore.setState({ scores: freshScores });
      return;
    }

    const scoreTotal = freshScores.reduce((sum, s) => sum + s.points, 0);
    const topScoreVotes = freshScores.filter((s) => s.points === 3).length;
    const laughTriggered = topScoreVotes > Math.floor(eligibleJudges.length / 2);

    const { error } = await supabase
      .from("answers")
      .update({
        resolved: true,
        score_total: scoreTotal,
        top_score_votes: topScoreVotes,
        judge_count: eligibleJudges.length,
        laugh_triggered: laughTriggered,
      })
      .eq("id", active.id);

    // 採点確定と同時に、演出シーケンス（フリップが消える→間を置く→玉が消える→
    // 得点表示→しばらく見せる→間を置く）が終わるまでの締切を全クライアントに配信する。
    // これによりlives.answering_paused（isAnsweringBusy経由）が、この一連の間ずっと
    // trueのままになり、他の参加者の送信もロックされ続ける。
    if (!error && state.live) {
      await updateLive(state.live.id, {
        reveal_sequence_until: new Date(Date.now() + REVEAL_SEQUENCE_MS).toISOString(),
      });
    }

    if (!error && state.live?.current_turn_id) {
      const answers = await fetchAnswersForTurn(state.live.current_turn_id);
      const resolvedEntry: AnswerRow = {
        ...active,
        resolved: true,
        score_total: scoreTotal,
        top_score_votes: topScoreVotes,
        judge_count: eligibleJudges.length,
        laugh_triggered: laughTriggered,
      };
      useLiveHostStore.setState((s) => ({
        answers,
        scores: [],
        // 何らかの理由で既に同じIDが入っていたら追加しない(念のための二重防止)。
        resolvedAnswers: s.resolvedAnswers.some((a) => a.id === resolvedEntry.id)
          ? s.resolvedAnswers
          : [...s.resolvedAnswers, resolvedEntry],
        resolvedScoresByAnswer: { ...s.resolvedScoresByAnswer, [active.id]: freshScores },
      }));
    }
  } finally {
    resolvingAnswerIds.delete(active.id);
  }
}

// 未表示の回答がある、表示中で未確定の回答がある、または直前の採点確定演出
// (reveal_sequence_until)がまだ終わっていなければ「審査サイクル中」とみなす。
//
// 持ち時間切れ後も、既にキューにある(=時間内に投稿済みの)未表示回答は引き続きbusyに
// 含める（ギリギリで滑り込んできた回答を打ち切らず、ちゃんと表示・評価させるため）。
// runBotBehavior側で時間切れ後は新規のボット回答をキューに積ませないようにしている
// ため、このキューは時間切れ後に増えることはなく、いずれ必ず空になる＝busyもいずれ
// 必ずfalseになる（無限に終わらなくなることはない）。
function isAnsweringBusy(answers: AnswerRow[], live: LiveRow | null): boolean {
  const now = Date.now();
  const busyByAnswers = answers.some((a) => !a.revealed_at || (a.revealed_at && !a.resolved));
  const busyByRevealSequence =
    !!live?.reveal_sequence_until && now < new Date(live.reveal_sequence_until).getTime();
  return busyByAnswers || busyByRevealSequence;
}

// 審査サイクル中は持ち時間を一時停止し、サイクルが終わったら残り時間から再開する。
async function syncAnsweringPause() {
  const state = useLiveHostStore.getState();
  const { live } = state;
  if (!live || live.current_phase !== "answering") return;

  const busy = isAnsweringBusy(state.answers, live);

  if (busy && !live.answering_paused) {
    const remaining = live.phase_deadline
      ? new Date(live.phase_deadline).getTime() - Date.now()
      : 0;
    await updateLive(live.id, {
      answering_paused: true,
      answering_remaining_ms: Math.max(0, remaining),
      phase_deadline: null,
    });
    return;
  }

  if (!busy && live.answering_paused) {
    const remaining = live.answering_remaining_ms ?? 0;
    await updateLive(live.id, {
      answering_paused: false,
      phase_deadline: new Date(Date.now() + remaining).toISOString(),
      answering_remaining_ms: null,
    });
  }
}

// ボット参加者に、舞台上なら回答を、客席なら採点を、それぞれ自分自身の
// 認証済みクライアントで行わせる（本人としての書き込みなので既存RLSにそのまま合致する）。
// 事前に計算したスケジュールではなく、tickのたびに低確率で抽選する方式にすることで、
// 60秒の間に自然にばらけて送信されるようにしている。
async function runBotBehavior() {
  const state = useLiveHostStore.getState();
  const { live, turns, participants, answers, scores } = state;
  if (!live || live.current_phase !== "answering" || !live.current_turn_id) return;
  const turn = turns.find((t) => t.id === live.current_turn_id);
  if (!turn) return;

  const bots = useLiveBotStore.getState().bots;
  const now = Date.now();
  const activeAnswer = answers.find((a) => a.revealed_at && !a.resolved);
  // 持ち時間が切れた後は、新しく回答を送信させない（既に表示中の1件への採点は
  // 引き続き受け付ける＝現在進行中の演出を壊さず、時間切れ後の"新規差し込み"だけ止める）。
  const answeringTimeUp = answeringRemainingMsTrue !== null && answeringRemainingMsTrue <= 0;
  // 「予約送信」を無くす：誰かの回答がまだキューに残っている・表示中・演出シーケンス中
  // (isAnsweringBusy)の間は、ボットにも新しい回答を送信させない。1人ぶんの
  // 「送信→回答席が光る→回答が出る→評価→玉が落ちる→フリップが消える→玉が消える→
  // 点数が出る→点数が消える」が完全に終わるまでは、次の回答は一切受け付けない
  // （送信そのものを止める。表示の順番待ちの"キュー"を作らない）。
  const busy = isAnsweringBusy(answers, live);

  // 客席のボットがたまにツッコミ/爆笑/拍手ボタンを押したかのように送る
  // （見た目の賑やかし用のブロードキャストのみで、どのボットが送ったかは扱わない）。
  // 60秒の回答フェーズ中に数回程度発生する頻度を狙っている（2026-08-19：2%→5%に引き上げ）。
  if (bots.length > 0 && tsukkomiChannel && now - lastBotTsukkomiAt > 1_500 && Math.random() < 0.05) {
    lastBotTsukkomiAt = now;
    const roll = Math.random();
    const [kind, text]: ["stamp" | "clap", string] =
      roll < 1 / 3
        ? ["stamp", TSUKKOMI_TEMPLATES[Math.floor(Math.random() * TSUKKOMI_TEMPLATES.length)]]
        : roll < 2 / 3
          ? ["stamp", "爆笑"]
          : ["clap", "👏"];
    tsukkomiChannel.send({
      type: "broadcast",
      event: "tsukkomi",
      payload: { liveId: live.id, kind, text },
    });
  }

  // 各ボットの行動判定・DB書き込みは互いに独立しているため、for...ofの逐次awaitではなく
  // Promise.allで並列実行する。ボット数が多い（審査員が多い組）ほど、直列だと
  // 「ボット数×DBラウンドトリップ」ぶん合計レイテンシが線形に伸び、500ms間隔のポーリング
  // 全体を遅延させ続けてしまう（効果音が遅れる・回答フリップが出ない等の一因と考えられる）。
  await Promise.all(
    bots.map(async (bot) => {
      const participant = participants.find((p) => p.id === bot.participantId);
      if (!participant || participant.role !== "player") return;
      if ((botCooldownUntil.get(bot.participantId) ?? 0) > now) return;

      if (participant.group_id === turn.group_id) {
        if (answeringTimeUp || busy) return;
        // 舞台上のボット：残り回答数があれば低確率で送信する。
        const myAnswerCount = answers.filter((a) => a.participant_id === bot.participantId).length;
        if (myAnswerCount >= 5) return;
        if (Math.random() >= 0.03) return;
        const { error } = await bot.client.from("answers").insert({
          turn_id: turn.id,
          participant_id: bot.participantId,
          seq: myAnswerCount + 1,
          body: randomBotAnswerBody(),
        });
        if (!error) {
          botCooldownUntil.set(bot.participantId, now + randomDelay(3_000, 9_000));
        }
      } else if (activeAnswer) {
        // 客席のボット：表示中の回答にまだ採点していなければ低確率で採点する。
        const alreadyScored = scores.some((s) => s.judge_participant_id === bot.participantId);
        if (alreadyScored) return;
        if (Math.random() >= 0.2) return;
        if (!answerPerfectRoundIds.has(activeAnswer.id)) {
          answerPerfectRoundIds.set(activeAnswer.id, Math.random() < 0.8);
        }
        const isPerfectRound = answerPerfectRoundIds.get(activeAnswer.id) ?? false;
        const { error } = await bot.client.from("scores").insert({
          answer_id: activeAnswer.id,
          judge_participant_id: bot.participantId,
          points: isPerfectRound ? 3 : randomBotScore(),
        });
        if (!error) {
          botCooldownUntil.set(bot.participantId, now + randomDelay(1_000, 3_000));
        }
      }
    }),
  );
}

// フェーズ・ターンの自動進行。
async function advanceIfDue() {
  const state = useLiveHostStore.getState();
  const { live } = state;
  if (!live) return;

  if (live.current_phase === "answering") {
    // src/store/useLiveDemoStore.tsのtick()と同じ考え方：このtickを始める時点でbusy
    // (審査中の1件がある、未表示のキューが残っている、または演出シーケンス中)なら、
    // 持ち時間の予算を消費しない。busyでなければ、前回tickからの実経過時間(dt)ぶんだけ
    // answeringRemainingMsTrueを減らす。
    const now = Date.now();
    const dt = Math.max(0, now - (lastAnsweringTickAt ?? now));
    lastAnsweringTickAt = now;
    if (!isAnsweringBusy(state.answers, live) && answeringRemainingMsTrue !== null) {
      answeringRemainingMsTrue = Math.max(0, answeringRemainingMsTrue - dt);
    }

    await processRevealQueue();
    await runBotBehavior();
    await resolveIfDue();
    await syncAnsweringPause();

    if (answeringRemainingMsTrue === null || answeringRemainingMsTrue > 0) return;
    const freshState = useLiveHostStore.getState();
    const latest = freshState.live;
    if (!latest || latest.current_phase !== "answering") return;

    // 2026-08-30:「時間切れギリギリで投稿された回答が無視されて次のフェーズに進んで
    // しまう」不具合対策。answersはRealtimeイベント経由で更新されるため、投稿直後は
    // まだこのクライアントのstate.answersに反映されていないことがある。フェーズを
    // 進める直前は必ずDBから直接最新の回答一覧を取得して確認し、state.answersの
    // キャッシュだけに頼らないようにする（ギリギリの回答も必ず表示・評価されてから
    // 次のフェーズに進むようにする）。
    const dbAnswers = latest.current_turn_id
      ? await fetchAnswersForTurn(latest.current_turn_id)
      : freshState.answers;
    if (isAnsweringBusy(dbAnswers, latest)) {
      // 取得し直した最新の回答をstateにも反映しておき、次のtickでprocessRevealQueue等が
      // 追いついた状態からすぐ処理を続けられるようにする。
      useLiveHostStore.setState({ answers: dbAnswers });
      return; // 現在表示中の1件・演出シーケンス・未表示の回答が残っている間は待つ
    }
    answeringRemainingMsTrue = null;
    lastAnsweringTickAt = null;
    // reveal_sequence_untilは意図的にここに含めない：もしDBにこの列がまだ無い環境
    // （マイグレーション未適用）だと、存在しない列を含むUPDATEはPostgreSQL側で
    // エラーになりUPDATE全体が失敗する。これをcurrent_phase遷移と同じ呼び出しに
    // 混ぜていたせいで、マイグレーション未適用の環境ではフェーズ遷移そのものが
    // 常に失敗し、時間切れになっても画面が進まなくなっていた。次の周のresolveJudging
    // が新しい値を上書きするため、ここで明示的にnullへ戻す必要は無い。
    await updateLive(latest.id, {
      current_phase: "group_result",
      phase_deadline: new Date(Date.now() + LIVE_ROOM_TIMING.groupResultMs).toISOString(),
      answering_paused: false,
      answering_remaining_ms: null,
    });
    if (latest.current_turn_id) {
      await supabase.from("turns").update({ status: "done" }).eq("id", latest.current_turn_id);
    }
    return;
  }

  const latest = useLiveHostStore.getState().live;
  if (!latest) return;
  if (!latest.phase_deadline) return;
  if (Date.now() < new Date(latest.phase_deadline).getTime()) return;

  if (live.current_phase === "group_result") {
    const sorted = orderedTurns(state.turns, state.groups);
    const currentIndex = sorted.findIndex((t) => t.id === live.current_turn_id);
    const nextTurn = sorted[currentIndex + 1];
    if (nextTurn) {
      await supabase.from("turns").update({ status: "active" }).eq("id", nextTurn.id);
      await updateLive(live.id, {
        current_turn_id: nextTurn.id,
        current_phase: "topic_reveal",
        phase_deadline: new Date(Date.now() + PHASE_DURATIONS_MS.topic_reveal!).toISOString(),
        answering_paused: false,
        answering_remaining_ms: null,
      });
      await refreshAnswersForTurn(nextTurn.id);
    } else {
      await updateLive(live.id, { current_phase: "final_result", phase_deadline: null });
    }
    return;
  }

  if (live.current_phase === "topic_reveal") {
    const answerMs = PHASE_DURATIONS_MS.answering!;
    answeringRemainingMsTrue = answerMs;
    lastAnsweringTickAt = Date.now();
    await updateLive(live.id, {
      current_phase: "answering",
      phase_deadline: new Date(Date.now() + answerMs).toISOString(),
    });
    return;
  }

  if (live.current_phase === "interlude") {
    await updateLive(live.id, {
      current_phase: "opening",
      phase_deadline: new Date(Date.now() + PHASE_DURATIONS_MS.opening!).toISOString(),
    });
    return;
  }
  // opening は「ゲームを開始する」ボタン(beginGame)が押されるまで自動では進めない。
}

export const useLiveHostStore = create<LiveHostState>()((set, get) => ({
  live: null,
  participants: [],
  profiles: [],
  groups: [],
  topics: [],
  turns: [],
  answers: [],
  scores: [],
  resolvedAnswers: [],
  resolvedScoresByAnswer: {},
  topicBank: [],
  loading: true,
  error: null,
  lastRefreshedAt: null,

  loadTopicBank: async () => {
    const { data, error } = await supabase
      .from("topic_bank")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (!error) set({ topicBank: (data ?? []) as TopicBankRow[] });
  },

  init: async () => {
    set({ loading: true, error: null });
    void get().loadTopicBank();
    const live = await fetchActiveLive();
    if (live) {
      const children = await fetchLiveChildren(live.id);
      const profiles = await fetchProfilesFor(children.participants);
      const answers = live.current_turn_id ? await fetchAnswersForTurn(live.current_turn_id) : [];
      const resolvedAnswers = await fetchResolvedAnswersForLive(live.id);
      const resolvedScoresByAnswer = await fetchScoresForAnswers(resolvedAnswers.map((a) => a.id));
      set({
        live,
        ...children,
        profiles,
        answers,
        resolvedAnswers,
        resolvedScoresByAnswer,
        loading: false,
        lastRefreshedAt: new Date().toISOString(),
      });
      // 司会画面を開き直した時、answeringフェーズの途中であればanswerRemainingMsTrue
      // （ホスト内メモリのみ）を最善努力で復元する。これが無いと再読込のたびに
      // 強制終了の判定が効かなくなる（pendingRevealAt等と同じ既知の制約：司会ブラウザの
      // 再読込・再起動をまたいだ完全な復元は今回のスコープ外。DBの一時停止スナップショット
      // をそのまま使うため、直前に長い連続審査があった場合はズレる可能性がある）。
      if (live.current_phase === "answering") {
        answeringRemainingMsTrue = live.answering_paused
          ? (live.answering_remaining_ms ?? 0)
          : live.phase_deadline
            ? Math.max(0, new Date(live.phase_deadline).getTime() - Date.now())
            : null;
        lastAnsweringTickAt = Date.now();
      } else {
        answeringRemainingMsTrue = null;
        lastAnsweringTickAt = null;
      }
      await subscribeLiveChannels(live.id);
    } else {
      set({ live: null, loading: false });
    }

    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      advanceIfDue();
    }, 500);
  },

  // 事故防止・操作性改善：ページ全体をリロードせず、現在表示中のライブ情報一式だけを
  // 再取得する。「最新状態を取得」ボタンから呼ぶ。loadingフラグは変更しない
  // （画面全体を「状態を確認中…」に戻さないため）。tickTimer自体はinit()で既に
  // 動いているので触らない。
  refresh: async () => {
    const { live } = get();
    if (!live) return { ok: true };
    try {
      const { data: freshLiveData, error: liveError } = await supabase
        .from("lives")
        .select("*")
        .eq("id", live.id)
        .maybeSingle();
      if (liveError) return { ok: false, reason: liveError.message };
      if (!freshLiveData) {
        // ライブ行自体が無くなっている（通常は起こらないが念のため）。
        set({ live: null, lastRefreshedAt: new Date().toISOString() });
        return { ok: true };
      }
      const freshLive = freshLiveData as LiveRow;
      const children = await fetchLiveChildren(live.id);
      const profiles = await fetchProfilesFor(children.participants);
      const answers = freshLive.current_turn_id
        ? await fetchAnswersForTurn(freshLive.current_turn_id)
        : [];
      const resolvedAnswers = await fetchResolvedAnswersForLive(live.id);
      const resolvedScoresByAnswer = await fetchScoresForAnswers(resolvedAnswers.map((a) => a.id));
      const active = answers.find((a) => a.revealed_at && !a.resolved);
      const scores = active ? await fetchScoresForAnswer(active.id) : [];
      set({
        live: freshLive,
        ...children,
        profiles,
        answers,
        scores,
        resolvedAnswers,
        resolvedScoresByAnswer,
        lastRefreshedAt: new Date().toISOString(),
        error: null,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "取得に失敗しました" };
    }
  },

  // 運営者専用管理画面の追加（第1段階）：「ライブ準備画面」の保存操作。
  // 旧startLive()はここでinterludeとして直接insertしていたが、新設計では
  // 「準備中(scheduled)」として作成し、受付開始は別操作(openReception)に分離する。
  createLivePreparation: async (input) => {
    const existing = await fetchActiveLive();
    if (existing) {
      set({ live: existing });
      await subscribeLiveChannels(existing.id);
      return { ok: false, reason: "既に進行中のライブがあります" };
    }
    if (input.groupCount < 1) {
      return { ok: false, reason: "組数は1以上にしてください" };
    }
    const neededTopics = input.groupCount * ROUNDS_PER_LIVE_DEFAULT;

    let entries: Pick<TopicBankRow, "id" | "body" | "format">[];
    if (input.topicSelection.mode === "random") {
      entries = await pickRandomTopicBankEntries(neededTopics);
    } else {
      const ids = input.topicSelection.topicBankIds;
      const { data } = await supabase
        .from("topic_bank")
        .select("id, body, format")
        .in("id", ids);
      entries = (data ?? []) as Pick<TopicBankRow, "id" | "body" | "format">[];
    }
    if (entries.length < neededTopics) {
      return { ok: false, reason: `お題が足りません（${neededTopics}件必要）` };
    }

    const actorId = (await supabase.auth.getUser()).data.user?.id ?? null;
    const { data: liveRow, error: liveError } = await supabase
      .from("lives")
      .insert({
        scheduled_at: input.scheduledAt,
        current_phase: "scheduled",
        title: input.title || null,
        description: null,
        max_players: input.maxPlayers,
        planned_group_count: input.groupCount,
        reception_starts_at: null,
        reception_ends_at: null,
        created_by: actorId,
      })
      .select()
      .single();
    if (liveError || !liveRow) {
      return { ok: false, reason: liveError?.message ?? "ライブの作成に失敗しました" };
    }
    const live = liveRow as LiveRow;

    const { error: topicError } = await supabase.from("topics").insert(
      entries.slice(0, neededTopics).map((entry) => ({
        live_id: live.id,
        body: entry.body,
        format: entry.format,
        topic_bank_id: entry.id,
      })),
    );
    if (topicError) {
      return { ok: false, reason: topicError.message };
    }

    await logAdminAction({
      action: "live_prepared",
      targetType: "lives",
      targetId: live.id,
      detail: { title: input.title, maxPlayers: input.maxPlayers, groupCount: input.groupCount },
    });

    const children = await fetchLiveChildren(live.id);
    const profiles = await fetchProfilesFor(children.participants);
    set({ live, ...children, profiles, error: null });
    await subscribeLiveChannels(live.id);
    return { ok: true };
  },

  // 「参加受付を開始する」：旧startLive()のinsert部分をupdateに置き換えただけで、
  // 以降のフェーズ自動進行(interlude→opening、advanceIfDue)は無改造で流用する。
  // 事故防止：別タブ等から既に受付開始済みの場合に二重実行しないよう、
  // current_phase='scheduled'であることをwhere条件に含めたガード付きupdateにする
  // （closeLiveと同じ考え方）。対象0件なら状態が変わっている旨のエラーを返す。
  openReception: async () => {
    const { live } = get();
    if (!live || live.current_phase !== "scheduled") {
      return {
        ok: false,
        reason: "ライブの状態が別の操作によって変更されています。最新状態を取得してください。",
      };
    }
    const phaseDeadline = new Date(Date.now() + LIVE_ROOM_TIMING.interludeMs).toISOString();
    const { data, error } = await supabase
      .from("lives")
      .update({ current_phase: "interlude", phase_deadline: phaseDeadline })
      .eq("id", live.id)
      .eq("current_phase", "scheduled")
      .select()
      .maybeSingle();
    if (error) {
      set({ error: error.message });
      return { ok: false, reason: error.message };
    }
    if (!data) {
      const message = "ライブの状態が別の操作によって変更されています。最新状態を取得してください。";
      set({ error: message });
      return { ok: false, reason: message };
    }
    set({ live: data as LiveRow });
    await logAdminAction({ action: "reception_opened", targetType: "lives", targetId: live.id });
    return { ok: true };
  },

  // 「（もう一度）ランダムに振り分ける」：旧confirmGroupingAndBeginの前半部分
  // （組分けのみ）。お題選定・turns作成・フェーズ遷移は行わない（beginGameへ分離）。
  randomizeGroups: async () => {
    const { live } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };
    const groupCount = live.planned_group_count ?? 1;

    const { data: participantsData, error: participantsError } = await supabase
      .from("participants")
      .select("*")
      .eq("live_id", live.id);
    if (participantsError) return { ok: false, reason: participantsError.message };
    const participants = (participantsData ?? []) as ParticipantRow[];

    const playerParticipants = participants.filter((p) => p.preferred_role === "player");
    if (playerParticipants.length === 0) {
      return { ok: false, reason: "プレイヤー希望の参加者がいません" };
    }

    const groupedIds = assignParticipantsToGroups(
      playerParticipants.map((p) => p.id),
      groupCount,
    );

    // 既存のgroups行があれば再利用する（「もう一度振り分ける」で毎回組を
    // 作り直すとturns.group_idの参照が壊れるため、group_order昇順で既存行に対応させる）。
    let groupRows = get().groups.filter((g) => g.live_id === live.id);
    if (groupRows.length < groupCount) {
      const { data: newGroups, error: groupError } = await supabase
        .from("groups")
        .insert(
          Array.from({ length: groupCount - groupRows.length }, (_, i) => ({
            live_id: live.id,
            group_order: groupRows.length + i + 1,
          })),
        )
        .select();
      if (groupError || !newGroups) {
        return { ok: false, reason: groupError?.message ?? "組の作成に失敗しました" };
      }
      groupRows = [...groupRows, ...(newGroups as GroupRow[])].sort(
        (a, b) => a.group_order - b.group_order,
      );
    }

    // まずプレイヤー希望者全員をaudience/group_id:nullへ一旦戻し、
    // 新しい割り当てだけを反映する（前回の手動変更を確実に上書きするため）。
    await Promise.all(
      playerParticipants.map((p) =>
        supabase.from("participants").update({ group_id: null, role: "audience" }).eq("id", p.id),
      ),
    );
    await Promise.all(
      groupedIds.flatMap((memberIds, i) =>
        memberIds.map((participantId) =>
          supabase
            .from("participants")
            .update({ group_id: groupRows[i].id, role: "player" })
            .eq("id", participantId),
        ),
      ),
    );

    await logAdminAction({
      action: "groups_randomized",
      targetType: "lives",
      targetId: live.id,
      detail: { groupCount, playerCount: playerParticipants.length },
    });

    const children = await fetchLiveChildren(live.id);
    const profiles = await fetchProfilesFor(children.participants);
    set({ ...children, profiles, error: null });
    return { ok: true };
  },

  // 参加者一覧の組選択プルダウンから呼ぶ、個別の手動組変更。即時保存。
  setParticipantGroup: async (participantId, groupId) => {
    const { error } = await supabase
      .from("participants")
      .update({ group_id: groupId, role: groupId ? "player" : "audience" })
      .eq("id", participantId);
    if (error) {
      set({ error: error.message });
      return { ok: false, reason: error.message };
    }
    await logAdminAction({
      action: "participant_group_changed",
      targetType: "participants",
      targetId: participantId,
      detail: { groupId },
    });
    const { live } = get();
    if (live) {
      const children = await fetchLiveChildren(live.id);
      const profiles = await fetchProfilesFor(children.participants);
      set({ ...children, profiles });
    }
    return { ok: true };
  },

  // 組分け確認画面でのお題変更（ランダム再抽選 or 手動選択、どちらも呼び出し側で
  // 選んだ1件のtopic_bank行をここに渡す）。locked=true（既にturnsに紐づいて
  // 参加者へ公開済み）の場合の確認ダイアログはUI側の責務とする。
  changeTopicAssignment: async (topicId, entry) => {
    const { error } = await supabase
      .from("topics")
      .update({ body: entry.body, format: entry.format, topic_bank_id: entry.id })
      .eq("id", topicId);
    if (error) {
      set({ error: error.message });
      return { ok: false, reason: error.message };
    }
    await logAdminAction({
      action: "topic_changed",
      targetType: "topics",
      targetId: topicId,
      detail: { newTopicBankId: entry.id },
    });
    const { live } = get();
    if (live) {
      const children = await fetchLiveChildren(live.id);
      set({ topics: children.topics });
    }
    return { ok: true };
  },

  sendAnnouncement: async (message, scope) => {
    const { live } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };
    const trimmed = message.trim();
    if (!trimmed) return { ok: false, reason: "メッセージを入力してください" };
    const { error } = await updateLive(live.id, {
      announcement_message: trimmed,
      announcement_scope: scope,
      announcement_sent_at: new Date().toISOString(),
    });
    if (error) {
      set({ error: error.message });
      return { ok: false, reason: error.message };
    }
    await logAdminAction({
      action: "announcement_sent",
      targetType: "lives",
      targetId: live.id,
      detail: { message: trimmed, scope },
    });
    return { ok: true };
  },

  clearAnnouncement: async () => {
    const { live } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };
    const { error } = await updateLive(live.id, { announcement_message: null });
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  },

  sendPrivateMessage: async (participantId, message) => {
    const { live } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };
    const trimmed = message.trim();
    if (!trimmed) return { ok: false, reason: "メッセージを入力してください" };
    const { error } = await supabase
      .from("participants")
      .update({ host_message: trimmed, host_message_sent_at: new Date().toISOString() })
      .eq("id", participantId);
    if (error) return { ok: false, reason: error.message };
    await logAdminAction({
      action: "participant_private_message_sent",
      targetType: "participants",
      targetId: participantId,
      detail: { message: trimmed },
    });
    const children = await fetchLiveChildren(live.id);
    set({ participants: children.participants });
    return { ok: true };
  },

  clearPrivateMessage: async (participantId) => {
    const { live } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };
    const { error } = await supabase
      .from("participants")
      .update({ host_message: null })
      .eq("id", participantId);
    if (error) return { ok: false, reason: error.message };
    const children = await fetchLiveChildren(live.id);
    set({ participants: children.participants });
    return { ok: true };
  },

  kickParticipant: async (participantId) => {
    const { live, participants } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };
    const target = participants.find((p) => p.id === participantId);
    const { error } = await supabase
      .from("participants")
      .update({ kicked_at: new Date().toISOString() })
      .eq("id", participantId);
    if (error) return { ok: false, reason: error.message };
    await logAdminAction({
      action: "participant_kicked",
      targetType: "participants",
      targetId: participantId,
    });
    // 2026-08-30:「退場させられたらユーザー管理に通知（記録）が行くようにして、
    // 退場させられた件数をユーザー詳細に入れておいて」の要望対応。
    // /admin/users/[id]の「警告・対応履歴」と同じuser_sanctionsに記録することで、
    // 新規の通知経路を増やさずユーザー詳細ページにそのまま反映される。
    if (target) {
      const actorId = useAuthStore.getState().user?.id ?? null;
      const { error: sanctionError } = await supabase.from("user_sanctions").insert({
        user_id: target.user_id,
        type: "kicked",
        // reasonは種別ラベル「ライブからの退場」と表示上重複させないため、
        // 直前の個別メッセージがあればそれだけを補足として入れる（無ければ空）。
        reason: target.host_message ?? "",
        target_ref: live.id,
        created_by: actorId,
      });
      if (sanctionError) {
        console.warn("[useLiveHostStore] 退場のuser_sanctions記録に失敗", sanctionError);
      }
    }
    const children = await fetchLiveChildren(live.id);
    set({ participants: children.participants });
    return { ok: true };
  },

  unkickParticipant: async (participantId) => {
    const { live } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };
    const { error } = await supabase
      .from("participants")
      .update({ kicked_at: null })
      .eq("id", participantId);
    if (error) return { ok: false, reason: error.message };
    await logAdminAction({
      action: "participant_unkicked",
      targetType: "participants",
      targetId: participantId,
    });
    const children = await fetchLiveChildren(live.id);
    set({ participants: children.participants });
    return { ok: true };
  },

  // 受付中（interlude/opening）に、集まり具合を見ながら組数・最大参加人数を
  // 調整できるようにする。組数を変えても既存のgroups/participantsの割り当ては
  // 自動では変更しない（randomizeGroupsを呼び直すとplanned_group_countに
  // 合わせて再割り当てされる）。
  updateCapacity: async ({ maxPlayers, groupCount }) => {
    const { live } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };
    if (groupCount < 1) return { ok: false, reason: "組数は1以上にしてください" };
    const { error } = await updateLive(live.id, {
      max_players: maxPlayers,
      planned_group_count: groupCount,
    });
    if (error) return { ok: false, reason: error.message };
    await logAdminAction({
      action: "capacity_updated",
      targetType: "lives",
      targetId: live.id,
      detail: { maxPlayers, groupCount },
    });
    return { ok: true };
  },

  // 「ゲームを開始する」：旧confirmGroupingAndBeginの後半部分。準備画面で既に
  // 作成済みのtopics（live_id紐づけ）とrandomizeGroupsで確定済みのgroups/participants
  // を使ってturnsを作成し、topic_revealへ遷移する。以降のゲーム進行は一切変更しない。
  beginGame: async () => {
    const { live, groups } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };

    const { data: participantsData } = await supabase
      .from("participants")
      .select("*")
      .eq("live_id", live.id)
      .eq("role", "player");
    const players = (participantsData ?? []) as ParticipantRow[];
    if (players.length === 0) {
      return { ok: false, reason: "組分けされたプレイヤーがいません" };
    }

    const { data: topicRows } = await supabase
      .from("topics")
      .select("*")
      .eq("live_id", live.id)
      .order("created_at", { ascending: true });
    const topics = (topicRows ?? []) as TopicRow[];
    const groupCount = groups.length || live.planned_group_count || 1;
    const neededTopics = groupCount * ROUNDS_PER_LIVE_DEFAULT;
    if (topics.length < neededTopics) {
      return { ok: false, reason: "お題の準備が不足しています" };
    }

    // 事故防止：連打・複数タブからの同時実行でturns等が重複作成されないための関所。
    // 「opening・かつまだturnsが割り当てられていない(current_turn_id is null)」状態からしか
    // 離脱できないガード付きupdateにし、成功できるのは最初の1回だけになるようにする。
    const topicRevealDeadline = new Date(Date.now() + PHASE_DURATIONS_MS.topic_reveal!).toISOString();
    const { data: guardedLive, error: guardError } = await supabase
      .from("lives")
      .update({ current_phase: "topic_reveal", phase_deadline: topicRevealDeadline })
      .eq("id", live.id)
      .eq("current_phase", "opening")
      .is("current_turn_id", null)
      .select()
      .maybeSingle();
    if (guardError) {
      return { ok: false, reason: guardError.message };
    }
    if (!guardedLive) {
      const message = "ライブの状態が別の操作によって変更されています。最新状態を取得してください。";
      set({ error: message });
      return { ok: false, reason: message };
    }
    set({ live: guardedLive as LiveRow });

    const sortedGroups = [...groups].sort((a, b) => a.group_order - b.group_order);
    const turnsToInsert: {
      live_id: string;
      round: number;
      group_id: string;
      topic_id: string;
      status: "pending" | "active";
    }[] = [];
    let topicCursor = 0;
    for (let round = 1; round <= ROUNDS_PER_LIVE_DEFAULT; round += 1) {
      for (const group of sortedGroups) {
        turnsToInsert.push({
          live_id: live.id,
          round,
          group_id: group.id,
          topic_id: topics[topicCursor].id,
          status: "pending",
        });
        topicCursor += 1;
      }
    }
    const { data: turnRows, error: turnError } = await supabase
      .from("turns")
      .insert(turnsToInsert)
      .select();
    if (turnError || !turnRows) {
      // ロールバック：opening状態に戻し、もう一度「ゲームを開始する」をやり直せるようにする
      // （このガードを通過できるのは1回だけなので、戻さないと二度と開始できなくなる）。
      await updateLive(live.id, { current_phase: "opening", phase_deadline: null });
      return { ok: false, reason: turnError?.message ?? "ターンの作成に失敗しました" };
    }

    // 使用が確定したお題だけlocked=trueにする（実際にturnsに紐づいた分のみ）。
    await supabase
      .from("topics")
      .update({ locked: true })
      .in("id", turnsToInsert.map((t) => t.topic_id));

    const firstTurn = orderedTurns(turnRows as TurnRow[], sortedGroups)[0];
    await supabase.from("turns").update({ status: "active" }).eq("id", firstTurn.id);

    await logAdminAction({
      action: "game_started",
      targetType: "lives",
      targetId: live.id,
      detail: { playerCount: players.length, groupCount },
    });

    const children = await fetchLiveChildren(live.id);
    const profiles = await fetchProfilesFor(children.participants);
    set({ ...children, profiles, error: null });

    // current_phase/phase_deadlineは既に上のガード付きupdateで設定済みのため、
    // ここではcurrent_turn_idの確定だけを行う。
    await updateLive(live.id, {
      current_turn_id: firstTurn.id,
      answering_paused: false,
      answering_remaining_ms: null,
    });
    await refreshAnswersForTurn(firstTurn.id);
    return { ok: true };
  },

  closeLive: async () => {
    const { live } = get();
    if (!live) return { ok: true };
    // 終了ボタン連打で二重実行されないよう、対象をcurrent_phase<>'closed'に絞る。
    // 既に他の呼び出し（別タブ等）でclosed済みなら対象0件で何も起きない。
    const { data, error } = await supabase
      .from("lives")
      .update({ current_phase: "closed", phase_deadline: null, ended_at: new Date().toISOString() })
      .eq("id", live.id)
      .neq("current_phase", "closed")
      .select();
    if (error) {
      set({ error: error.message });
      return { ok: false, reason: error.message };
    }
    if (!data || data.length === 0) {
      // 既に終了済み（二重クリック等）。UIだけ「開始前」に戻す。
      cleanupChannels();
      set({
        live: null,
        participants: [],
        profiles: [],
        groups: [],
        topics: [],
        turns: [],
        answers: [],
        scores: [],
        resolvedAnswers: [],
        resolvedScoresByAnswer: {},
        error: null,
      });
      return { ok: true };
    }
    await logAdminAction({ action: "live_closed", targetType: "lives", targetId: live.id });
    cleanupChannels();
    useLiveBotStore.getState().removeAllBots();
    // closed状態の行を持ち続けると画面が「開始前」に戻らない(!liveでのみ判定しているため)。
    // ライブそのものを無かった状態に戻す。
    set({
      live: null,
      participants: [],
      profiles: [],
      groups: [],
      topics: [],
      turns: [],
      answers: [],
      scores: [],
      resolvedAnswers: [],
      resolvedScoresByAnswer: {},
      error: null,
    });
    return { ok: true };
  },
}));
