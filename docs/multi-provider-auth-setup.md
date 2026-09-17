# 複数ログイン方法（X / Google / Apple）の設定手順

このドキュメントは、`feature/multi-provider-auth` で実装した複数ログイン対応を
本番で有効化するために必要な、コード外の作業（Supabase・Google Cloud・Apple
Developer・Vercelの設定）をまとめたものです。**コード側の対応は完了しており、
このドキュメントに書かれた設定と実機確認が終わるまでは、機能フラグを
ONにしないでください。**

## 前提

- 既存のXログイン・ゲスト観戦の設定・挙動には一切変更がありません。
- Google/Appleは、`NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN` / `NEXT_PUBLIC_ENABLE_APPLE_LOGIN`
  という2つの環境変数（後述）がどちらも未設定の間、ボタン自体が画面に一切表示されません。
  誤って未設定のまま機能が露出することはありません。

## 1. Supabaseで有効化する設定

### 1.1 Google Providerの有効化

1. Supabaseダッシュボード → 該当プロジェクト → **Authentication → Providers → Google**
2. 有効化(Enable)し、後述の手順で取得したGoogle OAuth ClientのClient ID／
   Client Secretを入力して保存する。

### 1.2 Apple Providerの有効化

1. Supabaseダッシュボード → **Authentication → Providers → Apple**
2. 有効化し、後述の手順で取得したApple関連の値（Services ID・Team ID・Key ID・
   秘密鍵から生成したClient Secret）を入力して保存する。

### 1.3 Manual Identity Linkingの有効化（重要・必須）

既存のXアカウントへGoogle/Appleを**追加連携**する機能（`linkIdentity()`）は、
この設定が入っていないと `manual_linking_disabled` エラーで失敗します。

1. Supabaseダッシュボード → **Authentication → Settings**（プロジェクトの
   Auth設定画面。UIの文言は「Allow manual linking」「Enable manual linking」
   に類する項目です）
2. Manual Linkingを有効化して保存する。

### 1.4 SupabaseのOAuth Callback URL

Google Cloud・Apple Developer側で「認可後のリダイレクト先」として登録する
URLは、**両方とも同じ、Supabase自身のURL**です（アプリのURLではありません）。

```
https://<あなたのプロジェクトref>.supabase.co/auth/v1/callback
```

`<あなたのプロジェクトref>` は、Supabaseダッシュボードのプロジェクト設定
（Project Settings → General → Reference ID）で確認できます。

### 1.5 アプリ側で許可するRedirect URL

Supabaseダッシュボード → **Authentication → URL Configuration → Redirect URLs**
に、アプリの`/auth/callback/`（末尾スラッシュあり、`trailingSlash: true`設定のため）
を許可リストへ追加してください。

```
https://<本番ドメイン>/auth/callback/
```

新規ログイン・追加連携（`?flow=link`付き）のどちらも同じ`/auth/callback/`を
使うため、登録するURLは1つで足ります（クエリ文字列はSupabase側の許可リスト
判定には影響しません）。

## 2. Google Cloud側で必要な設定

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを
   作成（または既存のものを使用）。
2. **APIとサービス → OAuth同意画面** を設定（アプリ名・サポートメール等）。
   外部公開する場合は「公開ステータス」を「本番」にする必要があります
   （テストユーザー限定のままだと、登録した数人以外はログインできません）。
3. **APIとサービス → 認証情報 → 認証情報を作成 → OAuthクライアントID**
   - アプリケーションの種類：**ウェブアプリケーション**
   - **承認済みの JavaScript 生成元（Authorized JavaScript origins）**：
     アプリの本番オリジン（例：`https://ogiri-dojo.vercel.app`、または独自ドメイン）。
     `signInWithOAuth`/`linkIdentity`はブラウザからのリダイレクト開始のため、
     実際にボタンを表示するオリジンをここへ登録する。
   - **承認済みのリダイレクト URI（Authorized redirect URI）**：
     上記1.4の `https://<プロジェクトref>.supabase.co/auth/v1/callback`
     （アプリの本番ドメインではなく、Supabase自身のドメイン）。
   - **Preview環境・localhostを使う場合**：Vercelのpreviewデプロイやローカル
     開発（`http://localhost:3000`等）でもGoogleログインの実機確認をしたい
     場合は、そのオリジンも同様に「承認済みのJavaScript生成元」へ追加できる
     （リダイレクトURI自体はSupabase側の1つで共通のため追加不要）。
     **ただし本番公開時には、確認や検証が終わった一時的なlocalhost・
     使わなくなったpreview URLをこの一覧に残さないこと。** 不要になった
     オリジンが残っていると、そのオリジンから偽装されたページが
     OAuthフローを開始できてしまう余地が生まれるため、定期的に一覧を
     見直して不要なエントリを削除する。
4. 発行された **クライアントID** と **クライアントシークレット** を、
   Supabaseダッシュボードの Google Provider設定（1.1）へ入力する。

## 3. Apple Developer側で必要な設定

Sign in with Appleは、Googleより設定項目が多く、シークレットに有効期限がある
点に注意してください。

1. **App ID**（[Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list)）
   - 既存のアプリ用App IDに **Sign In with Apple** Capabilityを追加する
     （まだ本アプリ用のApp IDが無い場合は新規作成）。
2. **Services ID**
   - 「Identifiers → Services IDs」で新規作成。これがOAuthの`client_id`
     として使われる（App IDとは別物）。
   - Services IDの設定内で **Sign In with Apple** を有効化し、
     「Configure」から以下を登録する（Supabase公式ドキュメント
     [Login with Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple)、
     2026-09-18確認の記載どおり）。
     - **Domains and Subdomains：`<project-ref>.supabase.co`**
       （**アプリの本番ドメイン（`ogiri-dojo.vercel.app`や独自ドメイン）ではない**。
       SupabaseのWeb OAuthフローでは、Appleとのやり取り自体はSupabase側の
       ドメインで完結するため、Apple側にはSupabaseのドメインだけを登録する）
     - **Return URLs：`https://<project-ref>.supabase.co/auth/v1/callback`**
       （上記1.4と同じURL。アプリの本番ドメインをここに登録する必要は無い）
   - アプリの本番ドメイン（`https://<本番ドメイン>/auth/callback/`）は、
     Apple側ではなく**Supabase側のRedirect URLs（上記1.5）**へ登録するもの
     である点に注意する（AppleのDomains/Return URLsと、Supabaseの
     Redirect URLsは、登録先も値も別物）。
3. **Key**
   - 「Keys」で新規作成し、**Sign In with Apple** を有効化してひも付けるApp IDを選択。
   - 作成すると`.p8`の秘密鍵ファイルが**1度だけ**ダウンロードできる
     （紛失すると再発行が必要）。Key IDも控えておく。
4. **Team ID**
   - Apple Developerアカウントの「Membership」ページで確認できる10桁の英数字。
5. 上記（Services ID＝Client ID、Team ID、Key ID、`.p8`秘密鍵の内容）から、
   SupabaseダッシュボードのApple Provider設定画面の指示に従って
   **Client Secret（JWT形式）** を生成し入力する
   （Supabase側がSecret生成を代行してくれる場合はそちらを使ってよい）。

### Apple Client Secretの有効期限と更新運用（重要）

Sign in with AppleのClient Secret（JWT）は、**発行から最長6か月**で失効します。
期限が切れると、Appleログインが（既存の連携済みユーザーも含めて）失敗するように
なるため、以下のいずれかの運用を決めておく必要があります。

- カレンダーや監視で「発行から5か月後」等にリマインドを設定し、手動で
  Secretを再生成してSupabaseへ再登録する。
- Secret生成を自動化するバッチ処理を用意する（Apple側の鍵(.p8)・Key ID・
  Team ID・Services IDが変わらない限り、JWTの再生成自体は自動化可能）。

いずれの場合も、**秘密鍵(.p8)の実体はリポジトリに含めず、安全な場所
（パスワードマネージャー等）に保管**してください。

## 4. Vercelの環境変数

コード側で秘密情報を必要とする箇所はありません（Client ID/SecretはすべてSupabase
ダッシュボード側にのみ保存され、アプリのビルド・実行時には一切参照しません）。
Vercelに設定するのは、ボタンの表示有無を切り替える機能フラグの2つだけです。

| 環境変数 | 値 | 説明 |
|---|---|---|
| `NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN` | `true` | Googleログインボタンを表示する |
| `NEXT_PUBLIC_ENABLE_APPLE_LOGIN` | `true` | Appleログインボタンを表示する |

**重要：上記1〜3の外部設定（Supabase Provider有効化・Manual Linking有効化・
Google Cloud/Apple Developer設定）と、下記5章の実機確認がすべて完了するまでは、
これらのフラグをONにしないでください。** 未設定のままフラグだけONにすると、
ボタンを押したユーザーが必ずエラーになります。

`NEXT_PUBLIC_*`はNext.jsのビルド時にクライアントバンドルへ埋め込まれる、
非秘密の設定値です。**Client Secretや秘密鍵(.p8)を`NEXT_PUBLIC_*`環境変数へ
入れたり、Vercelの環境変数以外（コード・リポジトリ・ログ・エラーメッセージ・
コミットメッセージ等）に書き残したりしないでください。**

## 5. 実機確認（フラグON前に必ず行うこと）

1. ステージング環境またはPreviewデプロイでフラグを一時的にONにし、以下を確認する。
   - Googleでの新規ログインが成功し、`profiles`行が作成される
     （`x_username`はnullのままでよい）。
   - Appleでの新規ログインが成功する（氏名が取得できなくても高座名設定へ進める）。
   - Xでログイン中のアカウントから、ログイン方法画面でGoogle/Appleを連携できる
     （連携後もポイント・投稿・フォロー・ライブ履歴が維持されている）。
   - 既に他のアカウントに連携済みのGoogle/Appleで連携しようとすると、
     日本語の案内文（生のエラーではない）が出て処理が止まる。
   - 最後の1つのログイン方法は解除できない。
   - ゲストからGoogle/Appleへの切り替え時も、確認ダイアログ→ゲスト記録の
     引き継ぎなしが機能する。
2. **自動リンク（6章参照）の実際の挙動を、以下の組み合わせで確認する。**
   自動リンクが成立する条件・成立しない条件が実機でも6章の記載どおりに
   なっているかを見るための項目であり、いずれの結果になっても
   （成立してもしなくても）利用者にエラーや不可解な状態を見せないことを確認する。
   - **XとGoogleで確認済みメールアドレスが同じ場合**（自動リンクが成立し、
     同じSupabase userとして扱われることを確認する）。
   - **メールアドレスが異なる場合**（自動リンクが起きず、Google側は
     別アカウントとして新規作成されることを確認する）。
   - **Xからメールアドレスが取得できない場合**（自動リンクの判定材料が
     無いため、新規アカウントとして作成されることを確認する）。
   - **Appleでメールアドレスを公開した場合**（Appleの実メールがX/Google側と
     一致すれば自動リンク、一致しなければ新規アカウントになることを確認する）。
   - **Appleでメールアドレスを非公開にした場合**（リレーアドレスが使われ、
     通常は自動リンクが成立しないことを確認する）。
   - **既に別アカウントへ連携済みのidentityを使った場合**（`identity_already_exists`
     等が生のエラーではなく日本語の案内文になり、処理が安全に止まることを確認する）。
3. 問題が無いことを確認したら、本番のVercel環境変数でフラグをONにする。

## 6. 既存アカウントへの追加連携について（訂正：2026-09-18）

**訂正のお知らせ：** 本ドキュメントの旧版には「メールアドレスが同じでも
自動統合されない」という記載がありましたが、これはSupabase Authの公式仕様と
逆であり誤りでした。以下の内容に訂正します。

### Supabase Authには自動リンクの仕組みが実際にある

Supabase Auth公式ドキュメント
[Identity Linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
（2026-09-18確認）によれば、Supabase Authは
**確認済み（verified）のメールアドレスが一致するOAuth識別情報を、
同じユーザーへ自動的にリンクする**仕組みを持っている。これは複数のOAuth
手段を使うユーザーの利便性のための挙動であり、Manual Linking
（`linkIdentity()`）とは別の、Supabase Auth自体の既定の動作である。

さらに、自動リンクが成立した際にSupabaseは**確認未了（unconfirmed）の
他の識別情報を削除する**（アカウント乗っ取り対策）ことも公式ドキュメントに
明記されている。

### ただし、すべての組み合わせで起きるとは限らない

自動リンクは「確認済みメールアドレスの一致」が条件であり、以下のような
ケースでは一致せず、自動リンクが起きない可能性がある。

- **Xからメールアドレスが提供されない**（Xはメールアドレスをスコープに
  含めない設定・連携が一般的で、Supabaseに渡らないことがある）。
- **XとGoogleで異なるメールアドレスを使っている。**
- **Appleの「メールを非公開」機能により、実際のメールではなく
  Apple生成のリレーアドレスが使われる**（これがX/Google側のメールと
  一致することは通常無い）。
- **provider側のメールアドレスが未確認（unverified）**の場合。
- **そのGoogle/Appleの識別情報が、既に別のSupabase userへ連携済み**の場合
  （この場合はSupabase側が`identity_already_exists`等で拒否し、本実装は
  この結果を生のエラーを見せずに日本語で案内して処理を止める設計になって
  いる。詳細はsrc/lib/authErrorMessages.ts参照）。

### 利用者へ案内する安全な手順（変更なし）

上記のとおり自動リンクが**起きる場合はあるが、すべての組み合わせで
起きるとは保証できない**ため、引き続き以下の手順を確実な方法として案内する。

> **既存のXアカウントを確実に引き継ぎたい場合は、先にそのXアカウントで
> ログインし、マイページの「ログイン方法」からGoogle／Appleを連携して
> ください。**

- 新規に「Googleでログイン」「Appleでログイン」をした場合、メールアドレスの
  一致条件を満たせば自動的に同じアカウントへ寄せられることもあるが、
  **上記の条件を満たさなければ、意図せず別の新しいアカウントが作られる。**
  自動リンクの成立有無に依存したアカウント引き継ぎの案内はしない。
- **本実装（LoginMethodsManageModal・マイページの「ログイン方法」画面）は、
  Xログイン中のセッションに対してManual Linking（`linkIdentity()`）で
  明示的に連携する操作のみを提供する。** 既にそれぞれ別々のSupabase user
  として作成済みになってしまった2つのアカウント（例：自動リンクの条件を
  満たさずGoogleで新規登録してしまった後のXアカウントとGoogleアカウント）を、
  この画面だけで後から統合することはできない。
- **別々に作成済みの2アカウントのデータ（ポイント・投稿・フォロー・
  ライブ履歴等）を統合したい場合は、この画面の操作だけでは完結せず、
  管理者による別の移行手順（対象ユーザーの特定・profiles行の手動統合・
  関連テーブルのuser_id付け替え等）が必要になる可能性がある。** 現時点で
  この移行手順は未整備であり、今回の実装スコープにも含まれていない。

## 7. ログインボタンのロゴ素材について（2026-09-18追加）

`src/components/app/AuthProviderIcon.tsx`が使用しているロゴ素材の出所を記録する。
SupabaseのOAuth開始処理（`signInWithOAuth`/`linkIdentity`）自体は変更しておらず、
以下は見た目（ロゴ画像）だけの対応であることに注意。

### Google：公式配布物を導入済み

- **取得元URL：** https://developers.google.com/identity/branding-guidelines
  に掲載されている、公式配布のZIPアーカイブ
  `https://developers.google.com/static/identity/images/signin-assets.zip`
- **確認日：2026-09-18**
- **取得した具体的なファイル：**
  `Android + Web/SVG/Light/Theme=Light, Show text=No, Shape=Square, Platform=Android+Web.svg`
  （ライトテーマ・正方形・テキスト無しの「G」ロゴ単体）を一切加工せず
  `public/auth-icons/google-g-light-square.svg`としてそのまま同梱している。
- **テキスト無し版を選んだ理由：** 公式配布物のテキスト付きボタンは
  英語（"Sign in with Google"）が画像に焼き込まれており、アプリの日本語UI
  （「Googleでログイン」）と両立できないため。ロゴ単体を使い、ボタンの文言は
  Googleのガイドライン記載の配色（文字色 `#1F1F1F`、枠線 `#747775`、背景
  `#FFFFFF`）に沿って別途HTML/CSSで組んでいる。
- 色・形状の描き直しは行っていない（ロゴ画像自体は非改変、周囲のボタンの
  余白・枠線・背景色だけをガイドラインの数値に合わせて実装している）。

### Apple：公式素材導入待ち

Appleについては、以下の理由により、出所を確認できる公式のロゴ素材を
今回のブランチには導入していない。

- Apple公式のボタン生成手段（`https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid.js`）は、
  Apple自身の認証フロー（`AppleID.auth.signIn()`、IDトークンをSupabaseの
  `signInWithIdToken`で検証する方式）に紐づいており、今回のSupabase OAuth
  リダイレクト方式（`signInWithOAuth`/`linkIdentity`）とは別の実装になる。
  「SupabaseのOAuth開始処理は変更しない」という要件と両立できないため
  採用していない。
- Apple Human Interface Guidelinesのロゴ配布ページはスクリプト描画のため
  内容を確認できず、認証済みのApple Developerアカウント経由でのみ入手できる
  ダウンロード資産にもこの環境からはアクセスできなかった。
- そのため、`AuthProviderIcon`の`provider === "apple"`は現在ロゴを描画せず
  `null`を返す（Appleボタンはテキストのみ）。**`NEXT_PUBLIC_ENABLE_APPLE_LOGIN`が
  OFFの間はボタン自体が表示されないため、この状態が本番ユーザーの目に
  触れることは無い。**
- Apple公式のロゴ素材を正規の手段（Apple Developerアカウントでのログイン、
  または正式に配布されるデザインリソースパッケージ）で入手できた時点で、
  Googleと同様に取得元URL・確認日を記録した上でこのコンポーネントへ追加すること。
  それまでは機能フラグをONにしないこと。
