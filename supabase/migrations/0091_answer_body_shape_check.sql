-- answers.bodyにDB側の入力制約（安全上限）を追加する（フェーズ2B.M、2026-10-16）。
--
-- 背景：
--   answers.bodyはNOT NULLだけで、長さ・中身の制約がDBに無かった。ブラウザ版は
--   送信前にtrim・空チェック・50文字チェックをしているが、純正アプリなど別の
--   クライアントから直接INSERTされた場合の最後の砦が無い。純正アプリの回答送信を
--   実装する前に、DB側で「空・空白だけ・極端に長い回答」を拒否できるようにする。
--
-- 制約の中身（answers_body_shape_check）：
--   1. char_length(body)が1〜50（Unicodeコードポイント数）。
--   2. 次の空白文字だけで構成された回答を拒否する（btrimで両端から除去して空になるか）：
--        chr(9)     tab
--        chr(10)    LF
--        chr(11)    vertical tab
--        chr(12)    form feed
--        chr(13)    CR
--        chr(32)    ASCII空白
--        chr(160)   NBSP（U+00A0）
--        chr(12288) 全角空白（U+3000）
--        chr(65279) BOM／zero width no-break space（U+FEFF）
--      正規表現の\sや\uXXXXは、照合順序・エスケープ解釈・standard_conforming_strings
--      等の設定に挙動が左右されうるため使わず、chr()で文字集合を明示してbtrim()の
--      第2引数に渡す。
--   3. 先頭・末尾に空白があっても可視文字を含む回答は、DB制約では拒否しない
--      （正規クライアントは送信前にtrimする。DBは「無効な回答を入れさせない」安全上限に
--      徹し、整形はクライアントの責務とする）。内部の改行も拒否しない。
--
-- 文字数の定義（ブラウザ版との意図的な差）：
--   DBの上限は「50 Unicodeコードポイント」（PostgreSQLのchar_length）。
--   既存ブラウザ版（useLiveFollowerStore.submitAnswer）はJavaScriptのString.length、
--   つまりUTF-16 code unitで50を判定するため、サロゲートペアになる絵文字等については
--   DBの方が緩い（例：絵文字50個はブラウザ版では100単位で送信不可、DBでは受理）。
--   - どちらも無制限入力は防げる
--   - ブラウザ版がtrimして送る回答（UTF-16で50単位以下＝50コードポイント以下）は
--     必ずこの制約を満たす（既存クライアントを壊さない）
--   - DBでUTF-16単位を再現する独自関数は追加しない
--   ため、この差は許容する。UX上の正確な上限の統一は純正アプリ実装時に別途判断する。
--
-- NOT VALIDで追加する理由：
--   既存行をこのマイグレーションでは走査・検証・変更しない（本番の既存回答に万一
--   不適合な行があってもマイグレーション自体は失敗させず、既存の結果表示等も壊さない）。
--   CHECK制約はNOT VALIDでも、追加後の新規INSERT・UPDATEには即時適用される。
--   既存行の適合件数確認とVALIDATE CONSTRAINTは、別の適用フェーズで行う。
--
-- 再実行について：
--   再実行前提にはしない。同名制約が既にある場合はADD CONSTRAINTがエラー
--   （duplicate_object, 42710）になり、黙って成功はしない。
--
-- このマイグレーションは制約を1件追加するだけで、RLS・GRANT/REVOKE・関数・トリガー・
-- 既存の制約/indexと既存行は一切変更しない。

alter table public.answers
  add constraint answers_body_shape_check
  check (
    char_length(body) between 1 and 50
    and btrim(
      body,
      chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32)
        || chr(160) || chr(12288) || chr(65279)
    ) <> ''
  )
  not valid;
