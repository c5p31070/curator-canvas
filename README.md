# curator-canvas
東京都美術館の展示配置図作成システム「Curator・Canvas」

## 起動

`index.html` をブラウザーで開き、「展示物配置を開始する」からエディターを開きます。

## ファイル構成

- `css/home.css`、`css/editor.css`: 各画面の基本レイアウト
- `css/theme.css`: 共通の色・部品スタイル
- `css/dark-mode.css`: ダーク配色の上書き
- `js/editor/core.js`: キャンバス状態、保存、履歴
- `js/editor/view.js`: 平面図・壁面図の切り替えと描画
- `js/editor/interaction.js`: キャンバス操作、衝突判定、描画モード
- `js/editor/pdf.js`: 印刷用PDFの生成
- `js/editor/ui-*.js`: 画面操作の初期化（壁・画面切替、編集、追加など）
- `js/editor/ui.js`: UI初期化の呼び出し順を管理

`editor.html` は各JavaScriptを `defer` 付きで読み込みます。`core.js`、`view.js`、`interaction.js`、`pdf.js`、各UI機能、`ui.js` の順序を保ってください。各ファイルは共有するアプリ状態を使います。
