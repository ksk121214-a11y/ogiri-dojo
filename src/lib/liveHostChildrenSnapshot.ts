// useLiveHostStore.ts（司会ストア）のinit()/refresh()が、participants/groups/
// topics/turns（「children」と呼ぶ）の取得結果をどう扱うかを決める純粋関数。
//
// 背景：HostProgressController（RootLayout常駐）がfocus/visibilitychange/
// pageshow/online のたびにinit()を呼び直すようになったことで、一時的な通信
// 失敗のたびにチェックが必要になった。以前は失敗時に無条件で空配列へ
// 上書きしており、advanceIfDue（フェーズ自動進行）が「turnsが無い＝次のターンが
// 無い」と誤判定してfinal_resultへ誤って進む恐れがあった。
//
// ルール：
// - 取得に成功したら、常に新しいデータを採用し、ready(スナップショットが
//   信頼できる状態か)をtrueにする。
// - 取得に失敗しても、同じライブについての直前のデータがあれば、それを維持する
//   （直前のready状態もそのまま引き継ぐ）。
// - 取得に失敗し、かつ別のライブへ切り替わっていた場合は、前のライブのデータを
//   流用せず空のデータを使う（ready=false。まだそのライブの有効なスナップショットを
//   一度も取得できていない状態）。

export interface ResolveLiveChildrenSnapshotInput<TChildren> {
  fetchOk: boolean;
  freshChildren: TChildren;
  sameLiveAsBefore: boolean;
  prevChildren: TChildren;
  prevReady: boolean;
  emptyChildren: TChildren;
}

export interface ResolveLiveChildrenSnapshotResult<TChildren> {
  children: TChildren;
  ready: boolean;
}

export function resolveLiveChildrenSnapshot<TChildren>(
  input: ResolveLiveChildrenSnapshotInput<TChildren>,
): ResolveLiveChildrenSnapshotResult<TChildren> {
  const { fetchOk, freshChildren, sameLiveAsBefore, prevChildren, prevReady, emptyChildren } = input;
  if (fetchOk) {
    return { children: freshChildren, ready: true };
  }
  if (sameLiveAsBefore) {
    return { children: prevChildren, ready: prevReady };
  }
  return { children: emptyChildren, ready: false };
}
