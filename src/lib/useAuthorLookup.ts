"use client";

import { useCallback, useEffect, useState } from "react";

import { getDummySnsAuthor } from "@/data/snsAuthors";
import { deriveAuthorLookupStatus } from "@/lib/authorLookupStatus";
import { isUuid } from "@/lib/uuid";
import { useSnsStore } from "@/store/useSnsStore";

export type { AuthorLookupStatus } from "@/lib/authorLookupStatus";

// 演者（authorId）の表示情報を取得し、「読み込み中／取得成功／存在しない／通信失敗」を分けて返す。
// 取得が終わる前に「見つかりません」を出さない。UUIDでないIDはAPIを呼ばずnot-foundにする。
export function useAuthorLookup(authorId: string) {
  const dummyAuthor = getDummySnsAuthor(authorId);
  const realAuthor = useSnsStore((s) => s.realAuthorNames[authorId]);
  const resolveAuthorName = useSnsStore((s) => s.resolveAuthorName);
  const [attempt, setAttempt] = useState<{ id: string; result: "ok" | "error" } | null>(null);
  const [tick, setTick] = useState(0);
  const needsFetch = !dummyAuthor && !realAuthor && isUuid(authorId);

  useEffect(() => {
    if (!needsFetch) return;
    let cancelled = false;
    void resolveAuthorName(authorId).then((result) => {
      if (!cancelled) setAttempt({ id: authorId, result });
    });
    return () => {
      cancelled = true;
    };
  }, [needsFetch, authorId, resolveAuthorName, tick]);

  const status = deriveAuthorLookupStatus({ authorId, hasInfo: !!(dummyAuthor || realAuthor), attempt });

  const retry = useCallback(() => {
    setAttempt(null);
    setTick((t) => t + 1);
  }, []);

  return { status, dummyAuthor, realAuthor, retry };
}
