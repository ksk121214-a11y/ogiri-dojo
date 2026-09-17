// 2026-09-16（複数プロバイダー対応）：これまで「Xでログイン」ボタンを持つ
// 10箇所以上のコンポーネントが、それぞれ個別にsignInWithXを呼びローカルの
// エラーstateを持っていた。ログイン方法がX/Google/Appleの3択になったことで
// 選択UIが必要になったため、trigger側は「モーダルを開く」ことだけを行い、
// 実際の選択肢表示・エラー表示は共通のLoginMethodModal（1つだけ全体にマウント）
// に集約する。isGuestSwitchだけを引き継げれば元の呼び出し意図を再現できる。
import { create } from "zustand";

interface LoginModalState {
  open: boolean;
  isGuestSwitch: boolean;
  openLoginModal: (options?: { isGuestSwitch?: boolean }) => void;
  closeLoginModal: () => void;
}

export const useLoginModalStore = create<LoginModalState>()((set) => ({
  open: false,
  isGuestSwitch: false,
  openLoginModal: (options) => set({ open: true, isGuestSwitch: options?.isGuestSwitch ?? false }),
  closeLoginModal: () => set({ open: false }),
}));
