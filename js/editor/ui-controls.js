function initializeCanvasControlsUi() {
    // ----------------------------------------------------
    // 展覧会タイトル
    // ----------------------------------------------------

    const titleInput = document.getElementById("exhibitionTitle");

    if (titleInput) {
        titleInput.addEventListener("input", saveState);
    }

    // ----------------------------------------------------
    // 回転
    // ----------------------------------------------------

    const btnRotate90 = document.getElementById("btnRotate90");

    if (btnRotate90) {
        btnRotate90.addEventListener("click", rotateActiveObject);
    }

    // ----------------------------------------------------
    // 縮尺測定
    // ----------------------------------------------------

    const btnMeasureScale = document.getElementById("btnMeasureScale");

    if (btnMeasureScale) {
        btnMeasureScale.addEventListener("click", function() {
            toggleMeasuringMode();
        });
    }

    const btnToggleFreeDraw = document.getElementById('btnToggleFreeDraw');
    const freeDrawColor = document.getElementById('freeDrawColor');
    const freeDrawWidth = document.getElementById('freeDrawWidth');
    if (btnToggleFreeDraw) {
        btnToggleFreeDraw.addEventListener('click', () => toggleFreeDrawingMode());
    }
    if (freeDrawColor) freeDrawColor.addEventListener('input', updateFreeDrawingBrush);
    if (freeDrawWidth) freeDrawWidth.addEventListener('input', updateFreeDrawingBrush);
}
