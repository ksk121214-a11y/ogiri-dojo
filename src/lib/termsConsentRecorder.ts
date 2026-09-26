// record_terms_consent RPC の呼び出しを、利用者×規約版ごとに1回へ束ねる共通処理。
//
// 呼び出し元は3系統ある（ゲスト同意直後・Xログイン後の保留同意・既存利用者の
// 同意ボタン）。いずれもここを経由することで、UIのstate・認証イベント・再レンダー・
// React Strict Modeの二重実行・連打が重なっても、同じ利用者・同じ版のRPCは
// 「送信中なら同じPromiseへ合流（RPCは1本）」になる。
//
// 成功の結果は記憶しない（永続キャッシュ無し）。完了後はDBを正とする：DBの同意行が
// 削除・リセットされた場合、次の呼び出しでRPCが再実行される。二重記録はDB側の
// UNIQUE(user_id, terms_version, privacy_version)＋ON CONFLICT DO NOTHING（0076）が防ぐ。
// userIdが確定していない（null）呼び出しは束ねられず、RPCも呼ばない
// （呼び出し側が確定したuserIdを渡す。src/store/useConsentGateStore.ts参照）。
export type ConsentRpcResult = { error: unknown };

const inFlight = new Map<string, Promise<ConsentRpcResult>>();

function keyOf(userId: string, termsVersion: string, privacyVersion: string): string {
  return `${userId}|${termsVersion}|${privacyVersion}`;
}

export function recordTermsConsentOnce(p: {
  userId: string | null;
  termsVersion: string;
  privacyVersion: string;
  rpc: () => Promise<ConsentRpcResult>;
}): Promise<ConsentRpcResult> {
  // userIdが未確定の間は記録RPCを呼ばない（束ねられず二重送信になり得るため）。
  if (!p.userId) return Promise.resolve({ error: new Error("USER_NOT_CONFIRMED") });
  const key = keyOf(p.userId, p.termsVersion, p.privacyVersion);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = p
    .rpc()
    .catch((e: unknown) => ({ error: e }))
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

// ゲスト参加は「匿名認証 → 認証ストア反映 → 記録RPC」の順に進むため、認証ストアへの反映
// （ConsentRequiredGateの同意確認の開始）が、記録RPCの開始より先に起こり得る。その間に
// 「未同意」と誤判定して全画面の同意画面を出さないよう、ゲスト同意処理の開始から完了までを
// 「窓」として登録し、同意確認はすべての窓の終了まで待つ。
// 窓は単一の変数ではなく集合で管理する：ゲスト同意処理が重なっても（再マウント・二重実行・
// ストア関数の直接呼び出し）、後発の窓が先発の窓を上書きしたり、後発の終了で先発の窓が
// 消えたりしない。窓の解除は冪等で、最大待機時間を過ぎると自動解除される（例外・アンマウント・
// 応答なしでも永久待機にならない）。
export const GUEST_CONSENT_WINDOW_MAX_MS = 15_000;
const guestWindows = new Set<Promise<void>>();

export function beginGuestConsentWindow(maxMs: number = GUEST_CONSENT_WINDOW_MAX_MS): () => void {
  let release: () => void = () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const win: Promise<void> = new Promise<void>((resolve) => {
    release = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      guestWindows.delete(win);
      resolve();
    };
  });
  timer = setTimeout(release, maxMs);
  guestWindows.add(win);
  return release;
}

// 送信中の記録があれば、その完了を待つ（無ければ即座に解決）。「記録がまだDBに
// 届いていない」ことによる一瞬の未同意判定（全画面の同意画面の出現）を避けるために、
// DBの同意有無の確認より前に呼ぶ。
export async function waitForConsentInFlight(
  userId: string,
  termsVersion: string,
  privacyVersion: string,
): Promise<void> {
  // 開いている窓がすべて終わるまで待つ（待機中に新しく開いた窓も待つ）。
  while (guestWindows.size > 0) await Promise.all([...guestWindows]);
  const p = inFlight.get(keyOf(userId, termsVersion, privacyVersion));
  if (p) await p;
}

export function resetTermsConsentRecorderForTests(): void {
  inFlight.clear();
  guestWindows.clear();
}
