// 運営者専用「ライブ予定」画面の結果公開欄に出す、ライブ単位の流入アンケート集計。
//
// 集計元はそのライブに参加した participants.referral_source（0074）であり、
// 現在のprofiles.referral_source（アカウントの最新状態）からは集計しない。
// 「このライブに参加した時点で記録されていた値」を見るのが目的のため。
//
// is_guest=trueの匿名ゲストはアンケート自体の対象外なので、未回答数・対象人数・
// すべての内訳から除外する（0074のjoin_liveが常にnullを入れるため、含めると
// 実際には聞いていない「未回答」が水増しされてしまう）。
export interface ReferralSurveyParticipantRow {
  referralSource: string | null;
  isGuest: boolean;
}

export interface ReferralSurveyCounts {
  x: number;
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
  let friend = 0;
  let app = 0;
  let other = 0;
  let noAnswer = 0;

  for (const row of targets) {
    switch (row.referralSource) {
      case "x":
        x += 1;
        break;
      case "friend":
        friend += 1;
        break;
      case "app":
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
  x: "X（旧Twitter）",
  friend: "友人・知人の紹介",
  app: "アプリ内",
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
  friend_count: number;
  app_count: number;
  other_count: number;
  answered_total: number;
}

export interface OverallReferralSurveyCounts {
  x: number;
  friend: number;
  app: number;
  other: number;
  answeredTotal: number;
}

export function toOverallReferralSurveyCounts(row: OverallReferralSurveyRow): OverallReferralSurveyCounts {
  return {
    x: row.x_count,
    friend: row.friend_count,
    app: row.app_count,
    other: row.other_count,
    answeredTotal: row.answered_total,
  };
}
