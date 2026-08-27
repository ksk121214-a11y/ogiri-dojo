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
import { randomBotAnswerBody, randomBotScore, randomDelay } from "@/lib/liveDemoLogic";
import { assignParticipantsToGroups, pickTopicBodies } from "@/lib/liveRoomLogic";
import { supabase } from "@/lib/supabase";
import { useLiveBotStore } from "@/store/useLiveBotStore";
import type {
  AnswerRow,
  GroupRow,
  LivePhase,
  LiveRow,
  ParticipantRow,
  ProfileRow,
  ScoreRow,
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
  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  startLive: () => Promise<void>;
  closeLive: () => Promise<void>;
  confirmGroupingAndBegin: (groupCount: number) => Promise<void>;
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
    const scoreTotal = state.scores.reduce((sum, s) => sum + s.points, 0);
    const topScoreVotes = state.scores.filter((s) => s.points === 3).length;
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
        resolvedScoresByAnswer: { ...s.resolvedScoresByAnswer, [active.id]: state.scores },
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

  for (const bot of bots) {
    const participant = participants.find((p) => p.id === bot.participantId);
    if (!participant || participant.role !== "player") continue;
    if ((botCooldownUntil.get(bot.participantId) ?? 0) > now) continue;

    if (participant.group_id === turn.group_id) {
      if (answeringTimeUp || busy) continue;
      // 舞台上のボット：残り回答数があれば低確率で送信する。
      const myAnswerCount = answers.filter((a) => a.participant_id === bot.participantId).length;
      if (myAnswerCount >= 5) continue;
      if (Math.random() >= 0.03) continue;
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
      if (alreadyScored) continue;
      if (Math.random() >= 0.2) continue;
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
  }
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
    if (isAnsweringBusy(freshState.answers, latest)) {
      return; // 現在表示中の1件・演出シーケンスが終わるまでは待つ
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
  // opening は組分け確定ボタン(confirmGroupingAndBegin)が押されるまで自動では進めない。
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
  loading: true,
  error: null,

  init: async () => {
    set({ loading: true, error: null });
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

  startLive: async () => {
    const existing = await fetchActiveLive();
    if (existing) {
      set({ live: existing });
      await subscribeLiveChannels(existing.id);
      return;
    }
    const phaseDeadline = new Date(Date.now() + LIVE_ROOM_TIMING.interludeMs).toISOString();
    const { data, error } = await supabase
      .from("lives")
      .insert({
        scheduled_at: new Date().toISOString(),
        current_phase: "interlude",
        phase_deadline: phaseDeadline,
      })
      .select()
      .single();
    if (error) {
      set({ error: error.message });
      return;
    }
    set({ live: data as LiveRow, error: null });
    await subscribeLiveChannels((data as LiveRow).id);
  },

  closeLive: async () => {
    const { live } = get();
    if (!live) return;
    const { error } = await supabase
      .from("lives")
      .update({ current_phase: "closed", phase_deadline: null })
      .eq("id", live.id);
    if (error) {
      set({ error: error.message });
      return;
    }
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
  },

  confirmGroupingAndBegin: async (groupCount: number) => {
    const { live } = get();
    if (!live) return;
    // storeのparticipantsはRealtime経由の反映を待つため、直前に参加したボット等が
    // 間に合っていない可能性がある。組分け確定の瞬間にDBから直接取り直す。
    const { data: participantsData, error: participantsError } = await supabase
      .from("participants")
      .select("*")
      .eq("live_id", live.id);
    if (participantsError) {
      set({ error: participantsError.message });
      return;
    }
    const participants = (participantsData ?? []) as ParticipantRow[];
    if (participants.length === 0) {
      set({ error: "参加者がまだいません" });
      return;
    }
    set({ participants });

    // プレイヤー希望(preferred_role='player')の人だけを組分け対象にする。
    // 観客希望の人はrole='audience'のまま(採点はできるが母数には含まれない挙動は変わらない)。
    const playerParticipants = participants.filter((p) => p.preferred_role === "player");
    if (playerParticipants.length === 0) {
      set({ error: "プレイヤー希望の参加者がいません" });
      return;
    }

    const groupedIds = assignParticipantsToGroups(
      playerParticipants.map((p) => p.id),
      groupCount,
    );
    const topicBodies = pickTopicBodies(groupCount * ROUNDS_PER_LIVE_DEFAULT);
    if (topicBodies.length < groupCount * ROUNDS_PER_LIVE_DEFAULT) {
      set({ error: "お題の在庫が足りません" });
      return;
    }

    const { data: groupRows, error: groupError } = await supabase
      .from("groups")
      .insert(
        Array.from({ length: groupCount }, (_, i) => ({
          live_id: live.id,
          group_order: i + 1,
        })),
      )
      .select();
    if (groupError || !groupRows) {
      set({ error: groupError?.message ?? "組の作成に失敗しました" });
      return;
    }

    const { data: topicRows, error: topicError } = await supabase
      .from("topics")
      .insert(topicBodies.map((body) => ({ live_id: live.id, body })))
      .select();
    if (topicError || !topicRows) {
      set({ error: topicError?.message ?? "お題の作成に失敗しました" });
      return;
    }

    // 参加者をgroup_id・role='player'に更新
    await Promise.all(
      groupedIds.flatMap((memberIds, i) =>
        memberIds.map((participantId) =>
          supabase
            .from("participants")
            .update({ group_id: (groupRows as GroupRow[])[i].id, role: "player" })
            .eq("id", participantId),
        ),
      ),
    );

    // ターン(round × group)を作成
    const turnsToInsert: { live_id: string; round: number; group_id: string; topic_id: string; status: "pending" | "active" }[] = [];
    let topicCursor = 0;
    for (let round = 1; round <= ROUNDS_PER_LIVE_DEFAULT; round += 1) {
      for (const group of groupRows as GroupRow[]) {
        turnsToInsert.push({
          live_id: live.id,
          round,
          group_id: group.id,
          topic_id: (topicRows as TopicRow[])[topicCursor].id,
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
      set({ error: turnError?.message ?? "ターンの作成に失敗しました" });
      return;
    }

    const firstTurn = orderedTurns(turnRows as TurnRow[], groupRows as GroupRow[])[0];
    await supabase.from("turns").update({ status: "active" }).eq("id", firstTurn.id);

    const children = await fetchLiveChildren(live.id);
    const profiles = await fetchProfilesFor(children.participants);
    set({ ...children, profiles, error: null });

    await updateLive(live.id, {
      current_turn_id: firstTurn.id,
      current_phase: "topic_reveal",
      phase_deadline: new Date(Date.now() + PHASE_DURATIONS_MS.topic_reveal!).toISOString(),
      answering_paused: false,
      answering_remaining_ms: null,
    });
    await refreshAnswersForTurn(firstTurn.id);
  },
}));
