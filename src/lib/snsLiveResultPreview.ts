// 0068問題2対応：管理画面（src/app/admin/live-results/[liveId]/page.tsx）の
// 「SNS上での表示プレビュー」カードは、テストライブ(live_mode='test')では
// そもそもSNSに公開されないため表示すべきでない。
//
// useSnsLiveResultsStore.fetchDetail()は一般公開側（寄合帳ユーザー向け）と
// 共有しており、live_mode='official'フィルタ自体はそちらのために必須
// （外せない）。テストライブでは条件不一致でliveがnullになり、
// sequenceNumber:0・title:nullのフォールバックのままdetailが組み立てられて
// しまい、「#0000」のような不自然な表示になっていた。
//
// 呼び出し側（管理画面）で「そもそも呼ばない・そもそも表示しない」を
// 判定するための純粋関数として切り出す。src/lib/__tests__/からDOM無しで
// 直接検証できるようにする。
export type LiveMode = "test" | "official";

// SNS上での表示プレビューを表示すべきか（＝テストライブでは表示しない）。
export function shouldShowSnsLiveResultPreview(liveMode: LiveMode | null | undefined): boolean {
  return liveMode === "official";
}

// useSnsLiveResultsStore.fetchDetail()を呼ぶべきか（＝テストライブでは
// 無駄なリクエストを送らない）。判定条件はshouldShowSnsLiveResultPreviewと
// 同じだが、呼び出し意図が違うため別名でexportする。
export function shouldFetchSnsLiveResultDetail(liveMode: LiveMode | null | undefined): boolean {
  return liveMode === "official";
}
