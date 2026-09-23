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
