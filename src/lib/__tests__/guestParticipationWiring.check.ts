// 配線確認：ゲスト（匿名）参加（0070）のフロント側配線を、ソースの静的検査で
// 確認する。実際のsingle-flightガード（signInAnonymouslyの連打防止）は
// src/lib/__tests__/store/useAuthStoreGuest.check.ts が本番実装を直接呼び出して
// 検証する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const livePage = readFileSync(join(process.cwd(), "src", "app", "live", "page.tsx"), "utf8");
const displayNameModal = readFileSync(
  join(process.cwd(), "src", "components", "app", "DisplayNameSetupModal.tsx"),
  "utf8",
);
const authStore = readFileSync(join(process.cwd(), "src", "store", "useAuthStore.ts"), "utf8");
const myProfileEditModal = readFileSync(
  join(process.cwd(), "src", "components", "app", "MyProfileEditModal.tsx"),
  "utf8",
);
const myStatsModal = readFileSync(join(process.cwd(), "src", "components", "app", "MyStatsModal.tsx"), "utf8");
const reportButton = readFileSync(join(process.cwd(), "src", "components", "app", "ReportButton.tsx"), "utf8");
const snsFollowButton = readFileSync(
  join(process.cwd(), "src", "components", "sns", "SnsFollowButton.tsx"),
  "utf8",
);
const snsTopicDetail = readFileSync(join(process.cwd(), "src", "components", "sns", "SnsTopicDetail.tsx"), "utf8");
const snsAnswerDetail = readFileSync(join(process.cwd(), "src", "components", "sns", "SnsAnswerDetail.tsx"), "utf8");
const snsFeedSection = readFileSync(join(process.cwd(), "src", "components", "sns", "SnsFeedSection.tsx"), "utf8");
const snsLiveResultBody = readFileSync(
  join(process.cwd(), "src", "components", "sns", "SnsLiveResultBody.tsx"),
  "utf8",
);
const openingView = readFileSync(join(process.cwd(), "src", "components", "live-room", "OpeningView.tsx"), "utf8");
const audienceAnsweringView = readFileSync(
  join(process.cwd(), "src", "components", "live-room", "AudienceAnsweringView.tsx"),
  "utf8",
);
const liveFollowerStore = readFileSync(join(process.cwd(), "src", "store", "useLiveFollowerStore.ts"), "utf8");
const snsLiveResultsStore = readFileSync(
  join(process.cwd(), "src", "store", "useSnsLiveResultsStore.ts"),
  "utf8",
);

// 1（2026-09-13再々レビュー2回目対応・ゲスト観客の最終仕様確定）：/live は、
//    未ログイン時のブロックで本番・テストのどちらのライブでも「ログインせず
//    観客として見る」ボタンを出す（以前はlive_mode==='test'限定だった）。
{
  const guardIdx = livePage.indexOf('if (screenGate === "not-authenticated") {');
  assert.ok(guardIdx >= 0, "/live に screenGate===\"not-authenticated\"の未ログイン分岐が見つからない");
  const block = livePage.slice(guardIdx, guardIdx + 2000);

  assert.ok(
    !/isTestLive/.test(block),
    "/live の未ログイン分岐にisTestLiveによる分岐がまだ残っている（本番・テスト両方で観客ボタンを出す最終仕様と矛盾する）",
  );
  assert.ok(
    /ログインせず観客として見る/.test(block),
    "/live に「ログインせず観客として見る」ボタンの文言が見当たらない",
  );
  assert.ok(
    /ゲストは観客としてライブを視聴できます。回答・採点・ポイント記録はできません。/.test(block),
    "/live に指定のゲスト案内文言が見当たらない",
  );
  // ログインボタン・ゲスト観客ボタンのどちらも、live_modeによる条件分岐の外
  // （常に表示）にあることを確認する。
  // 2026-09-16（複数プロバイダー対応）：ログインボタンの文言は「Xでログイン」から
  // 「ログイン」（押すとX/Google/Appleを選べるLoginMethodModalを開く）に変わった。
  const loginButtonMatch = /openLoginModal\(\)[\s\S]{0,200}?>\s*ログイン\s*<\/button>/.exec(block);
  const guestButtonIdx = block.indexOf("ログインせず観客として見る");
  assert.ok(loginButtonMatch, "openLoginModal()を呼ぶ「ログイン」ボタンが見つからない");
  assert.ok(
    (loginButtonMatch?.index ?? -1) < guestButtonIdx,
    "ログインボタンがゲスト観客ボタンより後にある",
  );

  console.log("PASS: /live は本番・テストどちらのライブでも「ログインせず観客として見る」ボタンを出す");
}

// 2: /live のゲスト観客ボタンは連打防止のためguestSigningIn中disabledになっており、
//    single-flightガードを持つuseAuthStore.signInAsGuestを呼んでいる。
{
  const guardIdx = livePage.indexOf('if (screenGate === "not-authenticated") {');
  assert.ok(guardIdx >= 0, "/live に screenGate===\"not-authenticated\"の未ログイン分岐が見つからない");
  const block = livePage.slice(guardIdx, guardIdx + 2000);
  assert.ok(/disabled=\{guestSigningIn\}/.test(block), "ゲスト観客ボタンがguestSigningIn中disabledになっていない");
  assert.ok(/signInAsGuest\(\)/.test(block), "ゲスト観客ボタンがuseAuthStore.signInAsGuest()を呼んでいない");
  console.log("PASS: ゲスト観客ボタンの連打防止（disabled=guestSigningIn）とsignInAsGuest呼び出しを確認");
}

// 3: useAuthStore.signInAsGuest自体がguestSigningInによるsingle-flightガードを持つ
//    （実際の呼び出し回数の検証はuseAuthStoreGuest.check.ts側で行う）。
{
  const storeBodyIdx = authStore.indexOf("export const useAuthStore = create");
  assert.ok(storeBodyIdx >= 0, "useAuthStoreの実装本体が見つからない");
  const fnIdx = authStore.indexOf("signInAsGuest:", storeBodyIdx);
  assert.ok(fnIdx >= 0, "useAuthStoreの実装本体にsignInAsGuestが定義されていない");
  const fnBlock = authStore.slice(fnIdx, fnIdx + 800);
  assert.ok(/if \(get\(\)\.guestSigningIn\) return/.test(fnBlock), "signInAsGuestの先頭にguestSigningInによる連打防止ガードが無い");
  assert.ok(/signInAnonymously\(\)/.test(fnBlock), "signInAsGuestがsupabase.auth.signInAnonymously()を呼んでいない");
  console.log("PASS: useAuthStore.signInAsGuestはguestSigningInによるsingle-flightガードを持つ");
}

// 4: useAuthStore.signInWithProvider（2026-09-16複数プロバイダー対応で、旧
//    signInWithXのロジックをプロバイダー引数化して移設したもの）は、
//    isGuestSwitch:trueの場合だけ（＝ゲストからの切り替えだと呼び出し元が
//    分かっている場合だけ）確認ダイアログを挟んだ上でsignOut()してから
//    signInWithOAuthを呼ぶ。通常ログイン利用者・未ログインからの呼び出しには
//    無意味なsignOut()を走らせない（2026-09-13レビュー対応で変更、2026-09-16で
//    プロバイダー非依存化）。signInWithXは後方互換のため
//    signInWithProvider("x", options)へ委譲するだけの薄いラッパーになっている。
//    実際の呼び出し回数・signingInProviderの状態遷移はuseAuthStoreXSwitch.check.ts・
//    useAuthStoreMultiProvider.check.ts側で検証する。
{
  const storeBodyIdx = authStore.indexOf("export const useAuthStore = create");
  assert.ok(storeBodyIdx >= 0, "useAuthStoreの実装本体が見つからない");
  assert.ok(
    /signInWithX: \(options\) => get\(\)\.signInWithProvider\("x", options\),/.test(authStore),
    "signInWithXがsignInWithProvider(\"x\", options)への委譲になっていない",
  );
  const fnIdx = authStore.indexOf("signInWithProvider: async", storeBodyIdx);
  assert.ok(fnIdx >= 0, "useAuthStoreの実装本体にsignInWithProviderが定義されていない");
  const fnBlock = authStore.slice(fnIdx, fnIdx + 1600);
  const isGuestSwitchIfIdx = fnBlock.indexOf("if (isGuestSwitch) {");
  const confirmIdx = fnBlock.indexOf("window.confirm(");
  const signOutIdx = fnBlock.indexOf("supabase.auth.signOut()");
  const oauthIdx = fnBlock.indexOf("supabase.auth.signInWithOAuth(");
  assert.ok(isGuestSwitchIfIdx >= 0, "signInWithProviderにisGuestSwitchによる分岐が無い");
  assert.ok(
    confirmIdx >= 0 && confirmIdx < signOutIdx,
    "signInWithProviderがisGuestSwitch時にsignOutより前で確認ダイアログ(window.confirm)を出していない",
  );
  assert.ok(
    signOutIdx >= 0 && signOutIdx < oauthIdx,
    "signInWithProviderがsignInWithOAuthより前にsignOut()を呼んでいない",
  );
  // signOut()の呼び出しがisGuestSwitchのifブロック内（signingInProviderガードの中）に
  // あることを確認する（=常には呼ばれない）。
  assert.ok(
    isGuestSwitchIfIdx < signOutIdx,
    "signOut()がisGuestSwitch分岐の外で呼ばれている（常にsignOutしてしまう可能性）",
  );
  assert.ok(
    /signingInProvider: null,/.test(authStore) && /if \(get\(\)\.signingInProvider\) return/.test(fnBlock),
    "signInWithProviderの先頭にsigningInProviderによる連打防止ガードが無い",
  );
  console.log(
    "PASS: useAuthStore.signInWithProviderはisGuestSwitch:trueの場合だけ確認ダイアログ+signOutを挟んでからOAuthを開始する",
  );
}

// 5: DisplayNameSetupModalは確定会員（isConfirmedMember、ゲスト・id不一致・
//    profile取得中のいずれでもない）以外には一切表示しない。
{
  assert.ok(
    /if \(!isConfirmedMember\(\{ authUser, profile, profileLoading \}\) \|\| profile\?\.displayNameSet\) return null;/.test(
      displayNameModal,
    ),
    "DisplayNameSetupModalがisConfirmedMember()で早期returnしていない（ゲスト・別ユーザーのprofileにも名前設定モーダルが出てしまう可能性）",
  );
  console.log("PASS: DisplayNameSetupModalは確定会員以外には表示されない");
}

// 6（2026-09-13再々レビュー2回目対応・ゲスト観客の最終仕様確定）：/live は
//    resolveLiveScreenGateの結果を使い、profile取得中はauthLoadingと同じ扱いで
//    待機する。ゲストが本番ライブを開いた場合に一律ブロックする
//    「official-guest-blocked」分岐は、最終仕様（ゲストは本番・テストどちらも
//    観客として視聴できる）と矛盾するため廃止した。
{
  assert.ok(
    /import \{ resolveLiveScreenGate \} from "@\/lib\/liveGuestAccess";/.test(livePage),
    "/liveがresolveLiveScreenGate(src/lib/liveGuestAccess.ts)をimportしていない",
  );
  assert.ok(
    /screenGate === "auth-loading" \|\| screenGate === "profile-loading"/.test(livePage),
    "/liveがprofileLoading中をauthLoadingと同じ扱いで待機していない",
  );
  assert.ok(
    !/official-guest-blocked/.test(livePage),
    "/liveに、最終仕様と矛盾するofficial-guest-blocked分岐がまだ残っている",
  );
  assert.ok(
    !/isAnonymous:/.test(livePage.slice(livePage.indexOf("resolveLiveScreenGate({"), livePage.indexOf("resolveLiveScreenGate({") + 300)),
    "/liveのresolveLiveScreenGate呼び出しに、廃止したisAnonymouseパラメータがまだ渡されている",
  );
  console.log(
    "PASS: /liveはprofile取得中を待機し、official-guest-blocked分岐は最終仕様に合わせて廃止されている",
  );
}

// 7（再々レビュー対応）：MyProfileEditModalは開いた時点のauthUserIdを保持し、
//    開いている間にidが変わったら（会員A→会員B・ゲストへの切り替え等）即座に
//    onClose()する。実際の状態遷移はReactテスト基盤が無いためソース検査に留め、
//    store側の多層防御（guardOwnProfileUpdate/isStillSameOwner）は
//    useProfileStoreUpdate.check.tsで実際に呼び出して検証済み。
{
  assert.ok(
    /const \[openedForUserId\] = useState\(authUserId\);/.test(myProfileEditModal),
    "MyProfileEditModalが開いた時点のauthUserIdを保持していない",
  );
  assert.ok(
    /if \(authUserId !== openedForUserId\) onClose\(\);/.test(myProfileEditModal),
    "MyProfileEditModalがauthUserIdの変化を検知してonClose()していない",
  );
  console.log("PASS: MyProfileEditModalは開いた時点のauthUserIdを保持し、変わったら即座に閉じる");
}

// 7b（再々レビュー2回目対応）：MyProfileEditModalは、isConfirmedMemberでない間
//    （ゲスト・未ログイン・profile取得中・id不一致）はフォーム自体を表示・送信
//    しない。未ログイン／ゲスト向けのダミー編集フォールバック（useUserStoreの
//    現在値を直接編集する経路）は完全に削除されている。useUserStore（ライブ中の
//    自分表示用ローカルstate）への書き込みは、所有者確認より後にだけ行う。
{
  assert.ok(
    /const isMember = isConfirmedMember\(\{ authUser, profile, profileLoading \}\);/.test(myProfileEditModal),
    "MyProfileEditModalがisConfirmedMemberで本人確認していない",
  );
  assert.ok(
    /if \(!isMember \|\| !profile\) \{/.test(myProfileEditModal),
    "MyProfileEditModalが確定会員でない場合にフォームの代わりの表示へ分岐していない",
  );
  assert.ok(
    !/const user = useUserStore\(\(s\) => s\.user\);/.test(myProfileEditModal),
    "MyProfileEditModalに未ログイン／ゲスト向けのダミー編集フォールバック（useUserStoreの現在値取得）がまだ残っている",
  );
  assert.ok(
    !/未ログイン時はダミーストアの名前だけその場で書き換える/.test(myProfileEditModal),
    "MyProfileEditModalに未ログイン時のダミー編集フォールバックのコメント・分岐がまだ残っている",
  );

  const ownershipCheckIdx = myProfileEditModal.indexOf(
    "if (useAuthStore.getState().user?.id !== openedForUserId) {",
  );
  assert.ok(ownershipCheckIdx >= 0, "MyProfileEditModalの送信処理に送信直前の所有者確認が無い");
  const userStoreWriteIdx = myProfileEditModal.indexOf("updateAvatarColor(color);");
  assert.ok(userStoreWriteIdx >= 0, "MyProfileEditModalがuseUserStoreへアイコン色を反映していない");
  assert.ok(
    ownershipCheckIdx < userStoreWriteIdx,
    "MyProfileEditModalがuseUserStoreへの書き込みを所有者確認より前に行っている",
  );
  console.log(
    "PASS: MyProfileEditModalは確定会員以外にフォームを表示・送信せず、useUserStoreへの書き込みは所有者確認より後にのみ行う",
  );
}

// 8（再々レビュー対応）：MyStatsModalはisConfirmedMemberの時だけ実データを表示し、
//    開いている間にauthUserIdが変わったら即座に閉じる。
{
  assert.ok(
    /const isMember = isConfirmedMember\(\{ authUser, profile, profileLoading \}\);/.test(myStatsModal),
    "MyStatsModalがisConfirmedMemberで本人確認していない",
  );
  assert.ok(
    /const masteryMeter = isMember \? \(profile\?\.masteryMeter \?\? 0\) : 0;/.test(myStatsModal),
    "MyStatsModalのmasteryMeterがisConfirmedMemberでガードされていない（本人確認できない間も実績が見える可能性）",
  );
  assert.ok(
    /if \(open && openedForUserId !== null && authUserId !== openedForUserId\) onClose\(\);/.test(myStatsModal),
    "MyStatsModalがauthUserIdの変化を検知してonClose()していない",
  );
  console.log("PASS: MyStatsModalは本人確認できた場合だけ実績を表示し、authUserIdが変わったら即座に閉じる");
}

// 9（再々レビュー対応）：ReportButtonはゲストに対して通報ボタン自体を表示しない
//    （押せるのに拒否される体験を避ける。閲覧は引き続き許可）。
{
  assert.ok(
    /if \(isGuestUser\(authUser, profile\)\) return null;/.test(reportButton),
    "ReportButtonがゲストに対してnullを返す早期returnを持っていない",
  );
  console.log("PASS: ReportButtonはゲストに対して表示されない");
}

// 10（再々レビュー対応）：SnsFollowButtonはゲストに対してフォローボタン自体を
//    表示しない。
{
  assert.ok(
    /if \(isGuestUser\(authUser, profile\)\) return null;/.test(snsFollowButton),
    "SnsFollowButtonがゲストに対してnullを返す早期returnを持っていない",
  );
  console.log("PASS: SnsFollowButtonはゲストに対して表示されない");
}

// 11（再々レビュー対応）：SnsTopicDetail（お題詳細＋回答投稿）は、ゲストには
//    回答の投稿入力欄・送信ボタンを表示せず案内文に差し替え、いいねボタンも
//    操作不可の静的表示に差し替える（閲覧・件数表示は引き続き許可）。
{
  assert.ok(
    /const isGuest = isGuestUser\(authUser, profile\);/.test(snsTopicDetail),
    "SnsTopicDetailにisGuest判定が無い",
  );
  const formGuestIdx = snsTopicDetail.indexOf("{isGuest ? (");
  assert.ok(formGuestIdx >= 0, "SnsTopicDetailに{isGuest ? (…分岐が見つからない");
  const formBlock = snsTopicDetail.slice(formGuestIdx, formGuestIdx + 400);
  assert.ok(
    /ゲストは回答できません/.test(formBlock),
    "SnsTopicDetailがゲストに対して回答フォームの代わりの案内文を出していない",
  );
  const likeGuestIdx = snsTopicDetail.indexOf("{isGuest ? (", formGuestIdx + 1);
  assert.ok(likeGuestIdx >= 0, "SnsTopicDetailのいいねボタンに{isGuest ? (…分岐が見つからない");
  const likeBlock = snsTopicDetail.slice(likeGuestIdx, likeGuestIdx + 600);
  assert.ok(
    /<span className="mt-1 flex shrink-0/.test(likeBlock),
    "SnsTopicDetailのいいねボタンがゲストに対して静的表示へ差し替わっていない",
  );
  console.log("PASS: SnsTopicDetailはゲストに回答フォーム・いいねボタンを表示しない（閲覧は許可）");
}

// 12（再々レビュー対応）：SnsAnswerDetail（回答詳細＋ツッコミ投稿）も同様に、
//    ゲストにはツッコミ投稿欄・いいねボタンを表示しない。
{
  assert.ok(
    /const isGuest = isGuestUser\(authUser, profile\);/.test(snsAnswerDetail),
    "SnsAnswerDetailにisGuest判定が無い",
  );
  const likeGuestIdx = snsAnswerDetail.indexOf("{isGuest ? (");
  assert.ok(likeGuestIdx >= 0, "SnsAnswerDetailのいいねボタンに{isGuest ? (…分岐が見つからない");
  const likeBlock = snsAnswerDetail.slice(likeGuestIdx, likeGuestIdx + 600);
  assert.ok(
    /<span className="flex w-fit items-center/.test(likeBlock),
    "SnsAnswerDetailのいいねボタンがゲストに対して静的表示へ差し替わっていない",
  );
  const formGuestIdx = snsAnswerDetail.indexOf("{isGuest ? (", likeGuestIdx + 1);
  assert.ok(formGuestIdx >= 0, "SnsAnswerDetailに{isGuest ? (…分岐（ツッコミフォーム）が見つからない");
  const formBlock = snsAnswerDetail.slice(formGuestIdx, formGuestIdx + 400);
  assert.ok(
    /ゲストはツッコめません/.test(formBlock),
    "SnsAnswerDetailがゲストに対してツッコミフォームの代わりの案内文を出していない",
  );
  console.log("PASS: SnsAnswerDetailはゲストにツッコミフォーム・いいねボタンを表示しない（閲覧は許可）");
}

// 13（再々レビュー対応）：SnsFeedSectionは、ゲストには「お題を投稿する」導線を
//    表示せず、案内文に差し替える。
{
  assert.ok(
    /const isGuest = isGuestUser\(authUser, profile\);/.test(snsFeedSection),
    "SnsFeedSectionにisGuest判定が無い",
  );
  const guestIdx = snsFeedSection.indexOf("{isGuest ? (");
  assert.ok(guestIdx >= 0, "SnsFeedSectionに{isGuest ? (…分岐が見つからない");
  const block = snsFeedSection.slice(guestIdx, guestIdx + 400);
  assert.ok(
    /ゲスト参加中です。ログインすると投稿やリアクションができます/.test(block),
    "SnsFeedSectionがゲストに対して投稿導線の代わりの案内文を出していない",
  );
  console.log("PASS: SnsFeedSectionはゲストに「お題を投稿する」導線を表示しない");
}

// 14（再々レビュー対応）：SnsLiveResultBody（ライブ結果のいいね・コメント）も、
//    ゲストにはいいねボタン・コメント入力欄を表示しない（閲覧・コメント一覧は許可）。
{
  assert.ok(
    /const isGuest = isGuestUser\(authUser, profile\);/.test(snsLiveResultBody),
    "SnsLiveResultBodyにisGuest判定が無い",
  );
  const likeGuestIdx = snsLiveResultBody.indexOf("{isGuest ? (");
  assert.ok(likeGuestIdx >= 0, "SnsLiveResultBodyのいいねボタンに{isGuest ? (…分岐が見つからない");
  const likeBlock = snsLiveResultBody.slice(likeGuestIdx, likeGuestIdx + 500);
  assert.ok(
    /<span className="flex items-center gap-1 rounded-full border border-\[var\(--ink\)\]\/15/.test(likeBlock),
    "SnsLiveResultBodyのいいねボタンがゲストに対して静的表示へ差し替わっていない",
  );
  assert.ok(
    /ゲストはコメントできません。ログインしてください。/.test(snsLiveResultBody),
    "SnsLiveResultBodyがゲストに対してコメント入力欄の代わりの案内文を出していない",
  );
  console.log("PASS: SnsLiveResultBodyはゲストにいいねボタン・コメント入力欄を表示しない（閲覧・コメント一覧は許可）");
}

// 15（2026-09-13ゲスト観客対応）：OpeningViewはゲストにプレイヤー希望ボタン・
//    「あとからプレイヤーへ変更できます」文言・プレイヤーへの変更ボタンを
//    一切表示しない（閲覧・観客参加は引き続き許可）。
{
  assert.ok(
    /const isGuest = isGuestUser\(authUser, profile\);/.test(openingView),
    "OpeningViewにisGuest判定が無い",
  );
  assert.ok(
    /\{!isGuest && \(/.test(openingView),
    "OpeningViewのプレイヤー参加ボタンが{!isGuest && (…で分岐していない",
  );
  assert.ok(
    !/あとからプレイヤーへ変更できます/.test(openingView) || /isGuest\s*\n?\s*\?\s*"観客として参加しますか？"/.test(openingView),
    "OpeningViewの確認ダイアログが、ゲストにも「あとからプレイヤーへ変更できます」と案内してしまっている",
  );
  console.log("PASS: OpeningViewはゲストにプレイヤー関連のボタン・案内文を表示しない");
}

// 16（2026-09-13ゲスト観客対応）：AudienceAnsweringViewのhandleScoreは、
//    ScoreButtonsのisJudge非表示だけに頼らず、canJudgeでも明示的に採点処理を
//    止める。
{
  const handleScoreIdx = audienceAnsweringView.indexOf("const handleScore = async");
  assert.ok(handleScoreIdx >= 0, "AudienceAnsweringViewにhandleScoreが見つからない");
  const block = audienceAnsweringView.slice(handleScoreIdx, handleScoreIdx + 300);
  assert.ok(
    /if \(!canJudge\) return;/.test(block),
    "AudienceAnsweringViewのhandleScoreがcanJudgeを明示的に確認していない",
  );
  console.log("PASS: AudienceAnsweringViewのhandleScoreはcanJudgeで採点処理を明示的にガードする");
}

// 17（2026-09-13ゲスト観客対応）：useLiveFollowerStoreは、submitMyAnswer/
//    submitMyScoreの双方でゲストを明示的にブロックし、joinLiveの
//    GUEST_AUDIENCE_ONLYエラーを日本語文言へ変換する（旧仕様のGUEST_OFFICIAL_
//    NOT_ALLOWEDは廃止された）。submitMyAnswerは生のSupabaseエラーも画面へ
//    返さない。
{
  assert.ok(
    !/GUEST_OFFICIAL_NOT_ALLOWED/.test(liveFollowerStore),
    "useLiveFollowerStoreに廃止したはずのGUEST_OFFICIAL_NOT_ALLOWED参照がまだ残っている",
  );
  assert.ok(
    /GUEST_AUDIENCE_ONLY/.test(liveFollowerStore),
    "useLiveFollowerStoreのjoinLiveエラー処理がGUEST_AUDIENCE_ONLYを扱っていない",
  );
  const submitAnswerIdx = liveFollowerStore.indexOf("submitMyAnswer: async");
  assert.ok(submitAnswerIdx >= 0, "useLiveFollowerStoreにsubmitMyAnswerが見つからない");
  const answerBlock = liveFollowerStore.slice(submitAnswerIdx, submitAnswerIdx + 600);
  assert.ok(
    /isGuestUser\(useAuthStore\.getState\(\)\.user, useProfileStore\.getState\(\)\.profile\)/.test(answerBlock),
    "submitMyAnswerがisGuestUserで明示的にゲストを拒否していない",
  );
  const submitScoreIdx = liveFollowerStore.indexOf("submitMyScore: async");
  assert.ok(submitScoreIdx >= 0, "useLiveFollowerStoreにsubmitMyScoreが見つからない");
  const scoreBlock = liveFollowerStore.slice(submitScoreIdx, submitScoreIdx + 900);
  assert.ok(
    /isGuestUser\(useAuthStore\.getState\(\)\.user, useProfileStore\.getState\(\)\.profile\)/.test(scoreBlock),
    "submitMyScoreがisGuestUserで明示的にゲストを拒否していない",
  );
  assert.ok(
    !/reason: error\.message/.test(answerBlock),
    "submitMyAnswerが生のSupabaseエラー(error.message)をそのまま返している",
  );
  console.log("PASS: useLiveFollowerStoreはsubmitMyAnswer/submitMyScoreの双方でゲストを明示的に拒否し、生のエラーも返さない");
}

// 18（3回目レビュー対応・participants読み取り範囲の厳格化）：useLiveFollowerStore
//    は、一般参加者向けの参加者一覧取得を生のparticipantsテーブル直接SELECTから
//    安全なRPC(participants_for_live)へ切り替えている。あわせて、Realtimeの
//    参加者変更通知も、RLS厳格化後は一般参加者に配信されなくなるparticipants
//    テーブル直接購読ではなく、無害な合図テーブル(participants_change_pings)を
//    購読するように変えている。
{
  assert.ok(
    /\.rpc\(\s*"participants_for_live"/.test(liveFollowerStore),
    "useLiveFollowerStoreがparticipants_for_live RPCを呼んでいない",
  );
  assert.ok(
    /table: "participants_change_pings"/.test(liveFollowerStore),
    "useLiveFollowerStoreのRealtime購読がparticipants_change_pingsへ切り替わっていない",
  );
  // 2026-09-14（再レビュー対応）：pingsテーブルは「ライブ1件につき1行」を
  // upsertする設計（INSERTは初回だけ、2件目以降はUPDATE）に変わったため、
  // 購読イベントがINSERT限定のままだと2件目以降の変更を取りこぼす。
  const pingsChannelIdx = liveFollowerStore.indexOf('table: "participants_change_pings"');
  const pingsChannelBlock = liveFollowerStore.slice(Math.max(0, pingsChannelIdx - 200), pingsChannelIdx);
  assert.ok(
    /event:\s*"\*"/.test(pingsChannelBlock),
    "useLiveFollowerStoreのparticipants_change_pings購読がINSERT限定のままで、UPDATE後に再取得しない",
  );
  console.log("PASS: useLiveFollowerStoreは参加者一覧取得・Realtime購読の双方を安全な経路へ切り替え、INSERT/UPDATEの両方で再取得する");
}

// 19（3回目レビュー対応）：useSnsLiveResultsStoreも、participant_id→user_idの
//    解決を生のparticipants直接SELECTから安全なRPC(sns_result_participant_user_ids)
//    へ切り替えている（2箇所とも）。
{
  const matches = snsLiveResultsStore.match(/sns_result_participant_user_ids/g) ?? [];
  assert.ok(
    matches.length >= 2,
    `useSnsLiveResultsStoreでsns_result_participant_user_idsの呼び出しが2箇所未満(実際=${matches.length})`,
  );
  assert.ok(
    !/\.from\("participants"\)/.test(snsLiveResultsStore),
    "useSnsLiveResultsStoreにparticipantsテーブルへの生のSELECTがまだ残っている",
  );
  console.log("PASS: useSnsLiveResultsStoreはparticipant_id→user_idの解決を安全なRPCへ切り替えている");
}

// 20（3回目レビュー対応）：未ログイン画面の文言が「プレイヤーとして参加するには
//    ログインが必要です」に変わり、ゲストが観客専用であることが一読でわかる
//    構成になっている。
// 2026-09-16（複数プロバイダー対応）：X固定文言から、プロバイダーを問わない
// 「ログインが必要です」へ一般化した。
{
  assert.ok(
    /プレイヤーとして参加するにはログインが必要です/.test(livePage),
    "/liveの未ログイン画面の文言が「プレイヤーとして参加するには」に変わっていない",
  );
  console.log("PASS: /liveの未ログイン画面は、プレイヤー参加とゲスト観客の違いが一読でわかる文言になっている");
}

console.log("ALL GUEST_PARTICIPATION WIRING CHECKS PASSED");
