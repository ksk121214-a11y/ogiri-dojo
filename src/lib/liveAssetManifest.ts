// ライブ画面（/live）で実際に表示される瞬間まで新しい読み込みが発生しないよう、
// 「開幕（参加登録受付中）」の待機画面にいる間に裏で準備しておくべき必須素材の一覧。
//
// 対象は、お題発表・回答・審査という進行の中心にあり、表示される瞬間に読み込み待ちに
// なると体験を大きく損なうもの（舞台の背景・演壇・観客・参加者アイコン・回答フリップ、
// および場面転換のBGM・SE）に絞る。装飾的な素材や、結果発表以降にしか出ないもの
// （組結果・最終結果画面）は対象外（読み込み中でも進行を妨げないため）。
import { BASE_PATH } from "@/lib/basePath";
import type { BgmName, SfxName } from "@/lib/audio/audioManager";

// 本番のライブ画面（StageAnsweringView/AudienceAnsweringView、variant="neon2"）が
// opening〜answeringの間に実際に描画する画像だけを列挙する（デザインプレビュー専用の
// 素材、dojoテーマ用の旧素材は対象外）。
export const LIVE_CRITICAL_IMAGE_PATHS: string[] = [
  // 舞台背景・舞台袖・演壇・観客・電飾バー（LiveStageBackdrop/StageHeaderBanner/StageCharactersView）
  "/images/live2/stage-bg-2.png",
  "/images/live2/side-left-crop.png",
  "/images/live2/top-lights-crop.png",
  "/images/live2/podium-2-crop.png",
  "/images/live2/audience-2-crop.png",
  // 回答フリップ（AnswerRevealCard）
  "/images/live/answer-flip.png",
  // 参加者アイコン（本人＋ボット、全プリセットぶん。AVATAR_ICON_PRESETSと対応）
  "/images/live2/avatar-2-line-mask.png",
  "/images/live2/avatar-2-silhouette.webp",
  "/images/live2/avatar-afro-mask.webp",
  "/images/live2/avatar-afro-silhouette.webp",
  "/images/live2/avatar-mohawk-mask.webp",
  "/images/live2/avatar-mohawk-silhouette.webp",
  "/images/live2/avatar-suit-mask.webp",
  "/images/live2/avatar-suit-silhouette.webp",
  "/images/live2/avatar-rakugo-mask.webp",
  "/images/live2/avatar-rakugo-silhouette.webp",
  "/images/live2/avatar-clown-mask.webp",
  "/images/live2/avatar-clown-silhouette.webp",
  "/images/live2/avatar-shirtless-mask.webp",
  "/images/live2/avatar-shirtless-silhouette.webp",
];

export function resolveLiveAssetUrl(path: string): string {
  return `${BASE_PATH}${path}`;
}

// 場面転換で使うBGM。"home"はホーム画面専用のため対象外。
export const LIVE_CRITICAL_BGM: BgmName[] = ["waiting", "entrance", "live"];

// お題発表〜審査サイクルの間に鳴る可能性のあるSE。結果発表専用（groupResult/
// rankReveal/masteryLevelup）は組結果・最終結果画面が出る頃には十分な時間の余裕が
// あるため必須からは外し、進行に直結するものだけ必須にする。
// 2026-08-29: "countdownTick"/"spotlightIn"/"bigLaugh"/"startLive"は、コード上は
// 呼び出し箇所があるが対応する音源ファイル自体がpublic/sounds配下にまだ置かれて
// いない（意図的に未実装、audioManager.ts側でフォールバックして無音になる設計）。
// 必須リストに含めると「そもそも存在しないファイル」で毎回失敗扱いになり、
// 進捗表示が常にエラーのままになってしまうため、実在する音源だけに絞る。
export const LIVE_CRITICAL_SFX: SfxName[] = ["curtainOpen", "topicReveal", "answerSubmit", "scoreReveal", "perfect"];

export const LIVE_ASSET_TOTAL_COUNT =
  LIVE_CRITICAL_IMAGE_PATHS.length + LIVE_CRITICAL_BGM.length + LIVE_CRITICAL_SFX.length;
