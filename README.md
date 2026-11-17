# Curator-Canvas

東京都美術館の展覧会配置図を作成するWebアプリです。

## 起動

ローカルの静的サーバーで `index.html` を開き、「ログインして配置図を開く」へ進みます。ログインには設定済みのSupabaseプロジェクトを使います。

## ファイル構成

| 場所 | 役割 |
| --- | --- |
| `index.html`、`login.html`、`editor.html` | トップ、ログイン、配置図編集 |
| `css/entry.css`、`css/visual-tokens.css` | トップとログインのレイアウト、画面共通の色と書体 |
| `css/editor.css`、`css/theme.css`、`css/dark-mode.css` | 編集画面の基本レイアウトとテーマ |
| `css/editor-workspace.css`、`css/editor-account.css` | 図面とツールの表示、アカウント表示と閲覧者向けスタイル |
| `js/editor/core.js` | キャンバスの初期化、会場・縮尺・共有状態 |
| `js/editor/exhibition-storage.js` | 展覧会の保存・読み込みとチーム共有 |
| `js/editor/canvas-state.js` | 配置図の保存形式、復元、Undo／Redo |
| `js/editor/canvas-objects.js`、`js/editor/crowd-display.js` | オブジェクトの見た目と編集制御、混雑表示 |
| `js/editor/view.js`、`js/editor/interaction.js` | 平面図と壁面図の切り替え、キャンバス操作と衝突判定 |
| `js/editor/` の機能別ファイル | 照明、壁、展示物の輪郭、寸法線、パース、PDFなど |
| `js/editor/ui.js`、`js/editor/ui-*.js` | 操作パネルと画面初期化 |
| `images/`、`supabase/` | 会場の図面、データベース設定とEdge Functions |

`editor.html` は、共有状態と保存処理を先に、機能別スクリプトと画面初期化を後に `defer` で読み込みます。ファイル間で共有する状態があるため、読み込み順を変更する場合は初期化の依存関係も確認してください。図面の保存値は実寸が cm、縮尺が px/cm で、入力・表示の境界で mm に換算しています。

## オンラインデモの初期設定

このデモはSupabase AuthとPostgresでログイン・チーム共有を行います。SupabaseのPublishable keyはブラウザー用に設定済みですが、データベースの準備と管理者登録を行うまではログインできません。

1. Supabase DashboardのAuthenticationでメール認証を有効にし、一般ユーザーのサインアップを無効にします。
2. Authentication > Usersで最初の管理者メールアドレスに招待を送ります。
3. 初期構築時は、SQL Editorで `supabase/schema.sql` 末尾の `admin_email` を最初の管理者のメールアドレスに置き換えて実行します。チームとowner権限が作成されます。既存環境の更新には `supabase/migrations/` の個別SQLを使います。
4. 公開後、Authentication > URL ConfigurationのSite URLとRedirect URLsに、公開サイトのURLと `/login.html` を登録します。
5. `supabase/functions/invite-member` をSupabase Edge Functionとしてデプロイします。SupabaseはURLとPublishable/Secret keyを関数環境へ自動で渡します。Secret keyをブラウザーやGitへ置かないでください。
6. リポジトリをVercelに接続して静的サイトとして公開し、公開URLをSupabaseのURL Configurationに登録します。

管理者はチーム機能から編集者・閲覧者・ゲストを招待できます。ゲストの追加とデモログインの手順は [ゲスト設定](docs/GUEST_DEMO.md) にあります。保存済みの配置図はチームで共有され、編集内容は選択中の配置図に自動保存されます。
