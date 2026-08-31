"use client";

import Link from "next/link";

import AvatarGlyph from "@/components/app/AvatarGlyph";
import MyIconAvatar from "@/components/app/MyIconAvatar";
import ReportButton, { type ReportTargetType } from "@/components/app/ReportButton";
import { getRankByMeter } from "@/data/collectionData";
import { getDummySnsAuthor } from "@/data/snsAuthors";
import { getAvatarIconSrc, getAvatarSilhouetteSrc } from "@/lib/avatarIcons";
import { useProfileStore } from "@/store/useProfileStore";
import { useSnsStore } from "@/store/useSnsStore";
import { useUserStore } from "@/store/useUserStore";

// 寄合帳（お題一覧・お題詳細・回答カード）で共通利用する「アイコン＋演者名＋段位」の投稿者表示。
// authorId === "me" の場合はマイページ（useUserStore）と同じ情報源（演者名・段位・装備中アイコン）を
// そのまま反映し、それ以外は snsAuthors.ts のダミー投稿者プロフィールを参照する。
// 2026-08-30: アイコンを丸背景で囲むデザインをやめ、線画/絵文字をそのまま出す表示に変更した
// （MyIconAvatarはbare=trueを使用）。
// 自分（"me"）は寄合帳トップ（/sns、プロフィールカードを直接埋め込み済み）へ、
// それ以外は個別プロフィールページ（/sns/u/[authorId]）へのリンクになる。
// 呼び出し側でカード全体をLinkにしている場合があるため、アンカーのネストを避けるよう呼び出し元は
// SnsAuthorBadgeを外側のLinkでは包まないこと（stopPropagationのみでは<a>のネストは解消できないため）。
// 通報ボタンはLinkの中に入れず兄弟要素にする（<a>の中に<button>を入れるとクリック伝播が絡むため）。
export default function SnsAuthorBadge({
  authorId,
  size = 32,
  reportTarget,
  hideReportButton = false,
}: {
  authorId: string;
  size?: number;
  // 2026-08-30: 運営者専用管理画面の追加（第3段階）。通報ボタンから実際に
  // reportsテーブルへ保存できるよう、このバッジが表す投稿（お題/回答/コメント）の
  // 種別・ID・本文を呼び出し元から渡してもらう。省略時（ダミー投稿等）は
  // 従来どおりの確認のみのダミー通報のままになる。
  reportTarget?: { type: ReportTargetType; id: string; body: string };
  // 2026-08-31: 「通報の旗をカードの右端中央に置きたい」要望のため、呼び出し元が
  // カード側で独自にReportButtonを絶対配置する場合、このバッジ内での描画を止める。
  hideReportButton?: boolean;
}) {
  const user = useUserStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  // 2026-08-30: 早期returnより前でフックを呼ぶ必要がある（Rules of Hooks）ため、
  // isMeケースでは使わない値でも、ここで一度だけ呼んでおく。
  const realAuthor = useSnsStore((s) => s.realAuthorNames[authorId]);
  const isMe = authorId === "me";

  if (isMe) {
    // 2026-08-31: 段位はライブ終了時に加算される実データ（profiles.mastery_meter）を優先する。
    const rank = getRankByMeter(profile?.masteryMeter ?? user.masteryMeter);

    return (
      <span className="flex min-w-0 items-center gap-2">
        <Link
          href="/sns"
          onClick={(e) => e.stopPropagation()}
          className="flex min-w-0 items-center gap-2"
        >
          <MyIconAvatar size={size} bare />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-sans text-xs font-bold text-[var(--ink)] hover:underline">
              {user.displayName}
            </span>
            <span className="font-sans text-[10px] text-[var(--ink)]/60">
              {rank.label}
            </span>
          </span>
        </Link>
      </span>
    );
  }

  // 2026-08-30: 運営者専用管理画面の追加（第3段階）で寄合帳の投稿をDB化した際、
  // ダミー著者(author-xxx)でも自分(me)でもない実ユーザーの投稿（authorIdが実プロフィールの
  // UUID）が現れるようになった。realAuthor（sns_author_names経由で解決済み）が
  // あればそちらを優先する（無ければ従来どおり「名無しの演者」表示にフォールバック）。
  const author = getDummySnsAuthor(authorId);

  return (
    <span className="flex min-w-0 items-center gap-2">
      <Link
        href={`/sns/u/${authorId}`}
        onClick={(e) => e.stopPropagation()}
        className="flex min-w-0 items-center gap-2"
      >
        <span
          className="flex shrink-0 items-center justify-center"
          style={{ width: size, height: size, fontSize: size * 0.75 }}
        >
          {author ? (
            author.emoji
          ) : realAuthor ? (
            // 2026-08-30: 実ユーザーの投稿者はマイク絵文字(🎤)固定になっていたのを、
            // 本人がマイページで設定した実際の絵柄・色（SnsAuthorProfile.tsxの
            // プロフィールページと同じ経路）で表示するようにした。
            <AvatarGlyph
              iconSrc={getAvatarIconSrc(realAuthor.avatarIcon)}
              silhouetteSrc={getAvatarSilhouetteSrc(realAuthor.avatarIcon)}
              color={realAuthor.avatarColor}
              size={size}
            />
          ) : (
            "🎭"
          )}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-sans text-xs font-bold text-[var(--ink)] hover:underline">
            {author?.displayName ?? realAuthor?.displayName ?? "名無しの演者"}
          </span>
          <span className="font-sans text-[10px] text-[var(--ink)]/60">
            {author?.rankLabel ?? "見習い"}
          </span>
        </span>
      </Link>
      {!hideReportButton && (
        <ReportButton
          size={Math.max(16, size * 0.55)}
          targetType={reportTarget?.type}
          targetId={reportTarget?.id}
          targetAuthorId={authorId.startsWith("author-") ? null : authorId}
          snapshotBody={reportTarget?.body}
        />
      )}
    </span>
  );
}

// カード全体の右端中央にReportButtonを絶対配置したい呼び出し元向けのヘルパー。
// authorIdが"author-"始まり（ダミー投稿者）の場合はtargetAuthorIdをnullにする
// SnsAuthorBadge内部と同じ判定を、呼び出し元でも重複させないための共通関数。
export function reportTargetAuthorId(authorId: string): string | null {
  return authorId.startsWith("author-") ? null : authorId;
}
