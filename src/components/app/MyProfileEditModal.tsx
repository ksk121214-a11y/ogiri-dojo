"use client";

import { useState } from "react";

import { AVATAR_COLOR_PRESETS } from "@/lib/avatarColors";
import { AVATAR_ICON_PRESETS, getAvatarIconSrc, getAvatarSilhouetteSrc } from "@/lib/avatarIcons";
import { DISPLAY_NAME_MAX_LENGTH, useProfileStore } from "@/store/useProfileStore";
import { useUserStore } from "@/store/useUserStore";

import AvatarGlyph from "@/components/app/AvatarGlyph";
import styles from "@/components/home/StadiumHome.module.css";

const NAME_MAX_LENGTH = DISPLAY_NAME_MAX_LENGTH;
const BIO_MAX_LENGTH = 80;

// マイページの演者名カードから開く編集モーダル。
// アイコンの絵柄・色・一言コメントはローカル（useUserStore）のダミー項目、
// 名前だけは実際のログイン名（useProfileStore、Supabaseのprofiles.display_name）を更新する。
// ログイン前（profileが無い状態）はダミーのdisplayNameをその場で変える簡易フォールバックにしている。
// 呼び出し元が開いている間だけマウントする前提のコンポーネント（開くたびに現在値で再マウントされる）。
// 2026-08-28: マイページ本体（Stadiumテーマ）に合わせ、旧dojoテーマの見た目から
// チケット言語（.grainPaper／.pressable等）を使ったデザインに刷新。
// あわせて、絵柄違いのアイコン素材（大喜利素材2）から選べるアイコン選択UIを追加し、
// 色プリセットは「黒赤青緑」の4色に絞った。
export default function MyProfileEditModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const user = useUserStore((s) => s.user);
  const updateBio = useUserStore((s) => s.updateBio);
  const updateAvatarColor = useUserStore((s) => s.updateAvatarColor);
  const updateAvatarIcon = useUserStore((s) => s.updateAvatarIcon);
  const profile = useProfileStore((s) => s.profile);
  const updateDisplayName = useProfileStore((s) => s.updateDisplayName);
  const updateAvatar = useProfileStore((s) => s.updateAvatar);

  const currentName = profile?.displayName ?? user.displayName;

  const [color, setColor] = useState(user.avatarColor);
  const [icon, setIcon] = useState(user.avatarIcon);
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
    updateAvatarIcon(icon);
    updateBio(bio.trim());

    if (profile) {
      // 2026-08-29:「ライブ中、自分のアイコンが相手の画面ではランダムなアイコンに
      // なる」対応。アイコンの絵柄・色はこれまでuseUserStore（このブラウザにしか
      // 保存されない）だけに保存していたため、他の参加者からは見えなかった。
      // ログイン中はSupabase（profiles）にも保存し、他の参加者にも公開する。
      const avatarResult = await updateAvatar(icon, color);
      if (!avatarResult.ok) {
        setSubmitting(false);
        setError(avatarResult.reason);
        return;
      }
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
        className={`${styles.grainPaper} flex max-h-[90vh] w-full max-w-sm flex-col gap-5 overflow-y-auto rounded-3xl p-6 text-[var(--ink)] shadow-2xl`}
      >
        <h2 className="font-sans text-lg font-black">プロフィールを編集</h2>

        <div className="flex flex-col items-center gap-3">
          <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--ink)]/20 bg-white">
            <AvatarGlyph iconSrc={getAvatarIconSrc(icon)} silhouetteSrc={getAvatarSilhouetteSrc(icon)} color={color} size={64} />
          </span>

          <div>
            <p className="mb-1.5 text-center font-sans text-xs font-bold text-[var(--ink)]/70">絵柄</p>
            <div className="grid grid-cols-4 gap-2">
              {AVATAR_ICON_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setIcon(preset.id)}
                  aria-label={preset.label}
                  aria-pressed={icon === preset.id}
                  className={`${styles.pressable} flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border bg-white transition ${
                    icon === preset.id
                      ? "border-[var(--ink)] ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--paper)]"
                      : "border-[var(--ink)]/15 hover:border-[var(--ink)]/40"
                  }`}
                >
                  <AvatarGlyph iconSrc={preset.src} silhouetteSrc={preset.silhouetteSrc} color={color} size={36} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-center font-sans text-xs font-bold text-[var(--ink)]/70">色</p>
            <div className="flex flex-wrap justify-center gap-2">
              {AVATAR_COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setColor(preset.value)}
                  aria-label={preset.label}
                  aria-pressed={color === preset.value}
                  className={`${styles.pressable} h-8 w-8 rounded-full border border-[var(--ink)]/15 transition ${
                    color === preset.value
                      ? "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--paper)]"
                      : "hover:scale-110"
                  }`}
                  style={{ backgroundColor: preset.value }}
                />
              ))}
            </div>
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="font-sans text-xs font-bold text-[var(--ink)]/70">
            名前（{NAME_MAX_LENGTH}文字以内）
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-[var(--ink)]/15 bg-white px-3 py-2 font-sans text-base text-[var(--ink)] outline-none focus:border-[var(--ink)]"
          />
          <span
            className={`self-end font-sans text-[11px] ${
              name.length > NAME_MAX_LENGTH ? "font-bold text-[var(--accent)]" : "text-[var(--ink)]/60"
            }`}
          >
            {name.length} / {NAME_MAX_LENGTH}
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-sans text-xs font-bold text-[var(--ink)]/70">一言コメント</span>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            maxLength={BIO_MAX_LENGTH}
            className="w-full resize-none rounded-xl border border-[var(--ink)]/15 bg-white p-3 font-sans text-base text-[var(--ink)] outline-none focus:border-[var(--ink)]"
          />
          <span className="self-end font-sans text-[11px] text-[var(--ink)]/60">
            {bio.length} / {BIO_MAX_LENGTH}
          </span>
        </label>

        {error && <p className="font-sans text-xs font-bold text-[var(--accent)]">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={`${styles.pressable} rounded-xl px-5 py-2.5 font-sans text-sm font-bold text-[var(--ink)]/70 transition hover:bg-[var(--ink)]/5`}
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={submitting || !trimmedName || trimmedName.length > NAME_MAX_LENGTH}
            className={`${styles.pressable} rounded-xl bg-[var(--ink)] px-5 py-2.5 font-sans text-sm font-bold text-[var(--paper)] transition hover:opacity-90 disabled:opacity-40`}
          >
            {submitting ? "保存中…" : "保存する"}
          </button>
        </div>
      </form>
    </div>
  );
}
