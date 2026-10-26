// Copy venue rail geometry between floors without sharing equipment IDs.
(() => {
    let busy = false;
    const element = id => document.getElementById(id);
    const equipment = floorId => venueLightingData[floorId]?.objects
        ?? equipmentFromPlan(floorPlanData[floorId]?.json);
    const rails = floorId => equipment(floorId).filter(object => object.isLightRail && !object.excludeFromExport);
    const allowed = () => isAdminMode && window.CURATOR_ROLE !== 'viewer' && !window.CURATOR_GUEST?.active;

    window.refreshLightRailCopyControls = () => {
        const source = element('lightRailCopySource');
        const target = element('lightRailCopyTarget');
        if (!source || !target) return;
        const disabled = busy || !allowed();
        [source, target, element('lightRailCopyMode')].forEach(input => { input.disabled = disabled; });
        const count = rails(source.value).length;
        element('btnCopyLightRails').disabled = disabled || !count || source.value === target.value;
        element('lightRailCopySummary').textContent = source.value === target.value
            ? 'コピー先に別の階を選択してください。'
            : `コピー元 ${count}本 / コピー先 ${rails(target.value).length}本`;
    };

    async function copyRails() {
        if (busy || !allowed() || isTransitioning || isUndoRedoOperation || !window.isDiagramReady?.()) return;
        const sourceId = element('lightRailCopySource').value;
        const targetId = element('lightRailCopyTarget').value;
        if (!FLOOR_PLANS[sourceId] || !FLOOR_PLANS[targetId] || sourceId === targetId) return;
        window.cancelLightingPlacement?.();
        window.cancelDimensionDrawing?.();
        window.flushPendingItemEditHistory?.();
        captureCurrentCanvasState();
        const sourceRails = rails(sourceId);
        if (!sourceRails.length) return;
        const replace = element('lightRailCopyMode').value === 'replace';
        let targetPlan;
        try { targetPlan = JSON.parse(floorPlanData[targetId]?.json || '{"objects":[]}'); }
        catch { alert('コピー先の図面を読み込めませんでした。'); return; }
        if (!targetPlan || !Array.isArray(targetPlan.objects)) {
            alert('コピー先の図面を読み込めませんでした。'); return;
        }
        const targetEquipment = equipment(targetId);
        const oldIds = new Set(rails(targetId).map(rail => rail.lightId));
        const spots = targetPlan.objects.filter(object => object.lightKind === 'spot' && oldIds.has(object.lightRailId)).length;
        const message = `${FLOOR_PLANS[sourceId].title}のレール${sourceRails.length}本を${FLOOR_PLANS[targetId].title}に${replace ? '置き換えコピー' : '追加'}しますか？`
            + (replace ? `\nコピー先のレール${oldIds.size}本を削除します。` : '')
            + (replace && spots ? `\nそのレール上のスポットライト${spots}個も削除します。` : '');
        if (!confirm(message)) return;
        busy = true;
        window.refreshLightRailCopyControls();
        try {
            const kept = targetEquipment.filter(object => !replace || !object.isLightRail);
            let number = kept.filter(object => object.isLightRail).reduce((max, rail) => {
                const match = /^レール\s*(\d+)$/.exec(rail.lightName || '');
                return Math.max(max, Number(match?.[1]) || 0);
            }, kept.filter(object => object.isLightRail).length);
            const copies = sourceRails.map(rail => ({
                ...JSON.parse(JSON.stringify(rail)), lightId: crypto.randomUUID(),
                lightName: `レール ${++number}`, visible: true, excludeFromExport: false
            }));
            const next = { ...venueLightingData, [targetId]: { objects: [...kept, ...copies] } };
            // Persist first so a storage failure leaves the existing venue intact.
            editorStorage.setItem(VENUE_LIGHTING_KEY, JSON.stringify(next));
            venueLightingData = next;
            targetPlan = window.prepareFloorLighting(targetPlan, targetId);
            delete targetPlan.backgroundImage;
            floorPlanData[targetId] = { json: JSON.stringify(targetPlan) };
            if (selectedFloorId === targetId) {
                floorPlanJsonData = floorPlanData[targetId].json;
                if (currentViewMode === 'floor') await switchViewMode('floor', true, null, true);
            }
            window.refreshVenuePresetList?.();
            saveState();
            const status = element('saveStatus');
            if (status) status.textContent = `${FLOOR_PLANS[targetId].title}にレール${copies.length}本をコピーしました。`;
        } catch (error) {
            console.error('レール配置のコピーに失敗しました。', error);
            alert('レール配置をコピーできませんでした。保存状態を確認してください。');
        } finally {
            busy = false;
            window.refreshLightRailCopyControls();
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        ['lightRailCopySource', 'lightRailCopyTarget'].forEach(id => {
            const select = element(id);
            if (!select) return;
            Object.entries(FLOOR_PLANS).forEach(([floorId, floor]) => {
                const option = document.createElement('option');
                option.value = floorId;
                option.textContent = floor.title;
                select.appendChild(option);
            });
            select.addEventListener('change', window.refreshLightRailCopyControls);
        });
        element('lightRailCopySource').value = selectedFloorId;
        element('lightRailCopyTarget').value = Object.keys(FLOOR_PLANS).find(id => id !== selectedFloorId);
        element('btnCopyLightRails')?.addEventListener('click', copyRails);
        window.refreshLightRailCopyControls();
    });
})();
