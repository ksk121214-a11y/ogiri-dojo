// 実バックエンド版ライブ（フェーズB）の参加者（司会以外）用ストア。
// 参加登録・現在のターン/お題/表示中の回答の購読・回答送信・採点送信・
// 組結果発表/最終結果発表のランキング集計までを扱う。
import { create } from "zustand";

import { MAX_ANSWER_BODY_LENGTH } from "@/data/liveRoomTiming";
import { resolveAnsweringCue, type AnsweringCueSnapshot } from "@/lib/answeringCue";
import {
  buildChannelTopic,
  createChannelSwapController,
  type ChannelSwapSpawnArgs,
} from "@/lib/liveHostSnapshots";
import {
  getBestAnswer,
  getGroupTurnRanking,
  getOverallRanking,
  sortParticipantsBySeat,
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
  // 0068：live_tsukkomi_events.id（uuid）をそのまま使う。以前はクライアント側の
  // 通し番号(number)を独自に振っていたが、DBのidを使うことで重複受信の判定
  // （processedTsukkomiIds）や到着順の保持が正確に行えるようにする。
  id: string;
  kind: "clap" | "stamp";
  text: string;
}

// 0068：待機キュー内で保持する形（受信時刻を持たせ、3秒以上経過した古いイベントを
// 表示せず破棄する判定に使う）。
interface QueuedTsukkomiEvent extends TsukkomiEvent {
  receivedAt: number;
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
  // 2026-09-08（P1-8/9セキュリティレビュー対応）：未発表answersが本人以外に
  // 返らなくなった（answers RLSの変更）ことで、他端末は「誰の回答席を光らせるか」
  // 「送信ボタンを即座にロックすべきか」をturnAnswersから計算できなくなった。
  // 回答本文を一切含まない専用テーブル(answering_cues、DBトリガーで自動更新)を
  // 見て、この2値だけを演出に使う（詳細はsupabase/migrations/0063参照）。
  // 2026-09-08（再レビュー2回目対応）：fetchAnsweringCue()による再取得と
  // Realtimeイベント受信の2経路が同じstateを個別に更新するため、新旧逆転
  // （古い方が後から届いて上書きする）が起こり得た。liveId・revisionを保持し、
  // 反映は必ずsrc/lib/answeringCue.tsのresolveAnsweringCue経由で行う。
  pendingCue: AnsweringCueSnapshot | null;
  activeAnswerScores: ScoreRow[]; // 表示中の回答についた採点全員分（採点ボードの玉演出用）
  myAnswerCount: number;
  myScore: number | null;
  groupResult: GroupResultData | null;
  finalResult: FinalResultData | null;
  // 0068：単一のlastTsukkomi(1件だけ保持して上書きする方式)から、キュー(配列)方式に
  // 変更した。10〜20人がほぼ同時に押しても、各参加者ぶんのイベントを1件ずつ
  // 積んで表示できるようにするため（詳細はsrc/lib/liveReactionQueue.ts参照）。
  tsukkomiQueue: QueuedTsukkomiEvent[];
  laughEventSeq: number; // 誰かの回答が笑いエフェクト付きで確定するたびに増える通し番号
  // 2026-09-03:「回答者としてリロードすると観客画面になる」不具合の根本対策で意味を
  // 厳密化した。loading===trueの間は、live/participants/myParticipant/currentTurn/
  // currentTopicの取得が「auth確定→live確定→participants/myParticipant確定→
  // currentTurn/currentTopic確定」の順で一度も揃って成功しておらず、舞台/観客のどちらの
  // 画面を出すべきかまだ判定できない状態を表す（呼び出し元のLivePage側は、loading中は
  // 判定を一切行わず「復元中」を表示すること）。一度trueからfalseになった後は、
  // 以降の背景更新が一時的に失敗しても（syncError参照）falseに保たれ続け、
  // 既に確定済みの表示を勝手に観客画面などへ後退させない。
  loading: boolean;
  // 直近の取得試行が失敗した理由（表示用）。nullなら直近の取得は成功している。
  // loadingがtrueのままsyncErrorが立っている＝初回同期に失敗して自動再試行中。
  // loadingがfalse（一度は成功済み）でsyncErrorが立っている＝背景更新が一時的に
  // 失敗しているだけで、画面は直前の正常な状態を保ったまま裏で再試行している。
  syncError: string | null;
  error: string | null;

  subscribe: () => () => void;
  // syncErrorが出ている時に画面から手動で今すぐ再試行するためのアクション
  // （自動再試行の間隔を待たずに済むように用意する）。
  retrySync: () => void;
  joinLive: (preferredRole: ParticipantRole, referralSource?: string | null) => Promise<void>;
  submitMyAnswer: (body: string) => Promise<{ ok: boolean; reason?: string }>;
  // 2026-09-06:「採点を連打・同時押しするとDBの生エラーが赤字表示される」不具合対応。
  // 二重投票（一意制約違反）・RLS拒否（表示前/確定後/締切後の採点等、想定内の
  // サーバー側拒否）は、silent:trueを返して呼び出し元に何も表示させない。
  // reasonはsilent:falseの場合のみ意味を持ち、常に日本語の一般的な文言（生のPostgres/
  // Supabaseのerror.messageではない）。
  submitMyScore: (
    points: 0 | 1 | 2 | 3,
  ) => Promise<{ ok: true } | { ok: false; silent: boolean; reason?: string }>;
  sendTsukkomi: (kind: "clap" | "stamp", text: string) => void;
  // 0068追加：ツッコミ/拍手/爆笑の表示演出（src/lib/liveReactionQueue.tsの
  // useTsukkomiReactionQueueフック）が、待機キューから自分が担当する種別の
  // イベントを1件だけ取り出す。受信から3秒以上経過したイベントは表示せず
  // 破棄する（predicateに関わらず、スキャンの過程で見つかった時点で捨てる）。
  // この呼び出し・待機キューはライブ進行のstateと完全に独立しており、演出側の
  // 遅延・例外がフェーズ進行・回答受付・採点に影響することはない。
  claimReactionEvent: (predicate: (event: TsukkomiEvent) => boolean) => TsukkomiEvent | null;
}

// 2026-09-15（レビュー対応）：観客側の Realtime 購読はすべて Postgres Changes。
// - 以前は固定 topic 名（"follower-lives" 等、ツッコミは "follower-tsukkomi"）で
//   毎 subscribe に removeChannel を待たず再作成しており、削除中(leaving)の
//   古いインスタンスが再利用される・古い cleanup が新しい購読を消す、といった
//   競合があった。さらに "follower-tsukkomi" はホスト側の Broadcast 送信用 topic と
//   衝突しうる固定名だった。
// - createChannelSwapController で購読世代を発行し、全 topic を
//   `follower-<kind>-g<gen>` の世代固有名にする（固定 topic 名へ一切依存しない）。
//   live_tsukkomi_events など各テーブルの Postgres Changes は従来どおり受信する。
// - subscribe() が返す cleanup は所有権付き（swap 結果の dispose）：自分の世代の
//   チャンネルだけ除去し、新しい subscribe に追い越されていたら最新世代を触らない。
const FOLLOWER_CHANNEL_KINDS = [
  "lives",
  "participants",
  "answers",
  "scores",
  "tsukkomi",
  "answering-cue",
] as const;
const followerChannelSwap = createChannelSwapController<ReturnType<typeof supabase.channel>>({
  kinds: [...FOLLOWER_CHANNEL_KINDS],
  // 観客側はテーブル全体を購読し liveId で絞らないため scope は付けない。
  topicFor: (kind, _liveId, gen) => buildChannelTopic("follower", kind, gen),
  remove: (ch) => supabase.removeChannel(ch),
});
// retrySyncアクションから、subscribe()内で今動いているrefetchAllを直接叩けるようにする
// ための参照（subscribe()のクリーンアップでnullに戻す）。
let currentRefetchAllRef: (() => void) | null = null;
// ツッコミ・爆笑・拍手ボタンの連打制限（1秒に1回まで）。ボタン自体の見た目は
// 変えず、裏で黙って間引く。ボタンはUIから常にsendTsukkomiを直接呼ぶだけなので、
// ここ1箇所でガードすれば全ボタンに効く（0066のDB側レート制限とは別の、UX目的の
// 間引き。変更しない）。
const TSUKKOMI_COOLDOWN_MS = 1_000;
let lastTsukkomiSentAt = 0;

// 0068追加：ツッコミ/拍手/爆笑イベントのキュー方式への変更（過負荷対策込み）。
// - TSUKKOMI_QUEUE_MAX：待機キューの最大件数。これを超えたら、ライブ進行
//   （回答・採点・フェーズ遷移等の本来の機能）を優先し、古いイベントから破棄する。
// - TSUKKOMI_STALE_MS：受信からこの時間以上経過した待機中のイベントは、
//   表示せずに破棄する（古いリアクションとして扱う。基準はクライアント側で
//   キューに積んだ時刻）。
// - TSUKKOMI_PROCESSED_ID_CACHE_MAX：重複UUID判定用に保持するidの最大件数。
//   無限に増え続けないよう、古いものから捨てる（Setは挿入順を保持するため、
//   先頭＝最も古いものをvalues().next()で取り出せる）。
export const TSUKKOMI_QUEUE_MAX = 30;
export const TSUKKOMI_STALE_MS = 3_000;
export const TSUKKOMI_PROCESSED_ID_CACHE_MAX = 200;
let processedTsukkomiIds = new Set<string>();

// 0068追加：ライブ変更・退出・購読解除・再購読（subscribe()のcleanup/世代交代）の
// たびに、前のライブの待機キューと処理済みIDセットをリセットする。リロード・
// 再接続時に過去のリアクションをまとめて再生しないための対策でもある
// （新しいsubscribe世代は必ず空のキューから始まる）。
export function resetTsukkomiReactionQueue(): void {
  processedTsukkomiIds = new Set<string>();
  useLiveFollowerStore.setState({ tsukkomiQueue: [] });
}

// 0068追加：Realtimeで受信したツッコミ/拍手/爆笑イベントを待機キューへ積む。
// テスト（src/lib/__tests__/store/useLiveFollowerStoreReactionQueue.check.ts）から
// 本番と同じ実装をそのまま呼び出して検証できるようexportする。
export function enqueueTsukkomiEvent(
  id: string,
  kind: "clap" | "stamp",
  text: string,
  now: number = Date.now(),
): void {
  // 同じUUIDを重複受信しても一度だけ処理する。
  if (processedTsukkomiIds.has(id)) return;
  processedTsukkomiIds.add(id);
  if (processedTsukkomiIds.size > TSUKKOMI_PROCESSED_ID_CACHE_MAX) {
    const oldest = processedTsukkomiIds.values().next().value;
    if (oldest !== undefined) processedTsukkomiIds.delete(oldest);
  }
  useLiveFollowerStore.setState((s) => {
    const next = [...s.tsukkomiQueue, { id, kind, text, receivedAt: now }];
    if (next.length > TSUKKOMI_QUEUE_MAX) {
      // 待機キューの上限を超えた分は、古いイベントから破棄する
      // （ライブ本来の進行を優先し、リアクション表示だけが無限に積み上がらないようにする）。
      next.splice(0, next.length - TSUKKOMI_QUEUE_MAX);
    }
    return { tsukkomiQueue: next };
  });
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

// 2026-09-03:「Supabase取得エラーを空配列として上書きしない」対応。以前は
// エラーを確認せず、失敗時も黙って空配列を返していた（呼び出し元がそれを
// そのままgroupsに反映すると、一時的な通信失敗でgroups=[]になってしまう）。
async function fetchGroupsForLive(liveId: string): Promise<{ ok: boolean; data: GroupRow[] }> {
  const { data, error } = await supabase.from("groups").select("*").eq("live_id", liveId);
  if (error) {
    console.warn("[live] groups取得に失敗", error);
    return { ok: false, data: [] };
  }
  return { ok: true, data: (data ?? []) as GroupRow[] };
}

// 組結果・最終結果で他人の表示名を出すための安全な経路（生のprofilesは自分の行しか読めないため）。
// 2026-08-29: 表示名と同じ経路でavatar_icon/avatar_colorも取得するようにした
// （participant_display_names RPC自体を拡張、詳しくはsupabase/migrations/0015参照）。
// 2026-08-30:「採点確定のたびにボット全員のアイコンがランダムに変わって見える」不具合の
// 原因調査で判明した点：このRPCが一時的なエラーでdata==nullを返しても、これまでは
// エラーを無視して空のnames/avatarsをそのまま返していた。呼び出し元(refetchAll)がその
// 空の結果でparticipantAvatarsを丸ごと上書きすると、その間だけ全参加者の表示が
// participant_idベースの決定的ハッシュ（本来の絵柄・色とは無関係な値）にフォールバック
// してしまい、「アイコンが変わった」ように見えていた。ok:falseの場合は呼び出し元で
// 既存の値を保持させ、空の結果で上書きしないようにする。
async function fetchParticipantProfiles(liveId: string): Promise<{
  ok: boolean;
  names: Record<string, string>;
  avatars: Record<string, ParticipantAvatarInfo>;
}> {
  const { data, error } = await supabase.rpc("participant_display_names", { p_live_id: liveId });
  if (error) {
    console.warn("[live] participant_display_names取得に失敗", error);
    return { ok: false, names: {}, avatars: {} };
  }
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
  return { ok: true, names, avatars };
}

// 2026-09-03:「最終結果を一時的な全員0点で上書きしない」対応。以前はエラーを
// 確認せず、失敗時も黙って空配列を返していた。呼び出し元(refreshFinalResult)が
// それをそのまま集計すると、通信が一瞬失敗しただけで「全員0点」の最終結果に
// 見えてしまう（実機ライブで発覚した「全員0点なのに1位に100点」と同種の症状を
// 再現しうる経路）。
async function fetchResolvedAnswersForLive(
  liveId: string,
): Promise<{ ok: boolean; data: AnswerRow[] }> {
  const { data, error } = await supabase
    .from("answers")
    .select("*")
    .eq("live_id", liveId)
    .eq("resolved", true)
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[live] resolved answers取得に失敗", error);
    return { ok: false, data: [] };
  }
  return { ok: true, data: (data ?? []) as AnswerRow[] };
}

// 2026-09-03:「回答者としてリロードすると観客画面になる」不具合の根本対策で、
// 取得エラーと「正常に取得できたが行が無い」を区別できるようにした
// （以前はどちらも{turn:null,topic:null}に潰され、呼び出し元がエラー時にも
// 「現在進行中のターンが無い」と誤確定してcurrentTurnをnullで上書きしていた）。
async function fetchTurnAndTopic(
  turnId: string,
): Promise<{ ok: true; turn: TurnRow | null; topic: TopicRow | null } | { ok: false }> {
  const { data: turn, error: turnError } = await supabase
    .from("turns")
    .select("*")
    .eq("id", turnId)
    .maybeSingle();
  if (turnError) {
    console.warn("[live] turns取得に失敗", turnError);
    return { ok: false };
  }
  if (!turn) return { ok: true, turn: null, topic: null };
  const { data: topic, error: topicError } = await supabase
    .from("topics")
    .select("*")
    .eq("id", (turn as TurnRow).topic_id)
    .maybeSingle();
  if (topicError) {
    console.warn("[live] topics取得に失敗", topicError);
    return { ok: false };
  }
  return { ok: true, turn: turn as TurnRow, topic: topic as TopicRow | null };
}

// 2026-09-03:「Supabase取得エラーを空配列として上書きしない」対応。answers/scores
// の取得に失敗した場合はok:falseを返し、呼び出し元(refreshTurnDerived)で
// 既存の正常なstateを維持させる（以前はエラーを確認せず空配列で上書きしていた）。
async function fetchAnswersAndScoreForTurn(
  turnId: string,
  myParticipantId: string | undefined,
): Promise<
  | {
      ok: true;
      answers: AnswerRow[];
      activeAnswer: AnswerRow | null;
      myScore: number | null;
      myAnswerCount: number;
      activeAnswerScores: ScoreRow[];
    }
  | { ok: false }
> {
  const { data: answersData, error: answersError } = await supabase
    .from("answers")
    .select("*")
    .eq("turn_id", turnId);
  if (answersError) {
    console.warn("[live] answers取得に失敗", answersError);
    return { ok: false };
  }
  const rows = (answersData ?? []) as AnswerRow[];
  const activeAnswer = rows.find((a) => a.revealed_at && !a.resolved) ?? null;
  const myAnswerCount = myParticipantId
    ? rows.filter((a) => a.participant_id === myParticipantId).length
    : 0;

  // 2026-09-03:「締切直前の最後の1票が、採点した本人以外の画面ではボールとして
  // 出ない」不具合対策。以前はactiveAnswer(revealedかつ未resolved)がある時にしか
  // scoresを取得しておらず、scoresのINSERT直後にanswers.resolved=trueへの更新を
  // 先に受信してしまった端末では、その時点で既にactiveAnswerがnullになっており、
  // 最後の1票を含んだscoresを一度も取得できないまま終わっていた（確定得点
  // (answers.score_total)自体はホストがDBから直接集計するため必ず正しいが、
  // ボール演出の内訳だけがその端末で欠けて見えていた＝Realtimeイベントの到着順に
  // 結果が左右されていた）。
  // 「今まさに審査中の回答」だけでなく「このターンで直近にrevealedされた回答」
  // （resolved済みでも、弾ける演出がまだ終わっていない可能性がある）を対象にscoresを
  // 取得することで、resolvedになったかどうかに関わらず必ず最終形のscores一覧に
  // 追いつけるようにする。
  const boardTargetAnswer =
    activeAnswer ??
    [...rows]
      .filter((a) => a.revealed_at)
      .sort((a, b) => new Date(b.revealed_at!).getTime() - new Date(a.revealed_at!).getTime())[0] ??
    null;

  // 採点ボードの玉演出は全員分の採点を見る必要がある（自分の分だけでなく）ため、
  // 表示対象の回答についたscores行を丸ごと取得する。myScoreはactiveAnswer（今まさに
  // 審査中で、まだ自分が投票済みかどうかの判定に使う）に限定して拾う。
  let activeAnswerScores: ScoreRow[] = [];
  if (boardTargetAnswer) {
    const { data: scoresData, error: scoresError } = await supabase
      .from("scores")
      .select("*")
      .eq("answer_id", boardTargetAnswer.id);
    if (scoresError) {
      console.warn("[live] scores取得に失敗", scoresError);
      return { ok: false };
    }
    activeAnswerScores = (scoresData ?? []) as ScoreRow[];
  }
  const myScore =
    activeAnswer && myParticipantId
      ? (activeAnswerScores.find((s) => s.judge_participant_id === myParticipantId)?.points ?? null)
      : null;
  return { ok: true, answers: rows, activeAnswer, myScore, myAnswerCount, activeAnswerScores };
}

// 2026-09-08（P1-8/9セキュリティレビュー対応）：answering_cues
// （回答本文を一切含まない、演出用の最小限の合図。supabase/migrations/0063参照）を
// 取得する。取得失敗時は既存の値を保つ（他の取得関数と同じ方針）。
// 2026-09-08（再レビュー2回目対応）：select("*")ではなく、新旧判定に必要な列
// （liveId比較用のlive_id・revision比較用のrevision含む）だけを明示的に取得する。
async function fetchAnsweringCue(
  liveId: string,
): Promise<{ ok: true; cue: AnsweringCueSnapshot | null } | { ok: false }> {
  const { data, error } = await supabase
    .from("answering_cues")
    .select("live_id, turn_id, pending_participant_id, busy, revision")
    .eq("live_id", liveId)
    .maybeSingle();
  if (error) {
    console.warn("[live] answering_cues取得に失敗", error);
    return { ok: false };
  }
  if (!data) return { ok: true, cue: null };
  const row = data as {
    live_id: string;
    turn_id: string;
    pending_participant_id: string | null;
    busy: boolean;
    revision: number;
  };
  return {
    ok: true,
    cue: {
      liveId: row.live_id,
      turnId: row.turn_id,
      pendingParticipantId: row.pending_participant_id,
      busy: row.busy,
      revision: row.revision,
    },
  };
}

// 2026-09-16（再レビュー対応・問題1）：ownsRequestは「呼び出し元が今も所有権を
// 持っているか」を確認するガード。単に呼び出し元（refetchAllやRealtime
// コールバック）の購読世代が今も現行かだけでなく、refreshTurnDerivedから渡される
// 場合は同一世代内でのより新しいrefreshTurnDerived呼び出しに追い越されていないか
// （turnDerivedRequestId）も併せて見る（詳細はrefreshTurnDerived側のコメント参照）。
// 未指定（submitMyAnswer/submitMyScoreなど購読世代と無関係な既存呼び出し）は
// 常にtrueを返す既定値とし、従来どおり無条件に反映する。関数開始時と、
// 非同期取得の直後・setStateの直前で必ず確認し、所有権を失っていればstateを
// 一切変更せず終了する。
// 2026-09-16（再レビュー対応・問題1）：src/lib/__tests__/store/
// useLiveFollowerStoreRace.check.ts から、本番と同じ実装をそのまま呼び出して
// 「古い購読世代・古いrefreshTurnDerived呼び出しの取得結果が新しい方のstateを
// 上書きしない」ことを検証できるようexportする（テストのためだけに別のロジックを
// 再実装しない）。
export async function refreshFinalResult(ownsRequest: () => boolean = () => true): Promise<void> {
  if (!ownsRequest()) return;
  const { live, myParticipant, participants, participantNames } =
    useLiveFollowerStore.getState();
  if (!live) return;
  const resolvedResult = await fetchResolvedAnswersForLive(live.id);
  if (!ownsRequest()) return; // 取得後：追い越されていたら反映しない
  // 取得エラー時は既存のfinalResultを一切書き換えず、次の再試行に任せる。
  if (!resolvedResult.ok) return;
  const resolvedAnswers = resolvedResult.data;
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
  // 2026-09-03:「同点なのに1位・2位・3位のように別々の順位が付く」表示バグの修正。
  // 配列のインデックス(findIndex+1)ではなく、rankingが既に確定させたrank
  // （同点は同じ順位、SQL側のapply_live_rank_rewards()と同じ考え方）を使う。
  const myRank = myParticipant
    ? (ranking.find((r) => r.participantId === myParticipant.id)?.rank ?? null)
    : null;
  if (!ownsRequest()) return; // setState直前：追い越されていたら反映しない
  useLiveFollowerStore.setState({
    finalResult: { bestAnswer, ranking, myRank },
  });
}

// answers/scoresのRealtimeイベントはほぼ同時に複数飛んでくることがあり、
// refreshTurnDerivedの非同期取得が並行して走ると、後発の呼び出しの結果が先に返ってきて
// 反映された直後に、先発の呼び出しの（今となっては古い）結果が遅れて届いて上書きしてしまう
// ことがあった（採点ハイライトが遅延・消える・前の回答の点数を引きずる不具合の原因）。
// 「今から始める呼び出しが最新か」を通し番号で管理し、追い越された古い結果は捨てる。
let turnDerivedRequestId = 0;

// 2026-09-03:「回答者としてリロードすると観客画面になる」不具合の根本対策。
// 戻り値で成功/失敗を呼び出し元（refetchAll）に伝えるようにした。falseを返した
// 場合はcurrentTurn/currentTopicを含め一切stateを書き換えない（既に確定している
// 正常な値を、取得エラーによる一時的なnullで上書きしない）。呼び出し元は失敗時、
// loading:falseへの遷移を保留し、再試行する。
// 2026-09-16（再レビュー対応・問題1）：turnDerivedRequestIdによる「同一世代内の
// 追い越し防止」だけでは不十分だった。subscribe A→Bと購読世代が切り替わっても、
// AのrefreshTurnDerivedがBより先に呼ばれていればturnDerivedRequestId上はAが
// 最新のままになり得るため、Aの取得が遅れて完了するとAがsetStateしてしまう
// （refetchAll側がisMyGenCurrent()を確認するのはrefreshTurnDerivedから戻った
// 後なので手遅れ）。stillCurrent（呼び出し元の購読世代ガード）を関数開始時・
// 各awaitの直後・すべてのsetState直前で確認し、古い世代ならstateを一切
// 変更せずfalseで終了する。未指定（submitMyAnswer/submitMyScoreなど購読世代と
// 無関係な既存呼び出し）は常にtrueを返す既定値とし、従来どおり動作する。
// 2026-09-16（再レビュー対応・問題1、追加修正）：stillCurrent（購読世代）だけでは
// 「同じ購読世代内で複数のrefreshTurnDerivedが重なった」場合を検出できなかった。
// A（requestId=N）がrefreshFinalResultの取得待ちの間にB（requestId=N+1）が開始・
// 完了すると、Aへ渡すガードが購読世代だけを見るstillCurrentのままでは、Aの購読
// 世代自体は変わっていないためtrueのままになり、Aの（今となっては古い）
// finalResultがBの結果を上書きできてしまう。「購読世代」と「同一世代内の
// requestId」の両方を見るownsRequestを作り、refreshTurnDerived内部の全確認・
// refreshFinalResultへ渡すガードの両方をこれに統一する。
export async function refreshTurnDerived(stillCurrent: () => boolean = () => true): Promise<boolean> {
  if (!stillCurrent()) return false; // 関数開始時：呼び出し時点で既に古い世代なら何もしない
  const requestId = ++turnDerivedRequestId;
  const ownsRequest = () => requestId === turnDerivedRequestId && stillCurrent();
  const {
    live,
    myParticipant,
    participants,
    participantNames,
    turnAnswers: prevTurnAnswers,
    currentTurn: prevTurn,
  } = useLiveFollowerStore.getState();
  if (!live?.current_turn_id) {
    if (!ownsRequest()) return false; // より新しい呼び出しに追い越された
    // ライブが無い・current_turn_idが無い（interlude/opening等）状態は、revisionの
    // 大小に関わらず確定的にpendingCueを消してよい（次にcurrent_turn_idが
    // 立った時、pendingCueがnullなのでresolveAnsweringCueは新しい値を必ず採用する）。
    useLiveFollowerStore.setState({
      currentTurn: null,
      currentTopic: null,
      activeAnswer: null,
      turnAnswers: [],
      pendingCue: null,
      activeAnswerScores: [],
      myScore: null,
      myAnswerCount: 0,
      groupResult: null,
    });
    return true; // 「現在進行中のターンが無い」という正常に確定した状態（interlude/opening等）
  }
  // 2026-09-08（P1-8/9再レビュー対応）：以前はturn/topic→answers/scores→cueの順に
  // 1つずつawaitし、それぞれの直後にrequestIdを確認していた。しかし最後のcue取得の
  // 直後だけはrequestIdが古くても「pendingCueの反映だけ諦めて処理を継続」する作りに
  // なっており、その後に続くgroupResult計算・setState（currentTurn/currentTopic/
  // turnAnswers/activeAnswerScores/myScore/myAnswerCount等）はrequestIdを再確認せず
  // 無条件に実行されていた。つまりRealtimeイベントが短時間に連続すると、後発の
  // 呼び出しが先に完了して正しい状態を反映した直後、追い越されたはずの先発の
  // （今となっては古いターン・回答・点数を持つ）呼び出しがcue取得完了後に遅れて
  // 追いつき、新しい状態を古い内容で上書きしてしまうことがあった。
  // 3つの取得をPromise.allで並行実行し、すべて完了した後にrequestIdを1回だけ
  // 確認してから、関連stateをまとめて1回のsetStateで反映する（部分的な新旧混在を防ぐ）。
  const [turnResult, answersResult, cueResult] = await Promise.all([
    fetchTurnAndTopic(live.current_turn_id),
    fetchAnswersAndScoreForTurn(live.current_turn_id, myParticipant?.id),
    fetchAnsweringCue(live.id),
  ]);
  if (!ownsRequest()) return false; // より新しい呼び出しに追い越された
  if (!turnResult.ok) return false; // 取得エラー：既存のcurrentTurn/currentTopicはそのまま保つ
  if (!answersResult.ok) return false; // 取得エラー：既存のturnAnswers/activeAnswerScores等はそのまま保つ
  const { turn, topic } = turnResult;
  const { answers, activeAnswer, myScore, myAnswerCount, activeAnswerScores } = answersResult;
  // pendingCueだけは演出の補助情報のため、取得に失敗しても他の値の反映は止めない
  // （cueResult.ok===falseの場合は、直後のsetStateで既存のpendingCueを保つ）。
  // 2026-09-08（再レビュー2回目対応）：取得できた場合も無条件に上書きせず、
  // 必ずresolveAnsweringCue経由で「同じ実行中に届いたかもしれないRealtime
  // イベントより新しいか」をliveId・revisionで判定してから反映する
  // （setStateのupdater内でs.pendingCue＝反映直前の最新値を見るため、この
  // 関数の実行途中にRealtimeイベントが先に反映されていても正しく比較できる）。

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
  // 2026-09-03:「リロード直後、採点ボールが消えて見える」不具合対策。以前は
  // prevTurnがnull（＝ページ読み込み直後でまだ一度も確定させていないだけ、
  // 本当のターン切り替えではない）というだけでもturnChangedがtrueになり、
  // せっかく取得できたactiveAnswerScoresを毎回空にしてしまっていた。
  // 「前回のターンが実際にあり、かつ今回と違う」場合だけを本当の切り替えとする。
  const turnChanged = prevTurn !== null && prevTurn.id !== (turn?.id ?? null);

  if (!ownsRequest()) return false; // setState直前の再確認
  useLiveFollowerStore.setState((s) => ({
    currentTurn: turn,
    currentTopic: topic,
    activeAnswer,
    turnAnswers: answers,
    pendingCue: cueResult.ok ? resolveAnsweringCue(s.pendingCue, live.id, cueResult.cue) : s.pendingCue,
    // 2026-09-03:「締切直前の最後の1票のボールが端末によって出ない」不具合対策。
    // fetchAnswersAndScoreForTurnが、確定直後(resolved後)も含めて「このターンで
    // 直近にrevealedされた回答」のscoresを常に取得し直すようになったため、ここでは
    // 常にその最新の取得結果(activeAnswerScores)をそのまま使う。以前はactiveAnswerが
    // 無い間（＝確定直後）だけ古いstate(s.activeAnswerScores)を保持し続けていたが、
    // それだとRealtimeイベントの到着順によっては最後の1票を含まないまま固まって
    // しまうことがあった。ターンが切り替わった時だけ明示的に空にする。
    activeAnswerScores: turnChanged ? [] : activeAnswerScores,
    myScore,
    myAnswerCount,
    groupResult,
    laughEventSeq: newlyLaughed ? s.laughEventSeq + 1 : s.laughEventSeq,
  }));

  if (live.current_phase === "final_result") {
    await refreshFinalResult(ownsRequest);
    // refreshFinalResult内部で追い越しを検知して反映を見送った場合、この
    // refreshTurnDerived呼び出し自体も「最終的に自分の仕事を最後まで反映できた
    // わけではない」ため、falseを返す（呼び出し元がより新しい結果に基づいて
    // 再試行しても、既に確定済みの表示を後退させることはない＝上記コメント参照）。
    if (!ownsRequest()) return false;
  }
  return true;
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
  pendingCue: null,
  activeAnswerScores: [],
  myAnswerCount: 0,
  myScore: null,
  groupResult: null,
  finalResult: null,
  tsukkomiQueue: [],
  laughEventSeq: 0,
  loading: true,
  syncError: null,
  error: null,

  retrySync: () => {
    currentRefetchAllRef?.();
  },

  subscribe: () => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // lives/participantsテーブルの変更イベントで短時間に何度も呼ばれるため、
    // refreshTurnDerivedと同様に「今回の呼び出しが最新か」を通し番号で管理する。
    // 無いと、後発の呼び出しが先に完了して反映された直後に、先発の（今となっては
    // 古い）呼び出しの結果が遅れて届いて上書きしてしまうことがあった。
    // 2026-09-16（再レビュー対応）：ただしこのrefetchRequestIdはsubscribe()の
    // 呼び出しごとに0から始まる「このクロージャ内だけの通し番号」であり、
    // subscribe A→subscribe Bと短時間に切り替わった場合、AとBはそれぞれ独立した
    // カウンタを持つため、Aの取得がBより遅れて完了してもAは自分自身の
    // refetchRequestIdとしか比較できず、Bの結果を上書きできてしまう
    // （cleanup漏れ・順序のズレがあった場合の構造的な穴）。
    // channelSwapの購読世代（followerChannelSwap.currentGen()）はswap()を呼ぶ
    // たびに無条件で進み、cleanupが呼ばれたかどうかに関わらず「今どの世代が
    // 最新か」を正しく表す。refetchAll・failStage・scheduleRetry・
    // visibility/online/auth変更のすべてをこの世代に縛ることで、古い世代の
    // 経路がどの段階からでもstateを変更できないようにする。
    let refetchRequestId = 0;
    let myGen = -1;
    const isMyGenCurrent = () => followerChannelSwap.currentGen() === myGen;

    // 2026-09-03:「回答者としてリロードすると観客画面になる」不具合の根本対策
    // （認証復元待ちだけでは不十分だったため全面的に作り直した）。
    // refetchAllはページ表示直後の1回だけでなく、Realtimeの各チャンネルが
    // (再)接続するたびにも(下のonSubscribeStatus経由で)何度も呼ばれ、
    // 「一番最後に呼ばれたrefetchAll」の結果が最終的な表示を決める設計になっている
    // （このstore内のrequestIdガード参照）。
    //
    // 状態遷移は必ず auth確定 → live確定 → participants/myParticipant確定 →
    // currentTurn/currentTopic確定（refreshTurnDerived） の順で進め、途中の
    // どの段階であってもエラーが起きたら：
    //   - 一度も成功していない(loading===true)間は、syncErrorを立てて短い間隔
    //     （2秒後）で自動的に再試行する。loadingはtrueのままなので、LivePage側は
    //     判定を一切せず「復元中」を表示し続ける。
    //   - 一度でも成功していれば(loading===false)、既に確定済みのlive/
    //     participants/myParticipant/currentTurn/currentTopicは一切書き換えず、
    //     syncErrorだけ立てて裏で再試行する（一時的な通信失敗を理由に、既に
    //     正しく出ている画面を観客画面などへ後退させない）。
    const waitForAuthResolved = () =>
      new Promise<void>((resolve) => {
        if (!useAuthStore.getState().loading) {
          resolve();
          return;
        }
        const unsub = useAuthStore.subscribe((state) => {
          if (state.loading) return;
          unsub();
          resolve();
        });
      });

    const RETRY_DELAY_MS = 2_000;
    const scheduleRetry = () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        // 再試行予約の実行直前にも世代を確認する（タイマーが生きている間に
        // 新しい世代へ切り替わっていたら、古い世代の再試行は行わない）。
        if (!cancelled && isMyGenCurrent()) refetchAll();
      }, RETRY_DELAY_MS);
    };
    const failStage = (message: string) => {
      // 既に新しい世代に追い越されていたら、古い世代のsyncError表示・
      // 再試行予約は行わない（stateを一切変更しない）。
      if (!isMyGenCurrent()) return;
      console.warn("[live]", message);
      set({ syncError: message });
      scheduleRetry();
    };

    const refetchAll = async () => {
      const requestId = ++refetchRequestId;
      await waitForAuthResolved();
      if (cancelled || requestId !== refetchRequestId || !isMyGenCurrent()) return;
      const userId = useAuthStore.getState().user?.id ?? null;

      // 段階1：live確定。
      const { data: liveData, error: liveError } = await supabase
        .from("lives")
        .select("*")
        .neq("current_phase", "closed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || requestId !== refetchRequestId || !isMyGenCurrent()) return;
      if (liveError) {
        failStage("ライブ情報の取得に失敗しました");
        return;
      }
      const live = liveData as LiveRow | null;

      // 段階2：participants一覧確定。myParticipantは別クエリ(fetchMyParticipant)に
      // 頼らず、同じスナップショットのparticipants一覧からuser_idで導出する
      // （2つの別々の問い合わせの間で結果がずれるレースを構造的に無くす）。
      let participants: ParticipantRow[] = [];
      let myParticipant: ParticipantRow | null = null;
      // 2026-08-30:「採点確定のたびにボット全員のアイコンがランダムに変わって見える」
      // 不具合対策。participant_display_names RPCが一時的なエラーで取得できなかった
      // 場合は、空の結果で上書きせず直前の値を保持する（fetchParticipantProfiles参照）。
      // 2026-09-03: groupsもgroups取得エラー時に既存の値を保持できるよう、
      // 同様にget()から初期値を引き継ぐようにした。
      let { participantNames, participantAvatars, groups } = get();
      if (live) {
        // 2026-09-06:「回答すると回答者と回答席の位置が入れ替わる」不具合対応。
        // ORDER BYが無いとSupabase/PostgreSQLが返す行順は問い合わせのたびに
        // 変わりうる。joined_at昇順・同時刻はid昇順で全端末が同じ順序を得られる
        // ようにし、さらにsortParticipantsBySeatでクライアント側でも同じ規則で
        // 正規化する（DB側のソートだけに依存しない二重の保険）。
        const { data: participantsData, error: participantsError } = await supabase
          .from("participants")
          .select("*")
          .eq("live_id", live.id)
          .order("joined_at", { ascending: true })
          .order("id", { ascending: true });
        if (cancelled || requestId !== refetchRequestId || !isMyGenCurrent()) return;
        if (participantsError) {
          failStage("参加者情報の取得に失敗しました");
          return;
        }
        participants = sortParticipantsBySeat((participantsData ?? []) as ParticipantRow[]);
        myParticipant = userId ? (participants.find((p) => p.user_id === userId) ?? null) : null;

        // グループ一覧・表示名/アイコンは舞台/観客の判定そのものには使わない
        // 表示用データのため、ここは既存どおり緩やかに扱う（取得エラー時は
        // 直前の値を保持するだけで、readyへの遷移は妨げない）。
        const [groupsResult, profiles] = await Promise.all([
          fetchGroupsForLive(live.id),
          fetchParticipantProfiles(live.id),
        ]);
        if (cancelled || requestId !== refetchRequestId || !isMyGenCurrent()) return;
        if (groupsResult.ok) {
          groups = groupsResult.data;
        }
        if (profiles.ok) {
          participantNames = profiles.names;
          participantAvatars = profiles.avatars;
        }
      } else {
        // liveが無いこと自体は取得エラーではなく確定した状態なので、
        // 前のライブのgroupsを引き継がず明示的に空にする。
        groups = [];
      }
      if (cancelled || requestId !== refetchRequestId || !isMyGenCurrent()) return;
      set({ live, myParticipant, participants, groups, participantNames, participantAvatars });

      // 段階3：currentTurn/currentTopic確定。ここまで揃って初めて舞台/観客の
      // 判定材料が出揃うため、これが成功するまではloadingをfalseにしない。
      // isMyGenCurrentを渡し、refreshTurnDerived（と、その中で呼ばれる
      // refreshFinalResult）が古い購読世代のままstateを書き換えないようにする。
      const turnOk = await refreshTurnDerived(isMyGenCurrent);
      if (cancelled || requestId !== refetchRequestId || !isMyGenCurrent()) return;
      if (!turnOk) {
        failStage("進行状況の取得に失敗しました");
        return;
      }
      set({ loading: false, syncError: null });
    };

    currentRefetchAllRef = refetchAll;

    // 購読世代（channelSwap）越しに全 Postgres Changes チャンネルを作る。
    // - topic は `follower-<kind>-g<gen>` の世代固有名（固定 topic 名に依存しない）
    // - 各コールバックは自分の世代（swapArgs.isCurrentGen）を確認してから state を触る
    //   ＝古い subscribe の cleanup 後に遅れて届くイベントは反映されない
    // - この subscribe が返す cleanup は所有権付き（swap.dispose）
    const spawnFollowerChannels = (swapArgs: ChannelSwapSpawnArgs) => {
      const isCurrentGen = swapArgs.isCurrentGen;
      // 0068：購読世代が切り替わるたびに、前のライブの待機キュー・処理済みID
      // セットをリセットする（リロード・再接続時に過去のリアクションをまとめて
      // 再生しないため。新しい世代は必ず空のキューから始まる）。
      resetTsukkomiReactionQueue();
      // チャンネルが(再)接続できた瞬間に必ず最新スナップショットを取り直す。
      const onSubscribeStatus = (status: string) => {
        if (!isCurrentGen()) return;
        if (status === "SUBSCRIBED") refetchAll();
      };
      const guardedRefetchAll = () => {
        if (isCurrentGen()) refetchAll();
      };
      const guardedRefreshTurnDerived = () => {
        if (isCurrentGen()) void refreshTurnDerived(isCurrentGen);
      };

      const livesCh = supabase
        .channel(swapArgs.topicFor("lives"))
        .on("postgres_changes", { event: "*", schema: "public", table: "lives" }, guardedRefetchAll)
        .subscribe(onSubscribeStatus);
      const participantsCh = supabase
        .channel(swapArgs.topicFor("participants"))
        .on("postgres_changes", { event: "*", schema: "public", table: "participants" }, guardedRefetchAll)
        .subscribe(onSubscribeStatus);
      const answersCh = supabase
        .channel(swapArgs.topicFor("answers"))
        .on("postgres_changes", { event: "*", schema: "public", table: "answers" }, guardedRefreshTurnDerived)
        .subscribe(onSubscribeStatus);
      const scoresCh = supabase
        .channel(swapArgs.topicFor("scores"))
        .on("postgres_changes", { event: "*", schema: "public", table: "scores" }, guardedRefreshTurnDerived)
        .subscribe(onSubscribeStatus);

      // ツッコミ/拍手：DBの public.live_tsukkomi_events への INSERT を Postgres Changes
      // で受信する（0044/レビュー対応）。topic 名は世代固有で、ホスト側の送信用
      // 固定 topic とは無関係。ホストのボット反応も RPC 経由でこのテーブルへ INSERT
      // されるため、ここで一般参加者ぶんと同じく受信できる。
      const tsukkomiCh = supabase
        .channel(swapArgs.topicFor("tsukkomi"))
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "live_tsukkomi_events" },
          (payload) => {
            if (!isCurrentGen()) return;
            // 0068：payload.new.id（live_tsukkomi_events.id、uuid）を使う
            // （以前は捨てていた）。重複UUIDの排除・待機キューへの追加は
            // enqueueTsukkomiEvent側で行う（表示演出とは独立した処理のため、
            // ここでの例外・遅延がライブ進行の他のRealtime処理に影響しないよう
            // try/catchで囲む）。
            try {
              const row = payload.new as { id: string; live_id: string; kind: "clap" | "stamp"; text: string };
              const currentLive = useLiveFollowerStore.getState().live;
              if (!currentLive || row.live_id !== currentLive.id) return;
              enqueueTsukkomiEvent(row.id, row.kind, row.text);
            } catch (e) {
              console.warn("[tsukkomi] リアクション受信処理でエラーが発生しました", e);
            }
          },
        )
        .subscribe(onSubscribeStatus);

      // answering_cues：回答本文を含まない演出専用データ。payload をそのまま使うが、
      // resolveAnsweringCue で liveId・revision の新旧判定を通す（2経路のずれ防止）。
      const answeringCueCh = supabase
        .channel(swapArgs.topicFor("answering-cue"))
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "answering_cues" },
          (payload) => {
            if (!isCurrentGen()) return;
            const row = (payload.new ?? payload.old) as
              | {
                  live_id: string;
                  turn_id: string;
                  pending_participant_id: string | null;
                  busy: boolean;
                  revision: number;
                }
              | undefined;
            const currentLive = useLiveFollowerStore.getState().live;
            if (!row || !currentLive || row.live_id !== currentLive.id) return;
            const incoming: AnsweringCueSnapshot | null =
              payload.eventType === "DELETE"
                ? null
                : {
                    liveId: row.live_id,
                    turnId: row.turn_id,
                    pendingParticipantId: row.pending_participant_id,
                    busy: row.busy,
                    revision: row.revision,
                  };
            useLiveFollowerStore.setState((s) => ({
              pendingCue: resolveAnsweringCue(s.pendingCue, row.live_id, incoming),
            }));
          },
        )
        .subscribe(onSubscribeStatus);

      return [livesCh, participantsCh, answersCh, scoresCh, tsukkomiCh, answeringCueCh];
    };

    // liveId は購読時点で未確定（refetchAll が発見する）。観客側の購読はテーブル
    // 全体で liveId 絞りも無いため、swap の liveId には空文字を渡す（topic は
    // `follower-<kind>-g<gen>` で世代固有になる）。
    // 2026-09-16（再レビュー対応）：myGen をここで確定させてから初回refetchAllを
    // 開始する（初回取得も必ずこの世代に縛り、subscribe直後に別のsubscribeへ
    // 追い越された場合はrefetchAllの最初のawait直後で弾かれるようにする）。
    const channelSwapResult = followerChannelSwap.swap("", spawnFollowerChannels);
    myGen = channelSwapResult.gen;
    refetchAll();

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && isMyGenCurrent()) refetchAll();
    };
    const handleOnline = () => {
      if (isMyGenCurrent()) refetchAll();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);

    // 2026-09-03: リロード直後、Supabaseのセッション復元（useAuthStore.loading）が
    // 完了する前にrefetchAll()が実行されると、その時点でuser?.idがまだnullのため
    // myParticipantがnullのまま確定してしまい、以降DBに何も変化が起きない限り
    // 再取得されず「回答者のはずが観客画面のまま」になっていた（実機ライブで発覚）。
    // useAuthStoreのuser idの変化（ログイン確定・別ユーザーへの切替）を購読し、
    // 変化するたびに必ず取り直す。
    let lastAuthUserId = useAuthStore.getState().user?.id ?? null;
    const unsubscribeAuth = useAuthStore.subscribe((state) => {
      const nextUserId = state.user?.id ?? null;
      if (nextUserId === lastAuthUserId) return;
      lastAuthUserId = nextUserId;
      if (isMyGenCurrent()) refetchAll();
    });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (currentRefetchAllRef === refetchAll) currentRefetchAllRef = null;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
      unsubscribeAuth();
      // 所有権付きクリーンアップ：この subscribe の世代のチャンネルだけを除去する。
      // 既に新しい subscribe に追い越されていたら、最新世代の channels/gen には触らない。
      channelSwapResult.dispose();
      // 0068：ライブ変更・退出・購読解除時にも、待機キュー・処理済みIDセットを
      // リセットする（次にspawnFollowerChannelsが呼ばれた時にも同様にリセット
      // されるため二重にはなるが、ページ自体を離脱してsubscribe()が呼ばれ
      // 直さないケースでも古いキューを残さないための保険）。
      resetTsukkomiReactionQueue();
    };
  },

  joinLive: async (preferredRole, referralSource) => {
    const { live } = get();
    const userId = useAuthStore.getState().user?.id;
    if (!live || !userId) return;
    // 運営者専用管理画面の追加（第1段階）：最大参加人数(lives.max_players)を
    // Supabase側で安全に守るため、直接INSERTではなくsecurity definer RPC
    // (join_live)経由にした。RPC内でlives行をfor updateロックしてから
    // 人数を数えるため、同時押しでも上限を超えない。既存行があれば
    // on conflictでpreferred_roleだけ更新して返す（二重登録防止、
    // ページ再読み込み・再接続時も同じ結果になる）。
    // 2026-09-01: 集客施策の効果測定のため、任意で「どこで知ったか」を
    // referral_sourceとして一緒に記録できるようにした（未指定ならnull）。
    const { data, error } = await supabase.rpc("join_live", {
      p_live_id: live.id,
      p_preferred_role: preferredRole,
      p_referral_source: referralSource ?? null,
    });
    if (error) {
      const reason = error.message.includes("PLAYER_LIMIT_REACHED")
        ? "参加人数が上限に達しました"
        : error.message.includes("PLAYER_JOIN_CLOSED")
          ? "ゲームが始まったため、プレイヤーとしての参加登録はできません。観客として参加してください。"
          : error.message.includes("PARTICIPANT_KICKED")
            ? "このライブへの参加はできません。"
            : error.message.includes("ACCOUNT_SUSPENDED")
              ? "現在アカウントが利用停止中のため、ライブに参加できません。"
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
    if (trimmed.length > MAX_ANSWER_BODY_LENGTH) {
      return { ok: false, reason: `${MAX_ANSWER_BODY_LENGTH}文字以上は送信できないよ` };
    }

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
    // 2026-09-06:「採点を連打・同時押しするとDBの生エラーが赤字表示される」不具合対応。
    // activeAnswerが既に無い（確定直後・次の回答に切り替わった直後）は、押した本人が
    // 何か間違えたわけではない想定内の状態なので、何も表示させない(silent:true)。
    if (!activeAnswer || !myParticipant) return { ok: false, silent: true };
    // 採点は一発勝負：一度投票したら本人でも変更できない（玉が落ちてくる演出と対応）。
    // DB側もscores_update_own_as_playerを廃止し、primary key(answer_id, judge_participant_id)で
    // 二重投票そのものを弾くようにしてある。ここではUIを素早く止めるためのガード。
    // 「採点済みです」は連打時に頻発する想定内の状態のため、画面には出さない。
    if (myScore !== null) return { ok: false, silent: true };

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
      // 2026-09-06:「Supabase/PostgreSQLのerror.messageを画面へ直接表示しない」対応。
      // 想定内のサーバー側拒否（二重投票=一意制約違反23505、表示前・確定後・締切後
      // などのRLS拒否=42501）は画面には静かに無視させる（silent:true）。ただし
      // 「画面に出さない」＝「記録もしない」ではない。特に42501（RLS拒否）は本来
      // 想定内のタイミング競合だけでなく、権限設定のミス等の実バグでも同じコードで
      // 返りうるため、原因調査ができるよう常にconsole.warnへ記録する
      // （DB側の一意制約・RLS自体は削除・緩和しない。ここは表示側の対応のみ）。
      const isExpectedRejection = error.code === "23505" || error.code === "42501";
      if (isExpectedRejection) {
        console.warn("[live] 採点が想定内の理由でサーバーに拒否されました（画面には表示しません）", error);
      } else {
        console.error("[live] 採点の送信に失敗", error);
      }
      return isExpectedRejection
        ? { ok: false, silent: true }
        : { ok: false, silent: false, reason: "採点を送信できませんでした" };
    }
    await refreshTurnDerived();
    return { ok: true };
  },

  sendTsukkomi: (kind, text) => {
    // ここでのクールダウンはUX目的の間引き（連打でエフェクトが重ならないように）で
    // あり、セキュリティ対策としては依存しない。実際のレート制限はsend_tsukkomi RPC
    // （参加者ごとの最終送信時刻をDB側で見る）が担う。
    const now = Date.now();
    if (now - lastTsukkomiSentAt < TSUKKOMI_COOLDOWN_MS) return;
    const { live } = get();
    if (!live) return;
    lastTsukkomiSentAt = now;
    supabase.rpc("send_tsukkomi", { p_live_id: live.id, p_kind: kind, p_text: text }).then(({ error }) => {
      if (error) console.warn("[tsukkomi] 送信に失敗", error);
    });
  },

  claimReactionEvent: (predicate) => {
    const queue = get().tsukkomiQueue;
    if (queue.length === 0) return null;
    const now = Date.now();
    let claimed: QueuedTsukkomiEvent | null = null;
    const next: QueuedTsukkomiEvent[] = [];
    for (const item of queue) {
      if (claimed) {
        // 既に1件取り出した後に残る要素は、そのまま順序を保って残す。
        next.push(item);
        continue;
      }
      if (now - item.receivedAt > TSUKKOMI_STALE_MS) {
        // 受信から3秒以上経過した待機イベントは、表示せずに破棄する
        // （predicateの種別を問わず捨てる＝古いリアクションとして扱う）。
        continue;
      }
      if (!claimed && predicate(item)) {
        claimed = item;
        continue; // このイベントは取り出す（queueから除く）
      }
      next.push(item);
    }
    if (next.length !== queue.length) {
      set({ tsukkomiQueue: next });
    }
    if (!claimed) return null;
    return { id: claimed.id, kind: claimed.kind, text: claimed.text };
  },
}));
