let pendingArtworkCatalogId = '';

function refreshArtworkCatalog() {
    window.ensureArtworkCatalogNumbers?.();
    const select = document.getElementById('savedArtworkSelect');
    const addButton = document.getElementById('btnAddSavedArtwork');
    const deleteButton = document.getElementById('btnDeleteSavedArtwork');
    if (!select) return;
    const selected = select.value;
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = savedArtworkCatalog.length ? '展示品を選択してください' : '保存済み展示品はありません';
    select.appendChild(placeholder);
    savedArtworkCatalog.forEach(item => {
        const option = document.createElement('option');
        option.value = item.id;
        const typeLabel = item.displayType === 'wall' ? '壁面' : '床置';
        const dimensions = item.displayType === 'wall'
            ? `幅 ${item.cmWidth} × 高さ ${item.cmHeight} × 厚み ${item.cmDepth} cm`
            : `幅 ${item.cmWidth} × 奥行 ${item.cmDepth} × 高さ ${item.cmHeight} cm`;
        option.textContent = `No.${item.artworkNumber} ${item.name} · ${typeLabel} · ${dimensions}${item.artworkCenterHeightCm != null ? ` · 中央高 ${item.artworkCenterHeightCm} cm` : ''}`;
        select.appendChild(option);
    });
    select.value = savedArtworkCatalog.some(item => item.id === selected) ? selected : '';
    if (addButton) addButton.disabled = !select.value;
    if (deleteButton) deleteButton.disabled = !select.value;
}

function upsertArtworkCatalogEntry(data, preferredId = '') {
    const existing = savedArtworkCatalog.find(item => item.id === preferredId) ||
        savedArtworkCatalog.find(item => item.displayType === data.displayType &&
            item.name === data.name && Number(item.cmWidth) === Number(data.cmWidth) &&
            Number(item.cmHeight) === Number(data.cmHeight) && Number(item.cmDepth) === Number(data.cmDepth));
    const id = existing?.id || (window.crypto?.randomUUID?.() || `artwork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    const entry = { ...data, id, artworkNumber: existing?.artworkNumber || window.nextArtworkNumber() };
    if (existing) savedArtworkCatalog = savedArtworkCatalog.map(item => item.id === id ? entry : item);
    else savedArtworkCatalog = [...savedArtworkCatalog, entry];
    window.refreshArtworkCatalog();
    return id;
}

window.refreshArtworkCatalog = refreshArtworkCatalog;
window.updateArtworkCatalogEntry = obj => {
    if (!obj?.artworkCatalogId) return;
    if (!savedArtworkCatalog.some(item => item.id === obj.artworkCatalogId)) return;
    upsertArtworkCatalogEntry({
        name: obj.artworkName || '名称未設定',
        description: obj.description || '',
        displayType: obj.displayType || 'wall',
        cmWidth: Number(obj.cmWidth) || 150,
        cmHeight: Number(obj.cmHeight) || 100,
        cmDepth: Number(obj.cmDepth) || 5,
        artworkCenterHeightCm: window.getArtworkCenterHeightCm(obj)
    }, obj.artworkCatalogId);
};
window.migrateArtworkCatalogFromPlans = () => {
    const registerPlan = raw => {
        if (!raw) return;
        let plan;
        try { plan = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
        const visit = objects => (objects || []).forEach(obj => {
            if (obj.isArtwork && !obj.isFixture) {
                upsertArtworkCatalogEntry({
                    name: obj.artworkName || '名称未設定',
                    description: obj.description || '',
                    displayType: obj.displayType || 'wall',
                    cmWidth: Number(obj.cmWidth) || 150,
                    cmHeight: Number(obj.cmHeight) || 100,
                    cmDepth: Number(obj.cmDepth) || 5,
                    artworkCenterHeightCm: window.getArtworkCenterHeightCm(obj)
                }, obj.artworkCatalogId || '');
            }
            if (Array.isArray(obj.objects)) visit(obj.objects);
        });
        visit(plan.objects);
    };
    Object.values(floorPlanData).forEach(floor => registerPlan(floor.json));
    Object.values(wallPlanJsonData || {}).forEach(wall => registerPlan(wall.json));
    refreshArtworkCatalog();
};

function initializeObjectControlsUi() {
    const pinKindInput = document.getElementById('pinIcon');
    const refreshPinNumberField = () => {
        const field = document.getElementById('pinNumberField');
        if (field) field.hidden = pinKindInput?.value !== 'number';
    };
    pinKindInput?.addEventListener('change', refreshPinNumberField);
    refreshPinNumberField();
    const displayTypeSelect = document.getElementById("displayType");
    const scaleInput = document.getElementById("scale");
    const addButton = document.getElementById("addArtwork");
    const addPinButton = document.getElementById("addPin");
    const updateCrowdButton = document.getElementById("updateCrowd");
    const pdfButton = document.getElementById("generatePdf");
    const savedArtworkSelect = document.getElementById('savedArtworkSelect');
    const addSavedArtworkButton = document.getElementById('btnAddSavedArtwork');
    const deleteSavedArtworkButton = document.getElementById('btnDeleteSavedArtwork');
    refreshArtworkCatalog();
    savedArtworkSelect?.addEventListener('change', () => {
        if (addSavedArtworkButton) addSavedArtworkButton.disabled = !savedArtworkSelect.value;
        if (deleteSavedArtworkButton) deleteSavedArtworkButton.disabled = !savedArtworkSelect.value;
    });

    deleteSavedArtworkButton?.addEventListener('click', () => {
        if (window.CURATOR_ROLE === 'viewer') return;
        const item = savedArtworkCatalog.find(entry => entry.id === savedArtworkSelect?.value);
        if (!item || !confirm(`「${item.name}」を保存済み一覧から削除しますか？配置済みの展示物はそのまま残ります。`)) return;
        savedArtworkCatalog = savedArtworkCatalog.filter(entry => entry.id !== item.id);
        refreshArtworkCatalog();
        saveState();
    });

    addSavedArtworkButton?.addEventListener('click', () => {
        const item = savedArtworkCatalog.find(entry => entry.id === savedArtworkSelect?.value);
        if (!item || !addButton) return;
        document.getElementById('artworkName').value = item.name;
        document.getElementById('artworkDescription').value = item.description || '';
        document.getElementById('displayType').value = item.displayType || 'wall';
        document.getElementById('artworkWidth').value = item.cmWidth;
        document.getElementById('artworkHeight').value = item.cmHeight;
        document.getElementById('artworkDepth').value = item.cmDepth;
        document.getElementById('artworkCenterHeight').value = item.artworkCenterHeightCm ?? '';
        document.getElementById('displayType').dispatchEvent(new Event('change', { bubbles: true }));
        pendingArtworkCatalogId = item.id;
        addButton.click();
    });
    // ----------------------------------------------------
    // 展示品（作品）の追加
    // ----------------------------------------------------

    if (addButton) {

        addButton.addEventListener("click", function() {

            if (window.CURATOR_ROLE === 'viewer' || isTransitioning) return;
            const centerHeightText = document.getElementById('artworkCenterHeight').value.trim();
            let centerHeight = centerHeightText === '' ? null : Number(centerHeightText);
            if (centerHeight !== null && (!Number.isFinite(centerHeight) || centerHeight < 0)) {
                alert('作品中央の高さは0以上の数値で入力してください。');
                return;
            }

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
            if (centerHeight === null && displayType === 'floor') centerHeight = cmH / 2;

            const catalogId = addAsFixture ? '' : upsertArtworkCatalogEntry({
                name: nameText,
                description: descriptionEl ? descriptionEl.value.trim() : '',
                displayType,
                cmWidth: cmW,
                cmHeight: cmH,
                cmDepth: cmD,
                artworkCenterHeightCm: centerHeight
            }, pendingArtworkCatalogId);
            pendingArtworkCatalogId = '';

            let pxW = cmW * currentScale;
            const isFloorPlan = currentViewMode === 'floor';
            // 平面図は幅×奥行き（壁面展示では厚み）、壁面図は幅×高さで描画。
            const pxH = Math.max(
                (isFloorPlan ? cmD : cmH) * currentScale,
                isFloorPlan ? 8 : 6
            );

            const appearance = getArtworkAppearance({ displayType, isFixture: Boolean(addAsFixture) });
            const rect = new fabric.Rect({

                width: pxW,
                height: pxH,

                fill: appearance.fill,
                stroke: appearance.stroke,
                strokeWidth: 1.5,
                strokeDashArray: appearance.dash,

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

                    fill: appearance.text,

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
                        artworkCatalogId: catalogId,
                        artworkNumber: savedArtworkCatalog.find(item => item.id === catalogId)?.artworkNumber,
                        description: descriptionEl ? descriptionEl.value.trim() : '',

                        displayType: displayType,
                        isFixture: Boolean(addAsFixture),

                        cmWidth: cmW,
                        cmHeight: cmH,
                        cmDepth: cmD,
                        artworkCenterHeightCm: centerHeight,

                        pxWidth: pxW,
                        pxHeight: pxH

                    }
                );

            configureArtworkTransform(artworkGroup);

            window.snapObjectToGrid?.(artworkGroup);
            window.snapArtworkToMovableWall?.(artworkGroup);
            if (currentViewMode === 'wall') {
                if (!window.placeArtworkAtSavedHeight(artworkGroup)) window.updateArtworkHeightFromWall(artworkGroup, true);
            }
            if (artworkGroup.artworkCenterHeightCm != null) window.shareArtworkCenterHeight(artworkGroup);
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

                if (window.CURATOR_ROLE === 'viewer') return;
                if (document.getElementById('pinIcon')?.value === 'number') {
                    const numberInput = document.getElementById('pinNumber');
                    const number = Number(numberInput.value);
                    if (!Number.isInteger(number) || number < 1 || number > 999) {
                        alert('番号は1〜999の整数で入力してください。');
                        return;
                    }
                    const name = document.getElementById('pinText')?.value.trim() || `番号 ${number}`;
                    const color = document.getElementById('pinColor')?.value || '#ef4444';
                    const text = new fabric.Text(String(number), { fontSize: 12, fontFamily: 'sans-serif',
                        fill: color, originX: 'center', originY: 'center' });
                    const ring = new fabric.Circle({ radius: Math.max(10, text.width / 2 + 4),
                        fill: 'rgba(255,255,255,0)', stroke: color, strokeWidth: 1,
                        originX: 'center', originY: 'center' });
                    const center = canvas.getCenter();
                    const pin = new fabric.Group([ring, text], { left: center.left, top: center.top,
                        originX: 'center', originY: 'center', isPin: true, isFreePin: true,
                        isNumberPin: true, pinType: 'number', pinNumber: number, pinName: name,
                        pinLabel: `(${number}) ${name}`, description: document.getElementById('pinDescription')?.value.trim() || '',
                        isFixture: Boolean(isAdminMode && document.getElementById('addAsFixture')?.checked) });
                    pinCount++;
                    window.snapObjectToGrid?.(pin);
                    canvas.add(pin);
                    canvas.setActiveObject(pin);
                    canvas.requestRenderAll();
                    saveState();
                    numberInput.value = Math.min(999, number + 1);
                    return;
                }
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

                window.snapObjectToGrid?.(pinGroup);
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
                        ((diagonal / 2) + 25) * 1.1;

                    const colorObj =
                        getCrowdColor(count);

                    const circle = createCrowdSemicircle(
                        activeObj, radius, colorObj.fill, colorObj.stroke, 2
                    );

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
}
