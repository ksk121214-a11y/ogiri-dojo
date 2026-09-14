"use client";

import { useEffect, useState } from "react";

import { AVATAR_COLOR_PRESETS } from "@/lib/avatarColors";
import { AVATAR_ICON_PRESETS, getAvatarIconSrc, getAvatarSilhouetteSrc } from "@/lib/avatarIcons";
import { isConfirmedMember } from "@/lib/guestStatus";
import { useAuthStore } from "@/store/useAuthStore";
import { DISPLAY_NAME_MAX_LENGTH, useProfileStore, type DojoProfile } from "@/store/useProfileStore";
import { useUserStore } from "@/store/useUserStore";

import AvatarGlyph from "@/components/app/AvatarGlyph";
import styles from "@/components/home/StadiumHome.module.css";

const NAME_MAX_LENGTH = DISPLAY_NAME_MAX_LENGTH;
const BIO_MAX_LENGTH = 80;

// マイページの演者名カードから開く編集モーダル。
// 2026-09-13（再々レビュー2回目対応）：以前は未ログイン・ゲスト・profile未取得の
// 場合でもuseUserStore（ローカルのみのダミー項目）を直接書き換える簡易フォールバック
// 経路を持っていたが、ゲストはプロフィール編集を一切行えない仕様（今回の確定仕様）
// のため、この経路を完全に削除した。isConfirmedMember（認証済み・匿名でない・
// profile取得済み・authUserとprofileのidが一致）でない間は、フォーム自体を
// 表示・送信しない。
// 呼び出し元が開いている間だけマウントする前提のコンポーネント（開くたびに現在値で再マウントされる）。
export default function MyProfileEditModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const profile = useProfileStore((s) => s.profile);
  const profileLoading = useProfileStore((s) => s.loading);
  const authUser = useAuthStore((s) => s.user);
  const authUserId = authUser?.id ?? null;
  // 2026-09-13（再レビュー対応）：モーダルを開いた（＝マウントした）時点の
  // authUserIdを保持し、以降このidが変わったら（会員A→会員B・ゲストへの切り替え等）
  // 即座に閉じる。開いたままのAの入力値がBのprofileへ送信されるのを防ぐ
  // （store側のguardOwnProfileUpdate/isStillSameOwnerと合わせた多層防御）。
  const [openedForUserId] = useState(authUserId);
  useEffect(() => {
    if (authUserId !== openedForUserId) onClose();
  }, [authUserId, openedForUserId, onClose]);

  const isMember = isConfirmedMember({ authUser, profile, profileLoading });

  // 2026-09-13（再々レビュー2回目対応）：確定会員でない間（ゲスト・未ログイン・
  // profile取得中・authUserとprofileのid不一致のいずれか）は、フォーム自体を
  // 一切表示・送信しない。openedForUserIdの変化を待たずとも、profileが一時的に
  // 不整合になった場合にも安全側へ倒す。
  if (!isMember || !profile) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className={`${styles.grainPaper} flex w-full max-w-sm flex-col gap-5 rounded-none border border-[var(--ink)]/15 p-6 text-[var(--ink)] shadow-2xl`}
        >
          <h2 className="font-sans text-lg font-black">プロフィールを編集</h2>
          <p className="font-sans text-sm text-[var(--ink)]/70">
            ログインするとプロフィールを編集できます。
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className={`${styles.pressable} rounded-xl px-5 py-2.5 font-sans text-sm font-bold text-[var(--ink)]/70 transition hover:bg-[var(--ink)]/5`}
            >
              閉じる
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <MyProfileEditForm profile={profile} openedForUserId={openedForUserId} onClose={onClose} />
  );
}

// isMember確定後にだけマウントされるフォーム本体。マウント時点のprofileの値を
// そのままuseStateの初期値に使えるため（isMemberがtrueの間、profileは常に
// 本人の実データ）、以前のような「未ログイン時はuseUserStoreのダミー値に
// フォールバック」という分岐は不要になる。
function MyProfileEditForm({
  profile,
  openedForUserId,
  onClose,
}: {
  profile: DojoProfile;
  openedForUserId: string | null;
  onClose: () => void;
}) {
  const updateDisplayName = useProfileStore((s) => s.updateDisplayName);
  const updateAvatar = useProfileStore((s) => s.updateAvatar);
  const updateBio = useProfileStore((s) => s.updateBio);
  const updateAvatarColor = useUserStore((s) => s.updateAvatarColor);
  const updateAvatarIcon = useUserStore((s) => s.updateAvatarIcon);
  const updateLocalBio = useUserStore((s) => s.updateBio);

  const [color, setColor] = useState(profile.avatarColor);
  const [icon, setIcon] = useState(profile.avatarIcon);
  const [name, setName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
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
    // 2026-09-13（再々レビュー2回目対応）：開いたユーザーIDと現在のユーザーIDが
    // 一致することを、送信直前にも改めて確認する（開いている間に閉じる効果が
    // まだ効いていない一瞬の間に送信ボタンが押された場合の最後の砦）。
    // これより前にはuseUserStore・Supabaseのどちらも一切書き換えない。
    if (useAuthStore.getState().user?.id !== openedForUserId) {
      setError("アカウントが切り替わったため保存できません");
      return;
    }
    setSubmitting(true);
    setError(null);

    // 2026-08-29:「ライブ中、自分のアイコンが相手の画面ではランダムなアイコンに
    // なる」対応。アイコンの絵柄・色・一言コメントはuseUserStore（このブラウザ
    // にしか保存されない、ライブ中の自分表示用）にも反映する。所有者確認より
    // 後にだけ行う（切り替わっていたら実行しない）。
    updateAvatarColor(color);
    updateAvatarIcon(icon);
    updateLocalBio(bio.trim());

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
    // 2026-08-31: 一言コメントもSupabase（profiles.bio）へ保存し、他ユーザーの
    // プロフィールからも見られるようにする。
    const bioResult = await updateBio(bio.trim());
    if (!bioResult.ok) {
      setSubmitting(false);
      setError(bioResult.reason);
      return;
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
        className={`${styles.grainPaper} flex max-h-[76vh] w-full max-w-sm flex-col gap-5 overflow-y-auto rounded-none border border-[var(--ink)]/15 p-6 text-[var(--ink)] shadow-2xl`}
      >
        <h2 className="font-sans text-lg font-black">プロフィールを編集</h2>

        <div className="flex flex-col gap-3">
          {/* 2026-08-31: 現在のアイコン→絵柄（詰めて左寄せ）→色（縦一列）の
              3ブロック横並びに変更。絵柄はcontentサイズ（flex-1にしない）にして
              アイコンのすぐ右に詰め、余った右側を色の縦一列に充てる。 */}
          <div className="flex items-start gap-3">
            <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--ink)]/20 bg-white">
              <AvatarGlyph iconSrc={getAvatarIconSrc(icon)} silhouetteSrc={getAvatarSilhouetteSrc(icon)} color={color} size={64} />
            </span>

            <div className="shrink-0">
              <p className="mb-1.5 font-sans text-xs font-bold text-[var(--ink)]/70">絵柄</p>
              <div className="grid grid-cols-3 gap-2">
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

            <div className="ml-auto flex flex-col items-center">
              <p className="mb-1.5 font-sans text-xs font-bold text-[var(--ink)]/70">色</p>
              <div className="flex flex-col gap-2">
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
