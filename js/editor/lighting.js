// Ceiling geometry belongs to the venue; spotlights and power belong to each layout.
let lightingVisible = true;
try { lightingVisible = editorStorage.getItem('curator_canvas_lighting_visible') !== 'false'; } catch {}
let lightingRenderBusy = false;
let lightingPlacementMode = null;
let lightingRailStart = null;
let lightingRailPreview = null;
let spotlightPlacementPreview = null;
let selectedLightId = '';
let lightingEditTimer = null;
window.isLightingRenderBusy = () => lightingRenderBusy;
window.isLightingPlacementActive = () => Boolean(lightingPlacementMode);
const lightingById = id => canvas.getObjects().find(obj => obj.lightId === id);
const lightingReadOnly = () => window.CURATOR_ROLE === 'viewer';
const VENUE_LIGHTING_KEY = 'curator_canvas_venue_lighting_v1';
const isVenueEquipment = obj => obj.isLightRail || (obj.isLightObject && obj.lightKind === 'fixed');
const fixedLightSize = 12;
const spotlightMountHeightCm = 450;

function normalizeFixedLightShape(object) {
    if (!object.isLightObject || object.lightKind !== 'fixed') return object;
    // Convert saved circle markers before Fabric loads them; retain IDs,
    // positions and the exhibition's on/off state.
    const square = { ...object, type: 'rect', width: fixedLightSize, height: fixedLightSize, rx: 0, ry: 0 };
    delete square.radius;
    delete square.startAngle;
    delete square.endAngle;
    return square;
}
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
        const saved = JSON.parse(editorStorage.getItem(VENUE_LIGHTING_KEY) || 'null');
        const draft = JSON.parse(editorStorage.getItem(STORAGE_KEY) || 'null');
        const data = saved || draft?.venueLightingData || {};
        Object.keys(FLOOR_PLANS).forEach(id => {
            if (Array.isArray(data[id]?.objects)) return;
            delete data[id];
            const legacy = equipmentFromPlan(equipmentPlanForFloor(draft, id));
            if (legacy.length) data[id] = { objects: legacy };
        });
        if (Object.keys(data).length) editorStorage.setItem(VENUE_LIGHTING_KEY, JSON.stringify(data));
        return data;
    } catch (error) { console.warn('会場照明設定を読み込めませんでした。', error); return {}; }
}

function persistVenueLighting() {
    try { editorStorage.setItem(VENUE_LIGHTING_KEY, JSON.stringify(venueLightingData)); }
    catch (error) { console.warn('会場照明設定を保存できませんでした。', error); }
    window.refreshVenuePresetList?.();
    window.refreshLightRailCopyControls?.();
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
            ...equipment.map(obj => normalizeFixedLightShape({ ...obj, lightOn: power.get(obj.lightId) ?? true }))
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

function nearestSpotlightRail(point) {
    const zoom = canvas.lowerCanvasEl.getBoundingClientRect().width / canvas.getWidth() || 1;
    const tolerance = (window.matchMedia('(pointer: coarse)').matches ? 24 : 16) / zoom;
    let nearest = null;
    canvas.getObjects().filter(object => object.isLightRail && object.visible && !object.excludeFromExport).forEach(rail => {
        const { start, end } = railEndpoints(rail);
        if (Math.hypot(end.x - start.x, end.y - start.y) < .001) return;
        const position = projectOntoRail(rail, point);
        const distance = Math.hypot(position.x - point.x, position.y - point.y);
        if (distance <= tolerance && (!nearest || distance < nearest.distance)) nearest = { rail, position, distance };
    });
    return nearest;
}

const isArtworkLightAim = light => ['artwork', 'artwork-point'].includes(light?.lightAimMode);
const lightTargetPercent = value => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50;

function artworkLightDestination(light, target) {
    const height = window.getArtworkCenterHeightCm?.(target) ?? null;
    if (light.lightAimMode !== 'artwork-point') return { point: target.getCenterPoint(), height };
    const x = lightTargetPercent(light.lightTargetXPercent) / 100;
    const y = lightTargetPercent(light.lightTargetYPercent) / 100;
    const body = target.item(0);
    // A front elevation: horizontal position follows the artwork's local X
    // axis; vertical position changes physical height, never plan depth.
    const point = fabric.util.transformPoint(new fabric.Point((x - .5) * body.width, body.height / 2), body.calcTransformMatrix());
    return { point, height: height === null ? null : height + (y - .5) * Number(target.cmHeight || 0) };
}

function refreshLightTargetPoint(light, updateInputs = true) {
    const enabled = light?.lightAimMode === 'artwork-point';
    document.getElementById('lightTargetPointFields').hidden = !enabled;
    const target = canvas.getObjects().find(object => object.isArtwork && object.lightingTargetId === light?.lightAimTargetId);
    const x = lightTargetPercent(light?.lightTargetXPercent), y = lightTargetPercent(light?.lightTargetYPercent);
    if (updateInputs) {
        document.getElementById('lightTargetX').value = x;
        document.getElementById('lightTargetY').value = y;
    }
    const marker = document.getElementById('lightTargetPointMarker');
    marker.setAttribute('transform', `translate(${x} ${100 - y})`);
    const preview = document.getElementById('lightTargetPointPreview');
    const ratio = (Number(target?.cmWidth) || 100) / (Number(target?.cmHeight) || 100);
    const width = Math.min(150, 150 * ratio);
    preview.style.width = `${width}px`;
    preview.style.height = `${width / ratio}px`;
    [preview, document.getElementById('lightTargetX'), document.getElementById('lightTargetY')].forEach(input => {
        input.disabled = lightingReadOnly() || !enabled || !target;
    });
}

function alignSpotlightToArtwork() {
    const light = lightingById(selectedLightId);
    if (lightingReadOnly() || isTransitioning || light?.lightKind !== 'spot' || !isArtworkLightAim(light)) return;
    const target = canvas.getObjects().find(object => object.isArtwork && object.lightingTargetId === light.lightAimTargetId);
    const rail = lightingById(light.lightRailId);
    if (!target || !rail?.isLightRail) return;
    const { start, end } = railEndpoints(rail);
    const point = artworkLightDestination(light, target).point;
    const dx = end.x - start.x, dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < .000001) return;
    const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
    if (t < -1e-8 || t > 1 + 1e-8) {
        alert('このレールの範囲内では作品の正面に合わせられません。別のレールにライトを配置してください。');
        return;
    }
    const position = projectOntoRail(rail, point);
    if (Math.hypot(point.x - position.x, point.y - position.y) < .001) {
        alert('照射点がレールの真下にあるため、水平方向の正面を定められません。');
        return;
    }
    cancelLightingPlacement();
    light.lightRailT = position.t;
    light.setPositionByOrigin(new fabric.Point(position.x, position.y), 'center', 'center');
    light.setCoords();
    refreshLighting();
    saveState();
}

const normalizeLightAngle = angle => ((angle % 360) + 360) % 360;
const signedLightAngle = angle => ((angle + 180) % 360 + 360) % 360 - 180;

function spotlightRailReference(light, useSavedSide = true) {
    const rail = lightingById(light.lightRailId);
    if (!rail?.isLightRail) return null;
    const { start, end } = railEndpoints(rail);
    if (Math.hypot(end.x - start.x, end.y - start.y) < .001) return null;
    const normal = normalizeLightAngle(Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI + 90);
    const direction = Number(light.lightDirectionDeg) || 0;
    const side = useSavedSide && light.lightAimMode === 'free' && [1, -1].includes(light.lightRailNormalSide)
        ? light.lightRailNormalSide : Math.abs(signedLightAngle(direction - normal)) <= 90 ? 1 : -1;
    const base = normalizeLightAngle(normal + (side < 0 ? 180 : 0));
    const relative = signedLightAngle(direction - base);
    return { base, side, relative: Math.abs(relative) < 1e-8 ? 0 : relative };
}

function applyRailRelativeDirection(light) {
    const reference = spotlightRailReference(light);
    if (!reference) return;
    if (!Number.isFinite(light.lightRailAngleDeg)) light.lightRailAngleDeg = reference.relative;
    light.lightRailNormalSide = reference.side;
    light.lightDirectionDeg = normalizeLightAngle(reference.base + light.lightRailAngleDeg);
}

function lightingDirection(light) {
    const center = light.getCenterPoint();
    if (light.lightAimMode === 'ground') {
        if (!Number.isFinite(light.lightGroundX) || !Number.isFinite(light.lightGroundY)) {
            return { angle: 0, length: 0, tilt: null, note: '地面の照射先を選択してください' };
        }
        const dx = light.lightGroundX - center.x, dy = light.lightGroundY - center.y;
        const length = Math.hypot(dx, dy);
        const scale = Number(configuredScale);
        light.lightDirectionDeg = normalizeLightAngle(Math.atan2(dy, dx) * 180 / Math.PI);
        return { angle: light.lightDirectionDeg * Math.PI / 180, length,
            tilt: scale > 0 ? Math.atan2(length / scale, spotlightMountHeightCm) * 180 / Math.PI : null,
            note: scale > 0 ? '地面 / 高さ 0 cm' : '平面図の縮尺を設定してください' };
    }
    const target = isArtworkLightAim(light)
        ? canvas.getObjects().find(obj => obj.isArtwork && obj.lightingTargetId === light.lightAimTargetId)
        : null;
    if (target) {
        const aim = artworkLightDestination(light, target);
        const destination = aim.point;
        light.lightDirectionDeg = (Math.atan2(destination.y - center.y, destination.x - center.x) * 180 / Math.PI + 360) % 360;
        const length = Math.hypot(destination.x - center.x, destination.y - center.y);
        const scale = Number(configuredScale);
        const targetHeight = aim.height;
        const tilt = targetHeight !== null && targetHeight !== undefined && Number.isFinite(Number(targetHeight)) && scale > 0
            ? Math.atan2(length / scale, spotlightMountHeightCm - Number(targetHeight)) * 180 / Math.PI : null;
        return { angle: light.lightDirectionDeg * Math.PI / 180, length, tilt,
            note: !(scale > 0) ? '平面図の縮尺を設定してください' : tilt === null ? '展示物の編集で作品中央の高さを設定してください'
                : light.lightAimMode === 'artwork-point' ? `照射高 ${targetHeight.toFixed(1)} cm` : '' };
    }
    if (isArtworkLightAim(light)) {
        light.lightAimMode = 'free';
        light.lightAimTargetId = null;
    }
    if (light.lightAimMode === 'free') applyRailRelativeDirection(light);
    const tilt = light.lightAimMode === 'down' ? 0 : Number(light.lightTiltDeg ?? 30);
    const targetHeight = 0; // Free-angle rays project onto the floor plane.
    let length = 110;
    let note = '';
    if (light.lightAimMode !== 'down' && targetHeight !== null && targetHeight !== undefined && Number(configuredScale) > 0) {
        const drop = spotlightMountHeightCm - Number(targetHeight);
        const cosine = Math.cos(tilt * Math.PI / 180);
        const travel = Math.abs(cosine) > 1e-8 ? drop / cosine : -1;
        if (travel >= 0) length = travel * Math.sin(tilt * Math.PI / 180) * Number(configuredScale);
        else note = 'この角度では指定した高さに届きません';
    } else if (light.lightAimMode !== 'down') note = '光の長さは模式表示です';
    return { angle: (Number(light.lightDirectionDeg) || 0) * Math.PI / 180, length, tilt, note };
}

window.getLightPopupDetails = light => {
    if (!light?.isLightObject) return null;
    const power = light.lightOn === false ? '消灯' : '点灯';
    const title = light.lightName || (light.lightKind === 'spot' ? 'スポットライト' : '固定ライト');
    if (light.lightKind !== 'spot') return { title, meta: `固定ライト / ${power}`, description: '天井高 450 cm' };
    const direction = lightingDirection(light);
    const reference = spotlightRailReference(light);
    const horizontal = direction.tilt === 0 || !reference || direction.tilt === null ? '—' : `${reference.relative.toFixed(2)}°`;
    const tilt = direction.tilt === null ? '—' : `${direction.tilt.toFixed(2)}°`;
    const rail = lightingById(light.lightRailId);
    let aim = light.lightAimMode === 'down' ? '真下を照らす' : light.lightAimMode === 'ground' ? '地面の指定位置' : '角度で指定';
    if (isArtworkLightAim(light)) {
        const target = canvas.getObjects().find(object => object.isArtwork && object.lightingTargetId === light.lightAimTargetId);
        const name = target ? `${target.isFixture ? '' : `No.${window.getArtworkNumber(target)} `}${target.artworkName || '作品'}` : '作品未設定';
        aim = light.lightAimMode === 'artwork-point'
            ? `${name} / 横 ${lightTargetPercent(light.lightTargetXPercent).toFixed(1)}%・高さ ${lightTargetPercent(light.lightTargetYPercent).toFixed(1)}%`
            : `${name} / 中央`;
    }
    return { title, meta: `${power} / 水平 ${horizontal} / 仰角 ${tilt}`,
        description: [rail?.lightName, aim, direction.note].filter(Boolean).join(' / ') };
};

function refreshSpotlightReadout(light, direction = null) {
    if (!light || light.lightKind !== 'spot') return;
    direction ||= lightingDirection(light);
    const readout = document.getElementById('lightOrientationReadout');
    const reference = spotlightRailReference(light);
    const horizontal = light.lightAimMode === 'down' || direction.tilt === 0 || !reference ? '—' : reference.relative.toFixed(2) + '°';
    if (readout) readout.textContent = `水平 ${horizontal} / 仰角 ${direction.tilt === null ? '—' : direction.tilt.toFixed(2) + '°'}${direction.note ? ' · ' + direction.note : ''}`;
    if (light.lightAimMode !== 'free') {
        document.getElementById('lightDirection').value = horizontal === '—' ? '' : reference.relative.toFixed(2);
        document.getElementById('lightTilt').value = direction.tilt === null ? '' : direction.tilt.toFixed(2);
    }
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
                ...(spot ? { radius: 5 } : { width: fixedLightSize, height: fixedLightSize, rx: 0, ry: 0 }),
                lockMovementX: !editablePosition, lockMovementY: !editablePosition,
                lockScalingX: true, lockScalingY: true, lockRotation: true,
                fill: light.lightOn === false ? '#737b80' : (spot ? '#a5b6be' : '#f2ce54'),
                opacity: light.lightOn === false ? 0.65 : 1 });
            light.setControlsVisibility({ tl: false, tr: false, bl: false, br: false, ml: false, mt: false, mr: false, mb: false, mtr: false });
            light.setCoords();
            if (!spot) return;
            const direction = lightingDirection(light);
            if (light.lightId === selectedLightId) refreshSpotlightReadout(light, direction);
            if (light.lightAimMode === 'down' || direction.tilt === 0) {
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
            if (!lightingVisible || light.lightOn === false) return;
            if (light.lightAimMode === 'ground' && Number.isFinite(light.lightGroundX) && Number.isFinite(light.lightGroundY)) {
                // Use the actual destination rather than the capped beam length.
                const landing = new fabric.Circle({
                    left: light.lightGroundX, top: light.lightGroundY,
                    originX: 'center', originY: 'center', radius: 18,
                    fill: 'rgba(183,156,93,0.12)', stroke: 'rgba(143,122,73,0.55)', strokeWidth: 0.7,
                    isLightBeam: true, excludeFromExport: true, selectable: false, evented: false
                });
                canvas.add(landing);
                landing.moveTo(0);
            }
            if (direction.length < 1) return;
            const p = light.getCenterPoint();
            const dx = Math.cos(direction.angle), dy = Math.sin(direction.angle);
            // Limit the visual ray only; keep the exact geometry for the angle readout.
            const displayLength = Math.min(direction.length, Math.hypot(canvas.width, canvas.height) * 4);
            const end = { x: p.x + dx * displayLength, y: p.y + dy * displayLength };
            const width = Math.min(28, displayLength * 0.14);
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
        // Mount markers stay above artworks; beams remain behind the drawing.
        canvas.getObjects().filter(object => object.isLightObject).forEach(light => canvas.bringToFront(light));
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
    window.refreshVenuePresetList?.();
    window.refreshLightRailCopyControls?.();
    const objects = currentViewMode === 'floor' ? canvas.getObjects() : [];
    const lights = objects.filter(obj => obj.isLightObject);
    if (!lights.some(obj => obj.lightId === selectedLightId)) selectedLightId = lights[0]?.lightId || '';
    fillLightingSelect('lightObjectSelect', lights.map(obj => ({ id: obj.lightId, name: obj.lightName })), selectedLightId, 'ライトはありません');
    const artworks = objects.filter(obj => obj.isArtwork);
    const light = lights.find(obj => obj.lightId === selectedLightId);
    fillLightingSelect('lightTargetSelect', artworks.map((obj, index) => ({
        id: obj.lightingTargetId || `index:${index}`, name: `${obj.isFixture ? '' : `No.${window.getArtworkNumber(obj)} `}${obj.artworkName || `作品 ${index + 1}`}`
    })), light?.lightAimTargetId, '作品はありません');
    const fields = document.getElementById('lightSettingsFields');
    if (fields) fields.hidden = !light;
    const directionFields = document.getElementById('spotlightDirectionFields');
    if (directionFields) directionFields.hidden = light?.lightKind !== 'spot';
    const snap = isArtworkLightAim(light);
    const angleField = document.getElementById('lightAngleField');
    const targetField = document.getElementById('lightTargetField');
    if (angleField) angleField.hidden = false;
    if (targetField) targetField.hidden = !snap;
    const power = document.getElementById('lightPower');
    const mode = document.getElementById('lightAimMode');
    const angle = document.getElementById('lightDirection');
    if (power) power.checked = light?.lightOn !== false;
    if (mode) mode.value = ['down', 'ground'].includes(light?.lightAimMode) ? light.lightAimMode : (snap ? light.lightAimMode : 'free');
    if (light?.lightKind === 'spot') lightingDirection(light);
    const railReference = light?.lightKind === 'spot' ? spotlightRailReference(light) : null;
    if (angle) angle.value = railReference ? railReference.relative.toFixed(2) : '';
    document.getElementById('lightTilt').value = Number(light?.lightTiltDeg ?? 30);
    ['lightPower', 'lightAimMode', 'lightDirection', 'lightTargetSelect', 'lightTilt'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.disabled = lightingReadOnly() || !light;
    });
    if (angle) angle.disabled = lightingReadOnly() || !light || light.lightAimMode !== 'free' || !railReference;
    const flip = document.getElementById('btnFlipSpotlightSide');
    if (flip) flip.disabled = lightingReadOnly() || !light || light.lightAimMode !== 'free' || !railReference;
    document.getElementById('lightTilt').disabled = lightingReadOnly() || !light || light.lightAimMode !== 'free';
    refreshSpotlightReadout(light);
    refreshLightTargetPoint(light);
    const groundPick = document.getElementById('btnPickLightGround');
    groundPick.hidden = light?.lightKind !== 'spot' || light.lightAimMode !== 'ground';
    groundPick.disabled = lightingReadOnly();
    document.getElementById('btnDeleteSpotlight').disabled = lightingReadOnly() || light?.lightKind !== 'spot';
    const add = document.getElementById('btnPlaceSpotlight');
    if (add) add.disabled = lightingReadOnly() || !objects.some(obj => obj.isLightRail);
    const pick = document.getElementById('btnPickLightTarget');
    if (pick) pick.disabled = lightingReadOnly() || light?.lightKind !== 'spot' || !artworks.length;
    const align = document.getElementById('btnAlignSpotlightToArtwork');
    if (align) align.disabled = lightingReadOnly() || !snap || !railReference || !artworks.some(object => object.lightingTargetId === light?.lightAimTargetId);
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
    try { editorStorage.setItem('curator_canvas_lighting_visible', String(lightingVisible)); } catch {}
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
    spotlightPlacementPreview = null;
    canvas.contextTopDirty = true;
    const spotButton = document.getElementById('btnPlaceSpotlight');
    if (spotButton) { spotButton.textContent = 'スポットライトを追加'; spotButton.setAttribute('aria-pressed', 'false'); }
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
    const groundButton = document.getElementById('btnPickLightGround');
    if (groundButton) {
        groundButton.textContent = '地面の照射先を選択';
        groundButton.setAttribute('aria-pressed', 'false');
    }
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
    if (currentViewMode !== 'floor' && !await switchViewMode('floor')) return;
    if (mode === 'spot' && !canvas.getObjects().some(object => object.isLightRail && !object.excludeFromExport)) {
        alert('管理者モードでライトレールを登録してください。'); return;
    }
    if (['aim', 'ground'].includes(mode) && lightingById(selectedLightId)?.lightKind !== 'spot') return;
    if (!lightingVisible) toggleLightingVisibility(true);
    canvas.discardActiveObject(); lightingPlacementMode = mode;
    canvas.skipTargetFind = true; canvas.selection = false; canvas.defaultCursor = 'crosshair';
    if (mode === 'spot') {
        document.getElementById('btnPlaceSpotlight').textContent = 'レールを選択中';
        document.getElementById('btnPlaceSpotlight').setAttribute('aria-pressed', 'true');
    }
    if (mode === 'fixed') {
        document.getElementById('btnPlaceFixedLight').textContent = '固定ライトを終了';
        document.getElementById('btnPlaceFixedLight').setAttribute('aria-pressed', 'true');
    }
    if (mode === 'rail') {
        document.getElementById('btnDrawLightRail').textContent = 'レール登録を終了';
        document.getElementById('btnDrawLightRail').setAttribute('aria-pressed', 'true');
    }
    if (mode === 'aim') document.getElementById('btnPickLightTarget').textContent = '作品選択をキャンセル';
    if (mode === 'ground') {
        document.getElementById('btnPickLightGround').textContent = '照射先の選択をキャンセル';
        document.getElementById('btnPickLightGround').setAttribute('aria-pressed', 'true');
    }
}

function createLight(point, kind, rail = null) {
    const position = rail ? projectOntoRail(rail, point) : point;
    const count = canvas.getObjects().filter(obj => obj.isLightObject && obj.lightKind === kind).length + 1;
    const LightShape = kind === 'fixed' ? fabric.Rect : fabric.Circle;
    return new LightShape({
        left: position.x, top: position.y, originX: 'center', originY: 'center',
        ...(kind === 'fixed' ? { width: fixedLightSize, height: fixedLightSize, rx: 0, ry: 0 } : { radius: 5 }),
        stroke: '#53616a', strokeWidth: 1,
        fill: kind === 'fixed' ? '#f2ce54' : '#a5b6be',
        isLightObject: true, isFixture: kind === 'fixed', lightId: crypto.randomUUID(),
        lightKind: kind, lightName: `${kind === 'fixed' ? '固定ライト' : 'スポットライト'} ${count}`,
        lightOn: true, lightRailId: rail?.lightId || null, lightRailT: position.t ?? null,
        lightAimMode: 'free', lightDirectionDeg: 90, lightTiltDeg: 30,
        ...(kind === 'spot' ? { lightRailAngleDeg: 0, lightRailNormalSide: 1 } : {})
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
        const targetX = Number(document.getElementById('lightTargetX').value);
        const targetY = Number(document.getElementById('lightTargetY').value);
        if (mode === 'artwork-point' && ['lightTargetX', 'lightTargetY'].some(id => !document.getElementById(id).value.trim() || !Number.isFinite(Number(document.getElementById(id).value)) || Number(document.getElementById(id).value) < 0 || Number(document.getElementById(id).value) > 100)) {
            document.getElementById('lightOrientationReadout').textContent = '照射位置は0〜100%で入力してください';
            return;
        }
        let angleText = document.getElementById('lightDirection').value;
        if (mode === 'free' && light.lightAimMode !== 'free' && !angleText.trim()) {
            angleText = String(light.lightRailAngleDeg ?? 0);
        }
        const angle = Number(angleText);
        const tiltText = document.getElementById('lightTilt').value;
        const tilt = mode === 'free' && light.lightAimMode !== 'free'
            ? Number(light.lightTiltDeg ?? 30) : Number(tiltText);
        if (mode === 'free' && ((!tiltText.trim() && light.lightAimMode === 'free') || !Number.isFinite(tilt) || tilt < 0 || tilt > 180)) {
            document.getElementById('lightOrientationReadout').textContent = '角度の入力値を確認してください';
            return;
        }
        if (mode === 'free' && (!angleText.trim() || !Number.isFinite(angle) || angle < -90 || angle > 90)) {
            document.getElementById('lightOrientationReadout').textContent = '水平角は−90°から90°で入力してください';
            return;
        }
        const reference = mode === 'free' ? spotlightRailReference(light) : null;
        if (mode === 'free' && !reference) return;
        light.lightAimMode = mode;
        if (mode === 'free') {
            light.lightRailAngleDeg = angle;
            light.lightRailNormalSide = reference.side;
            light.lightDirectionDeg = normalizeLightAngle(reference.base + angle);
            light.lightTiltDeg = tilt;
            light.lightAimTargetId = null;
        } else if (mode === 'down' || mode === 'ground') {
            light.lightAimTargetId = null;
        } else {
            const targetValue = document.getElementById('lightTargetSelect').value;
            const artworks = canvas.getObjects().filter(obj => obj.isArtwork);
            const target = targetValue.startsWith('index:')
                ? artworks[Number(targetValue.slice(6))] : artworks.find(obj => obj.lightingTargetId === targetValue);
            if (!target) { light.lightAimMode = 'free'; refreshLighting(); return; }
            if (!target.lightingTargetId) target.lightingTargetId = crypto.randomUUID();
            light.lightAimTargetId = target.lightingTargetId;
            if (mode === 'artwork-point') {
                light.lightTargetXPercent = targetX;
                light.lightTargetYPercent = targetY;
            }
        }
    }
    refreshLighting(!debounce);
    refreshLightTargetPoint(light, !debounce);
    if (lightingEditTimer) clearTimeout(lightingEditTimer);
    lightingEditTimer = null;
    if (debounce) lightingEditTimer = setTimeout(() => { lightingEditTimer = null; saveState(); }, 400);
    else saveState();
}

window.canDeleteLightingObject = obj => !lightingReadOnly() && Boolean(
    (obj.isLightObject && (obj.lightKind === 'spot' || isAdminMode)) || (obj.isLightRail && isAdminMode)
);
function deleteSelectedSpotlight() {
    const light = lightingById(selectedLightId);
    if (lightingReadOnly() || isTransitioning || isUndoRedoOperation || currentViewMode !== 'floor' || !window.isDiagramReady?.() || light?.lightKind !== 'spot') return;
    cancelLightingPlacement();
    const restoring = isUndoRedoOperation;
    isUndoRedoOperation = true;
    try {
        canvas.discardActiveObject();
        canvas.remove(light);
    } finally { isUndoRedoOperation = restoring; }
    refreshLighting();
    saveState();
}
function removeVenueLightingObjects(objects) {
    if (!objects.length) return true;
    if (!isAdminMode || lightingReadOnly() || currentViewMode !== 'floor' || isTransitioning || isUndoRedoOperation) return false;
    if (objects.some(object => !isVenueEquipment(object) || !canvas.getObjects().includes(object))) return false;
    const railIds = new Set(objects.filter(object => object.isLightRail).map(object => object.lightId));
    const spots = canvas.getObjects().filter(object => object.isLightObject && object.lightKind === 'spot' && railIds.has(object.lightRailId));
    const restoring = isUndoRedoOperation;
    lightingRenderBusy = true;
    isUndoRedoOperation = true;
    try {
        canvas.discardActiveObject();
        canvas.remove(...objects, ...spots);
    } finally {
        lightingRenderBusy = false;
        isUndoRedoOperation = restoring;
    }
    window.persistLightingEquipmentChange(objects[0]);
    refreshLighting();
    saveState();
    window.refreshVenuePresetList?.();
    return true;
}
window.deleteVenueLightingForFloor = (floorId, expectedIds) => {
    if (selectedFloorId !== floorId || currentViewMode !== 'floor') return false;
    const ids = new Set(expectedIds);
    const objects = canvas.getObjects().filter(object => isVenueEquipment(object) && ids.has(object.lightId));
    if (objects.length !== ids.size) return false;
    return removeVenueLightingObjects(objects);
};
window.deleteVenueLightingPreset = async (floorId, lightId) => {
    if (!isAdminMode || lightingReadOnly() || isTransitioning || isUndoRedoOperation || !FLOOR_PLANS[floorId]) return false;
    cancelLightingPlacement();
    window.flushPendingItemEditHistory?.();
    if (currentViewMode !== 'floor' || selectedFloorId !== floorId) await handleFloorSelectChange(floorId);
    if (currentViewMode !== 'floor' || selectedFloorId !== floorId || !window.isDiagramReady?.()) return false;
    const object = lightingById(lightId);
    if (!object || !isVenueEquipment(object)) return false;
    const spots = object.isLightRail ? canvas.getObjects().filter(light => light.isLightObject && light.lightKind === 'spot' && light.lightRailId === object.lightId) : [];
    const message = `「${object.lightName || (object.isLightRail ? 'ライトレール' : '固定ライト')}」を事前設定から削除しますか？${spots.length ? `\nこのレール上のスポットライト ${spots.length}個も削除します。` : ''}`;
    if (!confirm(message)) return false;
    return removeVenueLightingObjects([object]);
};
window.handleLightingObjectRemoved = obj => {
    if (lightingRenderBusy || isTransitioning || isUndoRedoOperation || !(obj?.isLightObject || obj?.isLightRail || obj?.isArtwork)) return;
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
        delete obj.lightRailAngleDeg;
        delete obj.lightRailNormalSide;
        applyRailRelativeDirection(obj);
    } else if (obj.isLightRail && isAdminMode) obj.rotate((obj.angle || 0) + 90);
    else return;
    window.persistLightingEquipmentChange(obj);
    refreshLighting(); saveState();
};

canvas.on('mouse:down', event => {
    if (!lightingPlacementMode || (event.e.button !== undefined && event.e.button !== 0)) return;
    const point = canvas.getPointer(event.e);
    if (lightingPlacementMode === 'ground') {
        const light = lightingById(selectedLightId);
        if (light?.lightKind !== 'spot') return;
        const destination = window.snapPointToGrid?.(point) || point;
        light.lightAimMode = 'ground';
        light.lightAimTargetId = null;
        light.lightGroundX = destination.x;
        light.lightGroundY = destination.y;
        cancelLightingPlacement();
        refreshLighting();
        saveState();
        return;
    }
    if (lightingPlacementMode === 'aim') {
        const target = [...canvas.getObjects()].reverse().find(obj => obj.isArtwork && obj.visible && obj.containsPoint(new fabric.Point(point.x, point.y)));
        const light = lightingById(selectedLightId);
        if (!target || !light?.isLightObject) return;
        if (!target.lightingTargetId) target.lightingTargetId = crypto.randomUUID();
        light.lightAimMode = document.getElementById('lightAimMode').value === 'artwork-point' ? 'artwork-point' : 'artwork';
        light.lightAimTargetId = target.lightingTargetId;
        if (light.lightAimMode === 'artwork-point') {
            const body = target.item(0);
            const local = fabric.util.transformPoint(new fabric.Point(point.x, point.y), fabric.util.invertTransform(body.calcTransformMatrix()));
            light.lightTargetXPercent = Math.max(0, Math.min(100, (local.x / body.width + .5) * 100));
            light.lightTargetYPercent = lightTargetPercent(light.lightTargetYPercent);
        }
        cancelLightingPlacement(); refreshLighting(); saveState();
        return;
    }
    const placementPoint = window.snapPointToGrid?.(point) || point;
    if (lightingPlacementMode === 'rail') lightingRailStart = placementPoint;
    else if (lightingPlacementMode === 'fixed') finishLightingPlacement(createLight(placementPoint, 'fixed'));
    else {
        const nearest = nearestSpotlightRail(point);
        if (nearest) finishLightingPlacement(createLight(point, 'spot', nearest.rail));
    }
});
function lightRailEndPoint(event) {
    const pointer = canvas.getPointer(event.e);
    const point = window.snapPointToGrid?.(pointer) || pointer;
    if (!event.e.shiftKey || !lightingRailStart) return point;
    const dx = point.x - lightingRailStart.x;
    const dy = point.y - lightingRailStart.y;
    return Math.abs(dx) >= Math.abs(dy)
        ? { x: point.x, y: lightingRailStart.y }
        : { x: lightingRailStart.x, y: point.y };
}

canvas.on('after:render', () => {
    if (lightingPlacementMode !== 'spot' || !spotlightPlacementPreview) return;
    const { rail, position } = spotlightPlacementPreview;
    if (!canvas.getObjects().includes(rail)) return;
    const { start, end } = railEndpoints(rail);
    const zoom = canvas.lowerCanvasEl.getBoundingClientRect().width / canvas.getWidth() || 1;
    // Transient feedback on the interaction layer never changes saved rail data.
    const context = canvas.contextTop;
    context.save();
    context.transform(...canvas.viewportTransform);
    context.strokeStyle = '#cfbf8a';
    context.fillStyle = '#f2ce54';
    context.lineWidth = 2 / zoom;
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.beginPath();
    context.arc(position.x, position.y, 4 / zoom, 0, Math.PI * 2);
    context.fill();
    context.restore();
    canvas.contextTopDirty = true;
});
canvas.on('mouse:out', () => {
    if (lightingPlacementMode !== 'spot' || !spotlightPlacementPreview) return;
    spotlightPlacementPreview = null;
    canvas.contextTopDirty = true;
    canvas.requestRenderAll();
});
canvas.on('mouse:move', event => {
    if (lightingPlacementMode === 'spot') {
        spotlightPlacementPreview = nearestSpotlightRail(canvas.getPointer(event.e));
        canvas.contextTopDirty = true;
        canvas.requestRenderAll();
        return;
    }
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
        !event.target?.isLightBeam && !event.target?.excludeFromExport) refreshLighting();
});
const selectLight = event => {
    const object = event.selected?.[0];
    if (!object?.isLightObject && !object?.isLightRail) return;
    flushPendingLightingEdit();
    if (object.isLightObject) selectedLightId = object.lightId;
    if (lightingPlacementMode) return;
    if (isAdminMode && isVenueEquipment(object)) { refreshLightingControls(); return; }
    window.activateToolPanel?.('lighting'); refreshLightingControls();
};
canvas.on('selection:created', selectLight);
canvas.on('selection:updated', selectLight);

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnDeleteSpotlight')?.addEventListener('click', deleteSelectedSpotlight);
    document.getElementById('btnPickLightGround')?.addEventListener('click', () => startLightingPlacement('ground'));
    document.getElementById('btnAlignSpotlightToArtwork')?.addEventListener('click', alignSpotlightToArtwork);
    document.getElementById('btnFlipSpotlightSide')?.addEventListener('click', () => {
        const light = lightingById(selectedLightId);
        if (lightingReadOnly() || light?.lightKind !== 'spot' || light.lightAimMode !== 'free') return;
        flushPendingLightingEdit();
        applyRailRelativeDirection(light);
        if (!spotlightRailReference(light)) return;
        light.lightRailNormalSide *= -1;
        applyRailRelativeDirection(light);
        refreshLighting();
        saveState();
    });
    document.getElementById('btnPlaceFixedLight')?.addEventListener('click', () => startLightingPlacement('fixed'));
    document.getElementById('btnDrawLightRail')?.addEventListener('click', () => startLightingPlacement('rail'));
    document.getElementById('btnPlaceSpotlight')?.addEventListener('click', () => startLightingPlacement('spot'));
    document.getElementById('btnPickLightTarget')?.addEventListener('click', () => startLightingPlacement('aim'));
    document.getElementById('lightTargetPointPreview')?.addEventListener('click', event => {
        if (lightingReadOnly()) return;
        const bounds = event.currentTarget.querySelector('svg').getBoundingClientRect();
        if (!bounds.width || !bounds.height || event.detail === 0) return;
        document.getElementById('lightTargetX').value = Math.max(0, Math.min(100, (event.clientX - bounds.left) / bounds.width * 100)).toFixed(1);
        document.getElementById('lightTargetY').value = Math.max(0, Math.min(100, (bounds.bottom - event.clientY) / bounds.height * 100)).toFixed(1);
        applyLightSettings();
    });
    ['lightTargetX', 'lightTargetY'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => applyLightSettings(true));
        document.getElementById(id)?.addEventListener('change', () => { flushPendingLightingEdit(); refreshLightingControls(); });
    });
    document.getElementById('lightingVisibility')?.addEventListener('change', event => toggleLightingVisibility(event.target.checked));
    document.getElementById('lightObjectSelect')?.addEventListener('change', event => {
        flushPendingLightingEdit(); selectedLightId = event.target.value; refreshLightingControls();
        const light = lightingById(selectedLightId);
        if (light?.selectable) canvas.setActiveObject(light);
    });
    ['lightPower', 'lightAimMode', 'lightTargetSelect'].forEach(id => document.getElementById(id)?.addEventListener('change', () => applyLightSettings()));
    ['lightDirection', 'lightTilt'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => applyLightSettings(true));
        document.getElementById(id)?.addEventListener('change', () => { flushPendingLightingEdit(); refreshLightingControls(); });
    });
    refreshLighting();
});
window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && lightingPlacementMode) { cancelLightingPlacement(); event.preventDefault(); }
});
