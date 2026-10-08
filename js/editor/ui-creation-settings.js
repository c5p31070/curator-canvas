function initializeCreationSettingsUi() {
    // ----------------------------------------------------
    // 展示方法
    // ----------------------------------------------------

    const displayTypeSelect = document.getElementById("displayType");
    const typeHelpText = document.getElementById("typeHelpText");
    const depthInput = document.getElementById("artworkDepth");

    const updateDepthTooltip = () => {
        if (!depthInput || !displayTypeSelect) return;
        depthInput.dataset.tooltip = displayTypeSelect.value === 'wall'
            ? '壁面展示では厚みとして扱い、平面図では幅と厚みで表示します。'
            : '床置展示では奥行きとして扱い、平面図では幅と奥行きで表示します。';
    };
    updateDepthTooltip();

    if (displayTypeSelect && typeHelpText) {

        displayTypeSelect.addEventListener("change", function() {

            if (displayTypeSelect.value === 'wall') {

                typeHelpText.innerText =
                    '※壁面展示では「幅×厚み」の細長い形状で平面図に描画されます。';

            } else {

                typeHelpText.innerText =
                    '※床置展示では「幅×奥行き」の領域で平面図に描画されます。';

            }
            updateDepthTooltip();

        });

    }

    // ----------------------------------------------------
    // 縮尺
    // ----------------------------------------------------

    const scaleInput = document.getElementById("scale");

    if (scaleInput) {

        scaleInput.addEventListener("change", function() {

            const newScale =
                parseFloat(scaleInput.value) || 0.5;

            applyScaleToAllArtworks(newScale);

        });

    }

    // ----------------------------------------------------
    // ボタン取得
    // ----------------------------------------------------

    const btnUndo =
        document.getElementById("btnUndo");

    const btnRedo =
        document.getElementById("btnRedo");

    const btnSaveData =
        document.getElementById("btnSaveData");

    const btnResetCurrentLayout =
        document.getElementById("btnResetCurrentLayout");

    // ----------------------------------------------------
    // Undo / Redo
    // ----------------------------------------------------

    if (btnUndo) {
        btnUndo.addEventListener("click", undo);
    }

    if (btnRedo) {
        btnRedo.addEventListener("click", redo);
    }

    // ----------------------------------------------------
    // 手動保存
    // ----------------------------------------------------

    if (btnSaveData) {

        btnSaveData.addEventListener("click", function() {

            saveExhibitionSnapshot();

        });

    }

    // ----------------------------------------------------
    // 初期化
    // ----------------------------------------------------

    if (btnResetCurrentLayout) {
        btnResetCurrentLayout.addEventListener("click", function() {
            if (!confirm("現在表示中の配置図にある展示物・ピン・フリーペイントをすべて消去しますか？")) return;

            const removable = canvas.getObjects().filter(obj =>
                obj.isArtwork || obj.isPin || obj.isFreePin || obj.isGuard ||
                obj.pinLabel !== undefined || obj.isCrowdCircle || obj.isFreeDrawing || obj.isShapeObject || obj.type === 'path'
            );
            canvas.discardActiveObject();
            canvas.remove(...removable);
            canvas.requestRenderAll();
            artworkCount = canvas.getObjects().filter(obj => obj.isArtwork).length;
            pinCount = canvas.getObjects().filter(obj => obj.isPin || obj.isFreePin || obj.isGuard).length;
            saveState();

            const statusEl = document.getElementById("saveStatus");
            if (statusEl) statusEl.innerText = "現在の配置図をリセットしました";
        });
    }

    // ----------------------------------------------------
    // キーボードショートカット
    // ----------------------------------------------------

    window.addEventListener("keydown", function(e) {

        if (window.CURATOR_ROLE === 'viewer' && (
            e.key === 'Delete' || e.key === 'r' || e.key === 'R' ||
            ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase()))
        )) {
            e.preventDefault();
            return;
        }

        if (
            e.target.tagName === 'INPUT' ||
            e.target.tagName === 'TEXTAREA' ||
            e.target.tagName === 'SELECT' ||
            e.target.isContentEditable
        ) {
            return;
        }

        // Deleteキー → 選択中の展示物・ピンを削除
        if (e.key === 'Delete') {
            const selectedObjects = canvas.getActiveObjects();
            const deletableObjects = selectedObjects.filter(obj =>
                obj.isArtwork || obj.isPin || obj.isFreePin || obj.isGuard || obj.pinLabel !== undefined ||
                obj.isFreeDrawing || obj.isShapeObject || obj.type === 'path'
            );

            if (deletableObjects.length > 0) {
                const relatedObjects = deletableObjects
                    .map(obj => obj.crowdCircle)
                    .filter(Boolean);
                canvas.discardActiveObject();
                canvas.remove(...deletableObjects, ...relatedObjects);
                canvas.requestRenderAll();
                saveState();
                e.preventDefault();
            }
            return;
        }

        // Rキー → 90度回転
        if (e.key === 'r' || e.key === 'R') {

            rotateActiveObject();

            e.preventDefault();

        }

        // Ctrl + Z
        else if (
            (e.ctrlKey || e.metaKey) &&
            e.key === 'z'
        ) {

            if (e.shiftKey) {
                redo();
            } else {
                undo();
            }

            e.preventDefault();

        }

        // Ctrl + Y
        else if (
            (e.ctrlKey || e.metaKey) &&
            e.key === 'y'
        ) {

            redo();

            e.preventDefault();

        }

    });
}
