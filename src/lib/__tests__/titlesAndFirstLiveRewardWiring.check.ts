// 配線確認：称号システム・初回本番ライブ(#0001)限定特典（supabase/migrations/0081）の
// フロント側配線を、ソースの静的検査で確認する。実際のDB権限・冪等性はsupabase/tests/
// 0081_titles_and_first_live_rewards.test.sqlが、single-flight/冪等性のロジックは
// src/lib/__tests__/store/useFirstLiveRewardStore.check.tsが検証する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const titleSelectModal = readFileSync(join(process.cwd(), "src", "components", "app", "TitleSelectModal.tsx"), "utf8");
const myProfileTicket = readFileSync(join(process.cwd(), "src", "components", "home", "MyProfileTicket.tsx"), "utf8");
const myProfileEditModal = readFileSync(join(process.cwd(), "src", "components", "app", "MyProfileEditModal.tsx"), "utf8");
const avatarGlyph = readFileSync(join(process.cwd(), "src", "components", "app", "AvatarGlyph.tsx"), "utf8");
const finalResultView = readFileSync(join(process.cwd(), "src", "components", "live-room", "FinalResultView.tsx"), "utf8");
const firstLiveRewardModal = readFileSync(
  join(process.cwd(), "src", "components", "live-room", "FirstLiveRewardModal.tsx"),
  "utf8",
);
const livePage = readFileSync(join(process.cwd(), "src", "app", "live", "page.tsx"), "utf8");
const privacyPage = readFileSync(join(process.cwd(), "src", "app", "privacy", "page.tsx"), "utf8");
const adminTitlesPage = readFileSync(join(process.cwd(), "src", "app", "admin", "titles", "page.tsx"), "utf8");
const openingView = readFileSync(join(process.cwd(), "src", "components", "live-room", "OpeningView.tsx"), "utf8");
const firstLiveRewardAnnouncement = readFileSync(
  join(process.cwd(), "src", "components", "live-room", "FirstLiveRewardAnnouncement.tsx"),
  "utf8",
);
const firstLiveRewardStore = readFileSync(
  join(process.cwd(), "src", "store", "useFirstLiveRewardStore.ts"),
  "utf8",
);
const migration0081 = readFileSync(
  join(process.cwd(), "supabase", "migrations", "0081_titles_and_first_live_rewards.sql"),
  "utf8",
);

// 1: TitleSelectModalは、未所有の限定称号を選択肢に出さない（kind==='normal'か、
//    本人が所有している限定称号だけをフィルタする）。
{
  assert.ok(
    /selectableTitles = \(titles \?\? \[\]\)\.filter\(\s*\(t\) => t\.kind === "normal" \|\| ownedLimitedSlugs\.includes\(t\.slug\)/.test(
      titleSelectModal,
    ),
    "TitleSelectModalが未所有の限定称号を除外するフィルタを持っていない",
  );
  console.log("PASS: TitleSelectModalは未所有の限定称号を選択肢から除外する");
}

// 2: TitleSelectModalは、開いた後にアカウントが切り替わったら即座に閉じる
//    （MyProfileEditModalと同じopenedForUserIdガードパターン）。
{
  assert.ok(
    /const \[openedForUserId\] = useState\(authUserId\);/.test(titleSelectModal) &&
      /if \(authUserId !== openedForUserId\) onClose\(\);/.test(titleSelectModal),
    "TitleSelectModalにアカウント切替時の自動クローズガードが無い",
  );
  assert.ok(
    /if \(useAuthStore\.getState\(\)\.user\?\.id !== openedForUserId\)/.test(titleSelectModal),
    "TitleSelectModalの装備実行直前に、切り替わっていないかの再確認が無い",
  );
  console.log("PASS: TitleSelectModalはアカウント切替時に閉じ、送信直前にも本人確認する（前ユーザーの所有情報を表示しない）");
}

// 3: マイページ（MyProfileTicket）の段位表示の横に、選択中の称号（未選択時は
//    「称号を選ぶ」）を表示し、TitleSelectModalへの導線を持つ。
{
  assert.ok(
    /段位：\{rank\.label\}/.test(myProfileTicket),
    "MyProfileTicketの段位表示が見当たらない",
  );
  assert.ok(
    /equippedTitleName \? `［\$\{equippedTitleName\}］` : "称号を選ぶ"/.test(myProfileTicket),
    "MyProfileTicketが称号名または「称号を選ぶ」を表示していない",
  );
  assert.ok(/<TitleSelectModal onClose=/.test(myProfileTicket), "MyProfileTicketがTitleSelectModalを開く導線を持っていない");
  console.log("PASS: マイページの段位の横に選択中の称号（未選択時は「称号を選ぶ」）が表示され、称号選択モーダルへ導線がある");
}

// 4: AvatarGlyphは、fullColorSrcが指定された場合、CSS mask（線画+単色塗り）を
//    一切使わず、画像をそのままフルカラー表示する（早期returnでmask分岐を通らない）。
{
  const fullColorBranchIdx = avatarGlyph.indexOf("if (fullColorSrc) {");
  const maskStyleIdx = avatarGlyph.indexOf("const maskStyle");
  assert.ok(fullColorBranchIdx >= 0, "AvatarGlyphにfullColorSrc分岐が無い");
  assert.ok(maskStyleIdx >= 0, "AvatarGlyphにmaskStyle定義が見当たらない");
  assert.ok(fullColorBranchIdx < maskStyleIdx, "fullColorSrc分岐がmaskStyle定義より後にあり、早期returnになっていない可能性がある");
  const fullColorBlock = avatarGlyph.slice(fullColorBranchIdx, maskStyleIdx);
  assert.ok(/return \(/.test(fullColorBlock), "fullColorSrc分岐がreturnしていない（mask処理へ流れ落ちる可能性）");
  assert.ok(!/WebkitMaskImage/.test(fullColorBlock), "fullColorSrc分岐の中でCSS maskが使われている（単色化されてしまう）");
  console.log("PASS: 限定アイコン(fullColorSrc)はCSS maskを使わず、フルカラーのまま表示される");
}

// 5: MyProfileEditModalで限定アイコンを選択しても、通常アイコンのicon/color state
//    自体は変更されない（別の状態(limitedIconSlug)として持ち、保存時は常に
//    updateAvatar(icon, color)を呼ぶ＝通常アイコンへ戻した時に元の色が復元される）。
{
  const limitedButtonIdx = myProfileEditModal.indexOf("onClick={() => setLimitedIconSlug(slug)}");
  assert.ok(limitedButtonIdx >= 0, "MyProfileEditModalに限定アイコン選択ボタンが見当たらない");
  const nearbyBlock = myProfileEditModal.slice(Math.max(0, limitedButtonIdx - 400), limitedButtonIdx + 50);
  assert.ok(!/setIcon\(/.test(nearbyBlock) && !/setColor\(/.test(nearbyBlock), "限定アイコン選択時に通常アイコンのicon/colorが変更されている");
  assert.ok(
    /const avatarResult = await updateAvatar\(icon, color\);/.test(myProfileEditModal),
    "保存時に通常アイコン(icon, color)を保存する処理が見当たらない（限定アイコン解除時に色が失われる恐れ）",
  );
  assert.ok(
    /setEquippedLimitedIcon\(limitedIconSlug\)/.test(myProfileEditModal),
    "保存時にset_equipped_limited_icon経由での限定アイコン装備更新が見当たらない",
  );
  console.log("PASS: 限定アイコンを選択しても通常アイコンの色は消えず、通常アイコンへ戻した時に復元される");
}

// 6: FinalResultViewは、official #1・非緊急中止・非ゲストの場合だけ到達記録・付与を
//    試行し、リロード・visibilitychange・pageshow・online・Realtime再接続（dataの
//    再生成）のいずれでも再試行し、実行中に利用者が切り替わっていたら結果を反映しない。
{
  assert.ok(
    /liveMode === "official" && officialSequenceNumber === 1 && !emergencyClosed && !isGuest/.test(finalResultView),
    "FinalResultViewがofficial #1・非緊急中止・非ゲストの条件で絞り込んでいない",
  );
  assert.ok(
    /document\.addEventListener\("visibilitychange", onVisible\)/.test(finalResultView) &&
      /window\.addEventListener\("pageshow", run\)/.test(finalResultView) &&
      /window\.addEventListener\("online", run\)/.test(finalResultView),
    "FinalResultViewにvisibilitychange/pageshow/onlineでの再試行が無い",
  );
  assert.ok(
    /if \(useAuthStore\.getState\(\)\.user\?\.id !== startedUserId\) return;/.test(finalResultView),
    "FinalResultViewに、実行中に利用者が切り替わっていた場合の結果破棄ガードが無い",
  );
  assert.ok(
    /\}, \[isEligibleForFirstLiveReward, authUser\?\.id, liveId, data\]\);/.test(finalResultView),
    "FinalResultViewの到達記録エフェクトがdataの変化（Realtime再接続によるrefetchAll）で再試行されない",
  );
  assert.ok(
    /result\?\.newlyGranted\) \{/.test(finalResultView) && /setShowFirstLiveRewardModal\(true\)/.test(finalResultView),
    "FinalResultViewがnewlyGranted=trueの場合だけモーダルを出す判定になっていない",
  );
  assert.ok(
    /setFirstLiveRewardTitleName\(result\.titleDisplayName\)/.test(finalResultView),
    "FinalResultViewがgrant結果のtitleDisplayNameを獲得モーダルへ渡す状態を保持していない",
  );
  assert.ok(
    /<FirstLiveRewardModal[\s\S]{0,80}titleDisplayName=\{firstLiveRewardTitleName\}/.test(finalResultView),
    "FinalResultViewがFirstLiveRewardModalへtitleDisplayNameを渡していない",
  );
  console.log("PASS: FinalResultViewはofficial #1限定で到達記録・付与を試行し、各種再試行条件・利用者切替ガード・動的な表示名の受け渡しを備える");
}

// 7: 獲得モーダル(FirstLiveRewardModal)は指定の文言を含み、称号の表示名は
//    ハードコードせずtitleDisplayName（運営が改称可能なtitles.display_name）を使う。
//    取得できなかった場合は生のエラーではなく安全な一般文言へフォールバックする。
{
  assert.ok(/初回ライブ限定特典を獲得しました/.test(firstLiveRewardModal), "獲得モーダルに指定文言が無い");
  assert.ok(
    /titleDisplayName\?: string \| null/.test(firstLiveRewardModal),
    "獲得モーダルがtitleDisplayNameをpropsで受け取っていない（表示名がハードコードされている疑い）",
  );
  assert.ok(
    /titleDisplayName \? `限定称号「\$\{titleDisplayName\}」` : "限定称号を獲得しました"/.test(firstLiveRewardModal),
    "獲得モーダルが動的な表示名を使い、取得失敗時に安全な一般文言へフォールバックする実装になっていない",
  );
  assert.ok(/マイページで選択できます/.test(firstLiveRewardModal), "獲得モーダルに案内文言が無い");
  console.log("PASS: 獲得モーダルは指定の文言を表示し、称号名は運営が改称可能なtitleDisplayNameを動的に使う（取得失敗時はフォールバック）");
}

// 8: 初回ライブ限定特典の案内(FirstLiveRewardAnnouncement)は、未ログインの参加入口
//    (/live)とXログイン済みの参加受付画面(OpeningView)の両方から共通コンポーネント
//    経由で表示され、文言・表示条件が重複実装されていない。公式#0001・非緊急中止の
//    時だけ表示し、表示名はtitles.display_nameを動的に取得する（ハードコードしない）。
{
  assert.ok(
    /liveMode === "official" && officialSequenceNumber === 1 && !emergencyClosed/.test(firstLiveRewardAnnouncement),
    "FirstLiveRewardAnnouncementの表示条件が公式#0001・非緊急中止限定になっていない",
  );
  assert.ok(
    /最終結果まで参加したXログイン会員に、限定称号「\{titleName\}」と限定アイコンをプレゼントします。ゲスト参加は対象外です。/.test(
      firstLiveRewardAnnouncement,
    ),
    "FirstLiveRewardAnnouncementの案内文言が指定のものと一致しない、または表示名がハードコードされている",
  );
  assert.ok(
    /from\("titles"\)/.test(firstLiveRewardAnnouncement) && /eq\("slug", "first-witness"\)/.test(firstLiveRewardAnnouncement),
    "FirstLiveRewardAnnouncementがtitles.display_nameを動的に取得していない",
  );
  console.log("PASS: FirstLiveRewardAnnouncementは公式#0001・非緊急中止の時だけ、運営が変更可能な表示名を使って案内する");
}

// 8b: /liveの未ログイン参加入口とOpeningView（Xログイン済みの参加受付画面）の
//     両方が、8番の共通コンポーネントを実際に使っている（重複実装の防止）。
{
  const notAuthIdx = livePage.indexOf('if (screenGate === "not-authenticated") {');
  assert.ok(notAuthIdx >= 0, "/live に screenGate===\"not-authenticated\"の未ログイン分岐が見つからない");
  const block = livePage.slice(notAuthIdx, notAuthIdx + 4000);
  assert.ok(/<FirstLiveRewardAnnouncement/.test(block), "/live の未ログイン参加入口がFirstLiveRewardAnnouncementを使っていない");
  assert.ok(/ログインせず観客として見る/.test(block), "案内文言追加後もゲスト観戦ボタンの文言が残っていない");
  assert.ok(
    /<FirstLiveRewardAnnouncement/.test(openingView),
    "OpeningView（Xログイン済みの参加受付画面）がFirstLiveRewardAnnouncementを使っていない（ログイン済みユーザーに案内が出ない）",
  );
  console.log("PASS: 未ログインの参加入口・Xログイン済みの参加受付画面(OpeningView)の両方が共通の案内コンポーネントを使う");
}

// 9: プライバシーポリシーの公開プロフィール情報の説明に「称号」が追加されている。
{
  const profileInfoIdx = privacyPage.indexOf("プロフィール情報");
  assert.ok(profileInfoIdx >= 0, "プライバシーポリシーに「プロフィール情報」の項目が見当たらない");
  const profileInfoBlock = privacyPage.slice(profileInfoIdx, profileInfoIdx + 200);
  assert.ok(
    /表示名（演者名）、アイコン（種類・色の組み合わせ、又は初回ライブ参加記念の限定アイコン）、一言コメント、選択中の称号/.test(
      profileInfoBlock,
    ),
    "プライバシーポリシーのプロフィール情報の説明に称号が追加されていない",
  );
  console.log("PASS: プライバシーポリシーのプロフィール情報の説明に「称号」が追加されている");
}

// 10: 管理画面(/admin/titles)は、表示名・説明文・並び順・公開状態の編集、内部ID(slug)の
//     編集不可、所有者数確認、初回ライブ到達記録一覧、未付与者への再付与を備える。
{
  assert.ok(/admin_update_title/.test(adminTitlesPage), "管理画面がadmin_update_titleを呼んでいない");
  assert.ok(!/p_slug:.*draft\.slug|input.*slug.*onChange/.test(adminTitlesPage), "内部ID(slug)を編集できる入力欄がある可能性");
  assert.ok(/所有者数/.test(adminTitlesPage), "管理画面に所有者数の表示が無い");
  assert.ok(/admin_list_final_result_presence/.test(adminTitlesPage), "管理画面が到達記録一覧RPCを呼んでいない");
  assert.ok(/admin_regrant_first_live_reward/.test(adminTitlesPage), "管理画面が再付与RPCを呼んでいない");
  assert.ok(/参加登録があるだけの利用者への一括付与はできません/.test(adminTitlesPage), "一括付与不可の注記が無い");
  assert.ok(
    /admin_count_x_login_members/.test(adminTitlesPage),
    "管理画面が通常称号の所有者数を運営専用RPC(admin_count_x_login_members)で取得していない（is_guest=falseの単純カウントだとボットが混入する）",
  );
  assert.ok(
    !/from\("profiles"\)\s*\.select\("id", \{ count: "exact", head: true \}\)\s*\.eq\("is_guest", false\)/.test(adminTitlesPage),
    "管理画面が依然としてis_guest=falseの単純カウントで所有者数を出している（ボットが混入する）",
  );
  assert.ok(
    /newly_granted/.test(adminTitlesPage),
    "管理画面がadmin_regrant_first_live_rewardの戻り値(newly_granted)を複合型として扱っていない",
  );
  console.log("PASS: 管理画面(/admin/titles)は表示名等の編集・実際のXログイン会員数(所有者数)・到達記録一覧・個別再付与を備え、内部IDは編集不可");
}

// 11: マイグレーション0081が、新規テーブルへのINSERT/UPDATE/DELETEをanon/authenticatedから
//     明示的にrevokeしている（このプロジェクトのデフォルト権限は新規テーブルに
//     自動でINSERT/UPDATE/DELETEを付与するため、これが無いと直接書き込める）。
{
  for (const table of ["titles", "user_titles", "user_limited_icons", "final_result_presence"]) {
    const re = new RegExp(`revoke insert, update, delete on public\\.${table} from anon, authenticated;`);
    assert.ok(re.test(migration0081), `0081がpublic.${table}のINSERT/UPDATE/DELETEをanon/authenticatedからrevokeしていない`);
  }
  assert.ok(
    /profiles_equipped_limited_icon_slug_check/.test(migration0081),
    "profiles.equipped_limited_icon_slugの許容値を固定するCHECK制約が無い",
  );
  console.log("PASS: 0081は新規テーブルへの直接書き込みをanon/authenticatedから明示的にrevokeし、限定アイコンの値も固定している");
}

// 12: _is_x_login_identityは、auth.identities.provider='x'・raw_app_meta_data->>'provider'・
//     raw_app_meta_data->'providers'配列の3層で確認する（「非匿名だから」では判定しない）。
{
  const fnIdx = migration0081.indexOf("function public._is_x_login_identity");
  assert.ok(fnIdx >= 0, "_is_x_login_identityの定義が見つからない");
  const fnBlock = migration0081.slice(fnIdx, fnIdx + 1200);
  assert.ok(/auth\.identities i where i\.user_id = p_user_id and i\.provider = 'x'/.test(fnBlock), "_is_x_login_identityがauth.identitiesを確認していない");
  assert.ok(
    /raw_app_meta_data ->> 'provider' from auth\.users u where u\.id = p_user_id\) = 'x'/.test(fnBlock),
    "_is_x_login_identityがraw_app_meta_data->>'provider'を確認していない",
  );
  assert.ok(/raw_app_meta_data -> 'providers' \? 'x'/.test(fnBlock), "_is_x_login_identityがraw_app_meta_data->'providers'配列を確認していない");
  console.log("PASS: _is_x_login_identityはauth.identities・provider・providers配列の3層でXログインを確認する");
}

// 13: 通常称号・限定称号・限定アイコンの装備RPC(set_equipped_title/
//     set_equipped_limited_icon)は、いずれもXログイン会員であることをDB側で
//     確認する（UIの非表示だけに依存しない。email/passwordボットを拒否するため）。
{
  for (const fn of ["set_equipped_title", "set_equipped_limited_icon"]) {
    const fnIdx = migration0081.indexOf(`function public.${fn}(`);
    assert.ok(fnIdx >= 0, `${fn}の定義が見つからない`);
    const fnBlock = migration0081.slice(fnIdx, fnIdx + 900);
    assert.ok(
      /if not public\._is_x_login_identity\(v_uid\) then\s*\n\s*raise exception 'NOT_X_LOGIN';/.test(fnBlock),
      `${fn}がXログイン会員であることをDB側で確認していない`,
    );
  }
  console.log("PASS: set_equipped_title/set_equipped_limited_iconはいずれもXログイン会員のみに限定される（DB側で検証、UI非表示だけに依存しない）");
}

// 14: mark_final_result_presenceは、lives→participantsの順でFOR UPDATEロックを
//     取得してから状態を確認する（close_live/kick_participantとの行ロック競合を
//     防ぐため）。
{
  const markIdx = migration0081.indexOf("function public.mark_final_result_presence");
  const markBlock = migration0081.slice(markIdx, markIdx + 2200);
  assert.ok(/from public\.lives where id = p_live_id for update;/.test(markBlock), "mark_final_result_presenceがlives行をFOR UPDATEでロックしていない");
  assert.ok(
    /from public\.participants\s*\n\s*where live_id = p_live_id and user_id = v_uid for update;/.test(markBlock),
    "mark_final_result_presenceがparticipants行をFOR UPDATEでロックしていない",
  );
  console.log("PASS: mark_final_result_presenceはlives→participantsの順でFOR UPDATEロックを取得し、close_live/kick_participantとの競合を防ぐ");
}

// 14b（レビュー対応）：_apply_first_live_rewardは、lives→final_result_presence→
//     participantsの順でFOR UPDATEロックを個別に取得し、各SELECT直後にNOT FOUNDを
//     確認する（以前はlives行をロックせず、participant取得のNOT FOUNDも
//     確認していなかった）。participant行の取得はparticipant_id・live_id・user_idの
//     すべてが一致する条件で行う（presence.participant_idが別ライブ・別利用者の
//     participant行を指してしまっていないかの多層防御）。
{
  const applyIdx = migration0081.indexOf("function public._apply_first_live_reward");
  const applyBlock = migration0081.slice(applyIdx, applyIdx + 2600);

  // lives行のFOR UPDATE＋NOT FOUND。
  const livesLockIdx = applyBlock.indexOf("select * into v_live from public.lives where id = p_live_id for update;");
  assert.ok(livesLockIdx >= 0, "_apply_first_live_rewardがlives行をFOR UPDATEでロックしていない");
  assert.ok(
    /select \* into v_live from public\.lives where id = p_live_id for update;\s*\n\s*if not found then\s*\n\s*raise exception 'LIVE_NOT_FOUND';/.test(
      applyBlock,
    ),
    "_apply_first_live_rewardがlives行取得後にNOT FOUNDを確認していない",
  );

  // presence行のFOR UPDATE＋NOT FOUND。
  const presenceLockIdx = applyBlock.indexOf(
    "select * into v_presence from public.final_result_presence\n    where live_id = p_live_id and user_id = p_user_id for update;",
  );
  assert.ok(presenceLockIdx >= 0, "_apply_first_live_rewardがfinal_result_presence行をFOR UPDATEでロックしていない");
  assert.ok(
    /where live_id = p_live_id and user_id = p_user_id for update;\s*\n\s*if not found then\s*\n\s*raise exception 'NO_PRESENCE_RECORD';/.test(
      applyBlock,
    ),
    "_apply_first_live_rewardがpresence行取得後にNOT FOUNDを確認していない",
  );

  // participant行のFOR UPDATE（participant_id・live_id・user_idすべて一致）＋NOT FOUND。
  const participantLockIdx = applyBlock.indexOf(
    "select * into v_participant from public.participants\n    where id = v_presence.participant_id and live_id = p_live_id and user_id = p_user_id\n    for update;",
  );
  assert.ok(
    participantLockIdx >= 0,
    "_apply_first_live_rewardがparticipant行をparticipant_id・live_id・user_idすべて一致する条件でFOR UPDATEロックしていない",
  );
  assert.ok(
    /for update;\s*\n\s*if not found then\s*\n\s*raise exception 'PARTICIPANT_NOT_FOUND';/.test(applyBlock),
    "_apply_first_live_rewardがparticipant行取得後にNOT FOUND(PARTICIPANT_NOT_FOUND)を確認していない",
  );

  // ロック順序：lives→presence→participantsの順で並んでいること。
  assert.ok(
    livesLockIdx < presenceLockIdx && presenceLockIdx < participantLockIdx,
    "_apply_first_live_rewardのロック順序がlives→final_result_presence→participantsになっていない",
  );
  console.log(
    "PASS: _apply_first_live_rewardはlives→final_result_presence→participantsの順でFOR UPDATEロックを取得し、各SELECT直後にNOT FOUNDを確認し、participant行はparticipant_id・live_id・user_idすべて一致する条件で取得する",
  );
}

// 15: grant_first_live_reward/_apply_first_live_reward/admin_regrant_first_live_rewardは
//     first_live_reward_result（newly_granted・title_display_name）を返し、表示名は
//     毎回titlesテーブルから取得する（改称が新しい通知・戻り値に反映される）。
{
  assert.ok(/create type public\.first_live_reward_result as \(/.test(migration0081), "first_live_reward_result型が定義されていない");
  assert.ok(
    /returns public\.first_live_reward_result/.test(migration0081),
    "grant_first_live_reward等がfirst_live_reward_result型を返していない",
  );
  assert.ok(
    /select display_name into v_title_name from public\.titles where slug = 'first-witness';/.test(migration0081),
    "_apply_first_live_rewardが毎回titlesから最新の表示名を取得していない",
  );
  console.log("PASS: grant系RPCはnewly_granted・title_display_nameを返し、表示名は毎回titlesから最新のものを取得する");
}

// 16: admin_count_x_login_membersは運営専用で、ゲスト・実際にXログインしていない
//     アカウント（ボット等）を除外した会員数を返す。
{
  const fnIdx = migration0081.indexOf("function public.admin_count_x_login_members");
  assert.ok(fnIdx >= 0, "admin_count_x_login_membersの定義が見つからない");
  const fnBlock = migration0081.slice(fnIdx, fnIdx + 700);
  assert.ok(/if not is_host\(\) then/.test(fnBlock), "admin_count_x_login_membersがis_host()チェックを行っていない");
  assert.ok(
    /where not p\.is_guest and public\._is_x_login_identity\(p\.id\)/.test(fnBlock),
    "admin_count_x_login_membersがゲスト・非Xログインアカウントを除外していない",
  );
  console.log("PASS: admin_count_x_login_membersは運営限定で、ゲスト・ボットを除外した実際のXログイン会員数を返す");
}

// 17: useFirstLiveRewardStoreは、キー単位でin-flight状態を管理する（liveId×userIdの
//     組ごとに独立、単一のinFlightKeyへ戻っていない）。mark失敗時もgrantを試す
//     （2つのRPC呼び出しが1つのtry-catchで囲われて、mark例外でgrantが
//     スキップされる実装に戻っていないことを確認する）。
{
  assert.ok(
    /inFlightKeys: Record<string, true>/.test(firstLiveRewardStore),
    "useFirstLiveRewardStoreがキー単位のinFlightKeys(Record)を持っていない（単一のinFlightKeyに戻っている）",
  );
  assert.ok(!/inFlightKey: string \| null/.test(firstLiveRewardStore), "useFirstLiveRewardStoreが単一のinFlightKey(string|null)に戻っている");
  const markTryIdx = firstLiveRewardStore.indexOf('await supabase.rpc("mark_final_result_presence"');
  const grantTryIdx = firstLiveRewardStore.indexOf('await supabase.rpc("grant_first_live_reward"');
  assert.ok(markTryIdx >= 0 && grantTryIdx >= 0 && markTryIdx < grantTryIdx, "mark→grantの呼び出し順が見当たらない");
  const betweenBlock = firstLiveRewardStore.slice(markTryIdx, grantTryIdx);
  assert.ok(
    /catch \(markException\)/.test(betweenBlock),
    "mark_final_result_presenceの呼び出し自体の例外を個別にcatchしていない（例外時にgrantへ進めない可能性）",
  );
  assert.ok(
    !/return null;[\s\S]{0,80}catch \(markException\)/.test(betweenBlock),
    "mark失敗時に早期returnしてgrantを試していない可能性がある",
  );
  console.log("PASS: useFirstLiveRewardStoreはキー単位でin-flightを管理し、mark失敗・例外時もgrantを必ず試す");
}

// 18（レビュー対応・世代ガード）：mark_final_result_presence/grant_first_live_rewardは
//    p_expected_user_idを受け取り、実際の認証ユーザー(auth.uid())と一致しなければ
//    USER_MISMATCHで拒否する。ストア側もこの引数を渡している。
{
  for (const fn of ["mark_final_result_presence", "grant_first_live_reward"]) {
    const fnIdx = migration0081.indexOf(`function public.${fn}(p_live_id uuid, p_expected_user_id uuid)`);
    assert.ok(fnIdx >= 0, `${fn}がp_expected_user_id引数を受け取るシグネチャになっていない`);
    const fnBlock = migration0081.slice(fnIdx, fnIdx + 1300);
    assert.ok(
      /if p_expected_user_id is null or p_expected_user_id <> v_uid then\s*\n\s*raise exception 'USER_MISMATCH';/.test(fnBlock),
      `${fn}がp_expected_user_idと実際の認証ユーザーの不一致をUSER_MISMATCHで拒否していない`,
    );
    assert.ok(
      migration0081.includes(`grant execute on function public.${fn}(uuid, uuid) to authenticated;`),
      `${fn}(uuid, uuid)への実行権限がauthenticatedへgrantされていない（引数追加後のシグネチャでgrantし直されていない可能性）`,
    );
  }
  assert.ok(
    /supabase\.rpc\("mark_final_result_presence", \{\s*\n\s*p_live_id: liveId,\s*\n\s*p_expected_user_id: userId,/.test(
      firstLiveRewardStore,
    ),
    "useFirstLiveRewardStoreがmark_final_result_presenceにp_expected_user_idを渡していない",
  );
  assert.ok(
    /supabase\.rpc\("grant_first_live_reward", \{\s*\n\s*p_live_id: liveId,\s*\n\s*p_expected_user_id: userId,/.test(
      firstLiveRewardStore,
    ),
    "useFirstLiveRewardStoreがgrant_first_live_rewardにp_expected_user_idを渡していない",
  );
  console.log("PASS: mark_final_result_presence/grant_first_live_rewardはp_expected_user_idの不一致をUSER_MISMATCHで拒否し、ストア側も実際に渡している");
}

// 19（レビュー対応）：grant RPCの応答が不正な形式（data=null・空オブジェクト・
//    newly_grantedがboolean以外・title_display_nameが無効）の場合、成功・完了扱いに
//    しない（isValidFirstLiveRewardRpcDataで検証してから使う）。管理画面の再付与でも
//    同じ検証を行い、null・不正応答を「既に付与済み」と誤表示しない。
{
  const firstLiveRewardResultLib = readFileSync(
    join(process.cwd(), "src", "lib", "firstLiveRewardResult.ts"),
    "utf8",
  );
  assert.ok(
    /export function isValidFirstLiveRewardRpcData/.test(firstLiveRewardResultLib),
    "isValidFirstLiveRewardRpcDataが定義されていない",
  );
  assert.ok(
    /typeof d\.newly_granted === "boolean"/.test(firstLiveRewardResultLib) &&
      /typeof d\.title_display_name === "string"/.test(firstLiveRewardResultLib),
    "isValidFirstLiveRewardRpcDataがnewly_granted(boolean)・title_display_name(string)の型を確認していない",
  );

  assert.ok(
    /import \{ isValidFirstLiveRewardRpcData \} from "@\/lib\/firstLiveRewardResult";/.test(firstLiveRewardStore),
    "useFirstLiveRewardStoreがisValidFirstLiveRewardRpcDataをimportしていない",
  );
  assert.ok(
    /if \(!isValidFirstLiveRewardRpcData\(grantData\)\) \{/.test(firstLiveRewardStore),
    "useFirstLiveRewardStoreがgrant応答の形式を検証してから使っていない（不正応答を成功扱いにする恐れ）",
  );
  // 検証（isValidFirstLiveRewardRpcData）に通ってから初めてcompletedKeysへ記録している
  // （検証行より前でcompletedKeysをsetしていない）ことを確認する。
  const validateIdx = firstLiveRewardStore.indexOf("if (!isValidFirstLiveRewardRpcData(grantData))");
  const completedSetIdx = firstLiveRewardStore.indexOf("completedKeys: { ...s.completedKeys, [key]: true }");
  assert.ok(
    validateIdx >= 0 && completedSetIdx > validateIdx,
    "useFirstLiveRewardStoreが応答検証より前にcompletedKeysを記録している可能性がある",
  );

  assert.ok(
    /import \{ isValidFirstLiveRewardRpcData \} from "@\/lib\/firstLiveRewardResult";/.test(adminTitlesPage),
    "管理画面がisValidFirstLiveRewardRpcDataをimportしていない",
  );
  assert.ok(
    /if \(!isValidFirstLiveRewardRpcData\(data\)\) \{/.test(adminTitlesPage),
    "管理画面がadmin_regrant_first_live_rewardの応答形式を検証していない（不正応答を「既に付与済み」と誤表示する恐れ）",
  );
  console.log("PASS: grant系RPCの応答は形式検証(isValidFirstLiveRewardRpcData)を通ってから使われ、不正応答は完了扱い・「既に付与済み」表示のどちらにもならない");
}

// 20（レビュー対応・アカウント切替中の誤付与防止）：useFirstLiveRewardStore.attempt()は
//    mark前・mark完了後かつgrant開始前・grant完了後かつcompletedKeys更新前の
//    3時点で、現在の認証ユーザーがattempt開始時のuserIdのままかを確認する。
{
  const isStillCurrentUserDefIdx = firstLiveRewardStore.indexOf(
    "const isStillCurrentUser = () => useAuthStore.getState().user?.id === userId;",
  );
  assert.ok(isStillCurrentUserDefIdx >= 0, "useFirstLiveRewardStoreにisStillCurrentUserの定義が見当たらない");

  const markCallIdx = firstLiveRewardStore.indexOf('await supabase.rpc("mark_final_result_presence"');
  const grantCallIdx = firstLiveRewardStore.indexOf('await supabase.rpc("grant_first_live_reward"');
  const validateCallIdx = firstLiveRewardStore.indexOf("if (!isValidFirstLiveRewardRpcData(grantData))");
  assert.ok(markCallIdx >= 0 && grantCallIdx >= 0 && validateCallIdx >= 0, "mark/grant呼び出し、または応答検証の位置が特定できない");

  // チェックポイント1：mark前（isStillCurrentUserの定義よりは後、mark呼び出しよりは前）。
  const beforeMarkBlock = firstLiveRewardStore.slice(isStillCurrentUserDefIdx, markCallIdx);
  assert.ok(
    /if \(!isStillCurrentUser\(\)\) return null;/.test(beforeMarkBlock),
    "useFirstLiveRewardStoreがmark呼び出し前にアカウント切替を確認していない",
  );

  // チェックポイント2：mark完了後・grant開始前。
  const betweenMarkAndGrantBlock = firstLiveRewardStore.slice(markCallIdx, grantCallIdx);
  assert.ok(
    /if \(!isStillCurrentUser\(\)\) return null;/.test(betweenMarkAndGrantBlock),
    "useFirstLiveRewardStoreがmark完了後・grant開始前にアカウント切替を確認していない",
  );

  // チェックポイント3：grant完了後・応答検証(completedKeys更新)より前。
  const betweenGrantAndValidateBlock = firstLiveRewardStore.slice(grantCallIdx, validateCallIdx);
  assert.ok(
    /if \(!isStillCurrentUser\(\)\) return null;/.test(betweenGrantAndValidateBlock),
    "useFirstLiveRewardStoreがgrant完了後・completedKeys更新前にアカウント切替を確認していない",
  );
  console.log("PASS: useFirstLiveRewardStoreはmark前・mark後grant前・grant後completedKeys更新前の3時点でアカウント切替を確認する");
}

// 21（レビュー対応・非公開称号の装備解除）：admin_update_titleは、称号を非公開
//    (is_active=false)にした時、既に装備中の利用者のequipped_title_slugをnullへ
//    解除する（所有記録(user_titles)は削除しない）。
{
  const fnIdx = migration0081.indexOf("function public.admin_update_title(");
  const fnBlock = migration0081.slice(fnIdx, fnIdx + 2000);
  assert.ok(
    /if not p_is_active then\s*\n\s*update public\.profiles set equipped_title_slug = null where equipped_title_slug = p_slug;\s*\n\s*end if;/.test(
      fnBlock,
    ),
    "admin_update_titleが非公開化(is_active=false)時に装備中の利用者を解除していない",
  );
  console.log("PASS: admin_update_titleは称号を非公開にした時、装備中の利用者のequipped_title_slugを解除する（所有記録は削除しない）");
}

console.log("ALL TITLES AND FIRST LIVE REWARD WIRING CHECKS PASSED");
