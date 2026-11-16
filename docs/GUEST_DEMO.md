# アカウント付きゲスト

ゲストは通常のログイン画面からメールアドレスとパスワードで入ります。チームの展覧会を閲覧・作成・編集・削除できます。管理者モード、会場共通設定の変更、メンバーの招待は管理権限のあるメンバーが行います。

## 既存環境への反映

1. SupabaseのSQL Editorで `supabase/migrations/20261116_authenticated_guest_role.sql` を実行します。
2. SupabaseのEdge Function `invite-member` を更新してデプロイします。
3. アプリをVercelに反映します。

## ゲストの追加

チームの管理者でログインし、「チーム」でメールアドレスを入力して「ゲスト（配置図の編集可）」を選び、「招待を送る」を押します。

- 新規アカウントには招待メールが届きます。受信者がリンクを開いてパスワードを設定します。
- 管理者がSupabase Authenticationで先に作成し、メールアドレスを確認済みにしたアカウントも、同じ画面からゲストとして追加できます。この場合は既存のパスワードでログインできます。

以前のアカウント不要の体験版で作った配置図は、使用したブラウザーに保存されています。

## 発表用のワンクリックログイン

1. 発表に使う確認済みアカウントを、チームに `guest` として登録します。
2. Supabaseの **Edge Functions → Secrets** に `DEMO_GUEST_EMAIL` と `DEMO_GUEST_PASSWORD` を追加し、そのアカウントのメールアドレスとパスワードを設定します。
3. `supabase/functions/demo-login/index.ts` を `demo-login` としてデプロイします。ログイン前に呼ぶ関数なので、この関数のJWT検証はオフにします。CLIでは `supabase functions deploy demo-login --no-verify-jwt` を使えます。
4. Vercelに反映し、ログイン画面で「デモでログイン」を押します。

公開中は、ログイン画面を開ける人がこの共有ゲストとしてチームの展覧会を編集できます。設定したパスワードはSupabaseのSecretsで管理されます。発表後に新規のデモログインを止めるには、`DEMO_GUEST_PASSWORD` のSecretを削除します。
