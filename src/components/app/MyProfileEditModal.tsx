"use client";

import { useState } from "react";

import { BASE_PATH } from "@/lib/basePath";
import { AVATAR_COLOR_PRESETS } from "@/lib/avatarColors";
import { DISPLAY_NAME_MAX_LENGTH, useProfileStore } from "@/store/useProfileStore";
import { useUserStore } from "@/store/useUserStore";

const NAME_MAX_LENGTH = DISPLAY_NAME_MAX_LENGTH;
const BIO_MAX_LENGTH = 80;

// マイページの演者名カードから開く編集モーダル。
// アイコンの色・一言コメントはローカル（useUserStore）のダミー項目、
// 名前だけは実際のログイン名（useProfileStore、Supabaseのprofiles.display_name）を更新する。
// ログイン前（profileが無い状態）はダミーのdisplayNameをその場で変える簡易フォールバックにしている。
// 呼び出し元が開いている間だけマウントする前提のコンポーネント（開くたびに現在値で再マウントされる）。
export default function MyProfileEditModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const user = useUserStore((s) => s.user);
  const updateBio = useUserStore((s) => s.updateBio);
  const updateAvatarColor = useUserStore((s) => s.updateAvatarColor);
  const profile = useProfileStore((s) => s.profile);
  const updateDisplayName = useProfileStore((s) => s.updateDisplayName);

  const currentName = profile?.displayName ?? user.displayName;

  const [color, setColor] = useState(user.avatarColor);
  const [name, setName] = useState(currentName);
  const [bio, setBio] = useState(user.bio);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedName = name.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmedName) {
      setError("名前を入力してください");
      return;
    }
    if (trimmedName.length > NAME_MAX_LENGTH) {
      setError(`名前は${NAME_MAX_LENGTH}文字以内にしてください`);
      return;
    }
    setSubmitting(true);
    setError(null);

    updateAvatarColor(color);
    updateBio(bio.trim());

    if (profile) {
      const result = await updateDisplayName(trimmedName);
      if (!result.ok) {
        setSubmitting(false);
        setError(result.reason);
        return;
      }
    } else {
      // 未ログイン時はダミーストアの名前だけその場で書き換える。
      useUserStore.setState((s) => ({ user: { ...s.user, displayName: trimmedName } }));
    }

    setSubmitting(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-5 rounded-3xl border border-dojo-dark-brown/10 bg-dojo-tatami-cream p-6 shadow-2xl"
      >
        <h2 className="font-sans text-base font-bold text-dojo-ink">プロフィールを編集</h2>

        <div className="flex flex-col items-center gap-3">
          <span
            className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-dojo-dark-brown/15 bg-white"
          >
            <span
              aria-hidden
              style={{
                display: "block",
                width: 64,
                height: 64,
                backgroundColor: color,
                WebkitMaskImage: `url(${BASE_PATH}/images/live2/avatar-2-line-mask.png)`,
                maskImage: `url(${BASE_PATH}/images/live2/avatar-2-line-mask.png)`,
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskPosition: "center",
              }}
            />
          </span>
          <div className="flex flex-wrap justify-center gap-2">
            {AVATAR_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setColor(preset.value)}
                aria-label={preset.label}
                className={`h-7 w-7 rounded-full transition ${
                  color === preset.value
                    ? "ring-2 ring-dojo-ink ring-offset-2 ring-offset-dojo-tatami-cream"
                    : "hover:scale-110"
                }`}
                style={{ backgroundColor: preset.value }}
              />
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="font-sans text-xs font-bold text-dojo-dark-brown">
            名前（{NAME_MAX_LENGTH}文字以内）
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-dojo-dark-brown/15 bg-white px-3 py-2 font-sans text-sm text-dojo-ink outline-none focus:border-dojo-ink"
          />
          <span
            className={`self-end font-sans text-[11px] ${
              name.length > NAME_MAX_LENGTH ? "font-bold text-dojo-deep-crimson" : "text-dojo-dark-brown/70"
            }`}
          >
            {name.length} / {NAME_MAX_LENGTH}
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-sans text-xs font-bold text-dojo-dark-brown">一言コメント</span>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            maxLength={BIO_MAX_LENGTH}
            className="w-full resize-none rounded-xl border border-dojo-dark-brown/15 bg-white p-3 font-sans text-sm text-dojo-ink outline-none focus:border-dojo-ink"
          />
          <span className="self-end font-sans text-[11px] text-dojo-dark-brown/70">
            {bio.length} / {BIO_MAX_LENGTH}
          </span>
        </label>

        {error && <p className="font-sans text-xs text-dojo-deep-crimson">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-5 py-2 font-sans text-sm font-bold text-dojo-dark-brown transition hover:bg-black/5"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={submitting || !trimmedName || trimmedName.length > NAME_MAX_LENGTH}
            className="rounded-full bg-dojo-ink px-5 py-2 font-sans text-sm font-bold text-dojo-washi-white transition disabled:opacity-40"
          >
            {submitting ? "保存中…" : "保存する"}
          </button>
        </div>
      </form>
    </div>
  );
}
