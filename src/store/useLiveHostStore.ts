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
import {
  answersSnapshotMatches,
  childrenSnapshotReady,
  createSliceGate,
  loadSnapshotSlice,
  shouldReleaseInitInFlight,
  shouldRetryNow,
  type AnswersSnapshotKey,
  type SliceLoadOutcome,
} from "@/lib/liveHostSnapshots";
import { pickRandomTopicBankEntries } from "@/lib/liveRoomLogic";
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
  // 2026-09-09（再レビュー対応）：participants/groups/topics/turnsが「どのliveIdに
  // ついて正常なスナップショットを取得済みか」。今のlive.idと一致していれば
  // 「そのライブについてchildrenは信頼できる」＝childrenSnapshotReady()がtrue。
  // HostProgressControllerがfocus/visibilitychange等のたびにinit()を呼び直す
  // ようになったことで、一時的な取得失敗のたびにturns/groupsが空配列で
  // 上書きされ、advanceIfDueが「次のターンが無い」と誤判定してfinal_resultへ
  // 誤って進んでしまう恐れがあった。boolean単体だと別ライブへ誤流用しやすいため
  // liveIdで持つ（詳細はsrc/lib/liveHostSnapshots.ts・init()参照）。
  childrenSnapshotLiveId: string | null;
  // 2026-09-10（再レビュー対応）：現在stateに入っているanswersが、どの
  // (liveId, turnId)について正常取得済みか（未確認ならnull）。
  // answers取得失敗を「回答0件」と誤認しないための識別情報。これが今の
  // live.id/current_turn_idと一致しない間は、advanceIfDueは回答時間の減算・
  // processRevealQueue・resolveIfDue・syncAnsweringPauseの再開・
  // answering→group_result遷移を一切行わず、一定間隔で再取得だけ試みる。
  answersSnapshot: AnswersSnapshotKey | null;
  // 2026-09-11（再レビュー対応・問題3）：ライブ本体(lives行)の最新状態を
  // 確認できているか。fetchActiveLive/fetchLiveRowの取得失敗中はfalseにし、
  // 表示用の古いliveは残しつつ、advanceIfDueの自動進行を凍結する
  // （読み取り再試行だけを一定間隔で行い、取得成功でtrueへ戻す）。
  liveSnapshotConfirmed: boolean;
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
  // 2026-09-04: eligible_judge_countの分母をDBの現在値から実際に再計算し直す
  // 修復用アクション（「最新状態を取得」とは異なり、値そのものを書き換える）。
  resyncEligibleJudgeCounts: () => Promise<{ ok: boolean; reason?: string }>;
  // 受付中（interlude/opening）でも組数・最大参加人数を調整できるようにする。
  // 組数を変えた場合は、既存のgroupsとの整合を取るため「ランダムに振り分ける」を
  // 呼び直す必要がある旨をUI側で案内する（ここでは列の更新のみ行う）。
  updateCapacity: (input: { maxPlayers: number | null; groupCount: number }) => Promise<{ ok: boolean; reason?: string }>;
  beginGame: () => Promise<{ ok: boolean; reason?: string }>; // 「ゲームを開始する」
  closeLive: () => Promise<{ ok: boolean; reason?: string }>;
  // 2026-09-03: closeLiveのポイント付与が失敗した場合に、closed後いつでも
  // 単独で再試行するためのアクション（管理画面のライブ結果詳細から呼ぶ）。
  retryRankRewards: (liveId: string) => Promise<{ ok: boolean; reason?: string }>;
  // 2026-09-09（再レビュー対応）：ログアウト・isHost剥奪時にHostProgressControllerから
  // 呼ぶ。tickTimer・Realtime channels・進行用のモジュール変数一式を片付け、
  // 以後古い（stopされる前の）init()呼び出しが後から完了してもタイマー・
  // channelを再作成しないようにする（世代番号で判定。詳細はinit()参照）。
  stopHostProgress: () => void;
}

let tickTimer: ReturnType<typeof setInterval> | null = null;
let channels: ReturnType<typeof supabase.channel>[] = [];
// 2026-09-09（再レビュー対応）：stopHostProgress()を呼ぶたびに+1する世代番号。
// init()の非同期処理は開始時点の世代を覚えておき、要所（特にtickTimer/Realtime
// channelを作る直前）で現在の世代と比較する。ずれていれば、そのinit()呼び出しは
// 実行中にstopされたということなので、以降の処理・タイマー/channel作成を行わない
// （stopした後に、古いinit()が遅れて完了してタイマー等を復活させてしまう事故を防ぐ）。
let progressGeneration = 0;
// 2026-09-09（複数管理画面タブ対策）：init()は/live/hostページのuseEffectだけでなく、
// RootLayoutに常駐するHostProgressController（visibilitychange/focus/pageshow/online
// でも再度init()を呼ぶ）からも呼ばれるようになった。短時間に複数の呼び出しが重なった
// 場合、後発の呼び出しが同じ非同期処理を並行してもう一度始めてしまうと、
// tickTimer/channels自体はcleanup→再作成で最終的には1つに収束するものの、無駄な
// 重複リクエストが発生する。進行中のinit()があれば同じPromiseを返すことで、
// 呼び出しを実質1本化する（intervalやRealtime channelが増殖しないことの追加の保険）。
let initInFlight: Promise<void> | null = null;
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

// 2026-09-11（再レビュー対応）：スライスごとの取得世代ゲート。
// 同じ対象（live/children/answers/resolved）に対する取得が並行した場合、
// より新しい取得が始まった後は、古い取得の完了結果を一切反映しない
// （liveId/turnIdの一致だけでは、古いR1が新しいR2の後に完了してR2を巻き戻せる）。
// stopHostProgress()でも begin() して、進行中の全取得のトークンを無効化する。
const liveGate = createSliceGate();
const childrenGate = createSliceGate();
const answersGate = createSliceGate();
const resolvedGate = createSliceGate();

// 2026-09-11（再レビュー対応）：未確認スライスの読み取り再試行の
// single-flight フラグと最小間隔（tickは500msだが再取得は最短2秒間隔に絞る）。
let liveRetryInFlight = false;
let liveRetryAt = 0;
let childrenRetryInFlight = false;
let childrenRetryAt = 0;
let answersRetryInFlight = false;
let answersRetryAt = 0;
const SNAPSHOT_RETRY_INTERVAL_MS = 2_000;

// authoritative（DB書き込み結果やRPCの戻り値など、今この瞬間に確実に最新と分かる
// live行）を反映する。ゲートを begin() して、進行中の古いlive読み取りを無効化する。
function applyAuthoritativeLive(row: LiveRow) {
  liveGate.begin();
  useLiveHostStore.setState({ live: row, liveSnapshotConfirmed: true });
}
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

// 500msの進行tickタイマーを（重複なく）1本だけ確実に張る。指定世代が既に
// 古い（stopHostProgressされた）場合は張らない。
function ensureTickTimer(generation: number) {
  if (generation !== progressGeneration) return;
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    void advanceIfDue();
  }, 500);
}

// 2026-09-03:「Supabase取得エラーを空配列・nullとして上書きしない」対応。
// 従来は取得失敗時にnull/[]を返し、呼び出し側がそのまま「ライブが無い」
// 「参加者0人」等としてstateに反映していた。エラーと「本当に0件」を区別できる
// よう{ok, data}を返し、呼び出し側でok:falseの場合は既存stateを保持する。
async function fetchActiveLive(): Promise<{ ok: boolean; data: LiveRow | null }> {
  const { data, error } = await supabase
    .from("lives")
    .select("*")
    .neq("current_phase", "closed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[useLiveHostStore] fetchActiveLive failed", error);
    return { ok: false, data: null };
  }
  return { ok: true, data: data as LiveRow | null };
}

// 2026-09-06:「最初のお題発表だけ0秒になっても回答画面へ進まない」不具合対応。
// begin_game RPCはDB側でlives.current_phase/phase_deadlineをtopic_revealへ
// 更新するが、呼び出し元(beginGame)はparticipants/groups/topics/turnsしか
// 再取得しておらず、司会ストアのstate.liveが古い(opening)ままになっていた。
// advanceIfDueはstate.liveしか見ないため、最初のお題発表だけ「最新状態を取得」
// （＝liveの再取得）を手動で押すまで自動遷移できなかった。1件のlives行だけを
// 取得するこのヘルパーで、begin_game成功直後とlivesテーブルのRealtime購読の
// 両方から同じ経路でstate.liveへ反映する。
async function fetchLiveRow(liveId: string): Promise<{ ok: boolean; data: LiveRow | null }> {
  const { data, error } = await supabase.from("lives").select("*").eq("id", liveId).maybeSingle();
  if (error) {
    console.error("[useLiveHostStore] fetchLiveRow failed", error);
    return { ok: false, data: null };
  }
  return { ok: true, data: data as LiveRow | null };
}

async function fetchLiveChildren(
  liveId: string,
): Promise<{ ok: boolean; data: { participants: ParticipantRow[]; groups: GroupRow[]; topics: TopicRow[]; turns: TurnRow[] } }> {
  const [participantsRes, groupsRes, topicsRes, turnsRes] = await Promise.all([
    supabase.from("participants").select("*").eq("live_id", liveId),
    supabase.from("groups").select("*").eq("live_id", liveId),
    supabase.from("topics").select("*").eq("live_id", liveId),
    supabase.from("turns").select("*").eq("live_id", liveId),
  ]);
  const error =
    participantsRes.error ?? groupsRes.error ?? topicsRes.error ?? turnsRes.error ?? null;
  if (error) {
    // 4つのうちどれか1つでも失敗したら、他が成功していても全体をng扱いにする
    // （参加者・組・お題・ターンは互いに整合していて初めて意味を持つセットのため、
    // 一部だけ新しく一部だけ古い、という中途半端な状態でstateへ反映しない）。
    console.error("[useLiveHostStore] fetchLiveChildren failed", error);
    return {
      ok: false,
      data: { participants: [], groups: [], topics: [], turns: [] },
    };
  }
  return {
    ok: true,
    data: {
      participants: (participantsRes.data ?? []) as ParticipantRow[],
      groups: (groupsRes.data ?? []) as GroupRow[],
      topics: (topicsRes.data ?? []) as TopicRow[],
      turns: (turnsRes.data ?? []) as TurnRow[],
    },
  };
}

async function fetchProfilesFor(participants: ParticipantRow[]): Promise<ProfileRow[]> {
  const userIds = [...new Set(participants.map((p) => p.user_id))];
  if (userIds.length === 0) return [];
  const { data } = await supabase.from("profiles").select("*").in("id", userIds);
  return (data ?? []) as ProfileRow[];
}

async function fetchAnswersForTurn(turnId: string): Promise<{ ok: boolean; data: AnswerRow[] }> {
  const { data, error } = await supabase
    .from("answers")
    .select("*")
    .eq("turn_id", turnId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[useLiveHostStore] fetchAnswersForTurn failed", error);
    return { ok: false, data: [] };
  }
  return { ok: true, data: (data ?? []) as AnswerRow[] };
}

async function fetchScoresForAnswer(answerId: string): Promise<{ ok: boolean; data: ScoreRow[] }> {
  const { data, error } = await supabase
    .from("scores")
    .select("*")
    .eq("answer_id", answerId);
  if (error) {
    console.error("[useLiveHostStore] fetchScoresForAnswer failed", error);
    return { ok: false, data: [] };
  }
  return { ok: true, data: (data ?? []) as ScoreRow[] };
}

async function fetchResolvedAnswersForLive(liveId: string): Promise<{ ok: boolean; data: AnswerRow[] }> {
  const { data, error } = await supabase
    .from("answers")
    .select("*")
    .eq("live_id", liveId)
    .eq("resolved", true)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[useLiveHostStore] fetchResolvedAnswersForLive failed", error);
    return { ok: false, data: [] };
  }
  return { ok: true, data: (data ?? []) as AnswerRow[] };
}

// 確定済み回答ログの「誰が何点つけたか」内訳の再構築用（リロード復帰時のみ使う）。
async function fetchScoresForAnswers(
  answerIds: string[],
): Promise<{ ok: boolean; data: Record<string, ScoreRow[]> }> {
  if (answerIds.length === 0) return { ok: true, data: {} };
  const { data, error } = await supabase.from("scores").select("*").in("answer_id", answerIds);
  if (error) {
    console.error("[useLiveHostStore] fetchScoresForAnswers failed", error);
    return { ok: false, data: {} };
  }
  const map: Record<string, ScoreRow[]> = {};
  for (const row of (data ?? []) as ScoreRow[]) {
    (map[row.answer_id] ??= []).push(row);
  }
  return { ok: true, data: map };
}

// children（participants/groups/topics/turns）と表示名解決用profilesを、
// 1スライスとしてまとめて取得する。loadSnapshotSliceのfetchに渡す形。
type ChildrenPayload = {
  participants: ParticipantRow[];
  groups: GroupRow[];
  topics: TopicRow[];
  turns: TurnRow[];
  profiles: ProfileRow[];
};
async function fetchChildrenWithProfiles(
  liveId: string,
): Promise<{ ok: boolean; data: ChildrenPayload }> {
  const result = await fetchLiveChildren(liveId);
  if (!result.ok) {
    return { ok: false, data: { participants: [], groups: [], topics: [], turns: [], profiles: [] } };
  }
  const profiles = await fetchProfilesFor(result.data.participants);
  return { ok: true, data: { ...result.data, profiles } };
}

// 確定済み回答ログ（resolvedAnswers＋その採点内訳）を1スライスとしてまとめて取得する。
type ResolvedPayload = {
  resolvedAnswers: AnswerRow[];
  resolvedScoresByAnswer: Record<string, ScoreRow[]>;
};
async function fetchResolvedWithScores(
  liveId: string,
): Promise<{ ok: boolean; data: ResolvedPayload }> {
  const ra = await fetchResolvedAnswersForLive(liveId);
  if (!ra.ok) return { ok: false, data: { resolvedAnswers: [], resolvedScoresByAnswer: {} } };
  const rs = await fetchScoresForAnswers(ra.data.map((a) => a.id));
  if (!rs.ok) {
    return { ok: false, data: { resolvedAnswers: ra.data, resolvedScoresByAnswer: {} } };
  }
  return { ok: true, data: { resolvedAnswers: ra.data, resolvedScoresByAnswer: rs.data } };
}

async function subscribeLiveChannels(liveId: string) {
  cleanupChannels();

  // 2026-09-11（再レビュー対応）：Realtime起点の再取得も、initやrefreshや別の
  // Realtimeイベントの取得と並行しうる。スライスゲート（childrenGate/liveGate）で
  // 新旧を判定し、古い結果が新しい状態を巻き戻さないようにする。取得失敗時は
  // 表示データは維持しつつ確認状態だけ未確認へ戻す（loadSnapshotSlice参照）。
  const refetchChildren = () =>
    loadSnapshotSlice<ChildrenPayload>({
      gate: childrenGate,
      fetch: () => fetchChildrenWithProfiles(liveId),
      stillCurrent: () => useLiveHostStore.getState().live?.id === liveId,
      applyFresh: ({ profiles, ...children }) =>
        useLiveHostStore.setState({ ...children, profiles, childrenSnapshotLiveId: liveId }),
      markUnconfirmed: () => useLiveHostStore.setState({ childrenSnapshotLiveId: null }),
    });

  const refetchAnswersAndScores = resyncAnswersAndScoresForCurrentLive;

  // 2026-09-06:「最初のお題発表だけ0秒になっても回答画面へ進まない」不具合対応。
  // RPC（begin_game等）や別タブからのlives行の更新は、この購読が無いとRealtimeに
  // 気づけず、司会ブラウザが手動の「最新状態を取得」を押されるまでstate.liveが
  // 古いまま(advanceIfDueがそれを見て自動進行を判断する)になってしまう。
  const refetchLive = () =>
    loadSnapshotSlice<LiveRow | null>({
      gate: liveGate,
      fetch: () => fetchLiveRow(liveId),
      stillCurrent: () => true, // id=eq.${liveId} で絞っているので常に対象一致
      applyFresh: (row) =>
        useLiveHostStore.setState({ live: row ?? null, liveSnapshotConfirmed: true }),
      markUnconfirmed: () => useLiveHostStore.setState({ liveSnapshotConfirmed: false }),
    });

  // チャンネルが(再)接続できた瞬間に必ず最新スナップショットを取り直す
  // （Realtimeは切断中に起きた変更を後から届けてくれないため）。
  const onSubscribeStatus = (status: string) => {
    if (status === "SUBSCRIBED") {
      refetchLive();
      refetchChildren();
      refetchAnswersAndScores();
    }
  };

  const livesCh = supabase
    .channel(`host-lives-${liveId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "lives", filter: `id=eq.${liveId}` },
      refetchLive,
    )
    .subscribe(onSubscribeStatus);

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
      const result = await fetchScoresForAnswer(active.id);
      if (result.ok) useLiveHostStore.setState({ scores: result.data });
    })
    .subscribe(onSubscribeStatus);

  // ボット観客のツッコミ/爆笑/拍手を送るための送信専用チャンネル
  // （useLiveFollowerStore.tsと同じチャンネル名。ここでは受信は不要）。
  tsukkomiChannel = supabase
    .channel("follower-tsukkomi", { config: { broadcast: { self: true } } })
    .subscribe();

  channels = [livesCh, participantsCh, turnsCh, answersCh, scoresCh, tsukkomiChannel];
}

// current_turn_idが切り替わった直後は、Realtimeイベントを待たずに即座に
// そのターンぶんのanswers/scoresへ入れ替える（前のターンの古いデータが
// 一時的にでも残っていると、stillBusy判定を誤らせるため）。
async function refreshAnswersForTurn(turnId: string | null): Promise<SliceLoadOutcome> {
  if (!turnId) {
    // 「現在ターンが無い」という確定した状態：answers/scoresを空にし、
    // answersSnapshotも「該当ターン無し」として無効化する。ここもゲートを
    // 通し、進行中の古いanswers取得の結果が後から書き戻さないようにする。
    answersGate.begin();
    useLiveHostStore.setState({ answers: [], scores: [], answersSnapshot: null });
    return "applied";
  }
  const liveId = useLiveHostStore.getState().live?.id ?? null;
  if (!liveId) return "target-changed";
  // 2026-09-11（再レビュー対応）：スライスゲートで新旧を判定。より新しいanswers
  // 取得が始まっていれば、この（古い）結果は一切反映しない（superseded）。
  // 取得成功時のみ answers を差し替えて確認済みにし、取得失敗時は表示中の
  // answersは維持しつつ answersSnapshot だけ null（未確認）へ戻す。
  return loadSnapshotSlice<AnswerRow[]>({
    gate: answersGate,
    fetch: () => fetchAnswersForTurn(turnId),
    stillCurrent: () => {
      const s = useLiveHostStore.getState();
      return s.live?.id === liveId && s.live?.current_turn_id === turnId;
    },
    applyFresh: (data) =>
      useLiveHostStore.setState({ answers: data, scores: [], answersSnapshot: { liveId, turnId } }),
    markUnconfirmed: () => useLiveHostStore.setState({ answersSnapshot: null }),
  });
}

// 2026-09-09（再レビュー対応）：processRevealQueue/resolveIfDueが「条件付き
// UPDATEが0行だった」場合に呼ぶ、現在ターンのanswers/scoresの再同期。
// Realtimeイベントの到着（切断・通信状況によって取り逃す可能性がある）だけに
// 依存せず、DBから直接取り直すことでローカルstateを追いつかせる。
async function resyncAnswersAndScoresForCurrentLive() {
  const { live } = useLiveHostStore.getState();
  if (!live?.current_turn_id) return;
  const turnId = live.current_turn_id;
  await refreshAnswersForTurn(turnId);
  // refreshAnswersForTurn自体がturnIdの一致を確認してから反映するため、ここでも
  // 同じturnIdのままであることを確認してからscoresの再同期に進む（ターンが
  // 変わっていれば、以降の探索は無意味だが害も無いので単に打ち切る）。
  if (useLiveHostStore.getState().live?.current_turn_id !== turnId) return;
  const active = useLiveHostStore.getState().answers.find((a) => a.revealed_at && !a.resolved);
  if (!active) return;
  const result = await fetchScoresForAnswer(active.id);
  if (result.ok && useLiveHostStore.getState().live?.current_turn_id === turnId) {
    useLiveHostStore.setState({ scores: result.data });
  }
}

async function updateLive(id: string, patch: Partial<LiveRow>) {
  const { data, error } = await supabase
    .from("lives")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (!error && data) {
    // 直前に自分が書き込んだ authoritative な行。進行中の古いlive読み取りを
    // 無効化しつつ反映し、liveSnapshotConfirmed も true に戻す。
    applyAuthoritativeLive(data as LiveRow);
  } else if (error) {
    // ここが失敗すると進行そのものが止まってしまう（例：フェーズ遷移とマイグレーション
    // 未適用の列を同じ更新に混ぜてしまい、UPDATE全体が失敗する等）。エラーが黙って
    // 握りつぶされて原因調査ができなくなるのを防ぐため、必ずコンソールに出す。
    console.error("updateLive failed", { patch, error });
  }
  return { data: data as LiveRow | null, error };
}

// 2026-09-09（複数管理画面タブ対策）：フェーズ遷移専用のupdateLive。
// 「今まさにこのタブが見ている状態(expectedPhase・expectedTurnId)」をUPDATEの
// WHERE条件そのものに含めることで、同じライブ進行を複数の管理画面タブ
// （例：/live/hostを開いたタブと、RootLayoutの常駐コントローラーが動く別タブ）が
// 同時に検知した場合でも、実際に行を更新できたタブだけがupdated:trueを受け取り、
// 後続処理（ターンの状態更新・演出締切の設定等）を行う。既に他のタブが同じ遷移を
// 済ませていた場合はWHERE条件に一致する行が無く0行更新になるが、これはエラー
// ではなく「想定内の正常系」としてupdated:falseを返す（呼び出し側は後続処理を
// スキップするだけで良い）。
// expectedTurnIdをundefinedにすると、current_turn_idの一致は確認しない
// （interludeやgroup_resultからfinal_resultへの遷移など、current_turn_idを
// 問わない遷移向け）。
async function updateLiveIfPhase(
  id: string,
  expectedPhase: LivePhase,
  expectedTurnId: string | null | undefined,
  patch: Partial<LiveRow>,
): Promise<{ ok: boolean; updated: boolean; error: unknown }> {
  let query = supabase.from("lives").update(patch).eq("id", id).eq("current_phase", expectedPhase);
  if (expectedTurnId !== undefined) {
    query = expectedTurnId === null
      ? query.is("current_turn_id", null)
      : query.eq("current_turn_id", expectedTurnId);
  }
  const { data, error } = await query.select();
  if (error) {
    console.error("updateLiveIfPhase failed", { id, expectedPhase, expectedTurnId, patch, error });
    return { ok: false, updated: false, error };
  }
  const rows = (data ?? []) as LiveRow[];
  if (rows.length === 0) {
    // 0行更新：別の管理画面タブが既にこの遷移を行った後の可能性が高いが、
    // Realtimeイベントは切断や通信状況によって取り逃すことがあるため、
    // 「別タブが更新済みのはず」と決めつけてstateを古いまま放置しない。
    // スライスゲート越しに対象ライブを再取得し、より新しい取得に追い越されて
    // いなければ反映する（Realtimeの到着だけに依存しない）。
    await loadSnapshotSlice<LiveRow | null>({
      gate: liveGate,
      fetch: () => fetchLiveRow(id),
      stillCurrent: () => useLiveHostStore.getState().live?.id === id,
      applyFresh: (row) => {
        if (row) useLiveHostStore.setState({ live: row, liveSnapshotConfirmed: true });
      },
      markUnconfirmed: () => useLiveHostStore.setState({ liveSnapshotConfirmed: false }),
    });
    return { ok: true, updated: false, error: null };
  }
  applyAuthoritativeLive(rows[0]);
  return { ok: true, updated: true, error: null };
}

// 現在のターンの回答キューを処理する：表示中(revealed)の回答が無く、
// 未表示の回答があれば、一呼吸(revealDelayMs)置いてから1件だけrevealする。
async function processRevealQueue() {
  const state = useLiveHostStore.getState();
  const { answers, live } = state;
  // 2026-09-10（再レビュー対応）：現在ターンのanswersスナップショットが未確認
  // （取得失敗直後など）なら、空/古いキューを見て誤って次を表示しない。
  // advanceIfDue側でも同じガードをしているが、多層防御として明示する。
  if (!live || !answersSnapshotMatches(state.answersSnapshot, live.id, live.current_turn_id)) return;
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
  // 2026-09-09（複数管理画面タブ対策）：revealed_at is null AND resolved=false
  // の行だけを対象にする。複数タブが同時に同じ回答をrevealしようとしても、
  // 実際に更新できた1つのタブだけが0件でない結果(revealedRows)を受け取る
  // （0行更新＝別タブが既にrevealした後は、想定内としてここで終える）。
  const { data: revealedRows, error } = await supabase
    .from("answers")
    .update({
      revealed_at: new Date(now).toISOString(),
      judging_ends_at: new Date(now + LIVE_ROOM_TIMING.judgeMs).toISOString(),
    })
    .eq("id", target.id)
    .is("revealed_at", null)
    .eq("resolved", false)
    .select("id");
  pendingRevealAt = null;
  if (error) {
    console.error("processRevealQueue: revealの更新に失敗", error);
    return;
  }
  if (!revealedRows || revealedRows.length === 0) {
    // 0行更新：別のタブが既にこの回答をrevealした可能性が高いが、Realtimeイベントは
    // 切断・通信状況によって取り逃すことがあるため、決めつけずDBの現在ターンの
    // answers/scoresを取り直してローカルstateを追いつかせる（Realtimeの到着だけに
    // 依存しない）。
    await resyncAnswersAndScoresForCurrentLive();
    return;
  }
  const currentTurnId = useLiveHostStore.getState().live?.current_turn_id;
  if (currentTurnId) {
    // refreshAnswersForTurn自体がturnIdの一致を確認してから反映するため、この
    // 取得が完了するまでの間にターンが切り替わっていても古い結果で上書きしない。
    await refreshAnswersForTurn(currentTurnId);
  }
}

// 表示中の回答の採点が出揃った、または締切(judgeMs+judgeGraceMs)を過ぎていれば確定する。
async function resolveIfDue() {
  const state = useLiveHostStore.getState();
  // 2026-09-10（再レビュー対応）：現在ターンのanswersスナップショットが未確認なら、
  // 古い/空のstate.answersで誤って確定処理をしない（多層防御）。
  if (
    !state.live ||
    !answersSnapshotMatches(state.answersSnapshot, state.live.id, state.live.current_turn_id)
  ) {
    return;
  }
  const active = state.answers.find((a) => a.revealed_at && !a.resolved);
  if (!active || !active.judging_ends_at) return;
  if (resolvingAnswerIds.has(active.id)) return; // 前のtickの確定処理がまだ進行中

  const turn = state.turns.find((t) => t.id === active.turn_id);
  if (!turn) return;

  // 2026-09-03:「途中退場した参加者を審査対象から除外する」対応。退場済み
  // (kicked_at)の参加者は、以降このライブで採点したことにされる／採点済み
  // 扱いの分母に含まれることが無いようにする（DB側のRLSでも別途拒否している）。
  const eligibleJudges = state.participants.filter(
    (p) => p.role === "player" && p.group_id !== turn.group_id && !p.kicked_at,
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
    const freshScoresResult = await fetchScoresForAnswer(active.id);
    if (!freshScoresResult.ok) {
      // 2026-09-03:「Supabase取得エラーを空配列として上書きしない」対応。
      // 取得に失敗した回を「まだ誰も採点していない(0点)」として確定してしまうと
      // 実際には投票済みの点数が消えてしまう。何もせず既存stateを維持し、
      // 次のtickで再試行する（確定を急がない）。
      return;
    }
    // 2026-09-03:「過去ライブのplayer participant IDによる不正採点混入」対策。
    // DB側のRLS(scores_insert_own_as_player)に同一ライブ確認を追加したが、
    // アプリ側でも多層防御として、集計前に必ず「現在のeligible judge ID集合」に
    // 含まれるscoresだけを対象にする（想定外の参加者IDのscoreが混ざっていても
    // 合計点・top_score_votes・満点判定には一切反映されないようにする）。
    const eligibleJudgeIds = new Set(eligibleJudges.map((p) => p.id));
    const freshScores = freshScoresResult.data.filter((s) =>
      eligibleJudgeIds.has(s.judge_participant_id),
    );
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

    // 2026-09-09（複数管理画面タブ対策）：resolved=falseの行だけを対象にする。
    // 複数タブが同時に同じ回答を確定しようとしても、実際に更新できた1つの
    // タブだけが0件でない結果(resolvedRows)を受け取り、演出締切の設定・
    // resolvedAnswersへの追記まで行う（0行更新＝別タブが既に確定済みは
    // 想定内の正常系としてここで終える）。
    const { data: resolvedRows, error } = await supabase
      .from("answers")
      .update({
        resolved: true,
        score_total: scoreTotal,
        top_score_votes: topScoreVotes,
        judge_count: eligibleJudges.length,
        laugh_triggered: laughTriggered,
      })
      .eq("id", active.id)
      .eq("resolved", false)
      .select("id");

    if (error) {
      console.error("resolveIfDue: 採点確定の更新に失敗", error);
      return;
    }
    if (!resolvedRows || resolvedRows.length === 0) {
      // 0行更新：別のタブが既にこの回答を確定済みの可能性が高いが、Realtime
      // イベントは切断・通信状況によって取り逃すことがあるため、決めつけず
      // DBの現在ターンのanswers/scores、およびlives（reveal_sequence_until等）を
      // 取り直してローカルstateを追いつかせる（Realtimeの到着だけに依存しない）。
      await resyncAnswersAndScoresForCurrentLive();
      if (state.live) {
        const liveId = state.live.id;
        await loadSnapshotSlice<LiveRow | null>({
          gate: liveGate,
          fetch: () => fetchLiveRow(liveId),
          stillCurrent: () => useLiveHostStore.getState().live?.id === liveId,
          applyFresh: (row) => {
            if (row) useLiveHostStore.setState({ live: row, liveSnapshotConfirmed: true });
          },
          markUnconfirmed: () => useLiveHostStore.setState({ liveSnapshotConfirmed: false }),
        });
      }
      return;
    }

    // 採点確定と同時に、演出シーケンス（フリップが消える→間を置く→玉が消える→
    // 得点表示→しばらく見せる→間を置く）が終わるまでの締切を全クライアントに配信する。
    // これによりlives.answering_paused（isAnsweringBusy経由）が、この一連の間ずっと
    // trueのままになり、他の参加者の送信もロックされ続ける。
    if (state.live) {
      await updateLive(state.live.id, {
        reveal_sequence_until: new Date(Date.now() + REVEAL_SEQUENCE_MS).toISOString(),
      });
    }

    if (state.live?.current_turn_id) {
      const resolveLiveId = state.live.id;
      const resolveTurnId = state.live.current_turn_id;
      const answersToken = answersGate.begin();
      const answersResult = await fetchAnswersForTurn(resolveTurnId);
      const resolvedEntry: AnswerRow = {
        ...active,
        resolved: true,
        score_total: scoreTotal,
        top_score_votes: topScoreVotes,
        judge_count: eligibleJudges.length,
        laugh_triggered: laughTriggered,
      };
      // resolvedAnswers（確定ログ）への追記は、この確定処理を実際に行った
      // 証拠なので常に反映する。answers本体の差し替えは、より新しいanswers取得に
      // 追い越されておらず、かつ同じ(liveId,turnId)のままの場合だけ行う。
      const sAfter = useLiveHostStore.getState();
      const answersStillCurrent =
        answersGate.isCurrent(answersToken) &&
        sAfter.live?.id === resolveLiveId &&
        sAfter.live?.current_turn_id === resolveTurnId;
      useLiveHostStore.setState((s) => ({
        answers: answersStillCurrent && answersResult.ok ? answersResult.data : s.answers,
        answersSnapshot:
          answersStillCurrent && answersResult.ok
            ? { liveId: resolveLiveId, turnId: resolveTurnId }
            : s.answersSnapshot,
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

  // 2026-09-10（再レビュー対応）：現在ターンのanswersスナップショットが未確認の間は、
  // 空/古いstate.answersを見て「busyでない」と誤判定し、回答時間を再開してしまう
  // 恐れがある。未確認の間はpause/resumeの判断そのものを行わない
  // （advanceIfDue側でもガードしているが、多層防御として明示）。
  if (!answersSnapshotMatches(state.answersSnapshot, live.id, live.current_turn_id)) return;

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

// 2026-09-11（再レビュー対応）：未確認スライスの読み取り再試行。tickは500msだが
// single-flight＋最小間隔(SNAPSHOT_RETRY_INTERVAL_MS)で過剰アクセスを防ぐ。
// いずれも取得成功時のみ確認済みへ戻し、失敗中はstateを一切書き換えない。
function retryLiveSnapshot() {
  if (!shouldRetryNow(liveRetryInFlight, liveRetryAt, Date.now(), SNAPSHOT_RETRY_INTERVAL_MS)) return;
  liveRetryInFlight = true;
  liveRetryAt = Date.now();
  // 「今この瞬間の進行中(closed以外)ライブ」を再発見する。取得中に別ライブへ
  // 切り替わっていたら、その新しいライブについて children/answers 側が
  // 未確認のまま自動進行が凍結され、それぞれの再試行で追いつく。
  void loadSnapshotSlice<LiveRow | null>({
    gate: liveGate,
    fetch: () => fetchActiveLive(),
    stillCurrent: () => true,
    applyFresh: (row) => useLiveHostStore.setState({ live: row ?? null, liveSnapshotConfirmed: true }),
    markUnconfirmed: () => {}, // 既に未確認。次の間隔で再試行する
  })
    .catch((e) => console.warn("[useLiveHostStore] ライブ状態の再取得に失敗", e))
    .finally(() => {
      liveRetryInFlight = false;
    });
}

function retryChildrenSnapshot(liveId: string) {
  if (!shouldRetryNow(childrenRetryInFlight, childrenRetryAt, Date.now(), SNAPSHOT_RETRY_INTERVAL_MS)) {
    return;
  }
  childrenRetryInFlight = true;
  childrenRetryAt = Date.now();
  void loadSnapshotSlice<ChildrenPayload>({
    gate: childrenGate,
    fetch: () => fetchChildrenWithProfiles(liveId),
    stillCurrent: () => useLiveHostStore.getState().live?.id === liveId,
    applyFresh: ({ profiles, ...children }) =>
      useLiveHostStore.setState({ ...children, profiles, childrenSnapshotLiveId: liveId }),
    markUnconfirmed: () => {},
  })
    .catch((e) => console.warn("[useLiveHostStore] 組・ターン情報の再取得に失敗", e))
    .finally(() => {
      childrenRetryInFlight = false;
    });
}

function retryAnswersSnapshot(turnId: string | null) {
  if (!turnId) return;
  if (!shouldRetryNow(answersRetryInFlight, answersRetryAt, Date.now(), SNAPSHOT_RETRY_INTERVAL_MS)) {
    return;
  }
  answersRetryInFlight = true;
  answersRetryAt = Date.now();
  void refreshAnswersForTurn(turnId)
    .catch((e) => console.warn("[useLiveHostStore] 現在ターンのanswers再取得に失敗", e))
    .finally(() => {
      answersRetryInFlight = false;
    });
}

// フェーズ・ターンの自動進行。
async function advanceIfDue() {
  const state = useLiveHostStore.getState();
  // 2026-09-11（再レビュー対応・問題3）：lives行の最新状態を確認できない間は
  // 自動進行を凍結し、読み取り再試行だけを行う（表示用の古いliveは残す）。
  if (!state.liveSnapshotConfirmed) {
    retryLiveSnapshot();
    return;
  }
  const { live } = state;
  if (!live) return;
  // 2026-09-09/11（再レビュー対応）：participants/groups/topics/turnsが今のライブに
  // ついて未確認の間は、自動進行を一切行わず読み取り再試行だけを行う。
  // 特にgroup_result→次ターンの判定はturns/groupsを見て「次のターンがあるか」を
  // 決めるため、一時的な取得失敗でturns/groupsが空のまま進行すると、残りの組を
  // 飛ばしてfinal_resultへ誤って進む恐れがある。
  if (!childrenSnapshotReady(state.childrenSnapshotLiveId, live.id)) {
    retryChildrenSnapshot(live.id);
    return;
  }

  if (live.current_phase === "answering") {
    // 2026-09-10/11（再レビュー対応）：現在ターンのanswersが「取得失敗による空」なのか
    // 「本当に0件」なのか区別できない状態（answersSnapshotが今のlive/turnと不一致）
    // では、回答時間の減算・processRevealQueue・resolveIfDue・syncAnsweringPause・
    // group_result遷移を一切行わない。single-flight＋最小間隔で再取得だけ試み、
    // 確認できたら次tickから通常処理へ戻る。
    if (!answersSnapshotMatches(state.answersSnapshot, live.id, live.current_turn_id)) {
      retryAnswersSnapshot(live.current_turn_id);
      return;
    }

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
    const dbAnswersToken = latest.current_turn_id ? answersGate.begin() : null;
    const dbAnswersResult = latest.current_turn_id
      ? await fetchAnswersForTurn(latest.current_turn_id)
      : { ok: true as const, data: freshState.answers };
    if (!dbAnswersResult.ok) {
      // 2026-09-03:「回答一覧取得失敗時に『未処理回答なし』と誤認して次フェーズへ
      // 進まない」対応。取得に失敗した場合は「未確認」であって「無い」わけではない
      // ため、進行を止めて次のtickで再取得を試みる。確認状態も未確認へ戻す。
      if (latest.current_turn_id && dbAnswersToken !== null && answersGate.isCurrent(dbAnswersToken)) {
        useLiveHostStore.setState({ answersSnapshot: null });
      }
      return;
    }
    const dbAnswers = dbAnswersResult.data;
    // より新しいanswers取得に追い越されておらず、かつ同じlive/turnのままなら、
    // 取得し直した最新の回答をstateへ反映し、この(liveId,turnId)についての
    // answersSnapshotを確認済みに更新する（次tickのガード・processRevealQueue等が
    // 追いついた状態から続けられるように）。追い越されていれば新しい取得結果に任せる。
    const dbAnswersFresh =
      latest.current_turn_id !== null &&
      dbAnswersToken !== null &&
      answersGate.isCurrent(dbAnswersToken) &&
      useLiveHostStore.getState().live?.id === latest.id &&
      useLiveHostStore.getState().live?.current_turn_id === latest.current_turn_id;
    if (dbAnswersFresh && latest.current_turn_id) {
      useLiveHostStore.setState({
        answers: dbAnswers,
        answersSnapshot: { liveId: latest.id, turnId: latest.current_turn_id },
      });
    } else if (latest.current_turn_id) {
      // 追い越された／対象が変わった：このtickでは遷移まで進めず、次tickに委ねる。
      return;
    }
    if (isAnsweringBusy(dbAnswers, latest)) {
      return; // 現在表示中の1件・演出シーケンス・未表示の回答が残っている間は待つ
    }
    // 2026-09-09（再レビュー対応）：以前はここでanswringRemainingMsTrue/
    // lastAnsweringTickAtを両方nullへ戻してからDB更新を試みていたが、その後の
    // 更新が通信エラーで失敗すると、次のtickの時点でanswringRemainingMsTrueが
    // nullのため「if (answeringRemainingMsTrue === null || ... > 0) return;」に
    // 引っかかり、二度とこの遷移を試みられなくなっていた（0秒のまま永久停止）。
    // 更新に成功した（＝自分がこの遷移を行った）ことを確認できるまでは0のまま
    // 維持し、次のtickで再試行できるようにする。
    answeringRemainingMsTrue = 0;

    // reveal_sequence_untilは意図的にここに含めない：もしDBにこの列がまだ無い環境
    // （マイグレーション未適用）だと、存在しない列を含むUPDATEはPostgreSQL側で
    // エラーになりUPDATE全体が失敗する。これをcurrent_phase遷移と同じ呼び出しに
    // 混ぜていたせいで、マイグレーション未適用の環境ではフェーズ遷移そのものが
    // 常に失敗し、時間切れになっても画面が進まなくなっていた。
    // 2026-09-09（再レビュー対応・0065）：以前はupdateLiveIfPhase（lives更新）＋
    // 別呼び出しのturns status更新という2段階だったため、turns更新のエラーを
    // 確認しておらず、また途中で失敗した場合に両方をロールバックする手段も
    // 無かった。現在ターンのdone化とlives更新を1つのSECURITY DEFINER RPC
    // （1トランザクション、is_host()確認・行ロック・期待するphase/turn_idの
    // 確認込み）にまとめた。複数タブから同時に呼ばれても実際の遷移は1回だけ、
    // 既に他タブが遷移済みならupdated:falseが返る（エラーにはならない）。
    const { data: advanceData, error: advanceError } = await supabase
      .rpc("host_advance_answering_to_group_result", {
        p_live_id: latest.id,
        p_expected_turn_id: latest.current_turn_id,
        p_group_result_deadline: new Date(Date.now() + LIVE_ROOM_TIMING.groupResultMs).toISOString(),
      })
      .single();

    if (advanceError) {
      console.error("host_advance_answering_to_group_result failed", advanceError);
      // 通信エラー等：answeringRemainingMsTrueは0のままなので、次のtickで再試行する。
      return;
    }

    const advanceResult = advanceData as { updated: boolean; live: LiveRow | null };
    if (advanceResult.live) {
      applyAuthoritativeLive(advanceResult.live);
    }

    if (advanceResult.updated) {
      // 自分の呼び出しで遷移できた：ローカルタイマーをクリアする。
      answeringRemainingMsTrue = null;
      lastAnsweringTickAt = null;
      return;
    }

    if (advanceResult.live && advanceResult.live.current_phase !== "answering") {
      // 0行更新：RPCの戻り値から、別タブが既に本当に遷移済みだったと確認できた。
      // このタブのローカルタイマーもクリアしてよい。
      answeringRemainingMsTrue = null;
      lastAnsweringTickAt = null;
    }
    // まだ"answering"のまま（何らかの理由でexpected turn_idが一致しなかった等）
    // なら、answeringRemainingMsTrueは0のままにしておき、次のtickで再試行する。
    return;
  }

  const latest = useLiveHostStore.getState().live;
  if (!latest) return;
  if (!latest.phase_deadline) return;
  if (Date.now() < new Date(latest.phase_deadline).getTime()) return;

  if (live.current_phase === "group_result") {
    // 2026-09-09（再レビュー対応・0065）：以前は次ターンの特定(JS側でturns/groups
    // から計算)・turnsのstatus更新・lives更新が別々の呼び出しに分かれており、
    // turns更新のエラーを確認していなかった。次ターンの特定・active化・lives更新を
    // 1つのSECURITY DEFINER RPC（1トランザクション、is_host()確認・行ロック・
    // 期待するphase/turn_idの確認込み）にまとめた。次ターンがなければRPC内で
    // final_resultへ進める。複数タブから同時に呼ばれても実際の遷移は1回だけ、
    // 既に他タブが遷移済みならupdated:falseが返る（エラーにはならない）。
    const { data: advanceData, error: advanceError } = await supabase
      .rpc("host_advance_group_result_to_next", {
        p_live_id: live.id,
        p_expected_turn_id: live.current_turn_id,
        p_topic_reveal_deadline: new Date(Date.now() + PHASE_DURATIONS_MS.topic_reveal!).toISOString(),
      })
      .single();

    if (advanceError) {
      console.error("host_advance_group_result_to_next failed", advanceError);
      return; // 通信エラー等：次のtickで再試行する
    }

    const advanceResult = advanceData as {
      updated: boolean;
      advanced_to: "topic_reveal" | "final_result" | null;
      live: LiveRow | null;
    };
    if (advanceResult.live) {
      applyAuthoritativeLive(advanceResult.live);
    }
    if (
      advanceResult.updated &&
      advanceResult.advanced_to === "topic_reveal" &&
      advanceResult.live?.current_turn_id
    ) {
      await refreshAnswersForTurn(advanceResult.live.current_turn_id);
    }
    return;
  }

  if (live.current_phase === "topic_reveal") {
    const answerMs = PHASE_DURATIONS_MS.answering!;
    // ローカルの残り時間トラッキングは、このタブがDB更新に勝ったかどうかに
    // 関わらず初期化する（後続のadvanceIfDueの「answering」分岐がこの
    // ローカル値を見て進行判定するため。DB上の実際の遷移自体は下の
    // updateLiveIfPhaseがガードするので、二重にはならない）。
    answeringRemainingMsTrue = answerMs;
    lastAnsweringTickAt = Date.now();
    // 2026-09-09（複数管理画面タブ対策）：想定している現在の状態(topic_reveal・
    // このturn_id)と一致する行だけを更新する。
    await updateLiveIfPhase(live.id, "topic_reveal", live.current_turn_id, {
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
  childrenSnapshotLiveId: null,
  answersSnapshot: null,
  liveSnapshotConfirmed: false,
  lastRefreshedAt: null,

  loadTopicBank: async () => {
    const { data, error } = await supabase
      .from("topic_bank")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (!error) set({ topicBank: (data ?? []) as TopicBankRow[] });
  },

  init: () => {
    // 2026-09-09（複数管理画面タブ対策）：既に進行中のinit()があれば、新しく
    // 同じ処理を並行して始めず、その完了を待つだけにする（intervalやRealtime
    // channelの二重作成防止。詳細はinitInFlightの定義コメント参照）。
    if (initInFlight) return initInFlight;
    // 2026-09-09（再レビュー対応）：この呼び出しの「世代」を覚えておく。
    // stopHostProgress()が呼ばれるとprogressGenerationが+1され、この非同期処理が
    // 後から（stopされた後に）続きを実行しようとした際、要所でこの値を比較して
    // 中断する（stop後にtickTimer/Realtime channelが復活しないようにするため）。
    const myGeneration = progressGeneration;
    const stopped = () => myGeneration !== progressGeneration;
    const run = async () => {
      set({ loading: true, error: null });
      void get().loadTopicBank();

      // --- live スライス ---
      // 2026-09-11（再レビュー対応）：各スライスを loadSnapshotSlice で個別に
      // ゲート越しに反映する。init実行中にRealtimeが新しい状態を反映しても、
      // init最後の一括setで巻き戻ることがない（古いスライスはゲートで弾かれる）。
      const liveOutcome = await loadSnapshotSlice<LiveRow | null>({
        gate: liveGate,
        fetch: () => fetchActiveLive(),
        stillCurrent: () => true,
        applyFresh: (row) => set({ live: row ?? null, liveSnapshotConfirmed: true }),
        markUnconfirmed: () => set({ liveSnapshotConfirmed: false }),
      });
      if (stopped()) return;
      if (liveOutcome === "unconfirmed") {
        // ライブ本体の最新状態を確認できない：表示用の古いliveは残し、
        // advanceIfDueは liveSnapshotConfirmed=false を見て自動進行を凍結。
        // tickTimerは動かし続け、advanceIfDueが一定間隔で読み取り再試行する。
        set({ loading: false, error: "ライブの状態を取得できませんでした。しばらくすると自動的に再試行します。" });
        ensureTickTimer(myGeneration);
        return;
      }

      const live = get().live;
      if (live) {
        const liveId = live.id;
        // --- children スライス ---
        const childrenOutcome = await loadSnapshotSlice<ChildrenPayload>({
          gate: childrenGate,
          fetch: () => fetchChildrenWithProfiles(liveId),
          stillCurrent: () => get().live?.id === liveId,
          applyFresh: ({ profiles, ...children }) =>
            set({ ...children, profiles, childrenSnapshotLiveId: liveId }),
          markUnconfirmed: () => set({ childrenSnapshotLiveId: null }),
        });
        if (stopped()) return;

        // --- answers スライス ---
        let answersOutcome: SliceLoadOutcome = "applied";
        const turnId = live.current_turn_id;
        if (turnId) {
          answersOutcome = await loadSnapshotSlice<AnswerRow[]>({
            gate: answersGate,
            fetch: () => fetchAnswersForTurn(turnId),
            stillCurrent: () => {
              const s = get();
              return s.live?.id === liveId && s.live?.current_turn_id === turnId;
            },
            applyFresh: (data) =>
              set({ answers: data, scores: [], answersSnapshot: { liveId, turnId } }),
            markUnconfirmed: () => set({ answersSnapshot: null }),
          });
        } else {
          answersGate.begin();
          set({ answers: [], scores: [], answersSnapshot: null });
        }
        if (stopped()) return;

        // --- resolved（確定ログ）スライス ---
        const resolvedOutcome = await loadSnapshotSlice<ResolvedPayload>({
          gate: resolvedGate,
          fetch: () => fetchResolvedWithScores(liveId),
          stillCurrent: () => get().live?.id === liveId,
          applyFresh: ({ resolvedAnswers, resolvedScoresByAnswer }) =>
            set({ resolvedAnswers, resolvedScoresByAnswer }),
          markUnconfirmed: () => {}, // 表示は維持。ログ用なので確認状態は持たない
        });
        if (stopped()) return;

        const anyUnconfirmed =
          childrenOutcome === "unconfirmed" ||
          answersOutcome === "unconfirmed" ||
          resolvedOutcome === "unconfirmed";
        set({
          loading: false,
          lastRefreshedAt: new Date().toISOString(),
          error: anyUnconfirmed
            ? "一部の情報を取得できませんでした。しばらくすると自動的に再試行します。"
            : null,
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
        if (stopped()) return; // stopされた（channelを作らない）
        await subscribeLiveChannels(live.id);
      } else {
        // active liveが存在しないことを確認できた（liveスライスは applied）。
        // 「ライブ無し」は確定状態なので liveSnapshotConfirmed=true、
        // children/answers の snapshot識別情報は無効化する。
        set({
          live: null,
          loading: false,
          liveSnapshotConfirmed: true,
          childrenSnapshotLiveId: null,
          answersSnapshot: null,
          lastRefreshedAt: new Date().toISOString(),
          error: null,
        });
      }

      if (stopped()) {
        // 2026-09-10（再レビュー対応）：stopされた。ここでcleanupChannels()を呼ぶと、
        // stop後に開始した「新しい世代のinit」が既に作ったchannelまで消してしまう。
        // progressGenerationが変わるのはstopHostProgress()のときだけで、そこで
        // 必ずcleanupChannels()が呼ばれている（このinitが直前にsubscribeLiveChannels
        // でchannelを作っていた場合も、stopHostProgress()側のcleanupChannels()が
        // それを回収している）ため、ここでは何もせず終える。
        return;
      }
      ensureTickTimer(myGeneration);
    };
    const promise = run().finally(() => {
      // 2026-09-10（再レビュー対応）：自分のPromiseが今もinitInFlightのときだけ
      // nullへ戻す。stopHostProgress()がinitInFlight=nullにした後に新しいinitが
      // 始まっていると、無条件にnullへ戻すと新しいinitのinitInFlightを消してしまい、
      // 以降のinit呼び出しが重複実行される（詳細はsrc/lib/liveHostSnapshots.ts）。
      if (shouldReleaseInitInFlight(initInFlight, promise)) {
        initInFlight = null;
      }
    });
    initInFlight = promise;
    return promise;
  },

  // 2026-09-09（再レビュー対応）：ログアウト・isHost剥奪時にHostProgressControllerの
  // effect cleanupから呼ぶ。進行中のinit()を無効化（progressGenerationを進める）
  // した上で、tickTimer・Realtime channels・進行用のモジュール変数一式を片付ける。
  stopHostProgress: () => {
    progressGeneration += 1;
    // 2026-09-11（再レビュー対応）：全スライスゲートを begin() して、stop時点で
    // 進行中の全取得のトークンを無効化する（stop後に古い通信結果が完了しても
    // loadSnapshotSliceの isCurrent() が false になり、state を書き換えない）。
    liveGate.begin();
    childrenGate.begin();
    answersGate.begin();
    resolvedGate.begin();
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    cleanupChannels();
    initInFlight = null;
    pendingRevealAt = null;
    answeringRemainingMsTrue = null;
    lastAnsweringTickAt = null;
    liveRetryInFlight = false;
    liveRetryAt = 0;
    childrenRetryInFlight = false;
    childrenRetryAt = 0;
    answersRetryInFlight = false;
    answersRetryAt = 0;
    resolvingAnswerIds.clear();
    botCooldownUntil.clear();
    answerPerfectRoundIds.clear();
    lastBotTsukkomiAt = 0;
    // 2026-09-10/11（再レビュー対応）：ログアウト→再ログイン時に、前セッションの
    // スナップショット識別情報を引き継がないよう無効化する（次のinit()が
    // 取得成功して初めて確認済みになる）。liveSnapshotConfirmedもfalseへ。
    set({ childrenSnapshotLiveId: null, answersSnapshot: null, liveSnapshotConfirmed: false });
  },

  // 事故防止・操作性改善：ページ全体をリロードせず、現在表示中のライブ情報一式だけを
  // 再取得する。「最新状態を取得」ボタンから呼ぶ。loadingフラグは変更しない
  // （画面全体を「状態を確認中…」に戻さないため）。tickTimer自体はinit()で既に
  // 動いているので触らない。
  refresh: async () => {
    const live0 = get().live;
    if (!live0) return { ok: true };
    const liveId = live0.id;
    try {
      // --- live スライス ---
      const liveOutcome = await loadSnapshotSlice<LiveRow | null>({
        gate: liveGate,
        fetch: async () => {
          const { data, error } = await supabase
            .from("lives")
            .select("*")
            .eq("id", liveId)
            .maybeSingle();
          if (error) return { ok: false, data: null };
          return { ok: true, data: (data as LiveRow | null) ?? null };
        },
        stillCurrent: () => {
          const cur = get().live;
          return cur == null || cur.id === liveId;
        },
        applyFresh: (row) => set({ live: row ?? null, liveSnapshotConfirmed: true }),
        markUnconfirmed: () => set({ liveSnapshotConfirmed: false }),
      });
      if (liveOutcome === "unconfirmed") {
        return {
          ok: false,
          reason: "最新状態の取得に失敗しました。しばらくすると自動的に再試行します。",
        };
      }
      const freshLive = get().live;
      if (!freshLive || freshLive.id !== liveId) {
        // ライブ行が消えた / 別ライブへ切り替わった。snapshot識別情報は無効化。
        set({ childrenSnapshotLiveId: null, answersSnapshot: null, lastRefreshedAt: new Date().toISOString() });
        return { ok: true };
      }

      // --- children スライス ---
      const childrenOutcome = await loadSnapshotSlice<ChildrenPayload>({
        gate: childrenGate,
        fetch: () => fetchChildrenWithProfiles(liveId),
        stillCurrent: () => get().live?.id === liveId,
        applyFresh: ({ profiles, ...children }) =>
          set({ ...children, profiles, childrenSnapshotLiveId: liveId }),
        markUnconfirmed: () => set({ childrenSnapshotLiveId: null }),
      });

      // --- answers スライス ---
      let answersOutcome: SliceLoadOutcome = "applied";
      const turnId = freshLive.current_turn_id;
      if (turnId) {
        answersOutcome = await loadSnapshotSlice<AnswerRow[]>({
          gate: answersGate,
          fetch: () => fetchAnswersForTurn(turnId),
          stillCurrent: () => {
            const s = get();
            return s.live?.id === liveId && s.live?.current_turn_id === turnId;
          },
          applyFresh: (data) =>
            set({ answers: data, scores: [], answersSnapshot: { liveId, turnId } }),
          markUnconfirmed: () => set({ answersSnapshot: null }),
        });
      } else {
        answersGate.begin();
        set({ answers: [], scores: [], answersSnapshot: null });
      }

      // --- resolved（確定ログ）スライス ---
      const resolvedOutcome = await loadSnapshotSlice<ResolvedPayload>({
        gate: resolvedGate,
        fetch: () => fetchResolvedWithScores(liveId),
        stillCurrent: () => get().live?.id === liveId,
        applyFresh: ({ resolvedAnswers, resolvedScoresByAnswer }) =>
          set({ resolvedAnswers, resolvedScoresByAnswer }),
        markUnconfirmed: () => {},
      });

      set({ lastRefreshedAt: new Date().toISOString(), error: null });
      const anyUnconfirmed =
        childrenOutcome === "unconfirmed" ||
        answersOutcome === "unconfirmed" ||
        resolvedOutcome === "unconfirmed";
      return anyUnconfirmed
        ? {
            ok: false,
            reason: "一部の情報を取得できませんでした（前回の表示を維持しています）。しばらくすると自動的に再試行します。",
          }
        : { ok: true };
    } catch {
      return { ok: false, reason: "最新状態の取得に失敗しました。しばらくすると自動的に再試行します。" };
    }
  },

  // 運営者専用管理画面の追加（第1段階）：「ライブ準備画面」の保存操作。
  // 旧startLive()はここでinterludeとして直接insertしていたが、新設計では
  // 「準備中(scheduled)」として作成し、受付開始は別操作(openReception)に分離する。
  createLivePreparation: async (input) => {
    const existingResult = await fetchActiveLive();
    if (!existingResult.ok) {
      // 既存ライブの有無を確認できないまま作成へ進むと、実際には進行中のライブが
      // あるのに気づかず二重に作成してしまう恐れがあるため、ここでは中断する。
      return { ok: false, reason: "既存ライブの確認に失敗しました。もう一度お試しください。" };
    }
    const existing = existingResult.data;
    if (existing) {
      // 別ライブへ切り替える：前ライブのスナップショット識別情報は必ず無効化する
      // （subscribeLiveChannelsのSUBSCRIBED時、またはinit()/refresh()で
      // このライブについて取得成功して初めてreadyに戻る）。live行自体は
      // fetchActiveLiveで取得済み＝liveSnapshotConfirmed。
      liveGate.begin();
      set({
        live: existing,
        liveSnapshotConfirmed: true,
        childrenSnapshotLiveId: null,
        answersSnapshot: null,
      });
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

    // 2026-09-04:「createLivePreparationのトランザクション化」対応。以前は
    // 「lives作成→topics作成」の2回の別々のSupabase呼び出しに分かれており、
    // 後者が失敗するとscheduledなライブだけが残ってしまっていた。
    // create_live_preparation()に一括化し、Postgresの関数呼び出し自体が
    // 1トランザクションになる性質を利用して、途中で失敗すれば何も作られない
    // ようにする（お題本文はここでもう一度topic_bankから取り直すため、
    // クライアントから任意の本文を注入することもできない）。
    const { data, error } = await supabase
      .rpc("create_live_preparation", {
        p_scheduled_at: input.scheduledAt,
        p_title: input.title || null,
        p_max_players: input.maxPlayers,
        p_planned_group_count: input.groupCount,
        p_topic_bank_ids: entries.slice(0, neededTopics).map((entry) => entry.id),
      })
      .single();
    if (error) {
      return { ok: false, reason: error.message };
    }
    const result = data as { ok: boolean; reason: string | null; live_id: string | null };
    if (!result.ok || !result.live_id) {
      return { ok: false, reason: result.reason ?? "ライブの作成に失敗しました" };
    }

    await logAdminAction({
      action: "live_prepared",
      targetType: "lives",
      targetId: result.live_id,
      detail: { title: input.title, maxPlayers: input.maxPlayers, groupCount: input.groupCount },
    });

    // 新しいライブへ切り替える直前に、前ライブのスナップショット識別情報を無効化する。
    liveGate.begin();
    childrenGate.begin();
    answersGate.begin();
    set({ childrenSnapshotLiveId: null, answersSnapshot: null, liveSnapshotConfirmed: false });

    const { data: liveRow, error: liveFetchError } = await supabase
      .from("lives")
      .select("*")
      .eq("id", result.live_id)
      .single();
    if (liveFetchError || !liveRow) {
      set({ error: "ライブは作成できましたが、最新状態の取得に失敗しました。しばらくすると自動的に再試行します。" });
      return { ok: true };
    }
    const live = liveRow as LiveRow;
    const childrenResult = await fetchLiveChildren(live.id);
    const profiles = await fetchProfilesFor(childrenResult.data.participants);
    liveGate.begin();
    childrenGate.begin();
    set({
      live,
      liveSnapshotConfirmed: true,
      ...childrenResult.data,
      // createLivePreparation後のfetchLiveChildren成功時は、Realtimeの
      // SUBSCRIBED通知を待たずその場でreadyにする（interludeが0秒で止まらない
      // ように）。失敗時はnullのまま＝readyにしない。
      childrenSnapshotLiveId: childrenResult.ok ? live.id : null,
      answersSnapshot: null,
      profiles,
      error: childrenResult.ok
        ? null
        : "作成後の組・お題情報を取得できませんでした。しばらくすると自動的に再試行します。",
    });
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
    applyAuthoritativeLive(data as LiveRow);
    await logAdminAction({ action: "reception_opened", targetType: "lives", targetId: live.id });
    return { ok: true };
  },

  // 「（もう一度）ランダムに振り分ける」：旧confirmGroupingAndBeginの前半部分
  // （組分けのみ）。お題選定・turns作成・フェーズ遷移は行わない（beginGameへ分離）。
  randomizeGroups: async () => {
    const { live } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };

    // 2026-09-04:「randomizeGroupsの原子化・エラー確認」対応。以前はクライアント
    // 側で「（無ければ）groups作成→全員リセット→再割当」をPromise.allで並列
    // 実行しており、Supabaseのupdateはネットワーク越しに失敗してもPromise.all
    // 自体は例外を投げず(result.errorになるだけ)、その戻り値を検査していなかった
    // ため、一部だけaudience/group_id=nullのまま成功扱いになりうる状態だった。
    // randomize_groups()は1つのSECURITY DEFINER関数にまとめ、途中で失敗すれば
    // 何も変更されないようにする。使用する組もlives.planned_group_count件
    // （group_order昇順の先頭からその件数）に限定し、組数を減らした後の古い
    // 組が紛れ込まないようにする。
    const { data, error } = await supabase.rpc("randomize_groups", { p_live_id: live.id }).single();
    if (error) {
      return { ok: false, reason: error.message };
    }
    const result = data as { ok: boolean; reason: string | null };
    if (!result.ok) {
      return { ok: false, reason: result.reason ?? "組分けに失敗しました" };
    }

    await logAdminAction({
      action: "groups_randomized",
      targetType: "lives",
      targetId: live.id,
      detail: { groupCount: live.planned_group_count ?? 1 },
    });

    const childrenResult = await fetchLiveChildren(live.id);
    if (!childrenResult.ok) {
      return { ok: false, reason: "組分け後の情報取得に失敗しました。「最新状態を取得」で確認してください。" };
    }
    const profiles = await fetchProfilesFor(childrenResult.data.participants);
    // 有効なchildrenを再取得できたので、このライブについてreadyに更新する
    // （進行中の古いchildren読み取りを begin() で無効化してから反映）。
    childrenGate.begin();
    set({ ...childrenResult.data, childrenSnapshotLiveId: live.id, profiles, error: null });
    return { ok: true };
  },

  // 参加者一覧の組選択プルダウンから呼ぶ、個別の手動組変更。即時保存。
  setParticipantGroup: async (participantId, groupId) => {
    // 2026-09-05:「参加者とグループを更新するRPC側にも
    // participant.live_idとgroup.live_idが同じという不変条件を追加する」対応。
    // 従来はここで直接participantsをupdateしており、DB側には別ライブの
    // group_idを弾く手段が無かった（UIは現在のライブのgroupsしか選択肢に
    // 出さないため実害は無いが、多層防御として専用RPCに切り出す）。
    const { data, error } = await supabase
      .rpc("set_participant_group", { p_participant_id: participantId, p_group_id: groupId })
      .single();
    if (error) {
      set({ error: error.message });
      return { ok: false, reason: error.message };
    }
    const result = data as { ok: boolean; reason: string | null };
    if (!result.ok) {
      const message = result.reason ?? "組の変更に失敗しました";
      set({ error: message });
      return { ok: false, reason: message };
    }
    await logAdminAction({
      action: "participant_group_changed",
      targetType: "participants",
      targetId: participantId,
      detail: { groupId },
    });
    const { live } = get();
    if (live) {
      const childrenResult = await fetchLiveChildren(live.id);
      if (childrenResult.ok) {
        const profiles = await fetchProfilesFor(childrenResult.data.participants);
        childrenGate.begin();
        set({ ...childrenResult.data, childrenSnapshotLiveId: live.id, profiles });
      }
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
      const childrenResult = await fetchLiveChildren(live.id);
      if (childrenResult.ok) set({ topics: childrenResult.data.topics });
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

  // 2026-09-07（セキュリティレビュー対応 P1-5）：authenticatedがparticipants.
  // host_message/host_message_sent_atを直接UPDATEできる列GRANTを剥奪した（0060）。
  // is_host()をDB内で検証するSECURITY DEFINER RPC（admin_set_participant_message）
  // 経由にし、送信時のadmin_action_logs記録もRPC内（同一トランザクション）で
  // 行うようにしたため、ここでのlogAdminAction呼び出しは不要になった。
  sendPrivateMessage: async (participantId, message) => {
    const { live } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };
    const trimmed = message.trim();
    if (!trimmed) return { ok: false, reason: "メッセージを入力してください" };
    const { error } = await supabase.rpc("admin_set_participant_message", {
      p_participant_id: participantId,
      p_message: trimmed,
    });
    if (error) return { ok: false, reason: error.message };
    const childrenResult = await fetchLiveChildren(live.id);
    if (childrenResult.ok) set({ participants: childrenResult.data.participants });
    return { ok: true };
  },

  clearPrivateMessage: async (participantId) => {
    const { live } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };
    const { error } = await supabase.rpc("admin_set_participant_message", {
      p_participant_id: participantId,
      p_message: null,
    });
    if (error) return { ok: false, reason: error.message };
    const childrenResult = await fetchLiveChildren(live.id);
    if (childrenResult.ok) set({ participants: childrenResult.data.participants });
    return { ok: true };
  },

  kickParticipant: async (participantId) => {
    const { live } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };
    // 2026-09-04:「kick/unkickとeligible_judge_count更新を原子的にする」対応。
    // 以前はクライアント側で「participants更新→各turnsを1件ずつ個別に
    // update」という複数回の呼び出しに分かれており、後半が一部だけ失敗する
    // 部分状態がありえた。kick_participant()は1つのSECURITY DEFINER関数で
    // participants更新とturns再計算（および採点中の禁止判定・
    // user_sanctions記録）を全て行い、途中で失敗すれば何も変更しない。
    const { data, error } = await supabase.rpc("kick_participant", {
      p_participant_id: participantId,
    }).single();
    if (error) return { ok: false, reason: error.message };
    const result = data as { ok: boolean; reason: string | null };
    if (!result.ok) return { ok: false, reason: result.reason ?? "処理に失敗しました" };

    await logAdminAction({
      action: "participant_kicked",
      targetType: "participants",
      targetId: participantId,
    });
    const childrenResult = await fetchLiveChildren(live.id);
    if (!childrenResult.ok) {
      // 退場自体はDBに反映済みなのでok:trueのまま、取得失敗はerror状態で伝える
      // （closeLiveのポイント付与失敗時と同じ「本処理は成功・付随処理だけ要再確認」の扱い）。
      set({ error: "退場は完了しましたが、最新の参加者一覧の取得に失敗しました。「最新状態を取得」してください。" });
      return { ok: true };
    }
    set({ participants: childrenResult.data.participants });
    return { ok: true };
  },

  unkickParticipant: async (participantId) => {
    const { live } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };
    const { data, error } = await supabase.rpc("unkick_participant", {
      p_participant_id: participantId,
    }).single();
    if (error) return { ok: false, reason: error.message };
    const result = data as { ok: boolean; reason: string | null };
    if (!result.ok) return { ok: false, reason: result.reason ?? "処理に失敗しました" };

    await logAdminAction({
      action: "participant_unkicked",
      targetType: "participants",
      targetId: participantId,
    });
    const childrenResult = await fetchLiveChildren(live.id);
    if (!childrenResult.ok) {
      set({ error: "退場解除は完了しましたが、最新の参加者一覧の取得に失敗しました。「最新状態を取得」してください。" });
      return { ok: true };
    }
    set({ participants: childrenResult.data.participants });
    return { ok: true };
  },

  // 2026-09-04:「失敗後に実際の再計算を行う再試行処理を用意する」対応。
  // 「最新状態を取得」は今のDB値を読み直すだけで、間違ったeligible_judge_count
  // そのものは直らない。このアクションはDB側の値そのものを、現在の参加者一覧
  // から実際に再計算して書き換える（kick/unkickは原子化済みなので通常は不要だが、
  // 過去の不整合が残っている場合の修復用）。
  resyncEligibleJudgeCounts: async () => {
    const { live } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };
    const { data, error } = await supabase
      .rpc("resync_eligible_judge_counts", { p_live_id: live.id })
      .single();
    if (error) return { ok: false, reason: error.message };
    // 2026-09-05:「resync_eligible_judge_countsのreasonをフロントが処理して
    // いない」対応。DB関数は(ok, reason, updated_turns)を返す（0055で
    // reasonが追加された）のに、ここでは受け取っておらず、拒否時にも
    // 「N件のターンを更新しました」という成功寄りの文言を返してしまって
    // いた。ok=falseの場合はDBのreasonをそのまま返し、参加者一覧の
    // 再取得（refresh）も成功時だけ行う。
    const result = data as { ok: boolean; reason: string | null; updated_turns: number };
    if (!result.ok) {
      return { ok: false, reason: result.reason ?? "再計算に失敗しました" };
    }
    const childrenResult = await fetchLiveChildren(live.id);
    if (childrenResult.ok) set({ turns: childrenResult.data.turns });
    return { ok: true, reason: `${result.updated_turns}件のターンを更新しました` };
  },

  // 受付中（interlude/opening）に、集まり具合を見ながら組数・最大参加人数を
  // 調整できるようにする。組数を変えても既存のgroups/participantsの割り当ては
  // 自動では変更しない（randomizeGroupsを呼び直すとplanned_group_countに
  // 合わせて再割り当てされる）。
  // 2026-09-03: 組数を後から増やしても、ライブ作成時に用意したお題の枚数は
  // 自動では増えず、「ゲームを開始する」の時点で初めて「お題の準備が不足して
  // います」と分かる不親切な作りだった。組数を変更するたびに必要枚数
  // (groupCount×ROUNDS_PER_LIVE_DEFAULT)を再計算し、足りない分だけprepareLive()と
  // 同じ考え方(pickRandomTopicBankEntries)でtopic_bankから自動的に追加する。
  updateCapacity: async ({ maxPlayers, groupCount }) => {
    const { live } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };
    if (groupCount < 1) return { ok: false, reason: "組数は1以上にしてください" };

    const { data: existingTopicRows, error: fetchTopicsError } = await supabase
      .from("topics")
      .select("topic_bank_id")
      .eq("live_id", live.id);
    if (fetchTopicsError) return { ok: false, reason: fetchTopicsError.message };
    const existingTopics = (existingTopicRows ?? []) as { topic_bank_id: string | null }[];
    const neededTopics = groupCount * ROUNDS_PER_LIVE_DEFAULT;
    const shortfall = neededTopics - existingTopics.length;
    if (shortfall > 0) {
      const usedTopicBankIds = existingTopics
        .map((t) => t.topic_bank_id)
        .filter((id): id is string => id !== null);
      const additionalEntries = await pickRandomTopicBankEntries(shortfall, usedTopicBankIds);
      if (additionalEntries.length < shortfall) {
        return {
          ok: false,
          reason: `組数を増やすにはお題があと${shortfall}件必要です（お題管理から追加してください）`,
        };
      }
      const { error: insertTopicsError } = await supabase.from("topics").insert(
        additionalEntries.map((entry) => ({
          live_id: live.id,
          body: entry.body,
          format: entry.format,
          topic_bank_id: entry.id,
        })),
      );
      if (insertTopicsError) return { ok: false, reason: insertTopicsError.message };
    }

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
    const { live } = get();
    if (!live) return { ok: false, reason: "ライブがありません" };

    // 2026-09-03:「beginGameの部分成功防止」対応。以前はここで
    // 「lives更新(topic_reveal)→turns一括作成→topics施錠→最初のturn有効化→
    // lives.current_turn_id確定」を5回の別々のSupabase呼び出しに分けており、
    // 後半3つはエラーを一切確認していなかった。途中で失敗すると
    // current_phase='topic_reveal'なのにcurrent_turn_idがnullという不整合な
    // 状態のまま「ゲームを開始しました」と表示されうる状態だった。
    // begin_game()に一括化し、Postgresの関数呼び出し自体が1トランザクション
    // になる性質を利用して、途中のどこで失敗しても何も変更されない
    // （＝openingへ安全に戻ったのと同じ状態）ようにした。
    const { data, error } = await supabase.rpc("begin_game", { p_live_id: live.id }).single();
    if (error) {
      return { ok: false, reason: error.message };
    }
    const result = data as { ok: boolean; reason: string | null; first_turn_id: string | null };
    if (!result.ok || !result.first_turn_id) {
      const message = result.reason ?? "ゲームの開始に失敗しました";
      set({ error: message });
      return { ok: false, reason: message };
    }

    await logAdminAction({
      action: "game_started",
      targetType: "lives",
      targetId: live.id,
    });

    // 2026-09-10（再レビュー対応）：begin_gameでturnsが新規作成されたため、
    // begin_game前のchildrenスナップショット（turns未作成）はもう信頼できない。
    // 一旦無効化し、この直後のchildrenResult.ok（turns込みの再取得成功）で
    // 初めてreadyに戻す（取得失敗中は自動進行しない）。
    childrenGate.begin();
    answersGate.begin();
    set({ childrenSnapshotLiveId: null, answersSnapshot: null });

    // 2026-09-06:「最初のお題発表だけ0秒になっても回答画面へ進まない」不具合対応。
    // begin_gameはDB側でlives.current_phaseをtopic_revealへ、phase_deadlineを
    // DBのnow()基準で更新するが、以前はここでparticipants/groups/topics/turnsしか
    // 再取得しておらず、司会ストアのstate.liveがopeningのまま古くなっていた。
    // advanceIfDueはstate.liveしか見ないため、以降このタブが「最新状態を取得」を
    // 手動で押すまで自動遷移が一切効かなかった。lives行も同時に取得し直し、
    // phase_deadlineはDBが設定した値をそのまま使う（クライアントで作り直さない）。
    const [liveResult, childrenResult] = await Promise.all([
      fetchLiveRow(live.id),
      fetchLiveChildren(live.id),
    ]);
    if (liveResult.ok && liveResult.data) {
      applyAuthoritativeLive(liveResult.data);
    } else {
      // lives行の再取得に失敗した場合、liveSnapshotConfirmed=falseにして
      // advanceIfDueに自動進行を凍結させる（読み取り再試行で自動的に復帰する）。
      set({
        liveSnapshotConfirmed: false,
        error: "ゲームは開始しましたが、最新のライブ状態を取得できませんでした。しばらくすると自動的に再試行します。",
      });
    }
    if (childrenResult.ok) {
      const profiles = await fetchProfilesFor(childrenResult.data.participants);
      childrenGate.begin();
      set({
        ...childrenResult.data,
        childrenSnapshotLiveId: live.id,
        profiles,
        error: liveResult.ok ? null : get().error,
      });
    } else if (liveResult.ok) {
      // ゲーム開始自体（begin_game）は成功しているが、組・ターン情報の取得に
      // 失敗した：childrenSnapshotLiveId は null のまま（自動進行は凍結）にし、
      // advanceIfDueの読み取り再試行で復帰させる。
      set({ error: "ゲームは開始しましたが、組・ターン情報を取得できませんでした。しばらくすると自動的に再試行します。" });
    }
    await refreshAnswersForTurn(result.first_turn_id);
    return { ok: true };
  },

  closeLive: async () => {
    const { live } = get();
    if (!live) return { ok: true };
    // 2026-09-03:「closeLiveのポイント取りこぼし」対策。以前はlives更新と
    // apply_live_rank_rewards呼び出しが別々のSupabase呼び出しで、後者の失敗は
    // console.warnで握りつぶされ、運営が気づく・再試行する手段も無かった。
    // close_live()はこの2つを1つのSECURITY DEFINER関数にまとめ、ポイント付与
    // 側だけ失敗してもライブの終了自体はロールバックさせず、成功/失敗を
    // 戻り値で返す（既存のrank_rewards_appliedによる二重付与防止は維持）。
    const { data, error } = await supabase.rpc("close_live", { p_live_id: live.id }).single();
    if (error) {
      set({ error: error.message });
      return { ok: false, reason: error.message };
    }
    const result = data as { closed: boolean; rewards_applied: boolean; rewards_error: string | null };
    if (!result.closed) {
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
        childrenSnapshotLiveId: null,
        answersSnapshot: null,
        liveSnapshotConfirmed: true,
        error: null,
      });
      return { ok: true };
    }
    await logAdminAction({ action: "live_closed", targetType: "lives", targetId: live.id });
    // ポイント付与が失敗した場合は、成功扱いにせず運営に見える形で残す
    // （ライブの終了自体は完了しているのでok:trueのまま、errorだけ立てる。
    // 管理画面のライブ結果詳細から後でretryRankRewardsを呼べば再試行できる）。
    if (!result.rewards_applied) {
      const message = `段位・ポイントの加算に失敗しました（あとで管理画面から再試行できます）：${result.rewards_error ?? "不明なエラー"}`;
      console.warn("[live]", message);
      set({ error: message });
    }
    cleanupChannels();
    useLiveBotStore.getState().removeAllBots();
    // closed状態の行を持ち続けると画面が「開始前」に戻らない(!liveでのみ判定しているため)。
    // ライブそのものを無かった状態に戻す（errorは上で立てていれば維持する）。
    set((s) => ({
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
      childrenSnapshotLiveId: null,
      answersSnapshot: null,
      liveSnapshotConfirmed: true,
      error: result.rewards_applied ? null : s.error,
    }));
    return { ok: true };
  },

  retryRankRewards: async (liveId: string) => {
    const { data, error } = await supabase.rpc("retry_live_rank_rewards", { p_live_id: liveId }).single();
    if (error) return { ok: false, reason: error.message };
    const result = data as { rewards_applied: boolean; rewards_error: string | null };
    if (!result.rewards_applied) {
      return { ok: false, reason: result.rewards_error ?? "不明なエラー" };
    }
    return { ok: true };
  },
}));
