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

## オンラインデモの初期設定

このデモはSupabase AuthとPostgresでログイン・チーム共有を行います。SupabaseのPublishable keyはブラウザー用に設定済みですが、データベースの準備と管理者登録を行うまではログインできません。

1. Supabase DashboardのAuthenticationでメール認証を有効にし、一般ユーザーのサインアップを無効にします。
2. Authentication > Usersで最初の管理者メールアドレスに招待を送ります。
3. SQL Editorで `supabase/schema.sql` を開き、末尾の `REPLACE_WITH_ADMIN_EMAIL` を最初の管理者のメールアドレスに置き換えて実行します。チームとowner権限が作成されます。
4. 公開後、Authentication > URL ConfigurationのSite URLとRedirect URLsに、公開サイトのURLと `/login.html` を登録します。
5. Supabase CLIから `supabase/functions/invite-member` をデプロイし、Edge Function Secretsに `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY` を設定します。secret keyはブラウザーやGitに置かず、SupabaseのSecretsにのみ登録してください。
6. リポジトリをVercelに接続して静的サイトとして公開し、公開URLをSupabaseのURL Configurationに登録します。

管理者はチーム機能から編集者または閲覧者を招待できます。編集者は共有配置図の作成・編集・削除ができ、閲覧者は配置図を開いて閲覧できます。保存済みの配置図はチームで共有され、編集内容は選択中の配置図に自動保存されます。
