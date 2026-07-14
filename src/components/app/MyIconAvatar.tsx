"use client";

import AvatarPlaceholder from "@/components/app/AvatarPlaceholder";
import { getCollectionItem } from "@/data/collectionData";
import { ITEM_TYPE_EMOJI } from "@/lib/economyUi";
import { useUserStore } from "@/store/useUserStore";

// マイページ・寄合帳・番付表・結果発表など「あなた」のアイコンを表示する箇所で共通利用する。
// 装備中のアイコンパーツがあればそれを、無ければプレースホルダーを表示する。
// 複数箇所で個別に同じ参照ロジックを持つと表示がズレる不具合が過去に起きたため、ここに一本化する。
export default function MyIconAvatar({ size = 32 }: { size?: number }) {
  const user = useUserStore((s) => s.user);
  const iconItem = user.inventory.equipped.iconPartId
    ? getCollectionItem(user.inventory.equipped.iconPartId)
    : undefined;

  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-dojo-curtain-gold/60 bg-dojo-tatami-cream"
      style={{ width: size, height: size }}
    >
      {iconItem ? (
        <span style={{ fontSize: size * 0.55 }}>{ITEM_TYPE_EMOJI[iconItem.type]}</span>
      ) : (
        <AvatarPlaceholder size={size} />
      )}
    </span>
  );
}
