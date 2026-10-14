// 運営者専用「ライブ予定」画面の結果公開欄に出す、ライブ単位の流入アンケート集計。
//
// 集計元はそのライブに参加した participants.referral_source（0074）であり、
// 現在のprofiles.referral_source（アカウントの最新状態）からは集計しない。
// 「このライブに参加した時点で記録されていた値」を見るのが目的のため。
//
// is_guest=trueの匿名ゲストはアンケート自体の対象外なので、未回答数・対象人数・
// すべての内訳から除外する（0074のjoin_liveが常にnullを入れるため、含めると
// 実際には聞いていない「未回答」が水増しされてしまう）。
// 2026-10-14：選択肢を「X・YouTube・TikTok・友人・その他」の5択へ変更した
// （0090）。「アプリ内」(app)は新規回答の選択肢からは外したが、過去の回答は
// 削除・変換せず履歴としてDBに残すため、読み取り・表示・集計では引き続き
// 扱う。新規回答で送れる値（REFERRAL_SOURCE_ANSWER_OPTIONS）と、DBに保存され
// 得る値（REFERRAL_SOURCE_STORED_VALUES）を区別すること。
export const REFERRAL_SOURCE_ANSWER_OPTIONS = [
  { value: "x", label: "X" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
  { value: "friend", label: "友人" },
  { value: "other", label: "その他" },
] as const;

export const REFERRAL_SOURCE_STORED_VALUES = ["x", "youtube", "tiktok", "friend", "app", "other"] as const;

export function isStoredReferralSourceValue(value: string): boolean {
  return (REFERRAL_SOURCE_STORED_VALUES as readonly string[]).includes(value);
}

// 参加登録画面（OpeningView）でアンケートを表示するかどうか。通常会員で、
// プロフィール読み込み済み、かつ一度も回答していない（referral_source・
// referral_source_answered_atが両方null）場合だけ表示する。過去にappを含む
// どの値で回答済みでも再表示しない（0090で回答済み状態はリセットしていない）。
export function shouldShowReferralSurvey(params: {
  isGuest: boolean;
  profileLoading: boolean;
  profile: { referralSource: string | null; referralSourceAnsweredAt: string | null } | null;
}): boolean {
  const { isGuest, profileLoading, profile } = params;
  return !isGuest && !profileLoading && !!profile && profile.referralSource == null && profile.referralSourceAnsweredAt == null;
}

export interface ReferralSurveyParticipantRow {
  referralSource: string | null;
  isGuest: boolean;
}

export interface ReferralSurveyCounts {
  x: number;
  youtube: number;
  tiktok: number;
  friend: number;
  app: number;
  other: number;
  noAnswer: number;
  answered: number;
  target: number;
}

export function summarizeReferralSurvey(rows: ReferralSurveyParticipantRow[]): ReferralSurveyCounts {
  const targets = rows.filter((r) => !r.isGuest);

  let x = 0;
  let youtube = 0;
  let tiktok = 0;
  let friend = 0;
  let app = 0;
  let other = 0;
  let noAnswer = 0;

  for (const row of targets) {
    switch (row.referralSource) {
      case "x":
        x += 1;
        break;
      case "youtube":
        youtube += 1;
        break;
      case "tiktok":
        tiktok += 1;
        break;
      case "friend":
        friend += 1;
        break;
      case "app": // 旧選択肢（過去の回答の履歴として集計し続ける）
        app += 1;
        break;
      case "other":
        other += 1;
        break;
      default:
        noAnswer += 1;
        break;
    }
  }

  return {
    x,
    youtube,
    tiktok,
    friend,
    app,
    other,
    noAnswer,
    answered: targets.length - noAnswer,
    target: targets.length,
  };
}

// 参加者一覧（司会コンソール）の1行ごとの流入元表示ラベル。summarizeReferralSurvey
// と同じ「ゲストは対象外」という扱いを個別表示にも一致させ、通常会員の未回答
// （「未回答」）とゲスト（アンケート自体の対象外）を混同しないようにする。
const REFERRAL_SOURCE_LABEL: Record<string, string> = {
  x: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
  friend: "友人",
  app: "アプリ内（旧選択肢）",
  other: "その他",
};

export function referralSourceDisplayLabel(referralSource: string | null, isGuest: boolean): string {
  if (isGuest) return "対象外（ゲスト）";
  if (!referralSource) return "未回答";
  return REFERRAL_SOURCE_LABEL[referralSource] ?? "未回答";
}

// 「全体アンケート集計」（運営者専用「ライブ予定」画面、supabase RPC
// admin_referral_survey_summary の戻り値）用の型・変換。
//
// 上のsummarizeReferralSurvey（ライブ単位、participants.referral_source基準）
// とは目的が異なる。全体集計は「サービス全体で1アカウントにつき1回の回答を
// 集計する」ものなので、参加のたびに増えるparticipantsではなく、1アカウントに
// つき一度しか確定しないprofiles.referral_source（0074）をDB側（SQL migration
// 0075のRPC）で直接集計する。フロントは個々のprofiles行を取得せず、この
// 集計済みの件数だけを受け取る（全件取得・N+1を避けるため、及び個人が
// 特定できる情報を一切フロントに渡さないため）。
//
// 未回答人数・対象人数はここでは扱わない：現在のボット（14件、is_guest=false
// の通常プロフィール）には正式なis_bot列が無く、実際にはアンケートを見せて
// いないのに「未回答」として数えてしまうと実態と異なる数字になるため、
// 運営の要望により回答済みの内訳・合計だけを表示する（表示名・メールアドレス
// からのボット推測除外は対応範囲外）。
export interface OverallReferralSurveyRow {
  x_count: number;
  youtube_count: number;
  tiktok_count: number;
  friend_count: number;
  app_count: number;
  other_count: number;
  answered_total: number;
}

export interface OverallReferralSurveyCounts {
  x: number;
  youtube: number;
  tiktok: number;
  friend: number;
  app: number;
  other: number;
  answeredTotal: number;
}

export function toOverallReferralSurveyCounts(row: OverallReferralSurveyRow): OverallReferralSurveyCounts {
  return {
    x: row.x_count,
    youtube: row.youtube_count,
    tiktok: row.tiktok_count,
    friend: row.friend_count,
    app: row.app_count,
    other: row.other_count,
    answeredTotal: row.answered_total,
  };
}
