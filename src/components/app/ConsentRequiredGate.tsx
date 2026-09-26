"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { checkConsentForUser, GenerationGuard } from "@/lib/consentCheck";
import { TERMS_VERSION, PRIVACY_VERSION } from "@/lib/legalInfo";
import { recordTermsConsentOnce, waitForConsentInFlight } from "@/lib/termsConsentRecorder";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import {
  clearDeviceConsentAck,
  clearPendingConsentFlag,
  markDeviceConsentAck,
  readPendingConsentFlag,
} from "@/store/useConsentGateStore";

import { LegalLinksRow } from "@/components/legal/LegalLinks";

// ログイン中（Xログイン・ゲストいずれも）のセッションに対し、現在の
// TERMS_VERSION/PRIVACY_VERSIONへの同意記録（terms_consents）があるかを確認し、
// 無ければ同意を求める。/terms・/privacyは同意前でも常に閲覧できるよう、この
// ゲート自体を素通りさせる。
//
// 2026-09-25（再監査対応）：以前はneedsConsentの初期値がfalseで、DB確認前から
// childrenを描画・マウントしていたため、未同意/旧バージョンの既存ユーザーでも
// 確認が終わるまでの一瞬、画面を操作でき子コンポーネントの自動処理が走り得た。
// 状態を auth-loading / unauthenticated / checking / consent-required /
// accepted / error の6つに明確化し、/terms・/privacy以外では
// unauthenticated・accepted以外の間はchildrenを一切マウントしない
// （確認中・未同意・エラー中はそれぞれ専用の画面のみを表示する）。
// userIdが変わるたびに世代番号をインクリメントして直ちにcheckingへ戻し、
// 古い世代の非同期結果（generationRef不一致）は破棄して新しい世代の状態へ
// 反映しない（useSnsStore.ts等、このリポジトリの既存の世代ガードと同じ考え方）。
type GateStatus =
  | { kind: "auth-loading" }
  | { kind: "unauthenticated" }
  | { kind: "checking" }
  | { kind: "consent-required" }
  | { kind: "accepted" }
  | { kind: "error"; message: string };

// 現在のバージョンに一致する同意記録が存在するかどうかを、DB側へ直接問い合わせる
// （「最新1行を取得して版を比較する」のではなく、現在のTERMS_VERSION/
// PRIVACY_VERSIONに一致する行があるか自体をクエリの条件にする）。
async function hasCurrentConsentRow(uid: string): Promise<{ ok: true; exists: boolean } | { ok: false }> {
  // ゲスト同意直後などで記録RPCが送信中なら、その完了を待ってから確認する
  // （未着のせいで一瞬「未同意」と判定して同意画面を出さない）。
  await waitForConsentInFlight(uid, TERMS_VERSION, PRIVACY_VERSION);
  const { data, error } = await supabase
    .from("terms_consents")
    .select("id")
    .eq("user_id", uid)
    .eq("terms_version", TERMS_VERSION)
    .eq("privacy_version", PRIVACY_VERSION)
    .limit(1);
  if (error) return { ok: false };
  return { ok: true, exists: (data?.length ?? 0) > 0 };
}

function recordConsentOnceFor(userId: string | null) {
  return recordTermsConsentOnce({
    userId,
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    rpc: async () => {
      const { error } = await supabase.rpc("record_terms_consent");
      return { error };
    },
  });
}

function FullScreenNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4 text-gray-900">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-6 text-gray-900 shadow-2xl ring-1 ring-gray-300">
        {children}
      </div>
    </div>
  );
}

export default function ConsentRequiredGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const authLoading = useAuthStore((s) => s.loading);
  const authUser = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const userId = authUser?.id ?? null;

  const [status, setStatus] = useState<GateStatus>({ kind: "auth-loading" });
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [agreeError, setAgreeError] = useState<string | null>(null);
  // 世代ガード本体はsrc/lib/consentCheck.ts（React非依存、テスト容易性のため
  // 切り出し済み）。userIdが変わるたびに.next()し、非同期処理の完了時点で
  // .isCurrent()を満たさなければ結果を破棄する。
  const guardRef = useRef(new GenerationGuard());
  // ログアウト（userIdがnullへ変わった瞬間）を検知するための直前値の控え。
  // 共有端末で次に使う別の利用者が、前の利用者の端末共通「同意済み」フラグ・
  // 保留同意をそのまま引き継がないよう、検知した時点でclearDeviceConsentAck()
  // を呼ぶ。
  const previousUserIdRef = useRef<string | null>(null);

  const isAnonymousUser = authUser?.is_anonymous === true;

  const isLegalPage = pathname === "/terms" || pathname === "/privacy";

  const runCheck = useCallback(async (uid: string, myGeneration: number, isAnonymous: boolean) => {
    const result = await checkConsentForUser(uid, {
      readPendingFlag: readPendingConsentFlag,
      clearPendingFlag: clearPendingConsentFlag,
      recordConsent: () => recordConsentOnceFor(uid),
      hasCurrentConsentRow,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      isAnonymousUser: isAnonymous,
      now: () => Date.now(),
    });
    if (!guardRef.current.isCurrent(myGeneration)) return; // 古い世代の結果は破棄する
    if (result.kind === "accepted") markDeviceConsentAck();
    setStatus(result);
  }, []);

  useEffect(() => {
    // userIdが変わった瞬間に世代番号を進め、直ちにcheckingへ戻す
    // （auth-loading中・未ログインへの変化もこの世代番号で管理する）。
    // 2026-09-25（再々監査対応3）：下のsetSubmitting呼び出しを省くと、
    // 「Aが同意保存中にBへ切り替わる」場合、Aの処理は世代ガードにより自身の
    // 後始末処理でsubmitting解除を行わない（Bのsubmitting状態を誤って解除
    // しないため）ので、Bの同意画面が「処理中…」のまま操作不能になってしまう。
    // 世代の切り替わり＝新しい所有者の開始地点でリセットする。
    const myGeneration = guardRef.current.next();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAgreeError(null);
    setChecked(false);
    setSubmitting(false);

    // 2026-09-25（共有端末での取り違え対策）：ログイン中（userIdあり）から
    // 未ログイン（userIdなし）へ変わった＝ログアウトされた瞬間に、端末共通の
    // 「同意済み」フラグ・保留同意を消去する。これを行わないと、共有端末で
    // 次に使う別の利用者が、前の利用者がXログイン/ゲスト開始時に付けた
    // フラグをそのまま引き継ぎ、同意モーダルを飛ばしてしまう可能性がある。
    if (previousUserIdRef.current && !userId) {
      clearDeviceConsentAck();
    }
    previousUserIdRef.current = userId;

    if (authLoading) {
      setStatus({ kind: "auth-loading" });
      return;
    }
    if (!userId) {
      setStatus({ kind: "unauthenticated" });
      return;
    }
    setStatus({ kind: "checking" });
    void runCheck(userId, myGeneration, isAnonymousUser);
  }, [authLoading, userId, isAnonymousUser, runCheck]);

  const handleRetry = () => {
    if (!userId) return;
    const myGeneration = guardRef.current.next();
    setStatus({ kind: "checking" });
    void runCheck(userId, myGeneration, isAnonymousUser);
  };

  // 2026-09-25（再々監査対応）：runCheckには世代ガードがあったが、handleAgree
  // には無かったため、userAの同意保存RPC待機中にログアウト・userBへの切替が
  // 起きると、Aの遅延完了がmarkAcked()・setStatus({kind:"accepted"})を実行し、
  // Bの同意確認を上書きしてしまう可能性があった。開始時点のuserId・世代番号を
  // 記録し、RPC完了後に同じ世代（＝同じuserId）であることを確認してから
  // 状態を反映する。古い世代ならmarkAcked/setStatus/setCheckedのいずれも
  // 行わない。submittingの解除も、現在の処理の所有者（同じ世代）だけが行う
  // （古い世代のfinallyが、切り替わった後の新しい処理のsubmitting表示を
  // 誤って解除しないようにする）。
  // 2026-09-25（再々監査対応3）：世代番号の一致だけでなく、開始時点の
  // userId（startedUserId）とuseAuthStore.getState().user?.idの現在値も
  // 直接突き合わせる（useEffectの世代インクリメントを待たずに、認証ストアの
  // 最新値を同期的に読める分、より直接的な二重の安全策になる）。両方が
  // 一致する場合だけ、その処理が「今の所有者」として結果を反映してよい。
  const handleAgree = async () => {
    if (!checked || submitting) return;
    const myGeneration = guardRef.current.peek();
    const startedUserId = userId;
    const ownsThisAttempt = () =>
      guardRef.current.isCurrent(myGeneration) && useAuthStore.getState().user?.id === startedUserId;
    setSubmitting(true);
    setAgreeError(null);
    try {
      const { error } = await recordConsentOnceFor(startedUserId);
      if (!ownsThisAttempt()) return; // 保存完了前にログアウト・別ユーザーへ切り替わっていた
      if (error) {
        setAgreeError("同意内容を保存できませんでした。時間をおいて再度お試しください。");
        return;
      }
      clearPendingConsentFlag();
      markDeviceConsentAck();
      setStatus({ kind: "accepted" });
      setChecked(false);
    } catch {
      if (!ownsThisAttempt()) return;
      setAgreeError("同意内容を保存できませんでした。時間をおいて再度お試しください。");
    } finally {
      if (ownsThisAttempt()) {
        setSubmitting(false);
      }
    }
  };

  // /terms・/privacyは、認証確認中・未同意・エラー中でも常に閲覧できる。
  if (isLegalPage) {
    return <>{children}</>;
  }

  if (status.kind === "unauthenticated" || status.kind === "accepted") {
    return <>{children}</>;
  }

  if (status.kind === "auth-loading" || status.kind === "checking") {
    return (
      <FullScreenNotice>
        <p className="font-sans text-base text-gray-800">読み込み中…</p>
      </FullScreenNotice>
    );
  }

  if (status.kind === "error") {
    return (
      <FullScreenNotice>
        <h2 className="font-sans text-lg font-bold text-gray-900">エラーが発生しました</h2>
        <p className="font-sans text-sm leading-relaxed text-gray-800">{status.message}</p>
        <button
          type="button"
          onClick={handleRetry}
          className="rounded-xl bg-gray-900 px-4 py-3 font-sans text-base font-bold text-white transition hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700"
        >
          再試行
        </button>
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
          className="rounded-xl border border-gray-400 bg-white px-4 py-3 font-sans text-base font-bold text-gray-900 transition hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          ログアウト
        </button>
      </FullScreenNotice>
    );
  }

  // status.kind === "consent-required"
  return (
    <FullScreenNotice>
      <h2 className="font-sans text-lg font-bold text-gray-900">利用規約・プライバシーポリシーの改定について</h2>
      <p className="font-sans text-sm leading-relaxed text-gray-800">
        利用規約・プライバシーポリシーの内容をご確認の上、同意をお願いします。ご同意いただけない場合は、本サービスをご利用いただけません。
      </p>
      <LegalLinksRow className="font-sans text-base font-bold text-blue-800" openInNewTab />
      <label className="flex cursor-pointer items-start gap-3 font-sans text-base font-medium leading-snug text-gray-900">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        />
        利用規約に同意し、プライバシーポリシーを確認しました。
      </label>
      {agreeError && <p role="alert" className="font-sans text-sm font-bold text-red-700">{agreeError}</p>}
      <div className="mt-2 flex flex-col gap-2">
        <button
          type="button"
          disabled={!checked || submitting}
          onClick={handleAgree}
          className="rounded-xl bg-gray-900 px-4 py-3 font-sans text-base font-bold text-white transition hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700"
        >
          {submitting ? "処理中…" : "同意する"}
        </button>
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
          className="rounded-xl border border-gray-400 bg-white px-4 py-3 font-sans text-base font-bold text-gray-900 transition hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          同意しない場合はログアウト
        </button>
      </div>
    </FullScreenNotice>
  );
}
