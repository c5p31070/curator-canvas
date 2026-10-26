// Select persistent venue objects without hunting through the drawing.
(() => {
    let deleting = false;
    let selecting = false;
    const selectedPreset = () => {
        try { return JSON.parse(document.getElementById('venuePresetSelect')?.value || 'null'); }
        catch { return null; }
    };
    window.refreshVenuePresetList = () => {
        const select = document.getElementById('venuePresetSelect');
        if (!select) return;
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
        Object.entries(window.getVenueWallData?.() || {}).forEach(([id, wall]) => {
            add(fixed, { type: 'wall', id }, `${FLOOR_PLANS[wall.floorId]?.title || 'ロビー階'} / ${wall.title}`);
        });
        if (fixed.children.length) select.appendChild(fixed);
        const lighting = window.getVenueLightingData?.() || {};
        Object.entries(FLOOR_PLANS).forEach(([floorId, floor]) => {
            const equipment = group(`${floor.title}・照明`);
            (lighting[floorId]?.objects || []).forEach(object => {
                if (!object.isLightRail && !(object.isLightObject && object.lightKind === 'fixed')) return;
                add(equipment, { type: 'lighting', floorId, id: object.lightId }, `${object.isLightRail ? 'レール' : '固定ライト'} / ${object.lightName || '名称未設定'}`);
            });
            if (equipment.children.length) select.appendChild(equipment);
        });
        if ([...select.options].some(option => option.value === previous)) select.value = previous;
        const disabled = !isAdminMode || window.CURATOR_ROLE === 'viewer' || deleting || selecting;
        select.disabled = disabled;
        const button = document.getElementById('btnDeleteVenuePreset');
        if (button) button.disabled = disabled || !select.value;
    };
    document.addEventListener('DOMContentLoaded', () => {
        const select = document.getElementById('venuePresetSelect');
        const remove = document.getElementById('btnDeleteVenuePreset');
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
