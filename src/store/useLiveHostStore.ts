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
  awaitChannelsSubscribed,
  botScoringAllowed,
  childrenSnapshotReady,
  createChannelSubscriptionTracker,
  createRecoveryCoordinator,
  createSliceGate,
  hydrateAfterLive,
  insertGuardPasses,
  loadSnapshotSlice,
  progressionFrozen,
  runGuardedSteps,
  scoresSnapshotMatches,
  shouldReleaseInitInFlight,
  shouldReleaseRetryFlag,
  shouldRetryNow,
  type AnswersSnapshotKey,
  type ChannelSubscribeOutcome,
  type ChannelSubscriptionTracker,
  type HostHydrationOutcome,
  type ScoresSnapshotKey,
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
  // 確認できているか。fetchActiveLive/fetchLiveRowの取得失敗中・および最新の
  // 再取得を開始した時点(markPending)でfalseにし、表示用の古いliveは残しつつ
  // advanceIfDueの自動進行を凍結する（読み取り再試行だけを一定間隔で行い、
  // 取得成功でtrueへ戻す）。
  liveSnapshotConfirmed: boolean;
  // 2026-09-12（再レビュー対応・P1-2）：現在stateに入っているscoresが、どの
  // (liveId, turnId, answerId) について正常取得済みか（未確認・表示中の回答が
  // 無い場合はnull）。回答Aのscores取得中に回答Bへ切り替わったとき、Aの結果を
  // Bへ反映しないための識別情報。live/turn/表示中の回答が変わったら無効化する。
  scoresSnapshot: ScoresSnapshotKey | null;
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
// 2026-09-12（再レビュー対応・P1-2）：scores専用の取得世代ゲート。
// scoresのRealtimeイベントが連続/同時に届いたとき、古い取得R1が新しい取得R2の
// 後に完了して新しい採点一覧を古い一覧で上書きするのを防ぐ（他スライスと同様）。
const scoresGate = createSliceGate();

// 2026-09-11/12（再レビュー対応）：未確認スライスの読み取り再試行の
// single-flight フラグと最小間隔（tickは500msだが再取得は最短2秒間隔に絞る）。
// finallyでの解除は shouldReleaseRetryFlag で「自分が現行世代の所有者のときだけ」に
// 限定する（stop前の古いretryが、stop後に始まった新しいretryのフラグを解除しない）。
let liveRetryInFlight = false;
let liveRetryAt = 0;
let childrenRetryInFlight = false;
let childrenRetryAt = 0;
let answersRetryInFlight = false;
let answersRetryAt = 0;
let scoresRetryInFlight = false;
let scoresRetryAt = 0;
const SNAPSHOT_RETRY_INTERVAL_MS = 2_000;

// 2026-09-13（再レビュー対応・P1-1）：司会進行環境が「どのliveIdについて完全に
// 確立済みか」。liveSnapshotConfirmed（live行を取得できた）だけでは不十分で、
// - subscribedLiveId：進行に必要な全Realtimeチャンネルが対象liveIdで実際に
//   SUBSCRIBED になったか（onChannelStatus が集約して設定、接続異常/cleanupでクリア）
// - runtimeReadyLiveId：hydrate が children/answers/scores まで applied で
//   完了し、全必須チャンネル SUBSCRIBED ＋ タイマー復元まで済んだliveId
// の両方が現在のlive.idと一致して初めて「完全復旧済み」とみなす（isHostRuntimeEstablished）。
// 手動refreshがliveGateだけ進めて liveSnapshotConfirmed=true にしても、これらが
// 揃わない限り advanceIfDue は完全復旧（ensureHostRecovery）へ合流する。
let subscribedLiveId: string | null = null;
let runtimeReadyLiveId: string | null = null;

// 2026-09-14（再レビュー対応・P1-1/P1-2）：Realtime購読の「世代」。
// subscribeLiveChannels を呼ぶたび（＝cleanupChannels のたび）に +1 する。
// 各チャンネルの status/postgres_changes コールバックは自分が作られたときの
// 世代を捕捉し、コールバック開始時に channelGeneration と一致するかを確認する。
// 古い購読世代のコールバック（遅延した refetch・遅れて届く SUBSCRIBED/
// CHANNEL_ERROR/CLOSED）は現在の state に一切影響させない。
let channelGeneration = 0;
// 現在の購読世代が対象としている liveId と、必須チャンネルの接続状態集約。
let currentChannelLiveId: string | null = null;
let currentChannelTracker: ChannelSubscriptionTracker | null = null;
// 進行に必要な（＝SUBSCRIBED を待つ）チャンネル。tsukkomi は送信専用の
// 賑やかし用ブロードキャストで、接続できなくても進行に支障が無いため必須にしない。
const REQUIRED_CHANNELS = ["lives", "participants", "turns", "answers", "scores"] as const;
const CHANNEL_SUBSCRIBE_TIMEOUT_MS = 10_000;
const CHANNEL_SUBSCRIBE_POLL_MS = 150;

// 完全復旧（init / 初回失敗後のretry / 未初期化状態の手動refresh）を1本化する
// 所有権コーディネータ。同一世代の完全復旧が進行中なら、その Promise へ合流する
// （新しく並行して走らせない＝中途半端な superseded 終了を防ぐ）。
const recovery = createRecoveryCoordinator();

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
  subscribedLiveId = null;
  // 購読世代を +1 して、古い（この cleanup より前に作られた）チャンネルの
  // 遅延コールバックを全て無効化する。
  channelGeneration += 1;
  currentChannelLiveId = null;
  currentChannelTracker = null;
}

// 待機（awaitChannelsSubscribed のポーリング）で使う sleep。
function channelSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 500msの進行tickタイマーを（重複なく）1本だけ確実に張る。指定世代が既に
// 古い（stopHostProgressされた）場合は張らない。既に現在世代で1本動いていれば
// そのまま使う（clear→再作成でtickを1回落とさない）。tickTimer が非nullになるのは
// 現在世代のみ（stopHostProgress が clear ＋ 世代+1、ensureTickTimer は古い世代なら
// 作らない）。
function ensureTickTimer(generation: number) {
  if (generation !== progressGeneration) return;
  if (tickTimer) return;
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

// Realtime を対象 liveId で購読する。cleanupChannels で購読世代 channelGeneration を
// +1 したうえで新しい世代の channel を作る。各コールバックは自分が作られた世代
// (myGen) を捕捉し、コールバック開始時に channelGeneration と一致するかを確認する。
// 古い購読世代のコールバック（遅延 refetch・遅れて届く SUBSCRIBED/CHANNEL_ERROR/
// CLOSED）は現在の state に一切影響させない。
// 「購読を作った」だけでは接続完了ではないため、subscribedLiveId は
// onChannelStatus が「全必須チャンネル SUBSCRIBED」を確認したときだけ設定する。
function subscribeLiveChannels(liveId: string) {
  cleanupChannels(); // channelGeneration += 1
  const myGen = channelGeneration;
  const tracker = createChannelSubscriptionTracker([...REQUIRED_CHANNELS]);
  currentChannelTracker = tracker;
  currentChannelLiveId = liveId;

  // この購読世代がまだ現行か。古い世代のコールバックは全てここで弾く。
  const isCurrentGen = () => myGen === channelGeneration;

  const refetchChildren = () => {
    if (!isCurrentGen()) return;
    void loadSnapshotSlice<ChildrenPayload>({
      gate: childrenGate,
      fetch: () => fetchChildrenWithProfiles(liveId),
      // 2026-09-14（再レビュー対応・P1-1）：「無条件に現在」を返す stillCurrent を廃止。
      // 「liveIdで絞って取得している」ことは、そのliveIdが現在表示中のライブである
      // ことを保証しない。購読世代と現在の live.id の両方が一致するときだけ反映する。
      stillCurrent: () => isCurrentGen() && useLiveHostStore.getState().live?.id === liveId,
      markPending: () => useLiveHostStore.setState({ childrenSnapshotLiveId: null }),
      applyFresh: ({ profiles, ...children }) =>
        useLiveHostStore.setState({ ...children, profiles, childrenSnapshotLiveId: liveId }),
      markUnconfirmed: () => useLiveHostStore.setState({ childrenSnapshotLiveId: null }),
    });
  };

  const refetchAnswersAndScores = () => {
    if (!isCurrentGen()) return;
    void resyncAnswersAndScoresForCurrentLive();
  };

  const refetchLive = () => {
    if (!isCurrentGen()) return;
    void loadSnapshotSlice<LiveRow | null>({
      gate: liveGate,
      fetch: () => fetchLiveRow(liveId),
      // 2026-09-14（再レビュー対応・P1-1）：購読世代と現在の live.id の両方を確認する。
      // ライブAの遅延した refetchLive がライブBを上書きしないようにする。
      stillCurrent: () => isCurrentGen() && useLiveHostStore.getState().live?.id === liveId,
      markPending: () => useLiveHostStore.setState({ liveSnapshotConfirmed: false }),
      applyFresh: (row) =>
        useLiveHostStore.setState({ live: row ?? null, liveSnapshotConfirmed: true }),
      markUnconfirmed: () => useLiveHostStore.setState({ liveSnapshotConfirmed: false }),
    });
  };

  const refetchOnReconnect = (channel: (typeof REQUIRED_CHANNELS)[number]) => {
    // チャンネルが(再)接続できた瞬間に、そのチャンネルが担う範囲の最新スナップショットを
    // 取り直す（Realtimeは切断中に起きた変更を後から届けてくれないため）。
    if (channel === "lives") refetchLive();
    else if (channel === "participants" || channel === "turns") refetchChildren();
    else refetchAnswersAndScores();
  };

  // 各必須チャンネルの status コールバック。古い購読世代は無視。SUBSCRIBED を集約し、
  // 全必須チャンネル SUBSCRIBED になった時点でだけ subscribedLiveId を確立する。
  // CHANNEL_ERROR / TIMED_OUT / CLOSED は無視せず、このliveIdの runtime ready を無効化して
  // 自動進行を凍結する（ensureHostRecovery が再試行する）。
  const onChannelStatus =
    (channel: (typeof REQUIRED_CHANNELS)[number]) => (status: string) => {
      if (!isCurrentGen()) return; // 古い購読世代の通知は現在の状態へ影響させない
      tracker.note(channel, status);
      if (status === "SUBSCRIBED") {
        refetchOnReconnect(channel);
        if (tracker.allSubscribed() && !tracker.hasFailure()) {
          subscribedLiveId = liveId;
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (subscribedLiveId === liveId) subscribedLiveId = null;
        if (runtimeReadyLiveId === liveId) runtimeReadyLiveId = null;
      }
    };

  const livesCh = supabase
    .channel(`host-lives-${liveId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "lives", filter: `id=eq.${liveId}` },
      refetchLive,
    )
    .subscribe(onChannelStatus("lives"));

  const participantsCh = supabase
    .channel(`host-participants-${liveId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "participants", filter: `live_id=eq.${liveId}` },
      refetchChildren,
    )
    .subscribe(onChannelStatus("participants"));

  const turnsCh = supabase
    .channel(`host-turns-${liveId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "turns", filter: `live_id=eq.${liveId}` },
      refetchChildren,
    )
    .subscribe(onChannelStatus("turns"));

  const answersCh = supabase
    .channel(`host-answers-${liveId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "answers", filter: `live_id=eq.${liveId}` },
      () => {
        if (!isCurrentGen()) return;
        const { live } = useLiveHostStore.getState();
        if (!live?.current_turn_id) return;
        void refreshAnswersForTurn(live.current_turn_id);
      },
    )
    .subscribe(onChannelStatus("answers"));

  // scoresにはlive_idが無いため、絞り込まず購読し現在の回答分だけ都度取り直す
  // （リハ規模の件数なので問題にならない）。2026-09-12（P1-2）：scoresGate越しに
  // 取り直し、古いR1が新しいR2の後に完了して古い一覧で上書きするのを防ぐ。
  const scoresCh = supabase
    .channel(`host-scores-${liveId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "scores" }, () => {
      if (!isCurrentGen()) return;
      void refreshScoresForActiveAnswer();
    })
    .subscribe(onChannelStatus("scores"));

  // ボット観客のツッコミ/爆笑/拍手を送るための送信専用チャンネル。
  // これは賑やかし用のブロードキャストで、接続できなくても進行に支障が無いため
  // 必須チャンネル（SUBSCRIBEDを待つ対象）には含めない。
  tsukkomiChannel = supabase
    .channel("follower-tsukkomi", { config: { broadcast: { self: true } } })
    .subscribe();

  channels = [livesCh, participantsCh, turnsCh, answersCh, scoresCh, tsukkomiChannel];
}

// hydrateAfterLive の subscribeAndWait 実装。必須チャンネルが実際に SUBSCRIBED に
// なるまで待つ。既に同じliveId向けのチャンネルがあり異常が無ければ張り直さず待つ
// （タイムアウトしたら一度だけ張り直す）。abortedFn は stop / 進行世代変更 /
// 対象liveId変更 / 購読世代の入れ替わり を検知する。
async function subscribeAndWaitForLive(
  targetLiveId: string,
  abortedFn: (channelGen: number) => boolean,
): Promise<ChannelSubscribeOutcome> {
  const waitOn = (tracker: ChannelSubscriptionTracker, chGen: number) =>
    awaitChannelsSubscribed({
      tracker,
      aborted: () => channelGeneration !== chGen || abortedFn(chGen),
      timeoutMs: CHANNEL_SUBSCRIBE_TIMEOUT_MS,
      pollMs: CHANNEL_SUBSCRIBE_POLL_MS,
      now: () => Date.now(),
      sleep: channelSleep,
    });

  if (
    currentChannelLiveId === targetLiveId &&
    currentChannelTracker !== null &&
    !currentChannelTracker.hasFailure()
  ) {
    // 既にこのliveId向けのチャンネルがあり、接続待ち or 接続済み → 張り直さず待つ。
    const outcome = await waitOn(currentChannelTracker, channelGeneration);
    if (outcome !== "timeout") return outcome;
    // タイムアウト → 一度だけ張り直して再待機する（stuck した接続の作り直し）。
  }
  subscribeLiveChannels(targetLiveId);
  const tracker = currentChannelTracker;
  if (!tracker) return "aborted";
  return waitOn(tracker, channelGeneration);
}

// current_turn_idが切り替わった直後は、Realtimeイベントを待たずに即座に
// そのターンぶんのanswers/scoresへ入れ替える（前のターンの古いデータが
// 一時的にでも残っていると、stillBusy判定を誤らせるため）。
async function refreshAnswersForTurn(turnId: string | null): Promise<SliceLoadOutcome> {
  if (!turnId) {
    // 「現在ターンが無い」という確定した状態：answers/scoresを空にし、
    // answersSnapshot/scoresSnapshotも「該当ターン無し」として無効化する。
    // ここもゲートを通し、進行中の古いanswers/scores取得の結果が後から
    // 書き戻さないようにする。
    answersGate.begin();
    scoresGate.begin();
    useLiveHostStore.setState({
      answers: [],
      scores: [],
      answersSnapshot: null,
      scoresSnapshot: null,
    });
    return "applied";
  }
  const liveId = useLiveHostStore.getState().live?.id ?? null;
  if (!liveId) return "target-changed";
  // 2026-09-11/12（再レビュー対応）：スライスゲートで新旧を判定。より新しいanswers
  // 取得が始まっていれば、この（古い）結果は一切反映しない（superseded）。
  // 取得成功時のみ answers を差し替えて確認済みにし、取得失敗時は表示中の
  // answersは維持しつつ answersSnapshot だけ null（未確認）へ戻す。answersが
  // 変わると表示中の回答も変わりうるため、scoresGateも begin() して古いscores
  // 取得を無効化し、scoresSnapshotも未確認へ落とす。
  return loadSnapshotSlice<AnswerRow[]>({
    gate: answersGate,
    fetch: () => fetchAnswersForTurn(turnId),
    stillCurrent: () => {
      const s = useLiveHostStore.getState();
      return s.live?.id === liveId && s.live?.current_turn_id === turnId;
    },
    markPending: () => useLiveHostStore.setState({ answersSnapshot: null }),
    applyFresh: (data) => {
      scoresGate.begin();
      useLiveHostStore.setState({
        answers: data,
        scores: [],
        answersSnapshot: { liveId, turnId },
        scoresSnapshot: null,
      });
    },
    markUnconfirmed: () => useLiveHostStore.setState({ answersSnapshot: null }),
  });
}

// 2026-09-12（再レビュー対応・P1-2）：現在表示中（revealed かつ未resolved）の
// 回答のscoresを、scoresGate越しに取り直す。回答Aの取得中に回答Bへ切り替わったら、
// Aの結果はBへ反映しない（stillCurrentでanswerIdの一致を確認する）。取得失敗時は
// 既存の表示scoresは維持し、scoresSnapshotだけ未確認へ落とす。
async function refreshScoresForActiveAnswer(): Promise<SliceLoadOutcome> {
  const s0 = useLiveHostStore.getState();
  const live = s0.live;
  const turnId = live?.current_turn_id ?? null;
  const active = s0.answers.find((a) => a.revealed_at && !a.resolved) ?? null;
  if (!live || !turnId || !active) {
    // 表示中の回答が無い＝scoresは空が正しい。ゲートを通して古い取得を無効化する。
    scoresGate.begin();
    useLiveHostStore.setState({ scores: [], scoresSnapshot: null });
    return "applied";
  }
  const liveId = live.id;
  const answerId = active.id;
  return loadSnapshotSlice<ScoreRow[]>({
    gate: scoresGate,
    fetch: () => fetchScoresForAnswer(answerId),
    stillCurrent: () => {
      const s = useLiveHostStore.getState();
      return (
        s.live?.id === liveId &&
        s.live?.current_turn_id === turnId &&
        s.answers.some((a) => a.id === answerId && a.revealed_at && !a.resolved)
      );
    },
    markPending: () => useLiveHostStore.setState({ scoresSnapshot: null }),
    applyFresh: (data) =>
      useLiveHostStore.setState({ scores: data, scoresSnapshot: { liveId, turnId, answerId } }),
    markUnconfirmed: () => useLiveHostStore.setState({ scoresSnapshot: null }),
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
  // 2026-09-12（再レビュー対応・P1-2）：scoresGate越しに取り直す（古いR1が
  // 新しいR2の後に完了して古い一覧で上書きするのを防ぐ）。
  await refreshScoresForActiveAnswer();
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
      markPending: () => useLiveHostStore.setState({ liveSnapshotConfirmed: false }),
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
async function processRevealQueue(tickGeneration: number, tickLiveId: string | null) {
  const state = useLiveHostStore.getState();
  const { answers, live } = state;
  // 2026-09-10/13（再レビュー対応）：live/children/現在ターンのanswers が今の対象に
  // ついて確認済みで、進行環境も確立済みのときだけ reveal 更新へ進む（多層防御。
  // advanceIfDue 側でも同じガードをしているが、await をまたいだ呼び出しにも効かせる）。
  if (progressFrozenForTick(tickGeneration, tickLiveId, true)) return;
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
  // reveal 更新の直前でもう一度凍結を確認する（P2：多層防御）。
  if (progressFrozenForTick(tickGeneration, tickLiveId, true)) return;
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
    // 2026-09-12（再レビュー対応・P1-2）：新しく表示された回答のscoresSnapshotを
    // すぐ確定させる（まだ0件でも）。これが無いと、resolveIfDueが「scores未同期」
    // 判定で最短2秒間ブロックされる。
    await refreshScoresForActiveAnswer();
  }
}

// 表示中の回答の採点が出揃った、または締切(judgeMs+judgeGraceMs)を過ぎていれば確定する。
async function resolveIfDue(tickGeneration: number, tickLiveId: string | null) {
  const state = useLiveHostStore.getState();
  // 2026-09-10/13（再レビュー対応）：live/children/現在ターンのanswers が確認済みで
  // 進行環境も確立済みのときだけ確定処理へ進む（多層防御）。
  if (progressFrozenForTick(tickGeneration, tickLiveId, true)) return;
  if (
    !state.live ||
    !answersSnapshotMatches(state.answersSnapshot, state.live.id, state.live.current_turn_id)
  ) {
    return;
  }
  const active = state.answers.find((a) => a.revealed_at && !a.resolved);
  if (!active || !active.judging_ends_at) return;
  if (resolvingAnswerIds.has(active.id)) return; // 前のtickの確定処理がまだ進行中

  // 2026-09-12（再レビュー対応・P1-2/P2-1）：表示中の回答のscoresがまだ同期
  // できていない（Realtime変更検知直後・再取得中・取得失敗直後）間は、古い/空の
  // scoresで確定判定・確定処理をしない。scoresの再取得を促し、確認できてから
  // 次tick以降で続ける。※確定直前のDB再取得（下）は最終集計の正確性のため残す。
  if (
    !scoresSnapshotMatches(
      state.scoresSnapshot,
      state.live.id,
      state.live.current_turn_id,
      active.id,
    )
  ) {
    retryScoresSnapshot();
    return;
  }

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
    // 2026-09-12（再レビュー対応・P1-2）：この確定直前の再取得もscoresGateを
    // 通し、取得完了までに、より新しいscores取得（Realtime起点など）が始まって
    // いたら、この結果では確定処理を進めない（次tickで最新から再判定する）。
    // 集計そのものはこのfreshScoresで行い、最終集計の正確性は落とさない。
    const scoresToken = scoresGate.begin();
    const freshScoresResult = await fetchScoresForAnswer(active.id);
    if (!freshScoresResult.ok) {
      // 2026-09-03:「Supabase取得エラーを空配列として上書きしない」対応。
      // 取得に失敗した回を「まだ誰も採点していない(0点)」として確定してしまうと
      // 実際には投票済みの点数が消えてしまう。何もせず既存stateを維持し、
      // 次のtickで再試行する（確定を急がない）。確認状態も未確認へ戻す。
      if (scoresGate.isCurrent(scoresToken)) useLiveHostStore.setState({ scoresSnapshot: null });
      return;
    }
    if (!scoresGate.isCurrent(scoresToken)) {
      // より新しいscores取得に追い越された。この（古い）結果では進めない。
      return;
    }
    const sNow = useLiveHostStore.getState();
    if (
      sNow.live?.id !== state.live.id ||
      sNow.live?.current_turn_id !== state.live.current_turn_id ||
      !sNow.answers.some((a) => a.id === active.id && a.revealed_at && !a.resolved)
    ) {
      // 取得中にライブ／ターン／表示中の回答が変わった。今の対象には反映しない。
      return;
    }
    // 2026-09-03:「過去ライブのplayer participant IDによる不正採点混入」対策。
    // DB側のRLS(scores_insert_own_as_player)に同一ライブ確認を追加したが、
    // アプリ側でも多層防御として、集計前に必ず「現在のeligible judge ID集合」に
    // 含まれるscoresだけを対象にする（想定外の参加者IDのscoreが混ざっていても
    // 合計点・top_score_votes・満点判定には一切反映されないようにする）。
    // fetchScoresForAnswer の await をまたいだ後の再確認（P2）。
    if (progressFrozenForTick(tickGeneration, tickLiveId, true)) return;
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
      // 正しい状態から続きを判定できるようにする（scoresGate最新確認済み）。
      useLiveHostStore.setState({
        scores: freshScores,
        scoresSnapshot: {
          liveId: state.live.id,
          turnId: state.live.current_turn_id!,
          answerId: active.id,
        },
      });
      return;
    }

    const scoreTotal = freshScores.reduce((sum, s) => sum + s.points, 0);
    const topScoreVotes = freshScores.filter((s) => s.points === 3).length;
    const laughTriggered = topScoreVotes > Math.floor(eligibleJudges.length / 2);

    // 確定 UPDATE の直前でもう一度凍結を確認する（P2：多層防御）。
    if (progressFrozenForTick(tickGeneration, tickLiveId, true)) return;
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
          markPending: () => useLiveHostStore.setState({ liveSnapshotConfirmed: false }),
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
      // この回答が確定したので、表示中の回答は次へ移る。進行中の古いscores取得を
      // 無効化し、scoresSnapshotも未確認へ落とす（次の表示中回答で取り直す）。
      scoresGate.begin();
      useLiveHostStore.setState((s) => ({
        answers: answersStillCurrent && answersResult.ok ? answersResult.data : s.answers,
        answersSnapshot:
          answersStillCurrent && answersResult.ok
            ? { liveId: resolveLiveId, turnId: resolveTurnId }
            : s.answersSnapshot,
        scores: [],
        scoresSnapshot: null,
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
async function syncAnsweringPause(tickGeneration: number, tickLiveId: string | null) {
  const state = useLiveHostStore.getState();
  const { live } = state;
  if (!live || live.current_phase !== "answering") return;

  // 2026-09-10/13（再レビュー対応）：live/children/現在ターンのanswers が確認済みで
  // 進行環境も確立済みのときだけ pause/resume 更新へ進む（未確認の間に空/古い
  // state.answersを見て「busyでない」と誤判定して回答時間を再開しない。多層防御）。
  if (progressFrozenForTick(tickGeneration, tickLiveId, true)) return;
  if (!answersSnapshotMatches(state.answersSnapshot, live.id, live.current_turn_id)) return;

  const busy = isAnsweringBusy(state.answers, live);

  if (busy && !live.answering_paused) {
    const remaining = live.phase_deadline
      ? new Date(live.phase_deadline).getTime() - Date.now()
      : 0;
    // pause UPDATE の直前でもう一度確認する（P2：多層防御）。
    if (progressFrozenForTick(tickGeneration, tickLiveId, true)) return;
    await updateLive(live.id, {
      answering_paused: true,
      answering_remaining_ms: Math.max(0, remaining),
      phase_deadline: null,
    });
    return;
  }

  if (!busy && live.answering_paused) {
    const remaining = live.answering_remaining_ms ?? 0;
    // resume UPDATE の直前でもう一度確認する（P2：多層防御）。
    if (progressFrozenForTick(tickGeneration, tickLiveId, true)) return;
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
async function runBotBehavior(tickGeneration: number, tickLiveId: string | null) {
  const state = useLiveHostStore.getState();
  const { live, turns, participants, answers, scores } = state;
  if (!live || live.current_phase !== "answering" || !live.current_turn_id) return;
  const turn = turns.find((t) => t.id === live.current_turn_id);
  if (!turn) return;

  // 2026-09-13（再レビュー対応・P2）：live/children/answers が同期中／進行環境が
  // 未確立なら、ボット回答も採点も行わない（古いstateだけを根拠にDB書き込みを
  // 開始しない）。
  if (progressFrozenForTick(tickGeneration, tickLiveId, true)) return;

  const bots = useLiveBotStore.getState().bots;
  const now = Date.now();
  const activeAnswer = answers.find((a) => a.revealed_at && !a.resolved);
  // scores同期中（表示中の回答のscoresSnapshotが未確認）は、古いscoresを根拠に
  // ボット採点しない。active answerに一致するscoresSnapshotが確認済みのときだけ許可。
  const botScoringOk = botScoringAllowed(
    false,
    state.scoresSnapshot,
    live.id,
    live.current_turn_id,
    activeAnswer?.id ?? null,
  );
  const stillOnThisTurn = () =>
    insertGuardPasses({
      frozen: () => progressFrozenForTick(tickGeneration, tickLiveId, true),
      currentLiveId: () => useLiveHostStore.getState().live?.id ?? null,
      currentTurnId: () => useLiveHostStore.getState().live?.current_turn_id ?? null,
      expectedLiveId: live.id,
      expectedTurnId: turn.id,
    });
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
        // insert 直前に、凍結していない かつ await 前と同じ live.id / current_turn_id
        // のままであることを再確認する（P2：Promise.all 内で stop / ターン変更が
        // 起きたら insert しない）。
        if (!stillOnThisTurn()) return;
        const { error } = await bot.client.from("answers").insert({
          turn_id: turn.id,
          participant_id: bot.participantId,
          seq: myAnswerCount + 1,
          body: randomBotAnswerBody(),
        });
        if (!error) {
          botCooldownUntil.set(bot.participantId, now + randomDelay(3_000, 9_000));
        }
      } else if (activeAnswer && botScoringOk) {
        // 客席のボット：表示中の回答にまだ採点していなければ低確率で採点する。
        const alreadyScored = scores.some((s) => s.judge_participant_id === bot.participantId);
        if (alreadyScored) return;
        if (Math.random() >= 0.2) return;
        if (!answerPerfectRoundIds.has(activeAnswer.id)) {
          answerPerfectRoundIds.set(activeAnswer.id, Math.random() < 0.8);
        }
        const isPerfectRound = answerPerfectRoundIds.get(activeAnswer.id) ?? false;
        // insert 直前の再確認（P2）：凍結していない・同じ live/turn・表示中の回答が
        // 今も activeAnswer のまま・その scoresSnapshot が確認済み。
        if (!stillOnThisTurn()) return;
        const sNow = useLiveHostStore.getState();
        if (!sNow.answers.some((a) => a.id === activeAnswer.id && a.revealed_at && !a.resolved)) {
          return;
        }
        if (
          !scoresSnapshotMatches(sNow.scoresSnapshot, live.id, turn.id, activeAnswer.id)
        ) {
          return;
        }
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

type HydrateOutcome =
  | "stopped"
  | "superseded"
  | "live-unconfirmed"
  | "partial"
  | "no-live"
  | "live-ready";

// 2026-09-12/13（再レビュー対応・P1-1）：init()本体・初回失敗後のretry・未初期化
// 状態での手動refresh で共通して使う「進行中ライブの取得 → 存在すれば
// children/answers/resolved/scoresの取得・Realtime購読・answeringローカルタイマーの
// 復元まで」の一連の処理。liveの再取得成功だけを「完全復旧」と扱わず、通常のinit
// 成功時と同じ後処理まで完了させ、完全readyを runtimeReadyLiveId に記録する。
// 復旧途中でstopHostProgressされた（progressGeneration変化・所有権喪失）／別ライブへ
// 切り替わった場合は state/timer/channel を一切作らず戻る。live確定後の順序と
// 各awaitの後の再確認は liveHostSnapshots.ts の hydrateAfterLive へ分離している。
// recoveryToken：createRecoveryCoordinator が発行する所有権トークン。
async function hydrateHostForActiveLive(
  generation: number,
  recoveryToken: number,
): Promise<HydrateOutcome> {
  const stopped = () => generation !== progressGeneration || !recovery.owns(recoveryToken);
  const set = useLiveHostStore.setState;
  const get = useLiveHostStore.getState;

  // target-changed（取得中に別ライブへ切り替わった）ときは、新しいliveIdで
  // やり直す。無限ループを避けるため回数を制限し、超えたら次tickのretryへ委ねる。
  for (let attempt = 0; attempt < 3; attempt++) {
    const liveOutcome = await loadSnapshotSlice<LiveRow | null>({
      gate: liveGate,
      fetch: () => fetchActiveLive(),
      // fetchActiveLive は「今この瞬間の進行中ライブ」を発見する取得なので、対象liveIdは
      // 事前に決まっていない。ただし取得完了時に stop / 所有権喪失していたら反映しない。
      stillCurrent: () => !stopped(),
      markPending: () => set({ liveSnapshotConfirmed: false }),
      applyFresh: (row) => set({ live: row ?? null, liveSnapshotConfirmed: true }),
      markUnconfirmed: () => set({ liveSnapshotConfirmed: false }),
    });
    if (stopped()) return "stopped";
    // superseded：別の取得（Realtime起点・別のcreateLivePreparation等）に責任を委ねる。
    // 無条件にready扱いはしない（runtimeReadyLiveIdを立てない＝凍結して再試行）。
    if (liveOutcome === "superseded" || liveOutcome === "target-changed") return "superseded";
    if (liveOutcome === "unconfirmed") return "live-unconfirmed";

    const live = get().live;
    if (!live) {
      // 進行中ライブが無いことを正常取得できた：ライブ無しの確認済み状態にする。
      runtimeReadyLiveId = null;
      set({
        live: null,
        loading: false,
        liveSnapshotConfirmed: true,
        childrenSnapshotLiveId: null,
        answersSnapshot: null,
        scoresSnapshot: null,
        lastRefreshedAt: new Date().toISOString(),
        error: null,
      });
      return "no-live";
    }

    const targetLiveId = live.id;
    const turnId = live.current_turn_id;

    const result = await hydrateAfterLive({
      startGeneration: generation,
      currentGeneration: () => progressGeneration,
      targetLiveId,
      currentLiveId: () => get().live?.id ?? null,
      ownsRecovery: () => recovery.owns(recoveryToken),
      loadChildren: () =>
        loadSnapshotSlice<ChildrenPayload>({
          gate: childrenGate,
          fetch: () => fetchChildrenWithProfiles(targetLiveId),
          stillCurrent: () => get().live?.id === targetLiveId,
          markPending: () => set({ childrenSnapshotLiveId: null }),
          applyFresh: ({ profiles, ...children }) =>
            set({ ...children, profiles, childrenSnapshotLiveId: targetLiveId }),
          markUnconfirmed: () => set({ childrenSnapshotLiveId: null }),
        }),
      loadAnswers: () => {
        if (!turnId) {
          answersGate.begin();
          scoresGate.begin();
          set({ answers: [], scores: [], answersSnapshot: null, scoresSnapshot: null });
          return Promise.resolve<SliceLoadOutcome>("applied");
        }
        return loadSnapshotSlice<AnswerRow[]>({
          gate: answersGate,
          fetch: () => fetchAnswersForTurn(turnId),
          stillCurrent: () => {
            const s = get();
            return s.live?.id === targetLiveId && s.live?.current_turn_id === turnId;
          },
          markPending: () => set({ answersSnapshot: null }),
          applyFresh: (data) => {
            scoresGate.begin();
            set({
              answers: data,
              scores: [],
              answersSnapshot: { liveId: targetLiveId, turnId },
              scoresSnapshot: null,
            });
          },
          markUnconfirmed: () => set({ answersSnapshot: null }),
        });
      },
      loadResolved: () =>
        loadSnapshotSlice<ResolvedPayload>({
          gate: resolvedGate,
          fetch: () => fetchResolvedWithScores(targetLiveId),
          stillCurrent: () => get().live?.id === targetLiveId,
          applyFresh: ({ resolvedAnswers, resolvedScoresByAnswer }) =>
            set({ resolvedAnswers, resolvedScoresByAnswer }),
          markUnconfirmed: () => {}, // 表示は維持。ログ用なので進行は止めない
        }),
      loadScores: () => refreshScoresForActiveAnswer(),
      restoreAnsweringTimer: () => {
        const l = get().live;
        if (l && l.id === targetLiveId && l.current_phase === "answering") {
          answeringRemainingMsTrue = l.answering_paused
            ? (l.answering_remaining_ms ?? 0)
            : l.phase_deadline
              ? Math.max(0, new Date(l.phase_deadline).getTime() - Date.now())
              : null;
          lastAnsweringTickAt = Date.now();
        } else if (l && l.id === targetLiveId) {
          answeringRemainingMsTrue = null;
          lastAnsweringTickAt = null;
        }
        // l が targetLiveId でない（別ライブへ切り替わった）ときは触らない
        // ＝ hydrateAfterLive 側が target-changed で中断する。
      },
      finishLoading: (anyUnconfirmed) =>
        set({
          loading: false,
          lastRefreshedAt: new Date().toISOString(),
          error: anyUnconfirmed
            ? "一部の情報を取得できませんでした。しばらくすると自動的に再試行します。"
            : null,
        }),
      subscribeAndWait: () =>
        // 必須チャンネルが実際に SUBSCRIBED になるまで待つ。待機中の stop /
        // 進行世代変更 / 対象liveId変更 / 購読世代の入れ替わり を検知して中断する。
        subscribeAndWaitForLive(
          targetLiveId,
          () =>
            generation !== progressGeneration ||
            !recovery.owns(recoveryToken) ||
            get().live?.id !== targetLiveId,
        ),
      markRuntimeReady: () => {
        // 全必須チャンネル SUBSCRIBED 確認後にだけ hydrateAfterLive から呼ばれる。
        runtimeReadyLiveId = targetLiveId;
      },
    });

    if (result === "target-changed") {
      if (stopped()) return "stopped";
      continue; // 新しいliveIdで完全復旧をやり直す
    }
    if (result === "stopped") return "stopped";
    return result === "ready" ? "live-ready" : "partial";
  }
  // 3回試しても対象が定まらない：次tickのretry/ensureHostRecoveryへ委ねる。
  return "superseded";
}

// init / 初回失敗後のretry / 未初期化状態の手動refresh を1本化する入口。
// 同一世代の完全復旧が進行中なら、その Promise へ合流する（中途半端に superseded で
// 終わらせない）。
function ensureHostRecovery(generation: number): Promise<HostHydrationOutcome> {
  return recovery.run(generation, (gen, token) =>
    hydrateHostForActiveLive(gen, token).then(mapHydrateToHydration),
  );
}

// hydrateHostForActiveLive の詳細な結果を、コーディネータが扱う粗い結果へ写像する。
function mapHydrateToHydration(o: HydrateOutcome): HostHydrationOutcome {
  if (o === "stopped" || o === "superseded") return "stopped";
  if (o === "live-ready" || o === "no-live") return "ready";
  return "not-ready"; // live-unconfirmed / partial
}

// 司会進行環境が「現在のlive.idについて完全に確立済みか」。
// liveSnapshotConfirmed（live行を取得できた）だけでは不十分。
// - tickTimer が動いている
// - subscribedLiveId === live.id：進行に必要な全 Realtime チャンネルが実際に
//   SUBSCRIBED になった（onChannelStatus が集約。CHANNEL_ERROR 等でクリアされる）
// - runtimeReadyLiveId === live.id：hydrate が SUBSCRIBED 待ちまで完了して確立を記録
// - answering なら ローカル残り時間を復元済み
// のすべてが揃って初めて true。false の間、advanceIfDue は完全復旧
// （ensureHostRecovery、2秒throttle）へ合流し、自動進行を凍結する。
function isHostRuntimeEstablished(live: LiveRow): boolean {
  if (tickTimer === null) return false;
  if (subscribedLiveId !== live.id) return false;
  if (runtimeReadyLiveId !== live.id) return false;
  if (live.current_phase === "answering" && lastAnsweringTickAt === null) return false;
  return true;
}

// 2026-09-11/12（再レビュー対応）：未確認スライスの読み取り再試行。tickは500msだが
// single-flight＋最小間隔(SNAPSHOT_RETRY_INTERVAL_MS)で過剰アクセスを防ぐ。
// finallyでのフラグ解除は「開始時の世代が今も現行のときだけ」に限定する
// （shouldReleaseRetryFlag：stop前の古いretryがstop後の新しいretryのフラグを
// 解除しないため）。いずれも取得成功時のみ確認済みへ戻す。
function retryLiveSnapshot() {
  // init()が全体を再初期化中なら、二重に完全復旧を走らせない（init側が担う）。
  if (initInFlight) return;
  if (!shouldRetryNow(liveRetryInFlight, liveRetryAt, Date.now(), SNAPSHOT_RETRY_INTERVAL_MS)) return;
  const myGeneration = progressGeneration;
  const s = useLiveHostStore.getState();
  const live = s.live;

  // 司会進行環境が既に確立済み（購読・タイマー復元済み）で、単に lives 行が一時的に
  // 未確認になっただけ（Realtime変更検知のmarkPending・0行更新後の再取得中など）
  // なら、lives 行だけを軽量に取り直す（毎回 channel を張り直さない）。
  if (live && subscribedLiveId === live.id && runtimeReadyLiveId === live.id) {
    liveRetryInFlight = true;
    liveRetryAt = Date.now();
    void loadSnapshotSlice<LiveRow | null>({
      gate: liveGate,
      fetch: () => fetchLiveRow(live.id),
      stillCurrent: () => useLiveHostStore.getState().live?.id === live.id,
      markPending: () => {}, // 既に未確認
      applyFresh: (row) => {
        if (row) useLiveHostStore.setState({ live: row, liveSnapshotConfirmed: true });
      },
      markUnconfirmed: () => {},
    })
      .catch((e) => console.warn("[useLiveHostStore] ライブ状態の再取得に失敗", e))
      .finally(() => {
        if (shouldReleaseRetryFlag(progressGeneration, myGeneration)) liveRetryInFlight = false;
      });
    return;
  }

  // 未初期化 / 完全復旧が必要（購読やタイマー復元がまだ）→ 完全復旧オーケストレーション
  // へ合流する（liveの再取得成功だけでは「完全復旧」と扱わない）。
  liveRetryInFlight = true;
  liveRetryAt = Date.now();
  void ensureHostRecovery(myGeneration)
    .catch((e) => console.warn("[useLiveHostStore] 司会進行環境の再確立に失敗", e))
    .finally(() => {
      if (shouldReleaseRetryFlag(progressGeneration, myGeneration)) liveRetryInFlight = false;
    });
}

function retryChildrenSnapshot(liveId: string) {
  if (!shouldRetryNow(childrenRetryInFlight, childrenRetryAt, Date.now(), SNAPSHOT_RETRY_INTERVAL_MS)) {
    return;
  }
  const myGeneration = progressGeneration;
  childrenRetryInFlight = true;
  childrenRetryAt = Date.now();
  void loadSnapshotSlice<ChildrenPayload>({
    gate: childrenGate,
    fetch: () => fetchChildrenWithProfiles(liveId),
    stillCurrent: () => useLiveHostStore.getState().live?.id === liveId,
    markPending: () => useLiveHostStore.setState({ childrenSnapshotLiveId: null }),
    applyFresh: ({ profiles, ...children }) =>
      useLiveHostStore.setState({ ...children, profiles, childrenSnapshotLiveId: liveId }),
    markUnconfirmed: () => useLiveHostStore.setState({ childrenSnapshotLiveId: null }),
  })
    .catch((e) => console.warn("[useLiveHostStore] 組・ターン情報の再取得に失敗", e))
    .finally(() => {
      if (shouldReleaseRetryFlag(progressGeneration, myGeneration)) childrenRetryInFlight = false;
    });
}

function retryAnswersSnapshot(turnId: string | null) {
  if (!turnId) return;
  if (!shouldRetryNow(answersRetryInFlight, answersRetryAt, Date.now(), SNAPSHOT_RETRY_INTERVAL_MS)) {
    return;
  }
  const myGeneration = progressGeneration;
  answersRetryInFlight = true;
  answersRetryAt = Date.now();
  void refreshAnswersForTurn(turnId)
    .catch((e) => console.warn("[useLiveHostStore] 現在ターンのanswers再取得に失敗", e))
    .finally(() => {
      if (shouldReleaseRetryFlag(progressGeneration, myGeneration)) answersRetryInFlight = false;
    });
}

function retryScoresSnapshot() {
  if (!shouldRetryNow(scoresRetryInFlight, scoresRetryAt, Date.now(), SNAPSHOT_RETRY_INTERVAL_MS)) {
    return;
  }
  const myGeneration = progressGeneration;
  scoresRetryInFlight = true;
  scoresRetryAt = Date.now();
  void refreshScoresForActiveAnswer()
    .catch((e) => console.warn("[useLiveHostStore] 現在の回答のscores再取得に失敗", e))
    .finally(() => {
      if (shouldReleaseRetryFlag(progressGeneration, myGeneration)) scoresRetryInFlight = false;
    });
}

// 2026-09-12/13（再レビュー対応・P2）：advanceIfDue内でawaitをまたいだ後・各自動DB
// 書き込みの直前に、「途中でstopされた（progressGeneration変化）」「再取得が始まって
// スライスが同期中になった」「await前と対象ライブ／ターンが変わった」「司会進行環境が
// 未確立になった」を検出し、古い前提のままDB書き込みを行わないための共通判定。
// tickLiveId：この tick に入った時点の live.id（await をまたいで変わっていないか）。
function progressFrozenForTick(
  tickGeneration: number,
  tickLiveId: string | null,
  requireAnswers: boolean,
): boolean {
  const s = useLiveHostStore.getState();
  const live = s.live;
  return progressionFrozen(
    {
      tickGeneration,
      currentGeneration: progressGeneration,
      liveSnapshotConfirmed: s.liveSnapshotConfirmed,
      liveId: live?.id ?? null,
      tickLiveId,
      runtimeEstablished: live ? isHostRuntimeEstablished(live) : false,
      childrenSnapshotLiveId: s.childrenSnapshotLiveId,
      answersSnapshot: s.answersSnapshot,
      turnId: live?.current_turn_id ?? null,
    },
    requireAnswers,
  );
}

// フェーズ・ターンの自動進行。
async function advanceIfDue() {
  const tickGeneration = progressGeneration;
  const state = useLiveHostStore.getState();
  // 2026-09-11（再レビュー対応・問題3）：lives行の最新状態を確認できない間は
  // 自動進行を凍結し、読み取り再試行だけを行う（表示用の古いliveは残す）。
  if (!state.liveSnapshotConfirmed) {
    retryLiveSnapshot();
    return;
  }
  const { live } = state;
  if (!live) return;
  const tickLiveId = live.id;

  // 2026-09-13（再レビュー対応・P1-1）：lives行はあるが司会進行環境が未確立
  // （Realtime未購読 / answeringタイマー未復元 / runtimeReadyLiveId不一致）なら、
  // 完全復旧オーケストレーションへ合流する。手動refreshが liveGate だけ進めて
  // liveSnapshotConfirmed=true にしただけの状態も、ここで拾って完全復旧させる。
  // retryLiveSnapshot() 経由なので single-flight ＋ 最小間隔2秒で throttle される
  // （毎tickで channel を張り直さない。retryLiveSnapshot 内で
  //  「runtime確立済み＝軽量 fetchLiveRow / 未確立＝ensureHostRecovery」を判定）。
  if (!isHostRuntimeEstablished(live)) {
    retryLiveSnapshot();
    return;
  }

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

    // 2026-09-13（再レビュー対応・P2）：各awaitの「前」に凍結を再確認しながら順に
    // 実行する。processRevealQueueのawait中にRealtime取得が始まってスライスが
    // 未確認になった場合、runBotBehavior以降は実行しない。
    const guarded = await runGuardedSteps(
      () => progressFrozenForTick(tickGeneration, tickLiveId, true),
      [
        { name: "processRevealQueue", run: () => processRevealQueue(tickGeneration, tickLiveId) },
        { name: "runBotBehavior", run: () => runBotBehavior(tickGeneration, tickLiveId) },
        { name: "resolveIfDue", run: () => resolveIfDue(tickGeneration, tickLiveId) },
        { name: "syncAnsweringPause", run: () => syncAnsweringPause(tickGeneration, tickLiveId) },
      ],
    );
    if (guarded.blockedAt !== null) return;

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
    // fetchAnswersForTurnのawaitをまたいだ後の最終確認（P2-1）。
    if (progressFrozenForTick(tickGeneration, tickLiveId, true)) return;
    // 2026-09-09（再レビュー対応）：以前はここでanswringRemainingMsTrue/
    // lastAnsweringTickAtを両方nullへ戻してからDB更新を試みていたが、その後の
    // 更新が通信エラーで失敗すると、次のtickの時点でanswringRemainingMsTrueが
    // nullのため「if (answeringRemainingMsTrue === null || ... > 0) return;」に
    // 引っかかり、二度とこの遷移を試みられなくなっていた（0秒のまま永久停止）。
    // 更新に成功した（＝自分がこの遷移を行った）ことを確認できるまでは0のまま
    // 維持し、次のtickで再試行できるようにする。
    answeringRemainingMsTrue = 0;

    // RPC直前の最終確認（P2-1）：ここまでのawaitの間に同期中/stop/対象変更に
    // なっていたら遷移RPCを撃たない（answeringRemainingMsTrueは0のまま＝次tick再試行）。
    if (progressFrozenForTick(tickGeneration, tickLiveId, true)) return;

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
    if (progressFrozenForTick(tickGeneration, tickLiveId, false)) return; // P2-1
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
    if (progressFrozenForTick(tickGeneration, tickLiveId, false)) return; // P2-1
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
    if (progressFrozenForTick(tickGeneration, tickLiveId, false)) return; // P2-1
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
  scoresSnapshot: null,
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

      // 2026-09-12/13（再レビュー対応・P1-1）：live取得〜children/answers/resolved/
      // scores取得・Realtime購読・answeringローカルタイマー復元までを、初回失敗後の
      // retry・未初期化状態の手動refresh と共通の完全復旧オーケストレーション
      // （ensureHostRecovery＝所有権コーディネータ経由の hydrateHostForActiveLive）
      // に合流させる。進行中の完全復旧があればそれを待つだけ（中途半端に superseded で
      // 終わらせない）。init最後の一括setは無く、各スライスをゲート越しに個別反映する。
      const outcome = await ensureHostRecovery(myGeneration);
      if (stopped() || outcome === "stopped") {
        // stopされた／別の取得に追い越された。ここでcleanupChannels()は呼ばない。
        // progressGenerationが変わるのはstopHostProgress()のときだけで、そこで必ず
        // cleanupChannels()が呼ばれている（このinitがsubscribeLiveChannelsで
        // channelを作っていた場合も回収済み）。
        return;
      }
      if (outcome === "not-ready") {
        // ライブ本体を確認できない／一部スライスが未確認：表示用の古いデータは残し、
        // advanceIfDue が isHostRuntimeEstablished=false を見て自動進行を凍結する。
        // tickTimerは動かし続け、advanceIfDueが一定間隔で ensureHostRecovery を
        // 再実行して完全復旧を試みる（hydrate側で error 文言は設定済みのことも
        // あるが、live取得そのものに失敗した場合はここで明示的に文言を出す）。
        if (!get().live || !get().liveSnapshotConfirmed) {
          set({
            loading: false,
            error: "ライブの状態を取得できませんでした。しばらくすると自動的に再試行します。",
          });
        } else {
          set({ loading: false });
        }
        ensureTickTimer(myGeneration);
        return;
      }
      // "ready"：hydrate側で loading:false・error・lastRefreshedAt・
      // （ライブありなら）購読・タイマー復元・runtimeReadyLiveId まで完了済み。
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
    scoresGate.begin();
    // 2026-09-13（再レビュー対応・P1-1）：完全復旧の所有権トークンを進める。
    // stop 前に開始した完全復旧の ownsRecovery() は false になり、途中で
    // subscribe / タイマー復元 / runtimeReadyLiveId 記録を行わずに戻る。
    recovery.invalidate();
    subscribedLiveId = null;
    runtimeReadyLiveId = null;
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    cleanupChannels();
    initInFlight = null;
    pendingRevealAt = null;
    answeringRemainingMsTrue = null;
    lastAnsweringTickAt = null;
    // progressGeneration を +1 済み。進行中の retry の finally は
    // shouldReleaseRetryFlag(progressGeneration, myGeneration) が false になり、
    // ここで false へ戻したフラグを後から触らない（stop後の新しいretryの所有権を守る）。
    liveRetryInFlight = false;
    liveRetryAt = 0;
    childrenRetryInFlight = false;
    childrenRetryAt = 0;
    answersRetryInFlight = false;
    answersRetryAt = 0;
    scoresRetryInFlight = false;
    scoresRetryAt = 0;
    resolvingAnswerIds.clear();
    botCooldownUntil.clear();
    answerPerfectRoundIds.clear();
    lastBotTsukkomiAt = 0;
    // 2026-09-10/11/12（再レビュー対応）：ログアウト→再ログイン時に、前セッションの
    // スナップショット識別情報を引き継がないよう無効化する（次のinit()が
    // 取得成功して初めて確認済みになる）。liveSnapshotConfirmedもfalseへ。
    set({
      childrenSnapshotLiveId: null,
      answersSnapshot: null,
      scoresSnapshot: null,
      liveSnapshotConfirmed: false,
    });
  },

  // 事故防止・操作性改善：ページ全体をリロードせず、現在表示中のライブ情報一式だけを
  // 再取得する。「最新状態を取得」ボタンから呼ぶ。loadingフラグは変更しない
  // （画面全体を「状態を確認中…」に戻さないため）。tickTimer自体はinit()で既に
  // 動いているので触らない。
  refresh: async () => {
    const live0 = get().live;
    // 2026-09-13（再レビュー対応・P1-1）：未初期化 / 司会進行環境が未確立
    // （購読・タイマー復元がまだ）の状態で「最新状態を取得」が押された場合、
    // ここで liveGate だけ進めて hydrate を superseded で中途終了させると、
    // 購読もタイマー復元もされないまま liveSnapshotConfirmed=true になり放置される。
    // その場合は完全復旧オーケストレーションへ「合流」する（進行中があればその
    // Promise を待つ。無ければ開始する）。
    if (!live0 || !get().liveSnapshotConfirmed || !isHostRuntimeEstablished(live0)) {
      const outcome = await ensureHostRecovery(progressGeneration);
      ensureTickTimer(progressGeneration);
      if (outcome === "ready") return { ok: true };
      if (outcome === "not-ready") {
        return {
          ok: false,
          reason: "最新状態の取得に失敗しました。しばらくすると自動的に再試行します。",
        };
      }
      // "stopped"：別セッション／stop に委譲済み。次tickのretryが追いつく。
      return { ok: false, reason: "最新状態を再取得しています。しばらくお待ちください。" };
    }
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
        // 2026-09-12（再レビュー対応・P2-1）：手動refreshも「最新を取り直し始めた」
        // 時点で確認状態を未確認へ落とす（表示は維持）。取得成功で確認済みへ戻る。
        markPending: () => set({ liveSnapshotConfirmed: false }),
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
        set({
          childrenSnapshotLiveId: null,
          answersSnapshot: null,
          scoresSnapshot: null,
          lastRefreshedAt: new Date().toISOString(),
        });
        return { ok: true };
      }

      // --- children スライス ---
      const childrenOutcome = await loadSnapshotSlice<ChildrenPayload>({
        gate: childrenGate,
        fetch: () => fetchChildrenWithProfiles(liveId),
        stillCurrent: () => get().live?.id === liveId,
        markPending: () => set({ childrenSnapshotLiveId: null }),
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
          markPending: () => set({ answersSnapshot: null }),
          applyFresh: (data) => {
            scoresGate.begin();
            set({ answers: data, scores: [], answersSnapshot: { liveId, turnId }, scoresSnapshot: null });
          },
          markUnconfirmed: () => set({ answersSnapshot: null }),
        });
      } else {
        answersGate.begin();
        scoresGate.begin();
        set({ answers: [], scores: [], answersSnapshot: null, scoresSnapshot: null });
      }

      // --- scores スライス（現在表示中の回答があればその採点一覧）---
      const scoresOutcome = await refreshScoresForActiveAnswer();

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
        scoresOutcome === "unconfirmed" ||
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
      childrenGate.begin();
      answersGate.begin();
      scoresGate.begin();
      // children はまだ取得していない＝runtimeReadyLiveId は立てない
      // （advanceIfDue が isHostRuntimeEstablished=false を見て完全復旧へ合流する）。
      runtimeReadyLiveId = null;
      set({
        live: existing,
        liveSnapshotConfirmed: true,
        childrenSnapshotLiveId: null,
        answersSnapshot: null,
        scoresSnapshot: null,
      });
      // channel を用意しておく（onChannelStatus が全必須 SUBSCRIBED を確認したら
      // subscribedLiveId を設定。runtimeReadyLiveId は完全復旧フローが確立する）。
      subscribeLiveChannels(existing.id);
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
    scoresGate.begin();
    runtimeReadyLiveId = null;
    set({
      childrenSnapshotLiveId: null,
      answersSnapshot: null,
      scoresSnapshot: null,
      liveSnapshotConfirmed: false,
    });

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
      scoresSnapshot: null,
      profiles,
      error: childrenResult.ok
        ? null
        : "作成後の組・お題情報を取得できませんでした。しばらくすると自動的に再試行します。",
    });
    // channel を用意する。subscribedLiveId は onChannelStatus が全必須 SUBSCRIBED を
    // 確認したときに、runtimeReadyLiveId は完全復旧フロー（SUBSCRIBED待ち込み）が
    // 確立する。ここでは立てない（.subscribe() 直後＝接続完了ではないため）。
    subscribeLiveChannels(live.id);
    runtimeReadyLiveId = null;
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
    scoresGate.begin();
    set({ childrenSnapshotLiveId: null, answersSnapshot: null, scoresSnapshot: null });

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
      liveGate.begin();
      childrenGate.begin();
      answersGate.begin();
      scoresGate.begin();
      runtimeReadyLiveId = null;
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
        scoresSnapshot: null,
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
    liveGate.begin();
    childrenGate.begin();
    answersGate.begin();
    scoresGate.begin();
    runtimeReadyLiveId = null;
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
      scoresSnapshot: null,
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
