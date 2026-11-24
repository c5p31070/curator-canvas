// 各機能の入力欄やボタンの初期化を、画面の読み込み後にまとめて実行します。
document.addEventListener("DOMContentLoaded", function() {
    initializeNavigationUi();
    initializeCanvasControlsUi();
    initializeItemDetailsUi();
    initializeCreationSettingsUi();
    initializeObjectControlsUi();
});
