// 運営操作履歴(admin_action_logs)の表示用：logAdminAction呼び出し箇所
// （useLiveHostStore.ts・各/admin配下ページ）で使われているaction・target_type
// の英語スネークケース文字列を、日本語ラベルに変換するための辞書。
// 未知の値（今後の追加や過去ログとの不一致）はフォールバックで元の文字列を出す。

export const ACTION_LABEL: Record<string, string> = {
  // ライブ準備・進行（司会コンソール）
  live_prepared: "ライブを準備した",
  reception_opened: "参加受付を開始した",
  groups_randomized: "組分けをランダムに実行した",
  participant_group_changed: "参加者の組を変更した",
  topic_changed: "お題を変更した",
  announcement_sent: "運営メッセージを送信した",
  capacity_updated: "最大人数・組数を変更した",
  game_started: "ゲームを開始した",
  live_closed: "ライブを終了した",
  participant_private_message_sent: "参加者に個別メッセージを送った",
  participant_kicked: "参加者を退場させた",
  participant_unkicked: "参加者の退場を解除した",

  // ライブ予定
  schedule_entry_created: "ライブ予定を作成した",
  schedule_entry_updated: "ライブ予定を編集した",
  schedule_entry_role_changed: "ライブ予定の表示先を変更した",
  schedule_entry_deleted: "ライブ予定を削除した",
  schedule_entry_duplicated: "ライブ予定を複製した",
  results_published: "結果を公開した",
  results_unpublished: "結果を非公開にした",

  // お題管理
  topic_bank_added: "お題を追加した",
  topic_bank_edited: "お題を編集した",
  topic_bank_deleted: "お題を削除した",
  topic_bank_activated: "お題を使用再開にした",
  topic_bank_deactivated: "お題を使用停止にした",

  // 投稿・回答管理
  post_hidden: "投稿を非表示にした",
  post_unhidden: "投稿の非表示を解除した",
  post_deleted: "投稿を完全削除した",

  // ユーザー管理
  user_warning: "警告を送った",
  user_suspend_temporary: "期限付きで利用停止にした",
  user_suspend_permanent: "永久停止にした",
  user_lift: "利用停止を解除した",
  user_deleted: "アカウントを完全削除した",
};

export const TARGET_TYPE_LABEL: Record<string, string> = {
  lives: "ライブ",
  live_schedule_entries: "ライブ予定",
  topic_bank: "お題（マスター）",
  topics: "お題（ライブ内）",
  participants: "参加者",
  profiles: "ユーザー",
  sns_topic: "お題投稿",
  sns_answer: "回答",
  sns_comment: "コメント",
};

export function formatActionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

export function formatTargetTypeLabel(targetType: string | null): string {
  if (!targetType) return "-";
  return TARGET_TYPE_LABEL[targetType] ?? targetType;
}
