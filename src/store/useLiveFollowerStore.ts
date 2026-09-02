// 実バックエンド版ライブ（フェーズB）の参加者（司会以外）用ストア。
// 参加登録・現在のターン/お題/表示中の回答の購読・回答送信・採点送信・
// 組結果発表/最終結果発表のランキング集計までを扱う。
import { create } from "zustand";

import { MAX_ANSWER_BODY_LENGTH } from "@/data/liveRoomTiming";
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
  submitMyScore: (points: 0 | 1 | 2 | 3) => Promise<{ ok: boolean; reason?: string }>;
  sendTsukkomi: (kind: "clap" | "stamp", text: string) => void;
}

let channels: ReturnType<typeof supabase.channel>[] = [];
let tsukkomiChannel: ReturnType<typeof supabase.channel> | null = null;
let tsukkomiIdCounter = 0;
// retrySyncアクションから、subscribe()内で今動いているrefetchAllを直接叩けるようにする
// ための参照（subscribe()のクリーンアップでnullに戻す）。
let currentRefetchAllRef: (() => void) | null = null;
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

async function fetchGroupsForLive(liveId: string): Promise<GroupRow[]> {
  const { data } = await supabase.from("groups").select("*").eq("live_id", liveId);
  return (data ?? []) as GroupRow[];
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

async function fetchResolvedAnswersForLive(liveId: string): Promise<AnswerRow[]> {
  const { data } = await supabase
    .from("answers")
    .select("*")
    .eq("live_id", liveId)
    .eq("resolved", true)
    .order("created_at", { ascending: true });
  return (data ?? []) as AnswerRow[];
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
    const { data } = await supabase.from("scores").select("*").eq("answer_id", boardTargetAnswer.id);
    activeAnswerScores = (data ?? []) as ScoreRow[];
  }
  const myScore =
    activeAnswer && myParticipantId
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
  // 2026-09-03:「同点なのに1位・2位・3位のように別々の順位が付く」表示バグの修正。
  // 配列のインデックス(findIndex+1)ではなく、rankingが既に確定させたrank
  // （同点は同じ順位、SQL側のapply_live_rank_rewards()と同じ考え方）を使う。
  const myRank = myParticipant
    ? (ranking.find((r) => r.participantId === myParticipant.id)?.rank ?? null)
    : null;
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
async function refreshTurnDerived(): Promise<boolean> {
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
    if (requestId !== turnDerivedRequestId) return false; // より新しい呼び出しに追い越された
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
    return true; // 「現在進行中のターンが無い」という正常に確定した状態（interlude/opening等）
  }
  const turnResult = await fetchTurnAndTopic(live.current_turn_id);
  if (requestId !== turnDerivedRequestId) return false; // より新しい呼び出しに追い越された
  if (!turnResult.ok) return false; // 取得エラー：既存のcurrentTurn/currentTopicはそのまま保つ
  const { turn, topic } = turnResult;
  const { answers, activeAnswer, myScore, myAnswerCount, activeAnswerScores } =
    await fetchAnswersAndScoreForTurn(live.current_turn_id, myParticipant?.id);
  if (requestId !== turnDerivedRequestId) return false; // より新しい呼び出しに追い越された

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
  const turnChanged = (prevTurn?.id ?? null) !== (turn?.id ?? null);

  useLiveFollowerStore.setState((s) => ({
    currentTurn: turn,
    currentTopic: topic,
    activeAnswer,
    turnAnswers: answers,
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
    await refreshFinalResult();
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
  activeAnswerScores: [],
  myAnswerCount: 0,
  myScore: null,
  groupResult: null,
  finalResult: null,
  tsukkomiSeq: 0,
  lastTsukkomi: null,
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
    let refetchRequestId = 0;

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
        if (!cancelled) refetchAll();
      }, RETRY_DELAY_MS);
    };
    const failStage = (message: string) => {
      console.warn("[live]", message);
      set({ syncError: message });
      scheduleRetry();
    };

    const refetchAll = async () => {
      const requestId = ++refetchRequestId;
      await waitForAuthResolved();
      if (cancelled || requestId !== refetchRequestId) return;
      const userId = useAuthStore.getState().user?.id ?? null;

      // 段階1：live確定。
      const { data: liveData, error: liveError } = await supabase
        .from("lives")
        .select("*")
        .neq("current_phase", "closed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || requestId !== refetchRequestId) return;
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
      let groups: GroupRow[] = [];
      // 2026-08-30:「採点確定のたびにボット全員のアイコンがランダムに変わって見える」
      // 不具合対策。participant_display_names RPCが一時的なエラーで取得できなかった
      // 場合は、空の結果で上書きせず直前の値を保持する（fetchParticipantProfiles参照）。
      let { participantNames, participantAvatars } = get();
      if (live) {
        const { data: participantsData, error: participantsError } = await supabase
          .from("participants")
          .select("*")
          .eq("live_id", live.id);
        if (cancelled || requestId !== refetchRequestId) return;
        if (participantsError) {
          failStage("参加者情報の取得に失敗しました");
          return;
        }
        participants = (participantsData ?? []) as ParticipantRow[];
        myParticipant = userId ? (participants.find((p) => p.user_id === userId) ?? null) : null;

        // グループ一覧・表示名/アイコンは舞台/観客の判定そのものには使わない
        // 表示用データのため、ここは既存どおり緩やかに扱う（取得エラー時は
        // 直前の値を保持するだけで、readyへの遷移は妨げない）。
        const [groupsResult, profiles] = await Promise.all([
          fetchGroupsForLive(live.id),
          fetchParticipantProfiles(live.id),
        ]);
        if (cancelled || requestId !== refetchRequestId) return;
        groups = groupsResult;
        if (profiles.ok) {
          participantNames = profiles.names;
          participantAvatars = profiles.avatars;
        }
      }
      if (cancelled || requestId !== refetchRequestId) return;
      set({ live, myParticipant, participants, groups, participantNames, participantAvatars });

      // 段階3：currentTurn/currentTopic確定。ここまで揃って初めて舞台/観客の
      // 判定材料が出揃うため、これが成功するまではloadingをfalseにしない。
      const turnOk = await refreshTurnDerived();
      if (cancelled || requestId !== refetchRequestId) return;
      if (!turnOk) {
        failStage("進行状況の取得に失敗しました");
        return;
      }
      set({ loading: false, syncError: null });
    };

    currentRefetchAllRef = refetchAll;
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

    // 2026-09-02: 以前はDBに残さない演出専用イベントとして、認可設定のない生の
    // Realtimeブロードキャスト（固定チャンネル名）で送受信していたが、チャンネル名さえ
    // 分かれば誰でも任意のliveId/kind/textを送信できてしまっていた（初回ライブ実開催前
    // レビュー対応）。他の4チャンネル(lives/participants/answers/scores)と同じ
    // 「テーブルへのINSERT＋postgres_changes購読」パターンに揃え、送信自体は
    // send_tsukkomi RPC（0044、参加登録済みユーザーのみ・許可されたkind/textのみ・
    // レート制限あり）経由に限定する。
    tsukkomiChannel = supabase
      .channel("follower-tsukkomi")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "live_tsukkomi_events" },
        (payload) => {
          const row = payload.new as { live_id: string; kind: "clap" | "stamp"; text: string };
          const currentLive = useLiveFollowerStore.getState().live;
          if (!currentLive || row.live_id !== currentLive.id) return;
          tsukkomiIdCounter += 1;
          useLiveFollowerStore.setState((s) => ({
            tsukkomiSeq: s.tsukkomiSeq + 1,
            lastTsukkomi: { id: tsukkomiIdCounter, kind: row.kind, text: row.text },
          }));
        },
      )
      .subscribe(onSubscribeStatus);

    channels = [livesCh, participantsCh, answersCh, scoresCh, tsukkomiChannel];

    const handleVisibility = () => {
      if (document.visibilityState === "visible") refetchAll();
    };
    const handleOnline = () => refetchAll();
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
      refetchAll();
    });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (currentRefetchAllRef === refetchAll) currentRefetchAllRef = null;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
      unsubscribeAuth();
      cleanupChannels();
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
}));
