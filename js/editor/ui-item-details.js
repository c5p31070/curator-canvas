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
    const itemTooltip = document.getElementById('canvasTooltip');
    const tooltipTitle = document.getElementById('canvasTooltipTitle');
    const tooltipMeta = document.getElementById('canvasTooltipMeta');
    const tooltipDescription = document.getElementById('canvasTooltipDescription');
    const canvasArea = document.querySelector('.canvas-container-wrapper');
    let hoveredItem = null;
    let saveTimer = null;
    let pendingEditedObject = null;

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
        const isArtwork = Boolean(selectedItemForEditing?.isArtwork);
        if (itemArtworkDimensions) itemArtworkDimensions.hidden = !isArtwork;
        if (isArtwork) {
            if (itemWidthInput) itemWidthInput.value = selectedItemForEditing.cmWidth ?? 150;
            if (itemHeightInput) itemHeightInput.value = selectedItemForEditing.cmHeight ?? 100;
            if (itemDepthInput) itemDepthInput.value = selectedItemForEditing.cmDepth ?? 5;
        }
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

    const applyItemEdit = () => {
            const obj = selectedItemForEditing;
            if (!isEditableCanvasItem(obj)) return false;
            const newName = (itemNameInput?.value || '').trim();
            if (!newName) {
                if (itemEditorStatus) itemEditorStatus.textContent = '名前を入力してください。';
                return false;
            }
            const newDescription = itemDescriptionInput?.value.trim() || '';

            if (obj.isArtwork) {
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
                const scale = parseFloat(document.getElementById('scale')?.value) || 0.5;
                applyArtworkDimensions(obj, scale);
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

            obj.description = newDescription;
            obj.setCoords();
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

    [itemNameInput, itemDescriptionInput, itemWidthInput, itemHeightInput, itemDepthInput]
        .filter(Boolean)
        .forEach(input => input.addEventListener('input', () => applyItemEdit(false)));

}
