"use client";

import * as audioManager from "@/lib/audio/audioManager";

// 初回アクセス時・ブラウザ更新直後に必ず1回だけ出す「BGMを有効にしますか？」の確認モーダル。
// 表示タイミングの制御（1ブート1回・SPA遷移では出さない・Strict Modeで二重表示しない）は
// 呼び出し元のAudioProvider.tsx側で行う（このコンポーネント自体は「表示されたら常に描画する」
// だけの単純な見た目担当）。
// ホーム・ライブどちらの画面上にも出る可能性があるため、Stadiumテーマの
// CSS変数（--ink等、.shellの外では未定義）には依存しないニュートラルな配色にしている。
// OFF/ONボタンにはdata-sfx="home"を付け、下部ナビ等と同じhomeClick音が鳴るようにしている
// （StadiumSfxController.tsx参照。Stadium系画面以外で開いた場合はそもそも対象外のため無音）。
export default function BgmConsentModal({ onDone }: { onDone: () => void }) {
  const handleOn = () => {
    // 要件：ONボタン押下時は、状態更新・Supabase通信・画面遷移・その他のawaitより先に
    // AudioContextのresume()を呼ぶ（クリックイベントの同期的なコールスタック内で実行することが
    // モバイルSafari等の自動再生制限を突破する条件のため、setBgmEnabledより前に置く）。
    audioManager.resumeAudioContext();
    // SEの設定は変更しない（bgmEnabledだけを更新する）。
    audioManager.setBgmEnabled(true);
    onDone();
  };

  const handleOff = () => {
    audioManager.setBgmEnabled(false);
    onDone();
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bgm-consent-title"
    >
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-2xl">
        <h2 id="bgm-consent-title" className="font-sans text-base font-bold text-neutral-900">
          BGMを使用します
        </h2>
        <p className="mt-2 font-sans text-sm text-neutral-600">BGMを有効にしますか？</p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={handleOff}
            data-sfx="home"
            className="flex-1 rounded-full border border-neutral-300 px-4 py-2.5 font-sans text-sm font-bold text-neutral-700 transition hover:bg-neutral-50 active:scale-95"
          >
            OFF
          </button>
          <button
            type="button"
            onClick={handleOn}
            data-sfx="home"
            className="flex-1 rounded-full bg-neutral-900 px-4 py-2.5 font-sans text-sm font-bold text-white transition hover:opacity-90 active:scale-95"
          >
            ON
          </button>
        </div>
      </div>
    </div>
  );
}
