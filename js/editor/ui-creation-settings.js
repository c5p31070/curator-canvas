function initializeCreationSettingsUi() {
    // ----------------------------------------------------
    // 展示方法
    // ----------------------------------------------------

    const displayTypeSelect = document.getElementById("displayType");
    const typeHelpText = document.getElementById("typeHelpText");
    const depthInput = document.getElementById("artworkDepth");
    const depthLabel = document.getElementById('artworkDepthLabel');

    const updateDepthTooltip = () => {
        if (!depthInput || !displayTypeSelect) return;
        if (depthLabel) depthLabel.textContent = displayTypeSelect.value === 'wall' ? '厚み' : '奥行き';
        depthInput.dataset.tooltip = displayTypeSelect.value === 'wall'
            ? '壁面展示では厚みとして扱い、平面図では幅と厚みで表示します。'
            : '床置展示では奥行きとして扱い、平面図では幅と奥行きで表示します。';
    };
    updateDepthTooltip();

    if (displayTypeSelect && typeHelpText) {

        displayTypeSelect.addEventListener("change", function() {

            if (displayTypeSelect.value === 'wall') {

                typeHelpText.innerText =
                    '平面図は幅×厚み、壁面図は幅×高さで表示します。';

            } else {

                typeHelpText.innerText =
                    '平面図は幅×奥行き、壁面図は幅×高さで表示します。';

            }
            updateDepthTooltip();

        });

    }

    // ----------------------------------------------------
    // 縮尺
    // ----------------------------------------------------

    const scaleInput = document.getElementById("scale");

    if (scaleInput) {

        scaleInput.addEventListener("change", async function() {

            const newScale =
                Number(scaleInput.value);
            await window.saveTeamFloorScale(newScale);

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
            if (!confirm("現在表示中の配置図にある展示物・ピン・描画・図形・寸法線・移動壁をすべて消去しますか？移動壁の前面・裏面の配置も削除されます。")) return;
            window.cancelDimensionDrawing?.();
            window.cancelLightingPlacement?.();

            const removable = canvas.getObjects().filter(obj => !obj.isFixture && (
                obj.isArtwork || obj.isMovableWall || obj.isPin || obj.isFreePin || obj.isGuard ||
                obj.pinLabel !== undefined || obj.isCrowdCircle || obj.isFreeDrawing || obj.isShapeObject || obj.isDimension || obj.type === 'path' ||
                (obj.isLightObject && obj.lightKind === 'spot')
            ));
            const wasRestoring = isUndoRedoOperation;
            isUndoRedoOperation = true;
            try {
                window.removeMovableWallFaces?.(removable.filter(obj => obj.isMovableWall));
                canvas.discardActiveObject();
                canvas.remove(...removable);
            } finally { isUndoRedoOperation = wasRestoring; }
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
                obj.isArtwork || obj.isMovableWall || obj.isPin || obj.isFreePin || obj.isGuard || obj.pinLabel !== undefined ||
                obj.isFreeDrawing || obj.isShapeObject || obj.isDimension || obj.type === 'path' ||
                window.canDeleteLightingObject?.(obj)
            );

            if (deletableObjects.length > 0) {
                const venueEquipment = deletableObjects.filter(obj => obj.isLightRail || (obj.isLightObject && obj.lightKind === 'fixed'));
                const railIds = new Set(venueEquipment.filter(obj => obj.isLightRail).map(obj => obj.lightId));
                const attachedSpotlights = canvas.getObjects().filter(obj => obj.isLightObject && obj.lightKind === 'spot' && railIds.has(obj.lightRailId));
                if (venueEquipment.length && !confirm(`照明の事前設定 ${venueEquipment.length}件を削除しますか？${attachedSpotlights.length ? `\nレール上のスポットライト ${attachedSpotlights.length}個も削除します。` : ''}`)) return;
                const movableWalls = deletableObjects.filter(obj => obj.isMovableWall);
                if (movableWalls.length && !window.confirmMovableWallRemoval?.(movableWalls)) return;
                const relatedObjects = deletableObjects
                    .map(obj => obj.crowdCircle)
                    .filter(Boolean);
                const wasRestoring = isUndoRedoOperation;
                isUndoRedoOperation = true;
                try {
                    if (movableWalls.length) window.removeMovableWallFaces?.(movableWalls);
                    canvas.discardActiveObject();
                    canvas.remove(...deletableObjects, ...relatedObjects, ...attachedSpotlights);
                } finally { isUndoRedoOperation = wasRestoring; }
                if (venueEquipment.length) {
                    window.persistLightingEquipmentChange?.(venueEquipment[0]);
                    window.refreshLighting?.();
                }
                window.queueVenueWallFixtureChange?.(deletableObjects.find(obj => obj.isFixture));
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
