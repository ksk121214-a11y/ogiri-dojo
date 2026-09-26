<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:design-rules -->
# デザインの恒久ルール（和風デザイン禁止）

**利用者から「和風にして」と明示的に依頼されない限り、和風デザインを使わない。** これは今後のすべての画面・コンポーネント追加・改修に適用する恒久ルールである。

禁止する例：

- 筆文字・毛筆風フォント（Yuji Syuku 等）、寄席文字・勘亭流風の書体
- 和紙・畳・障子・巻物・家紋など、和の伝統意匠を思わせる背景・装飾
- 焦げ茶＋生成りを中心とした和風配色
- 「道場」「高座」「寄席」から連想した伝統和風UI（装飾枠・印・筆書き見出し 等）

許可する方向：現代的なスタジアム・エンタメ・ライブ感、ダーク背景とニュートラルなカード、赤・オレンジ・ゴールド等のアクセント、読みやすいゴシック／サンセリフ、ネオンや照明の演出。

**和風とは別物として、次は爆笑スタジアムの世界観に必須であり、削除・平坦化してはならない**：地下ライブ会場風の暗い背景、ノイズ・グレイン、コンクリート・紙・印刷物の質感、チケット（本券・半券・ミシン目）の意匠（実装：`src/components/home/StadiumHome.module.css` と `public/images/textures/`）。「和風禁止」を理由にこれらを消さないこと。

利用規約・プライバシーポリシーの画面は演出画面ではなく文書画面とし、白背景・黒文字・グレーの境界線・ゴシック体・十分な文字サイズと行間で、装飾より可読性を優先する。

用語：利用者向けの表示名は「演者名（表示名）」に統一する（「高座名」は使わない）。DBの列名・型名・APIの識別子（`display_name` 等）は改名しない。
<!-- END:design-rules -->
