// useLiveHostStore.ts（司会ストア）の「取得したスナップショットが、今表示中の
// ライブ／ターンについて信頼できるか」を判定する副作用のない純粋関数群。
//
// 背景：HostProgressController（RootLayout常駐）がfocus/visibilitychange/pageshow/
// online のたびにinit()を呼び直すようになったことで、一時的な通信失敗のたびに
// participants/groups/topics/turns や answers が空配列で上書きされる恐れが出た。
// - turns/groupsが空になると、advanceIfDueが「次のターンが無い」と誤判定して
//   final_resultへ誤って進む。
// - 採点中のanswersが空になると、isAnsweringBusy()がfalseと判断し、
//   syncAnsweringPause()が回答時間を再開してしまう。
//
// そこで「どのliveId（children）／どのliveId+turnId（answers）についての
// スナップショットが正常取得済みか」をstateに持ち、取得失敗時は
// - 同じ対象なら既存値を維持する
// - 別の対象なら空にしたうえで「未確認」に戻す
// という判断をこの関数群に集約する。boolean単体だと別ライブ・別ターンへ
// 誤って流用しやすいため、必ずliveId／turnIdを含む識別情報で判定する。

// ===== children（participants/groups/topics/turns）=====

export interface ChildrenSnapshotInput<TChildren> {
  fetchOk: boolean;
  freshChildren: TChildren;
  targetLiveId: string;
  prevChildren: TChildren;
  // 直前にstateへ入っているchildrenが、どのliveIdについて正常取得済みか（未確認ならnull）。
  prevSnapshotLiveId: string | null;
  emptyChildren: TChildren;
}

export interface ChildrenSnapshotResult<TChildren> {
  children: TChildren;
  // 反映後、childrenがどのliveIdについて正常取得済みか（未確認ならnull）。
  snapshotLiveId: string | null;
}

export function resolveChildrenSnapshot<TChildren>(
  input: ChildrenSnapshotInput<TChildren>,
): ChildrenSnapshotResult<TChildren> {
  const { fetchOk, freshChildren, targetLiveId, prevChildren, prevSnapshotLiveId, emptyChildren } =
    input;
  if (fetchOk) {
    // 取得成功：新しいデータを採用し、このliveIdについて確認済みとする。
    return { children: freshChildren, snapshotLiveId: targetLiveId };
  }
  if (prevSnapshotLiveId === targetLiveId) {
    // 取得失敗だが、同じライブについての正常な既存値がある：それを維持する
    // （空配列で上書きしない）。
    return { children: prevChildren, snapshotLiveId: targetLiveId };
  }
  // 取得失敗、かつ別ライブ（または一度も確認できていない）：前ライブのデータを
  // 流用せず空にし、「未確認」に戻す（＝自動進行を行わせない）。
  return { children: emptyChildren, snapshotLiveId: null };
}

export function childrenSnapshotReady(
  snapshotLiveId: string | null,
  liveId: string | null | undefined,
): boolean {
  return !!liveId && snapshotLiveId === liveId;
}

// ===== answers（現在ターンぶんの回答一覧）=====

export interface AnswersSnapshotKey {
  liveId: string;
  turnId: string;
}

export interface AnswersSnapshotInput<TAnswers> {
  fetchOk: boolean;
  freshAnswers: TAnswers;
  targetLiveId: string;
  targetTurnId: string;
  prevAnswers: TAnswers;
  prevSnapshot: AnswersSnapshotKey | null;
  emptyAnswers: TAnswers;
}

export interface AnswersSnapshotResult<TAnswers> {
  // stateへ書き込むべきanswers（writeAnswers=falseなら書き込まない）。
  answers: TAnswers;
  // answersを実際にstateへ書き込んでよいか。取得失敗時は既存値を壊さないためfalse。
  writeAnswers: boolean;
  // 反映後、answersがどの(liveId,turnId)について正常取得済みか（未確認ならnull）。
  snapshot: AnswersSnapshotKey | null;
}

export function resolveAnswersSnapshot<TAnswers>(
  input: AnswersSnapshotInput<TAnswers>,
): AnswersSnapshotResult<TAnswers> {
  const { fetchOk, freshAnswers, targetLiveId, targetTurnId, prevAnswers, prevSnapshot, emptyAnswers } =
    input;
  if (fetchOk) {
    return {
      answers: freshAnswers,
      writeAnswers: true,
      snapshot: { liveId: targetLiveId, turnId: targetTurnId },
    };
  }
  if (prevSnapshot && prevSnapshot.liveId === targetLiveId && prevSnapshot.turnId === targetTurnId) {
    // 取得失敗だが、同じライブ・同じターンについての正常な既存値がある：
    // 何も書き換えず維持する（画面表示用のanswersを空にしない）。
    return { answers: prevAnswers, writeAnswers: false, snapshot: prevSnapshot };
  }
  // 取得失敗、かつ別ターン（または一度も確認できていない）：既存answersを
  // 壊さない（writeAnswers=false）が、このターンについては「未確認」に戻す
  // ＝advanceIfDue側で回答時間の減算・processRevealQueue・resolveIfDue・
  //   syncAnsweringPause・group_result遷移を一切行わない。
  return { answers: emptyAnswers, writeAnswers: false, snapshot: null };
}

export function answersSnapshotMatches(
  snapshot: AnswersSnapshotKey | null,
  liveId: string | null | undefined,
  turnId: string | null | undefined,
): boolean {
  return (
    !!snapshot &&
    !!liveId &&
    !!turnId &&
    snapshot.liveId === liveId &&
    snapshot.turnId === turnId
  );
}

// ===== init()の並行実行制御（initInFlightの所有権）=====

// 「finallyで自分自身のPromiseを片付けてよいか」の判定。
// stopHostProgress()がinitInFlight=nullにした後に新しいinitが始まっていると、
// 古いinitのfinallyが無条件にnullへ戻すと新しいinitのinitInFlightを消してしまう。
// 現在のinitInFlightが自分のPromiseと同一のときだけ片付ける。
export function shouldReleaseInitInFlight<T>(current: T | null, mine: T): boolean {
  return current === mine;
}
