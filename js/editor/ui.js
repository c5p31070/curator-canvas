document.addEventListener("DOMContentLoaded", function() {

    const modeButton = document.getElementById('btnToggleAdminMode');
    const adminPanel = document.getElementById('adminSettingsPanel');
    const modeDescription = document.getElementById('modeDescription');
    const adminModeBanner = document.getElementById('adminModeBanner');
    const setAdminMode = enabled => {
        isAdminMode = enabled;
        document.body.classList.toggle('admin-mode', enabled);
        if (adminPanel) adminPanel.hidden = !enabled;
        if (adminModeBanner) adminModeBanner.hidden = !enabled;
        if (modeButton) modeButton.textContent = enabled ? '配置図作成に戻る' : '管理設定を開く';
        if (modeDescription) {
            modeDescription.textContent = enabled
                ? '壁・縮尺・固定設備を事前設定します。'
                : '壁を選び、展示物を配置します。事前登録された設備は固定表示されます。';
        }
        document.querySelectorAll('.admin-only').forEach(el => {
            el.hidden = !enabled;
        });
        applyFixtureEditability();
    };
    setAdminMode(false);
    updateWallDropdownOptions();
    if (modeButton) {
        modeButton.addEventListener('click', () => setAdminMode(!isAdminMode));
    }

    const btnAddWall = document.getElementById('btnAddWall');
    if (btnAddWall) {
        btnAddWall.addEventListener('click', async () => {
            const name = (document.getElementById('newWallTitle')?.value || '').trim();
            const width = parseFloat(document.getElementById('newWallWidthCm')?.value);
            const height = parseFloat(document.getElementById('newWallHeightCm')?.value);
            if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
                alert('壁の長さと高さを1cm以上で入力してください。');
                return;
            }
            captureCurrentCanvasState();
            const id = `wall_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const title = name || `壁面 ${Object.keys(wallPlanJsonData).length + 1}`;
            wallPlanJsonData[id] = { title, widthCm: width, heightCm: height, json: null };
            updateWallDropdownOptions();
            await handleWallSelectChange(id);
            const status = document.getElementById('saveStatus');
            if (status) status.innerText = `「${title}」を登録しました。固定設備を配置できます。`;
        });
    }

    refreshExhibitionList();
    const savedExhibitions = document.getElementById('savedExhibitions');
    const btnLoadExhibition = document.getElementById('btnLoadExhibition');
    const btnDeleteExhibition = document.getElementById('btnDeleteExhibition');
    if (savedExhibitions) {
        savedExhibitions.addEventListener('change', e => {
            selectedExhibitionId = e.target.value;
        });
    }
    if (btnLoadExhibition) {
        btnLoadExhibition.addEventListener('click', () => {
            if (!selectedExhibitionId) {
                alert('呼び出す展覧会を選択してください。');
                return;
            }
            loadExhibitionSnapshot(selectedExhibitionId);
        });
    }
    if (btnDeleteExhibition) {
        btnDeleteExhibition.addEventListener('click', deleteExhibitionSnapshot);
    }

    const tabFloor = document.getElementById("tabFloorPlan");
    const tabWall = document.getElementById("tabWallPlan");
    const tabPdfExport = document.getElementById("tabPdfExport");

    if (tabFloor) {
        tabFloor.addEventListener("click", () => switchViewMode('floor'));
    }

    if (tabWall) {
        tabWall.addEventListener("click", () => switchViewMode('wall'));
    }

    if (tabPdfExport) {
        tabPdfExport.addEventListener("click", () => switchViewMode('pdf'));
    }


    // ----------------------------------------------------
    // 壁面選択
    // ----------------------------------------------------

    const wallListSelect = document.getElementById("wallListSelect");

    if (wallListSelect) {
        wallListSelect.addEventListener("change", function(e) {
            handleWallSelectChange(e.target.value);
        });
    }

    const floorWallListSelect = document.getElementById('floorWallListSelect');
    if (floorWallListSelect) {
        floorWallListSelect.addEventListener('change', e => {
            handleWallSelectChange(e.target.value);
        });
    }


    const btnApplyWallSize = document.getElementById("btnApplyWallSize");

    if (btnApplyWallSize) {
        btnApplyWallSize.addEventListener("click", async function() {

            const wInput = document.getElementById("wallWidthCm");
            const hInput = document.getElementById("wallHeightCm");

            if (wInput && hInput) {

                const newW = parseFloat(wInput.value) || 600;
                const newH = parseFloat(hInput.value) || 300;

                selectedWallInfo.widthCm = newW;
                selectedWallInfo.heightCm = newH;

                if (wallPlanJsonData[selectedWallInfo.id]) {

                    wallPlanJsonData[selectedWallInfo.id].widthCm = newW;
                    wallPlanJsonData[selectedWallInfo.id].heightCm = newH;

                }

                updateWallDropdownOptions();
                updateWallBannerText();
                await renderWallCanvas();
                saveState();
            }
        });
    }

    const btnDeleteWall = document.getElementById('btnDeleteWall');
    if (btnDeleteWall) {
        btnDeleteWall.addEventListener('click', async function() {
            const wallId = selectedWallInfo?.id;
            const wall = wallPlanJsonData[wallId];
            if (!wall) return;

            const wallIds = Object.keys(wallPlanJsonData);
            if (wallIds.length <= 1) {
                alert('最後の壁は削除できません。別の壁を登録してから削除してください。');
                return;
            }
            if (!confirm(`「${wall.title}」と、この壁面に登録された配置・備品を削除しますか？`)) return;

            captureCurrentCanvasState();
            delete wallPlanJsonData[wallId];
            const nextWallId = Object.keys(wallPlanJsonData)[0];
            const nextWall = wallPlanJsonData[nextWallId];
            selectedWallInfo = {
                id: nextWallId,
                title: nextWall.title,
                widthCm: nextWall.widthCm,
                heightCm: nextWall.heightCm
            };

            isTransitioning = true;
            updateWallDropdownOptions();
            updateWallBannerText();
            await renderWallCanvas();
            isTransitioning = false;
            saveState();

            const status = document.getElementById('saveStatus');
            if (status) status.innerText = `「${wall.title}」を削除しました。`;
        });
    }


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

    let selectedItemForEditing = null;
    const itemEditorFields = document.getElementById('itemEditorFields');
    const itemEditorStatus = document.getElementById('itemEditorStatus');
    const itemNameInput = document.getElementById('editItemName');
    const itemDescriptionInput = document.getElementById('editItemDescription');
    const itemTooltip = document.getElementById('canvasTooltip');
    const tooltipTitle = document.getElementById('canvasTooltipTitle');
    const tooltipMeta = document.getElementById('canvasTooltipMeta');
    const tooltipDescription = document.getElementById('canvasTooltipDescription');
    const canvasArea = document.querySelector('.canvas-container-wrapper');
    let hoveredItem = null;

    const isEditableCanvasItem = obj => Boolean(
        obj && (obj.isArtwork || obj.isPin || obj.isFreePin || obj.isGuard || obj.pinLabel !== undefined)
    );
    const getItemName = obj => obj.isArtwork
        ? (obj.artworkName || obj.item(1)?.text || '')
        : (obj.pinName || obj.item(3)?.text || '');
    const updateSelectedItemEditor = obj => {
        selectedItemForEditing = isEditableCanvasItem(obj) ? obj : null;
        if (itemEditorFields) itemEditorFields.hidden = !selectedItemForEditing;
        if (!selectedItemForEditing) {
            if (itemEditorStatus) itemEditorStatus.textContent = 'キャンバス上の展示物またはピンを選択してください。';
            return;
        }
        if (itemEditorStatus) {
            itemEditorStatus.textContent = selectedItemForEditing.isArtwork ? '展示物の情報を編集できます。' : 'ピンの情報を編集できます。';
        }
        if (itemNameInput) itemNameInput.value = getItemName(selectedItemForEditing);
        if (itemDescriptionInput) itemDescriptionInput.value = selectedItemForEditing.description || '';
    };

    canvas.on('selection:created', e => updateSelectedItemEditor(e.selected?.[0] || canvas.getActiveObject()));
    canvas.on('selection:updated', e => updateSelectedItemEditor(e.selected?.[0] || canvas.getActiveObject()));
    canvas.on('selection:cleared', () => updateSelectedItemEditor(null));

    const positionTooltip = nativeEvent => {
        if (!itemTooltip || !canvasArea || !nativeEvent || nativeEvent.clientX === undefined) return;
        const areaRect = canvasArea.getBoundingClientRect();
        itemTooltip.hidden = false;
        const left = nativeEvent.clientX - areaRect.left + 14;
        const top = nativeEvent.clientY - areaRect.top + 14;
        itemTooltip.style.left = `${Math.max(8, Math.min(left, areaRect.width - itemTooltip.offsetWidth - 8))}px`;
        itemTooltip.style.top = `${Math.max(8, Math.min(top, areaRect.height - itemTooltip.offsetHeight - 8))}px`;
    };
    const hideItemTooltip = () => {
        hoveredItem = null;
        if (itemTooltip) itemTooltip.hidden = true;
    };
    canvas.on('mouse:over', e => {
        const obj = e.target;
        if (!isEditableCanvasItem(obj) || !itemTooltip) return hideItemTooltip();
        hoveredItem = obj;
        const name = getItemName(obj) || (obj.isArtwork ? '展示物' : 'ピン');
        const meta = obj.isArtwork && obj.cmWidth && obj.cmHeight
            ? `${obj.cmWidth} × ${obj.cmHeight} cm`
            : (obj.isGuard ? '警備員' : 'ピン');
        tooltipTitle.textContent = name;
        tooltipMeta.textContent = meta;
        tooltipDescription.textContent = obj.description || '';
        tooltipDescription.hidden = !obj.description;
        positionTooltip(e.e);
    });
    canvas.on('mouse:move', e => {
        if (hoveredItem && e.target === hoveredItem) positionTooltip(e.e);
    });
    canvas.on('mouse:out', hideItemTooltip);
    canvas.on('mouse:down', hideItemTooltip);

    const btnApplyItemEdit = document.getElementById('btnApplyItemEdit');
    if (btnApplyItemEdit) {
        btnApplyItemEdit.addEventListener('click', () => {
            const obj = selectedItemForEditing;
            if (!isEditableCanvasItem(obj)) return;
            const newName = (itemNameInput?.value || '').trim();
            if (!newName) {
                alert('名前またはラベルを入力してください。');
                return;
            }
            const newDescription = itemDescriptionInput?.value.trim() || '';
            obj.description = newDescription;

            if (obj.isArtwork) {
                obj.artworkName = newName;
                const label = obj.item(1);
                if (label) {
                    label.set('text', newName);
                    label.initDimensions();
                    obj.addWithUpdate();
                }
            } else {
                obj.pinName = newName;
                const label = obj.item(3);
                const labelBackground = obj.item(2);
                if (label) {
                    label.set('text', newName);
                    label.initDimensions();
                    if (labelBackground) labelBackground.set('width', Math.max(label.width + 8, 24));
                    obj.addWithUpdate();
                }
                const icon = obj.item(1)?.text || '📍';
                obj.pinLabel = `${icon} ${newName}`;
            }

            obj.setCoords();
            canvas.requestRenderAll();
            saveState();
            updateSelectedItemEditor(obj);
            if (itemEditorStatus) itemEditorStatus.textContent = '変更を保存しました。';
        });
    }


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

    const addButton = document.getElementById("addArtwork");

    // フリーピンと警備員を統合したボタン
    const addPinButton = document.getElementById("addPin");

    const updateCrowdButton =
        document.getElementById("updateCrowd");

    const pdfButton =
        document.getElementById("generatePdf");

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


    // ----------------------------------------------------
    // 展示品（作品）の追加
    // ----------------------------------------------------

    if (addButton) {

        addButton.addEventListener("click", function() {

            artworkCount++;

            const displayType =
                displayTypeSelect
                    ? displayTypeSelect.value
                    : 'wall';

            const nameEl =
                document.getElementById("artworkName");

            const descriptionEl =
                document.getElementById("artworkDescription");

            const widthEl =
                document.getElementById("artworkWidth");

            const heightEl =
                document.getElementById("artworkHeight");

            const depthEl =
                document.getElementById("artworkDepth");

            const currentScale =
                scaleInput
                    ? parseFloat(scaleInput.value) || 0.5
                    : 0.5;


            const nameText =
                (nameEl && nameEl.value)
                    ? nameEl.value
                    : `作品 ${artworkCount}`;

            const cmW =
                (widthEl && widthEl.value)
                    ? parseFloat(widthEl.value)
                    : 150;

            const cmH =
                (heightEl && heightEl.value)
                    ? parseFloat(heightEl.value)
                    : 100;

            const cmD =
                (depthEl && depthEl.value)
                    ? parseFloat(depthEl.value)
                    : 5;

            const addAsFixture =
                isAdminMode &&
                document.getElementById('addAsFixture')?.checked;


            let pxW = cmW * currentScale;
            let pxH;


            if (currentViewMode === 'floor') {

                if (displayType === 'wall') {

                    pxH =
                        Math.max(
                            cmD * currentScale,
                            8
                        );

                } else {

                    pxH =
                        cmH * currentScale;

                }

            } else {

                pxH =
                    cmH * currentScale;

            }


            const rect = new fabric.Rect({

                width: pxW,
                height: pxH,

                fill:
                    displayType === 'wall'
                        ? 'rgba(231, 76, 60, 0.85)'
                        : 'rgba(52, 152, 219, 0.8)',

                stroke:
                    displayType === 'wall'
                        ? '#c0392b'
                        : '#2980b9',

                strokeWidth: 2,

                originX: 'center',
                originY: 'center'

            });


            const text = new fabric.Text(
                nameText,
                {

                    fontSize:
                        displayType === 'wall'
                            ? 11
                            : 14,

                    fill: '#ffffff',

                    fontFamily: 'sans-serif',

                    originX: 'center',
                    originY: 'center'

                }
            );


            const artworkGroup =
                new fabric.Group(
                    [rect, text],
                    {

                        left: 450,
                        top: 300,

                        originX: 'center',
                        originY: 'center',

                        hasRotatingPoint: true,

                        isArtwork: true,
                        artworkName: nameText,
                        description: descriptionEl ? descriptionEl.value.trim() : '',

                        displayType: displayType,
                        isFixture: Boolean(addAsFixture),

                        cmWidth: cmW,
                        cmHeight: cmH,
                        cmDepth: cmD,

                        pxWidth: pxW,
                        pxHeight: pxH

                    }
                );


            canvas.add(artworkGroup);

            canvas.setActiveObject(
                artworkGroup
            );

            canvas.renderAll();

        });

    }


    // ====================================================
    // ピン追加
    // フリーピンと警備員を同じ機能に統合
    // ====================================================

    if (addPinButton) {

        addPinButton.addEventListener(
            "click",
            function() {

                pinCount++;


                const textInput =
                    document.getElementById("pinText");

                const descriptionInput =
                    document.getElementById("pinDescription");

                const iconSelect =
                    document.getElementById("pinIcon");

                const colorInput =
                    document.getElementById("pinColor");


                // 選択されたアイコン
                const iconSymbol =
                    iconSelect
                        ? iconSelect.value
                        : "📍";


                // 警備員アイコンを選択した場合だけ警備員扱い
                const isGuardPin =
                    iconSymbol === "👤";


                const pinType =
                    isGuardPin
                        ? "guard"
                        : "free";


                const defaultLabel =
                    isGuardPin
                        ? "警備員"
                        : `ピン ${pinCount}`;


                const labelText =
                    (
                        textInput &&
                        textInput.value.trim()
                    )
                        ? textInput.value.trim()
                        : defaultLabel;


                const selectedColor =
                    colorInput
                        ? colorInput.value
                        : "#ef4444";

                const addAsFixture =
                    isAdminMode &&
                    document.getElementById('addAsFixture')?.checked;


                // ------------------------------------------------
                // アイコン背景
                // ------------------------------------------------

                const iconBgCircle =
                    new fabric.Circle({

                        radius: 12,

                        fill: 'rgba(255, 255, 255, 0)',

                        opacity: 0,

                        originX: 'center',
                        originY: 'center',

                        top: -12

                    });


                // ------------------------------------------------
                // アイコン本体
                // ------------------------------------------------

                const iconTextObj =
                    new fabric.Text(
                        iconSymbol,
                        {

                            // 警備員だけ少し大きくする
                            fontSize:
                                isGuardPin
                                    ? 28
                                    : 22,

                            originX: 'center',
                            originY: 'center',

                            top: -12

                        }
                    );


                // ------------------------------------------------
                // ラベル
                // ------------------------------------------------

                const labelTextObj =
                    new fabric.Text(
                        labelText,
                        {

                            fontSize: 9,

                            fill: '#1e293b',

                            fontFamily:
                                'sans-serif',

                            fontWeight:
                                'bold',

                            originX: 'center',
                            originY: 'center',

                            top: 13

                        }
                    );


                    const labelWidth =
                        Math.max(
                        labelTextObj.width + 8,
                        24
                    );


                // ------------------------------------------------
                // ラベル背景
                // ------------------------------------------------

                const labelBg =
                    new fabric.Rect({

                        width: labelWidth,

                        height: 15,

                        rx: 4,
                        ry: 4,

                        fill:
                            'rgba(255, 255, 255, 0)',

                        stroke:
                            selectedColor,

                        strokeWidth: 1,

                        originX: 'center',
                        originY: 'center',

                        top: 13

                    });


                // ------------------------------------------------
                // ピングループ
                // ------------------------------------------------

                const pinGroup =
                    new fabric.Group(
                        [
                            iconBgCircle,
                            iconTextObj,
                            labelBg,
                            labelTextObj
                        ],
                        {

                            // 通常ピンは350
                            // 警備員は250
                            left: 450,

                            top:
                                isGuardPin
                                    ? 250
                                    : 350,

                            originX: 'center',
                            originY: 'center',

                            hasRotatingPoint: false,


                            // 新しい共通ピン識別子
                            isPin: true,
                            isFixture: Boolean(addAsFixture),
                            pinName: labelText,
                            description: descriptionInput ? descriptionInput.value.trim() : '',

                            // 種類
                            pinType: pinType,

                            // 表示用ラベル
                            pinLabel:
                                `${iconSymbol} ${labelText}`,


                            // ------------------------------------
                            // 旧データとの互換性
                            // ------------------------------------
                            isFreePin:
                                !isGuardPin,

                            isGuard:
                                isGuardPin

                        }
                    );


                canvas.add(pinGroup);

                canvas.setActiveObject(
                    pinGroup
                );

                canvas.renderAll();

            }
        );

    }


    // ----------------------------------------------------
    // 混雑円追加
    // ----------------------------------------------------

    if (updateCrowdButton) {

        updateCrowdButton.addEventListener(
            "click",
            function() {

                const activeObj =
                    canvas.getActiveObject();

                const crowdInput =
                    document.getElementById(
                        "crowdCount"
                    );


                if (
                    !activeObj ||
                    !activeObj.isArtwork
                ) {

                    alert(
                        "混雑度を更新したい作品をキャンバス上で選択してください。"
                    );

                    return;
                }


                const count =
                    crowdInput
                        ? (
                            parseInt(
                                crowdInput.value
                            ) || 0
                        )
                        : 0;


                if (activeObj.crowdCircle) {

                    canvas.remove(
                        activeObj.crowdCircle
                    );

                    activeObj.crowdCircle = null;

                }


                if (count > 0) {

                    const diagonal =
                        Math.sqrt(
                            Math.pow(
                                activeObj.pxWidth,
                                2
                            ) +
                            Math.pow(
                                activeObj.pxHeight,
                                2
                            )
                        );


                    const radius =
                        (diagonal / 2) + 25;


                    const colorObj =
                        getCrowdColor(count);


                    const circle =
                        new fabric.Circle({

                            radius: radius,

                            fill:
                                colorObj.fill,

                            stroke:
                                colorObj.stroke,

                            strokeWidth: 2,

                            left:
                                activeObj.left,

                            top:
                                activeObj.top,

                            originX: 'center',
                            originY: 'center',

                            selectable: false,

                            evented: false

                        });


                    canvas.add(circle);

                    circle.sendToBack();


                    if (canvas.backgroundImage) {
                        circle.bringForward();
                    }


                    activeObj.crowdCircle =
                        circle;

                    activeObj.crowdCountValue =
                        count;

                }


                canvas.renderAll();

                saveState();

            }
        );

    }


    // ----------------------------------------------------
    // PDF
    // ----------------------------------------------------

    if (pdfButton) {

        pdfButton.addEventListener(
            "click",
            generateCombinedPdf
        );

    }

});
