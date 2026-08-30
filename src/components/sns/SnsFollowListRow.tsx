"use client";

import stadiumStyles from "@/components/home/StadiumHome.module.css";
import SnsAuthorBadge from "@/components/sns/SnsAuthorBadge";
import SnsFollowButton from "@/components/sns/SnsFollowButton";

// フォロー中一覧・フォロワー一覧で共通利用する1行分の表示（アイコン＋演者名＋段位＋フォローボタン＋通報ボタン）。
// 2026-08-30（いいね・フォローの実データ化）：propsをSnsAuthorProfile（ダミー専用の型）から
// authorId: stringに変更した。アイコン・演者名・通報ボタンの表示は既存のSnsAuthorBadgeに
// 任せることで、ダミー投稿者("author-xxx")・実ユーザー(UUID)のどちらでもそのまま動く
// （SnsAuthorBadge自身がダミー/実データ/未解決を判定して出し分けている）。
export default function SnsFollowListRow({ authorId }: { authorId: string }) {
  return (
    <div className={`${stadiumStyles.grainPaper} flex items-center justify-between gap-3 rounded-xl p-3 text-[var(--ink)]`}>
      <SnsAuthorBadge authorId={authorId} />
      <SnsFollowButton authorId={authorId} size="compact" />
    </div>
  );
}
