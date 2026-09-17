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
   - 承認済みのリダイレクトURI：上記1.4の `https://<プロジェクトref>.supabase.co/auth/v1/callback`
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
     「Configure」から以下を登録する。
     - Primary App ID：手順1で用意したApp ID
     - Domains and Subdomains：本番ドメイン（例：`ogiri-dojo.vercel.app` や独自ドメイン）
     - Return URLs：上記1.4の `https://<プロジェクトref>.supabase.co/auth/v1/callback`
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
2. 問題が無いことを確認したら、本番のVercel環境変数でフラグをONにする。

## 6. 既存アカウントへの追加連携について（利用者向けの案内の要点）

- **Xで作成済みのアカウントにGoogle/Appleを追加したい場合は、必ず先にその
  Xアカウントでログインしてから、マイページの「ログイン方法」画面で連携して
  ください。** 新規に「Googleでログイン」「Appleでログイン」をすると、
  （そのGoogle/Appleが未連携であれば）別の新しいアカウントが作られます。
- **メールアドレスが同じだからといって、X側のアカウントとGoogle/Apple側の
  アカウントが自動的に統合されることはありません。** 本実装はSupabase Authの
  Manual Identity Linking（`linkIdentity()`）を使っており、メールアドレス
  一致による自動統合には一切依存していません。統合したい場合は、必ず上記の
  手順（先にXへログイン→ログイン方法画面で連携）を踏む必要があります。
