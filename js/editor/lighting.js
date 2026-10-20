// Ceiling geometry belongs to the venue; spotlights and power belong to each layout.
let lightingVisible = true;
try { lightingVisible = localStorage.getItem('curator_canvas_lighting_visible') !== 'false'; } catch {}
let lightingRenderBusy = false;
let lightingPlacementMode = null;
let lightingRailStart = null;
let lightingRailPreview = null;
let selectedLightId = '';
let lightingEditTimer = null;
window.isLightingRenderBusy = () => lightingRenderBusy;
window.isLightingPlacementActive = () => Boolean(lightingPlacementMode);
const lightingById = id => canvas.getObjects().find(obj => obj.lightId === id);
const lightingReadOnly = () => window.CURATOR_ROLE === 'viewer';
const VENUE_LIGHTING_KEY = 'curator_canvas_venue_lighting_v1';
const isVenueEquipment = obj => obj.isLightRail || (obj.isLightObject && obj.lightKind === 'fixed');
let venueLightingData = loadVenueLightingData();

function equipmentFromPlan(raw) {
    try {
        const plan = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return (plan?.objects || []).filter(isVenueEquipment).map(obj => ({ ...obj, lightOn: true }));
    } catch { return []; }
}

function equipmentPlanForFloor(state, id) {
    return state?.floorPlanData
        ? state.floorPlanData[id]?.json
        : (id === 'lobby' ? state?.floorPlanJsonData : null);
}

function loadVenueLightingData() {
    try {
        const saved = JSON.parse(localStorage.getItem(VENUE_LIGHTING_KEY) || 'null');
        const draft = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        const data = saved || draft?.venueLightingData || {};
        Object.keys(FLOOR_PLANS).forEach(id => {
            if (Array.isArray(data[id]?.objects)) return;
            delete data[id];
            const legacy = equipmentFromPlan(equipmentPlanForFloor(draft, id));
            if (legacy.length) data[id] = { objects: legacy };
        });
        if (Object.keys(data).length) localStorage.setItem(VENUE_LIGHTING_KEY, JSON.stringify(data));
        return data;
    } catch (error) { console.warn('会場照明設定を読み込めませんでした。', error); return {}; }
}

function persistVenueLighting() {
    try { localStorage.setItem(VENUE_LIGHTING_KEY, JSON.stringify(venueLightingData)); }
    catch (error) { console.warn('会場照明設定を保存できませんでした。', error); }
}
window.getVenueLightingData = () => JSON.parse(JSON.stringify(venueLightingData));
window.applyVenueLightingHistory = state => {
    if (!isAdminMode || lightingReadOnly() || !state.venueLightingData) return;
    venueLightingData = JSON.parse(JSON.stringify(state.venueLightingData));
    persistVenueLighting();
};
window.restoreVenueLightingData = state => {
    Object.keys(FLOOR_PLANS).forEach(id => {
        // Existing venue settings always win over older exhibitions and Undo states.
        if (venueLightingData[id]) return;
        const backup = state.venueLightingData?.[id];
        if (Array.isArray(backup?.objects)) venueLightingData[id] = JSON.parse(JSON.stringify(backup));
        else {
            const legacy = equipmentFromPlan(equipmentPlanForFloor(state, id));
            if (legacy.length) venueLightingData[id] = { objects: legacy };
        }
    });
    persistVenueLighting();
};
window.persistLightingEquipmentChange = object => {
    if (currentViewMode !== 'floor' || !isAdminMode || lightingReadOnly() || !isVenueEquipment(object) || object.excludeFromExport) return;
    venueLightingData[selectedFloorId] = {
        objects: canvas.getObjects().filter(obj => isVenueEquipment(obj) && !obj.excludeFromExport)
            .map(obj => ({ ...obj.toObject(getCustomProperties()), lightOn: true, visible: true }))
    };
    persistVenueLighting();
};
window.prepareFloorLighting = (plan, floorId) => {
    const existing = plan.objects || [];
    if (!venueLightingData[floorId]) {
        const legacy = equipmentFromPlan(plan);
        if (legacy.length) { venueLightingData[floorId] = { objects: legacy }; persistVenueLighting(); }
    }
    const equipment = venueLightingData[floorId]?.objects || [];
    const railIds = new Set(equipment.filter(obj => obj.isLightRail).map(obj => obj.lightId));
    const power = new Map(existing.filter(obj => obj.isLightObject && obj.lightKind === 'fixed').map(obj => [obj.lightId, obj.lightOn !== false]));
    return {
        ...plan,
        objects: [
            ...existing.filter(obj => !isVenueEquipment(obj) && !(obj.lightKind === 'spot' && !railIds.has(obj.lightRailId))),
            ...equipment.map(obj => ({ ...obj, lightOn: power.get(obj.lightId) ?? true }))
        ]
    };
};

function railEndpoints(rail) {
    const points = rail.calcLinePoints();
    const matrix = rail.calcTransformMatrix();
    return {
        start: fabric.util.transformPoint(new fabric.Point(points.x1, points.y1), matrix),
        end: fabric.util.transformPoint(new fabric.Point(points.x2, points.y2), matrix)
    };
}

function projectOntoRail(rail, point) {
    const { start, end } = railEndpoints(rail);
    const dx = end.x - start.x, dy = end.y - start.y;
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1)));
    return { t, x: start.x + t * dx, y: start.y + t * dy };
}

function lightingDirection(light) {
    const center = light.getCenterPoint();
    const target = light.lightAimMode === 'artwork'
        ? canvas.getObjects().find(obj => obj.isArtwork && obj.lightingTargetId === light.lightAimTargetId)
        : null;
    if (target) {
        const destination = target.getCenterPoint();
        light.lightDirectionDeg = (Math.atan2(destination.y - center.y, destination.x - center.x) * 180 / Math.PI + 360) % 360;
        return { angle: light.lightDirectionDeg * Math.PI / 180, length: Math.hypot(destination.x - center.x, destination.y - center.y) };
    }
    if (light.lightAimMode === 'artwork') {
        light.lightAimMode = 'free';
        light.lightAimTargetId = null;
    }
    return { angle: (Number(light.lightDirectionDeg) || 0) * Math.PI / 180, length: 110 };
}

function refreshLighting(updateControls = true) {
    if (lightingRenderBusy) return;
    lightingRenderBusy = true;
    try {
        canvas.remove(...canvas.getObjects().filter(obj => obj.isLightBeam));
        const rails = canvas.getObjects().filter(obj => obj.isLightRail);
        rails.forEach(rail => {
            rail.set({ visible: lightingVisible, selectable: isAdminMode && !lightingReadOnly(),
                evented: lightingVisible, lockMovementX: !isAdminMode || lightingReadOnly(),
                lockMovementY: !isAdminMode || lightingReadOnly(), lockScalingX: true, lockScalingY: true });
            rail.setControlsVisibility({ tl: false, tr: false, bl: false, br: false, ml: false, mt: false, mr: false, mb: false, mtr: isAdminMode });
        });
        canvas.getObjects().filter(obj => obj.isLightObject).forEach(light => {
            const spot = light.lightKind === 'spot';
            const rail = spot ? rails.find(item => item.lightId === light.lightRailId) : null;
            if (rail) {
                const { start, end } = railEndpoints(rail);
                const t = Math.max(0, Math.min(1, Number(light.lightRailT) || 0));
                light.set({ left: start.x + (end.x - start.x) * t, top: start.y + (end.y - start.y) * t });
            }
            const editablePosition = !lightingReadOnly() && (spot || isAdminMode);
            light.set({ visible: lightingVisible, selectable: editablePosition, evented: lightingVisible,
                radius: spot ? 5 : 4,
                lockMovementX: !editablePosition, lockMovementY: !editablePosition,
                lockScalingX: true, lockScalingY: true, lockRotation: true,
                fill: light.lightOn === false ? '#737b80' : (spot ? '#a5b6be' : '#f2ce54'),
                opacity: light.lightOn === false ? 0.65 : 1 });
            light.setControlsVisibility({ tl: false, tr: false, bl: false, br: false, ml: false, mt: false, mr: false, mb: false, mtr: false });
            light.setCoords();
            if (!spot) return;
            if (light.lightAimMode === 'down') {
                if (!lightingVisible || light.lightOn === false) return;
                const center = light.getCenterPoint();
                const beam = new fabric.Circle({
                    left: center.x, top: center.y, originX: 'center', originY: 'center', radius: 18,
                    fill: 'rgba(183,156,93,0.12)', stroke: 'rgba(143,122,73,0.36)', strokeWidth: 0.7,
                    isLightBeam: true, excludeFromExport: true, selectable: false, evented: false
                });
                canvas.add(beam);
                beam.moveTo(0);
                return;
            }
            const direction = lightingDirection(light);
            if (!lightingVisible || light.lightOn === false || direction.length < 1) return;
            const p = light.getCenterPoint();
            const dx = Math.cos(direction.angle), dy = Math.sin(direction.angle);
            const end = { x: p.x + dx * direction.length, y: p.y + dy * direction.length };
            const width = Math.min(28, direction.length * 0.14);
            const properties = { isLightBeam: true, excludeFromExport: true, selectable: false, evented: false };
            const beam = new fabric.Polygon([
                { x: p.x, y: p.y }, { x: end.x - dy * width, y: end.y + dx * width },
                { x: end.x + dy * width, y: end.y - dx * width }
            ], { ...properties, fill: 'rgba(183,156,93,0.12)', stroke: 'rgba(143,122,73,0.36)', strokeWidth: 0.7 });
            const axis = new fabric.Line([p.x, p.y, end.x, end.y], {
                ...properties, stroke: 'rgba(133,113,67,0.60)', strokeWidth: 1, strokeDashArray: [3, 3]
            });
            canvas.add(beam, axis);
            beam.moveTo(0);
            axis.moveTo(1);
        });
        if (updateControls) refreshLightingControls();
        canvas.requestRenderAll();
    } finally { lightingRenderBusy = false; }
}
window.refreshLighting = refreshLighting;

function fillLightingSelect(id, items, value, empty) {
    const select = document.getElementById(id);
    if (!select) return;
    select.replaceChildren();
    if (!items.length) {
        const option = document.createElement('option');
        option.value = ''; option.textContent = empty; select.appendChild(option);
    }
    items.forEach(item => {
        const option = document.createElement('option');
        option.value = item.id; option.textContent = item.name; select.appendChild(option);
    });
    select.value = items.some(item => item.id === value) ? value : items[0]?.id || '';
}

function refreshLightingControls() {
    const objects = currentViewMode === 'floor' ? canvas.getObjects() : [];
    const railSelect = document.getElementById('lightRailSelect');
    fillLightingSelect('lightRailSelect', objects.filter(obj => obj.isLightRail).map(obj => ({ id: obj.lightId, name: obj.lightName })), railSelect?.value, '登録済みのレールはありません');
    const lights = objects.filter(obj => obj.isLightObject);
    if (!lights.some(obj => obj.lightId === selectedLightId)) selectedLightId = lights[0]?.lightId || '';
    fillLightingSelect('lightObjectSelect', lights.map(obj => ({ id: obj.lightId, name: obj.lightName })), selectedLightId, 'ライトはありません');
    const artworks = objects.filter(obj => obj.isArtwork);
    const light = lights.find(obj => obj.lightId === selectedLightId);
    fillLightingSelect('lightTargetSelect', artworks.map((obj, index) => ({
        id: obj.lightingTargetId || `index:${index}`, name: obj.artworkName || `作品 ${index + 1}`
    })), light?.lightAimTargetId, '作品はありません');
    const fields = document.getElementById('lightSettingsFields');
    if (fields) fields.hidden = !light;
    const directionFields = document.getElementById('spotlightDirectionFields');
    if (directionFields) directionFields.hidden = light?.lightKind !== 'spot';
    const snap = light?.lightAimMode === 'artwork';
    const angleField = document.getElementById('lightAngleField');
    const targetField = document.getElementById('lightTargetField');
    if (angleField) angleField.hidden = snap || light?.lightAimMode === 'down';
    if (targetField) targetField.hidden = !snap;
    const power = document.getElementById('lightPower');
    const mode = document.getElementById('lightAimMode');
    const angle = document.getElementById('lightDirection');
    if (power) power.checked = light?.lightOn !== false;
    if (mode) mode.value = light?.lightAimMode === 'down' ? 'down' : (snap ? 'artwork' : 'free');
    if (angle) angle.value = Math.round(Number(light?.lightDirectionDeg) || 0);
    ['lightPower', 'lightAimMode', 'lightDirection', 'lightTargetSelect'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.disabled = lightingReadOnly() || !light;
    });
    const add = document.getElementById('btnPlaceSpotlight');
    if (add) add.disabled = lightingReadOnly() || !objects.some(obj => obj.isLightRail);
    const pick = document.getElementById('btnPickLightTarget');
    if (pick) pick.disabled = lightingReadOnly() || light?.lightKind !== 'spot' || !artworks.length;
    const visibility = document.getElementById('lightingVisibility');
    if (visibility) visibility.checked = lightingVisible;
    const toggle = document.querySelector('[data-action="light-visibility"]');
    toggle?.setAttribute('aria-pressed', String(lightingVisible));
    toggle?.classList.toggle('active', lightingVisible);
}
window.refreshLightingControls = refreshLightingControls;

function toggleLightingVisibility(value = !lightingVisible) {
    lightingVisible = Boolean(value);
    if (!lightingVisible) {
        cancelLightingPlacement();
        if (canvas.getActiveObject()?.isLightObject || canvas.getActiveObject()?.isLightRail) canvas.discardActiveObject();
    }
    try { localStorage.setItem('curator_canvas_lighting_visible', String(lightingVisible)); } catch {}
    refreshLighting();
}
window.toggleLightingVisibility = toggleLightingVisibility;

function flushPendingLightingEdit() {
    if (!lightingEditTimer) return;
    clearTimeout(lightingEditTimer); lightingEditTimer = null; saveState();
}
window.flushPendingLightingEdit = flushPendingLightingEdit;

function cancelLightingPlacement() {
    flushPendingLightingEdit();
    if (!lightingPlacementMode) return;
    if (lightingRailPreview) canvas.remove(lightingRailPreview);
    lightingRailPreview = null; lightingRailStart = null; lightingPlacementMode = null;
    document.getElementById('btnPlaceFixedLight')?.setAttribute('aria-pressed', 'false');
    const fixedButton = document.getElementById('btnPlaceFixedLight');
    if (fixedButton) fixedButton.textContent = '固定ライト';
    const railButton = document.getElementById('btnDrawLightRail');
    if (railButton) {
        railButton.textContent = 'ライトレール';
        railButton.setAttribute('aria-pressed', 'false');
    }
    const pickButton = document.getElementById('btnPickLightTarget');
    if (pickButton) pickButton.textContent = '作品をクリックしてスナップ';
    canvas.skipTargetFind = false; canvas.selection = !lightingReadOnly(); canvas.defaultCursor = 'default';
    canvas.requestRenderAll();
}
window.cancelLightingPlacement = cancelLightingPlacement;

async function startLightingPlacement(mode) {
    if (lightingReadOnly() || isTransitioning || isUndoRedoOperation) return;
    if (['fixed', 'rail'].includes(mode) && !isAdminMode) return;
    if (lightingPlacementMode === mode) return cancelLightingPlacement();
    cancelLightingPlacement();
    window.cancelDimensionDrawing?.();
    if (isFreeDrawingMode) toggleFreeDrawingMode(false);
    if (isMeasuringMode) toggleMeasuringMode(false);
    if (currentViewMode !== 'floor') await switchViewMode('floor');
    if (mode === 'spot' && !lightingById(document.getElementById('lightRailSelect')?.value)?.isLightRail) {
        alert('作業モードでライトレールを登録してください。'); return;
    }
    if (mode === 'aim' && lightingById(selectedLightId)?.lightKind !== 'spot') return;
    if (!lightingVisible) toggleLightingVisibility(true);
    canvas.discardActiveObject(); lightingPlacementMode = mode;
    canvas.skipTargetFind = true; canvas.selection = false; canvas.defaultCursor = 'crosshair';
    if (mode === 'fixed') {
        document.getElementById('btnPlaceFixedLight').textContent = '固定ライトを終了';
        document.getElementById('btnPlaceFixedLight').setAttribute('aria-pressed', 'true');
    }
    if (mode === 'rail') {
        document.getElementById('btnDrawLightRail').textContent = 'レール登録を終了';
        document.getElementById('btnDrawLightRail').setAttribute('aria-pressed', 'true');
    }
    if (mode === 'aim') document.getElementById('btnPickLightTarget').textContent = '作品選択をキャンセル';
}

function createLight(point, kind, rail = null) {
    const position = rail ? projectOntoRail(rail, point) : point;
    const count = canvas.getObjects().filter(obj => obj.isLightObject && obj.lightKind === kind).length + 1;
    return new fabric.Circle({
        left: position.x, top: position.y, originX: 'center', originY: 'center',
        radius: kind === 'fixed' ? 4 : 5, stroke: '#53616a', strokeWidth: 1,
        fill: kind === 'fixed' ? '#f2ce54' : '#a5b6be',
        isLightObject: true, isFixture: kind === 'fixed', lightId: crypto.randomUUID(),
        lightKind: kind, lightName: `${kind === 'fixed' ? '固定ライト' : 'スポットライト'} ${count}`,
        lightOn: true, lightRailId: rail?.lightId || null, lightRailT: position.t ?? null,
        lightAimMode: 'free', lightDirectionDeg: 90
    });
}

function createLightRail(start, end, preview = false) {
    return new fabric.Line([start.x, start.y, end.x, end.y], {
        left: (start.x + end.x) / 2, top: (start.y + end.y) / 2, originX: 'center', originY: 'center',
        stroke: '#82969f', strokeWidth: 2, strokeDashArray: [5, 2],
        isLightRail: true, isFixture: true, lightId: crypto.randomUUID(),
        lightName: `レール ${canvas.getObjects().filter(obj => obj.isLightRail && !obj.excludeFromExport).length + 1}`,
        excludeFromExport: preview, selectable: !preview, evented: !preview
    });
}

function finishLightingPlacement(object) {
    if (lightingRailPreview) canvas.remove(lightingRailPreview);
    lightingRailPreview = null;
    lightingRailStart = null;
    canvas.add(object);
    window.persistLightingEquipmentChange(object);
    if (object.isLightObject) selectedLightId = object.lightId;
    if (object.lightKind === 'fixed' || object.isLightRail) {
        // Keep equipment placement active and save each completed registration.
        refreshLighting();
        const mode = lightingPlacementMode;
        lightingPlacementMode = null;
        try { saveState(); }
        finally { lightingPlacementMode = mode; }
        return;
    }
    cancelLightingPlacement();
    refreshLighting();
    if (object.selectable) canvas.setActiveObject(object);
    saveState();
}

function applyLightSettings(debounce = false) {
    const light = lightingById(selectedLightId);
    if (!light?.isLightObject || lightingReadOnly()) return;
    light.lightOn = document.getElementById('lightPower').checked;
    if (light.lightKind === 'spot') {
        const mode = document.getElementById('lightAimMode').value;
        const angleText = document.getElementById('lightDirection').value;
        const angle = Number(angleText);
        if (mode === 'free' && (!angleText.trim() || !Number.isFinite(angle))) return;
        light.lightAimMode = mode;
        if (mode === 'free') {
            light.lightDirectionDeg = ((angle % 360) + 360) % 360;
            light.lightAimTargetId = null;
        } else if (mode === 'down') {
            light.lightAimTargetId = null;
        } else {
            const targetValue = document.getElementById('lightTargetSelect').value;
            const artworks = canvas.getObjects().filter(obj => obj.isArtwork);
            const target = targetValue.startsWith('index:')
                ? artworks[Number(targetValue.slice(6))] : artworks.find(obj => obj.lightingTargetId === targetValue);
            if (!target) { light.lightAimMode = 'free'; refreshLighting(); return; }
            if (!target.lightingTargetId) target.lightingTargetId = crypto.randomUUID();
            light.lightAimTargetId = target.lightingTargetId;
        }
    }
    refreshLighting(!debounce);
    if (lightingEditTimer) clearTimeout(lightingEditTimer);
    lightingEditTimer = null;
    if (debounce) lightingEditTimer = setTimeout(() => { lightingEditTimer = null; saveState(); }, 400);
    else saveState();
}

window.canDeleteLightingObject = obj => !lightingReadOnly() && Boolean(
    (obj.isLightObject && (obj.lightKind === 'spot' || isAdminMode)) || (obj.isLightRail && isAdminMode)
);
window.handleLightingObjectRemoved = obj => {
    if (lightingRenderBusy || isTransitioning || isUndoRedoOperation) return;
    lightingRenderBusy = true;
    try {
        if (obj?.isLightRail) canvas.remove(...canvas.getObjects().filter(light => light.isLightObject && light.lightRailId === obj.lightId));
    } finally { lightingRenderBusy = false; }
    if (obj && isVenueEquipment(obj)) window.persistLightingEquipmentChange(obj);
    refreshLighting();
};
window.rotateLightingObject = obj => {
    if (lightingReadOnly()) return;
    if (obj.isLightObject && obj.lightKind === 'spot') {
        if (obj.lightAimMode === 'down') return;
        obj.lightAimMode = 'free'; obj.lightAimTargetId = null;
        obj.lightDirectionDeg = ((Number(obj.lightDirectionDeg) || 0) + 90) % 360;
    } else if (obj.isLightRail && isAdminMode) obj.rotate((obj.angle || 0) + 90);
    else return;
    window.persistLightingEquipmentChange(obj);
    refreshLighting(); saveState();
};

canvas.on('mouse:down', event => {
    if (!lightingPlacementMode || (event.e.button !== undefined && event.e.button !== 0)) return;
    const point = canvas.getPointer(event.e);
    if (lightingPlacementMode === 'aim') {
        const target = [...canvas.getObjects()].reverse().find(obj => obj.isArtwork && obj.visible && obj.containsPoint(new fabric.Point(point.x, point.y)));
        const light = lightingById(selectedLightId);
        if (!target || !light?.isLightObject) return;
        if (!target.lightingTargetId) target.lightingTargetId = crypto.randomUUID();
        light.lightAimMode = 'artwork'; light.lightAimTargetId = target.lightingTargetId;
        cancelLightingPlacement(); refreshLighting(); saveState();
        return;
    }
    if (lightingPlacementMode === 'rail') lightingRailStart = point;
    else if (lightingPlacementMode === 'fixed') finishLightingPlacement(createLight(point, 'fixed'));
    else {
        const rail = lightingById(document.getElementById('lightRailSelect').value);
        if (rail?.isLightRail) finishLightingPlacement(createLight(point, 'spot', rail));
    }
});
function lightRailEndPoint(event) {
    const point = canvas.getPointer(event.e);
    if (!event.e.shiftKey || !lightingRailStart) return point;
    const dx = point.x - lightingRailStart.x;
    const dy = point.y - lightingRailStart.y;
    return Math.abs(dx) >= Math.abs(dy)
        ? { x: point.x, y: lightingRailStart.y }
        : { x: lightingRailStart.x, y: point.y };
}

canvas.on('mouse:move', event => {
    if (lightingPlacementMode !== 'rail' || !lightingRailStart) return;
    if (lightingRailPreview) canvas.remove(lightingRailPreview);
    lightingRailPreview = createLightRail(lightingRailStart, lightRailEndPoint(event), true);
    canvas.add(lightingRailPreview); canvas.requestRenderAll();
});
canvas.on('mouse:up', event => {
    if (lightingPlacementMode !== 'rail' || !lightingRailStart) return;
    const end = lightRailEndPoint(event);
    if (Math.hypot(end.x - lightingRailStart.x, end.y - lightingRailStart.y) < 8) {
        if (lightingRailPreview) canvas.remove(lightingRailPreview);
        lightingRailPreview = null; lightingRailStart = null; return;
    }
    finishLightingPlacement(createLightRail(lightingRailStart, end));
});
canvas.on('object:moving', event => {
    const light = event.target;
    if (light?.isLightObject && light.lightKind === 'spot') {
        const rail = lightingById(light.lightRailId);
        if (rail) {
            const position = projectOntoRail(rail, light.getCenterPoint());
            light.lightRailT = position.t; light.set({ left: position.x, top: position.y }); light.setCoords();
        }
    }
    if (light?.isLightObject || light?.isLightRail || light?.isArtwork) refreshLighting(false);
});
canvas.on('object:modified', () => refreshLighting());
canvas.on('object:rotating', event => {
    if (event.target?.isLightRail || event.target?.isArtwork) refreshLighting(false);
});
canvas.on('object:added', event => {
    if (!lightingRenderBusy && !isTransitioning && !isUndoRedoOperation && !lightingPlacementMode &&
        (event.target?.isArtwork || event.target?.isLightObject || event.target?.isLightRail)) refreshLighting();
});
const selectLight = event => {
    const object = event.selected?.[0];
    if (!object?.isLightObject && !object?.isLightRail) return;
    flushPendingLightingEdit();
    if (object.isLightObject) selectedLightId = object.lightId;
    if (object.isLightRail) document.getElementById('lightRailSelect').value = object.lightId;
    if (lightingPlacementMode) return;
    if (isAdminMode && isVenueEquipment(object)) { refreshLightingControls(); return; }
    window.activateToolPanel?.('lighting'); refreshLightingControls();
};
canvas.on('selection:created', selectLight);
canvas.on('selection:updated', selectLight);

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnPlaceFixedLight')?.addEventListener('click', () => startLightingPlacement('fixed'));
    document.getElementById('btnDrawLightRail')?.addEventListener('click', () => startLightingPlacement('rail'));
    document.getElementById('btnPlaceSpotlight')?.addEventListener('click', () => startLightingPlacement('spot'));
    document.getElementById('btnPickLightTarget')?.addEventListener('click', () => startLightingPlacement('aim'));
    document.getElementById('lightingVisibility')?.addEventListener('change', event => toggleLightingVisibility(event.target.checked));
    document.getElementById('lightObjectSelect')?.addEventListener('change', event => {
        flushPendingLightingEdit(); selectedLightId = event.target.value; refreshLightingControls();
        const light = lightingById(selectedLightId);
        if (light?.selectable) canvas.setActiveObject(light);
    });
    ['lightPower', 'lightAimMode', 'lightTargetSelect'].forEach(id => document.getElementById(id)?.addEventListener('change', () => applyLightSettings()));
    document.getElementById('lightDirection')?.addEventListener('input', () => applyLightSettings(true));
    document.getElementById('lightDirection')?.addEventListener('change', () => { flushPendingLightingEdit(); refreshLightingControls(); });
    refreshLighting();
});
window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && lightingPlacementMode) { cancelLightingPlacement(); event.preventDefault(); }
});
