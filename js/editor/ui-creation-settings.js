function initializeCreationSettingsUi() {
    // ----------------------------------------------------
    // 展示方法
    // ----------------------------------------------------

    const displayTypeSelect = document.getElementById("displayType");
    const typeHelpText = document.getElementById("typeHelpText");

    if (displayTypeSelect && typeHelpText) {

        displayTypeSelect.addEventListener("change", function() {

            if (displayTypeSelect.value === 'wall') {

                typeHelpText.innerText =
                    '※壁面展示では「幅×厚み」の細長い形状で平面図に描画されます。';

            } else {

                typeHelpText.innerText =
                    '※床置展示では「幅×奥行き」の領域で平面図に描画されます。';

            }

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

    const btnClearData =
        document.getElementById("btnClearData");

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

    if (btnClearData) {

        btnClearData.addEventListener("click", function() {

            if (
                confirm(
                    "保存されている下書きデータを削除し、キャンバスを初期化しますか？"
                )
            ) {

                localStorage.removeItem(STORAGE_KEY);

                canvas.clear();

                if (titleInput) {
                    titleInput.value = "";
                }

                loadBackgroundImage(function() {

                    historyStack = [];
                    redoStack = [];

                    artworkCount = 0;
                    pinCount = 0;

                    floorPlanJsonData = null;

                    wallPlanJsonData = {
                        'wall_default': {
                            title: '壁 A',
                            widthCm: 600,
                            heightCm: 300,
                            json: null
                        }
                    };

                    selectedWallInfo = {
                        id: 'wall_default',
                        title: '壁 A',
                        widthCm: 600,
                        heightCm: 300
                    };

                    currentViewMode = 'floor';

                    switchViewMode('floor');

                    saveState();

                    const statusEl =
                        document.getElementById("saveStatus");

                    if (statusEl) {
                        statusEl.innerText =
                            "データを初期化しました";
                    }

                });

            }

        });

    }

    // ----------------------------------------------------
    // キーボードショートカット
    // ----------------------------------------------------

    window.addEventListener("keydown", function(e) {

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
                obj.isFreeDrawing || obj.type === 'path'
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
