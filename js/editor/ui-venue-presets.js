// Select persistent venue objects without hunting through the drawing.
(() => {
    let deleting = false;
    let selecting = false;
    let lastCanvasFloor = null;
    const presetFloor = () => document.getElementById('venuePresetFloorSelect')?.value || selectedFloorId;
    const floorPresets = floorId => {
        const walls = Object.entries(window.getVenueWallData?.() || {}).filter(([, wall]) => (wall.floorId || 'lobby') === floorId);
        const equipment = (window.getVenueLightingData?.()[floorId]?.objects || [])
            .filter(object => object.isLightRail || (object.isLightObject && object.lightKind === 'fixed'));
        return { walls, equipment };
    };
    const selectedPreset = () => {
        try { return JSON.parse(document.getElementById('venuePresetSelect')?.value || 'null'); }
        catch { return null; }
    };
    window.refreshVenuePresetList = () => {
        const select = document.getElementById('venuePresetSelect');
        if (!select) return;
        const floorSelect = document.getElementById('venuePresetFloorSelect');
        if (floorSelect && lastCanvasFloor !== selectedFloorId && !selecting && !deleting) floorSelect.value = selectedFloorId;
        lastCanvasFloor = selectedFloorId;
        const floorId = presetFloor();
        const presets = floorPresets(floorId);
        const previous = select.value;
        select.replaceChildren();
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = '削除する事前設定を選択';
        select.appendChild(empty);
        const group = name => {
            const element = document.createElement('optgroup');
            element.label = name;
            return element;
        };
        const add = (parent, value, name) => {
            const option = document.createElement('option');
            option.value = JSON.stringify(value);
            option.textContent = name;
            parent.appendChild(option);
        };
        const fixed = group('固定壁（チーム共通）');
        presets.walls.forEach(([id, wall]) => {
            add(fixed, { type: 'wall', id }, wall.title);
        });
        if (fixed.children.length) select.appendChild(fixed);
        const equipment = group('照明');
            presets.equipment.forEach(object => {
                add(equipment, { type: 'lighting', floorId, id: object.lightId }, `${object.isLightRail ? 'レール' : '固定ライト'} / ${object.lightName || '名称未設定'}`);
            });
            if (equipment.children.length) select.appendChild(equipment);
        if ([...select.options].some(option => option.value === previous)) select.value = previous;
        const disabled = !isAdminMode || window.CURATOR_ROLE === 'viewer' || deleting || selecting;
        select.disabled = disabled;
        const button = document.getElementById('btnDeleteVenuePreset');
        if (button) button.disabled = disabled || !select.value;
        if (floorSelect) floorSelect.disabled = disabled;
        const rails = presets.equipment.filter(object => object.isLightRail).length;
        const summary = document.getElementById('venuePresetFloorSummary');
        if (summary) summary.textContent = `固定壁 ${presets.walls.length} / レール ${rails} / 固定ライト ${presets.equipment.length - rails}`;
        const bulk = document.getElementById('btnDeleteVenuePresetFloor');
        if (bulk) bulk.disabled = disabled || !presets.walls.length && !presets.equipment.length;
    };
    document.addEventListener('DOMContentLoaded', () => {
        const select = document.getElementById('venuePresetSelect');
        const remove = document.getElementById('btnDeleteVenuePreset');
        const floorSelect = document.getElementById('venuePresetFloorSelect');
        Object.entries(FLOOR_PLANS).forEach(([id, floor]) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = floor.title;
            floorSelect?.appendChild(option);
        });
        if (floorSelect) floorSelect.value = selectedFloorId;
        floorSelect?.addEventListener('change', async () => {
            if (!isAdminMode || window.CURATOR_ROLE === 'viewer' || isTransitioning) return;
            const floorId = floorSelect.value;
            selecting = true;
            window.refreshVenuePresetList();
            try {
                window.cancelLightingPlacement?.();
                if (selectedFloorId !== floorId) await handleFloorSelectChange(floorId, false, currentViewMode);
            } finally { selecting = false; window.refreshVenuePresetList(); }
        });
        document.getElementById('btnDeleteVenuePresetFloor')?.addEventListener('click', async () => {
            const floorId = presetFloor();
            if (deleting || selecting || !isAdminMode || window.CURATOR_ROLE === 'viewer' || isTransitioning || isUndoRedoOperation || !FLOOR_PLANS[floorId]) return;
            deleting = true;
            window.refreshVenuePresetList();
            try {
                window.cancelLightingPlacement?.();
                window.flushPendingItemEditHistory?.();
                if (currentViewMode !== 'floor' || selectedFloorId !== floorId) await handleFloorSelectChange(floorId);
                if (currentViewMode !== 'floor' || selectedFloorId !== floorId || !window.isDiagramReady?.()) return;
                const { walls, equipment } = floorPresets(floorId);
                if (!walls.length && !equipment.length) return;
                const rails = equipment.filter(object => object.isLightRail);
                const railIds = new Set(rails.map(object => object.lightId));
                const spots = canvas.getObjects().filter(object => object.isLightObject && object.lightKind === 'spot' && railIds.has(object.lightRailId));
                const message = `${FLOOR_PLANS[floorId].title}の事前設定をまとめて削除しますか？\n固定壁 ${walls.length}件（壁面の固定設備を含む）\nライトレール ${rails.length}件\n固定ライト ${equipment.length - rails.length}件\nレール上のスポットライト ${spots.length}個\n固定壁の削除はチーム内の全配置図に反映されます。`;
                if (!confirm(message)) return;
                captureCurrentCanvasState();
                if (walls.length && !await window.deleteVenueWallsForFloor(floorId, walls.map(([id]) => id))) {
                    alert('共通壁を削除できませんでした。共有設定の保存状態を確認してください。');
                    return;
                }
                if (currentViewMode !== 'floor' || selectedFloorId !== floorId) await handleFloorSelectChange(floorId);
                if (!window.deleteVenueLightingForFloor(floorId, equipment.map(object => object.lightId))) {
                    alert('照明の削除を完了できませんでした。対象の階を開いて登録内容を確認してください。');
                    return;
                }
                window.applyVenueWallsToPlans?.();
                updateWallDropdownOptions();
                saveState();
                const status = document.getElementById('saveStatus');
                if (status) status.textContent = `${FLOOR_PLANS[floorId].title}の事前設定を削除しました。`;
            } finally { deleting = false; window.refreshVenuePresetList(); }
        });
        select?.addEventListener('change', async () => {
            const preset = selectedPreset();
            if (!preset || !isAdminMode || window.CURATOR_ROLE === 'viewer' || isTransitioning) return;
            selecting = true;
            window.refreshVenuePresetList();
            try {
                window.cancelLightingPlacement?.();
                if (preset.type === 'wall') await handleWallSelectChange(preset.id);
                else {
                    if (currentViewMode !== 'floor' || selectedFloorId !== preset.floorId) await handleFloorSelectChange(preset.floorId);
                    const object = canvas.getObjects().find(item => item.lightId === preset.id);
                    if (object) {
                        if (!lightingVisible) window.toggleLightingVisibility(true);
                        canvas.setActiveObject(object);
                        canvas.requestRenderAll();
                    }
                }
            } finally { selecting = false; window.refreshVenuePresetList(); }
        });
        remove?.addEventListener('click', async () => {
            const preset = selectedPreset();
            if (!preset || deleting || !isAdminMode || window.CURATOR_ROLE === 'viewer') return;
            deleting = true;
            window.refreshVenuePresetList();
            try {
                if (preset.type === 'wall') await window.deleteFixedVenueWall(preset.id);
                else await window.deleteVenueLightingPreset(preset.floorId, preset.id);
            } finally { deleting = false; window.refreshVenuePresetList(); }
        });
        document.getElementById('btnToggleAdminMode')?.addEventListener('click', () => window.refreshVenuePresetList());
        window.refreshVenuePresetList();
    });
})();
