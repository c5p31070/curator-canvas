function initializeItemDetailsUi() {
    let selectedItemForEditing = null;
    const itemEditorFields = document.getElementById('itemEditorFields');
    const itemEditorStatus = document.getElementById('itemEditorStatus');
    const itemNameInput = document.getElementById('editItemName');
    const itemDescriptionInput = document.getElementById('editItemDescription');
    const itemArtworkDimensions = document.getElementById('itemArtworkDimensions');
    const itemWidthInput = document.getElementById('editItemWidth');
    const itemHeightInput = document.getElementById('editItemHeight');
    const itemDepthInput = document.getElementById('editItemDepth');
    const itemCenterHeightInput = document.getElementById('editArtworkCenterHeight');
    const itemDepthLabel = document.getElementById('editItemDepthLabel');
    const itemAngleInput = document.getElementById('editItemAngle');
    const itemPinNumberInput = document.getElementById('editItemPinNumber');
    const itemPinNumberField = document.getElementById('itemPinNumberField');
    const itemTooltip = document.getElementById('canvasTooltip');
    const tooltipTitle = document.getElementById('canvasTooltipTitle');
    const tooltipMeta = document.getElementById('canvasTooltipMeta');
    const tooltipDescription = document.getElementById('canvasTooltipDescription');
    const canvasArea = document.querySelector('.canvas-container-wrapper');
    let hoveredItem = null;
    let saveTimer = null;
    let rotationInputTimer = null;
    let pendingEditedObject = null;
    window.refreshArtworkHeightEditor = obj => {
        if (obj === selectedItemForEditing && itemCenterHeightInput && document.activeElement !== itemCenterHeightInput) {
            const value = window.getArtworkCenterHeightCm(obj);
            itemCenterHeightInput.value = value === null ? '' : Number(value.toFixed(2));
        }
    };

    window.flushPendingItemEditHistory = () => {
        if (!saveTimer) return;
        clearTimeout(saveTimer);
        saveTimer = null;
        saveState();
        if (itemEditorStatus && selectedItemForEditing === pendingEditedObject) {
            itemEditorStatus.textContent = '変更を自動保存しました。';
        }
        pendingEditedObject = null;
    };

    const isEditableCanvasItem = obj => Boolean(
        obj && (obj.isArtwork || obj.isPin || obj.isFreePin || obj.isGuard || obj.pinLabel !== undefined)
    );
    const isInspectableCanvasItem = obj => isEditableCanvasItem(obj) || Boolean(obj?.isMovableWall || obj?.isLightObject);
    const getItemName = obj => obj.isLightObject ? (obj.lightName || 'ライト') : obj.isMovableWall ? (obj.movableWallName || '移動壁')
        : obj.isArtwork ? (obj.artworkName || obj.item(1)?.text || '')
            : (obj.pinName || obj.item(3)?.text || '');
    const updateSelectedItemEditor = obj => {
        selectedItemForEditing = isEditableCanvasItem(obj) ? obj : null;
        if (itemEditorFields) itemEditorFields.hidden = !selectedItemForEditing;
        if (!selectedItemForEditing) {
            if (itemEditorStatus) itemEditorStatus.textContent = 'キャンバス上の展示物またはピンを選択してください。';
            return;
        }
        window.activateToolPanel?.('edit');
        if (itemEditorStatus) {
            itemEditorStatus.textContent = selectedItemForEditing.isArtwork
                ? (selectedItemForEditing.isFixture ? '展示物の情報を編集できます。' : `No.${window.getArtworkNumber(selectedItemForEditing)}`)
                : 'ピンの情報を編集できます。';
        }
        if (itemNameInput) itemNameInput.value = getItemName(selectedItemForEditing);
        if (itemDescriptionInput) itemDescriptionInput.value = selectedItemForEditing.description || '';
        const isArtwork = Boolean(selectedItemForEditing?.isArtwork);
        if (itemPinNumberField) itemPinNumberField.hidden = !selectedItemForEditing.isNumberPin;
        if (itemPinNumberInput && selectedItemForEditing.isNumberPin) itemPinNumberInput.value = selectedItemForEditing.pinNumber;
        if (itemArtworkDimensions) itemArtworkDimensions.hidden = !isArtwork;
        if (isArtwork) {
            if (itemDepthLabel) itemDepthLabel.textContent = selectedItemForEditing.displayType === 'floor' ? '奥行き' : '厚み';
            if (itemWidthInput) itemWidthInput.value = selectedItemForEditing.cmWidth ?? 150;
            if (itemHeightInput) itemHeightInput.value = selectedItemForEditing.cmHeight ?? 100;
            if (itemDepthInput) itemDepthInput.value = selectedItemForEditing.cmDepth ?? 5;
            if (itemAngleInput) itemAngleInput.value = Math.round(selectedItemForEditing.angle || 0);
            window.refreshArtworkHeightEditor(selectedItemForEditing);
        }
    };

    canvas.on('selection:created', e => updateSelectedItemEditor(e.selected?.[0] || canvas.getActiveObject()));
    canvas.on('selection:updated', e => updateSelectedItemEditor(e.selected?.[0] || canvas.getActiveObject()));
    canvas.on('selection:cleared', () => updateSelectedItemEditor(null));

    const positionTooltip = nativeEvent => {
        nativeEvent = nativeEvent?.changedTouches?.[0] || nativeEvent?.touches?.[0] || nativeEvent;
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
    const showItemTooltip = e => {
        const obj = e.target;
        if (!isInspectableCanvasItem(obj) || !itemTooltip) return hideItemTooltip();
        hoveredItem = obj;
        const name = getItemName(obj) || (obj.isArtwork ? '展示物' : 'ピン');
        const meta = obj.isMovableWall
            ? `幅 ${obj.cmWidth} × 厚さ ${obj.cmDepth} × 高さ ${obj.cmHeight || 440} cm`
            : obj.isArtwork && obj.cmWidth && obj.cmHeight
            ? (obj.displayType === 'floor'
                ? `幅 ${obj.cmWidth} × 奥行 ${obj.cmDepth} × 高さ ${obj.cmHeight} cm`
                : `幅 ${obj.cmWidth} × 高さ ${obj.cmHeight} × 厚み ${obj.cmDepth} cm`)
            : (obj.isGuard ? '警備員' : 'ピン');
        tooltipTitle.textContent = obj.isArtwork && !obj.isFixture ? `No.${window.getArtworkNumber(obj)} ${name}` : name;
        tooltipMeta.textContent = meta;
        const description = obj.isMovableWall
            ? `${FLOOR_PLANS[obj.movableFloorId]?.title || 'ロビー階'} / 回転 ${Number((obj.angle || 0).toFixed(1))}°`
            : obj.description || '';
        tooltipDescription.textContent = description;
        tooltipDescription.hidden = !description;
        if (obj.isLightObject) {
            const details = window.getLightPopupDetails?.(obj);
            if (details) {
                tooltipTitle.textContent = details.title;
                tooltipMeta.textContent = details.meta;
                tooltipDescription.textContent = details.description;
                tooltipDescription.hidden = !details.description;
            }
        }
        positionTooltip(e.e);
    };
    canvas.on('mouse:over', showItemTooltip);
    canvas.on('mouse:move', e => {
        if (hoveredItem && e.target === hoveredItem) positionTooltip(e.e);
    });
    canvas.on('mouse:out', hideItemTooltip);
    let tapStart = null;
    const touchPoint = event => event?.changedTouches?.[0] || event?.touches?.[0] || event;
    canvas.on('mouse:down', event => {
        hideItemTooltip();
        const point = touchPoint(event.e);
        tapStart = (event.e?.touches || event.e?.pointerType === 'touch' || event.e?.pointerType === 'pen')
            ? { target: event.target, x: point.clientX, y: point.clientY, moved: event.e?.touches?.length > 1 } : null;
    });
    canvas.on('mouse:move', event => {
        const point = touchPoint(event.e);
        if (tapStart && (event.e?.touches?.length > 1 || Math.hypot(point.clientX - tapStart.x, point.clientY - tapStart.y) > 6)) tapStart.moved = true;
    });
    canvas.on('mouse:up', event => {
        const point = touchPoint(event.e);
        if (tapStart && !tapStart.moved && event.target === tapStart.target &&
            Math.hypot(point.clientX - tapStart.x, point.clientY - tapStart.y) <= 6 && !isFreeDrawingMode) showItemTooltip(event);
        tapStart = null;
    });

    const applyItemEdit = (applyRotation = false) => {
            const obj = selectedItemForEditing;
            if (!isEditableCanvasItem(obj)) return false;
            const newName = (itemNameInput?.value || '').trim();
            if (!newName) {
                if (itemEditorStatus) itemEditorStatus.textContent = '名前を入力してください。';
                return false;
            }
            const newDescription = itemDescriptionInput?.value.trim() || '';

            if (obj.isArtwork) {
                const heightText = itemCenterHeightInput?.value.trim() || '';
                const centerHeight = heightText === '' ? null : Number(heightText);
                if (centerHeight !== null && (!Number.isFinite(centerHeight) || centerHeight < 0)) {
                    if (itemEditorStatus) itemEditorStatus.textContent = '作品中央の高さは0以上の数値で入力してください。';
                    return false;
                }
                if (applyRotation) {
                    const rawAngle = itemAngleInput?.value?.trim();
                    const enteredAngle = Number(rawAngle);
                    if (!rawAngle || !Number.isFinite(enteredAngle)) {
                        if (itemEditorStatus) itemEditorStatus.textContent = '回転角度を数値で入力してください。';
                        return false;
                    }
                    const previousAngle = obj.angle || 0;
                    const nextAngle = ((enteredAngle % 360) + 360) % 360;
                    obj.set('angle', nextAngle);
                    obj.setCoords();
                    if (checkCollisionWithWall(obj)) {
                        obj.set('angle', previousAngle);
                        obj.setCoords();
                        if (itemAngleInput) itemAngleInput.value = Math.round(previousAngle);
                        if (itemEditorStatus) itemEditorStatus.textContent = 'その角度では壁に接触します。';
                        canvas.requestRenderAll();
                        return false;
                    }
                    if (obj.crowdCircle) updateCrowdSemicircle(obj);
                    if (itemAngleInput) itemAngleInput.value = Math.round(nextAngle);
                }

                const dimensions = {
                    width: Number(itemWidthInput?.value),
                    height: Number(itemHeightInput?.value),
                    depth: Number(itemDepthInput?.value)
                };
                if (Object.values(dimensions).some(value => !Number.isFinite(value) || value <= 0)) {
                    if (itemEditorStatus) itemEditorStatus.textContent = '寸法は0より大きい数値で入力してください。';
                    return false;
                }
                obj.cmWidth = dimensions.width;
                obj.cmHeight = dimensions.height;
                obj.cmDepth = dimensions.depth;
                obj.artworkCenterHeightCm = centerHeight;
                const scale = parseFloat(document.getElementById('scale')?.value) || 0.5;
                applyArtworkDimensions(obj, scale);
                obj.artworkName = newName;
                const label = obj.item(1);
                if (label) {
                    if (obj.isFixture) {
                        label.set('text', newName);
                        label.initDimensions();
                        obj.addWithUpdate();
                    } else window.refreshArtworkNumberLabel?.(obj);
                }
                if (currentViewMode === 'wall') {
                    if (!window.placeArtworkAtSavedHeight(obj)) window.updateArtworkHeightFromWall(obj);
                }
                window.shareArtworkCenterHeight(obj);
            } else if (obj.isNumberPin) {
                const number = Number(itemPinNumberInput?.value);
                if (!Number.isInteger(number) || number < 1 || number > 999) {
                    if (itemEditorStatus) itemEditorStatus.textContent = '番号は1〜999の整数で入力してください。';
                    return false;
                }
                obj.pinName = newName;
                obj.pinNumber = number;
                obj.pinLabel = `(${number}) ${newName}`;
                const text = obj.item(1);
                text.set('text', String(number));
                text.initDimensions();
                resizeNumberPin(obj);
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

            obj.description = newDescription;
            if (obj.isArtwork) window.updateArtworkCatalogEntry?.(obj);
            obj.setCoords();
            window.queueVenueWallFixtureChange?.(obj);
            window.refreshLighting?.(false);
            canvas.requestRenderAll();
            if (saveTimer) clearTimeout(saveTimer);
            pendingEditedObject = obj;
            saveTimer = setTimeout(() => {
                saveState();
                saveTimer = null;
                if (itemEditorStatus && selectedItemForEditing === obj) itemEditorStatus.textContent = '変更を自動保存しました。';
                pendingEditedObject = null;
            }, 500);
            if (itemEditorStatus) itemEditorStatus.textContent = '変更を反映中…';
            return true;
    };

    [itemNameInput, itemDescriptionInput, itemWidthInput, itemHeightInput, itemDepthInput, itemPinNumberInput, itemCenterHeightInput]
        .filter(Boolean)
        .forEach(input => input.addEventListener('input', () => applyItemEdit()));

    itemAngleInput?.addEventListener('input', () => {
        if (rotationInputTimer) clearTimeout(rotationInputTimer);
        rotationInputTimer = setTimeout(() => {
            rotationInputTimer = null;
            applyItemEdit(true);
        }, 250);
    });
    itemAngleInput?.addEventListener('change', () => {
        if (rotationInputTimer) clearTimeout(rotationInputTimer);
        rotationInputTimer = null;
        applyItemEdit(true);
    });

}
