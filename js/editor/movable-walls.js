// A movable wall and its elevations belong to the current exhibition/layout.
(() => {
    const heightCm = 440;
    let selected = null;
    const faceLabelStorageKey = 'curator_canvas_movable_wall_faces_visible';
    let faceLabelsVisible = true;
    try { faceLabelsVisible = localStorage.getItem(faceLabelStorageKey) !== 'false'; } catch {}
    let faceLabelOverlay = null;
    let faceLabelFrame = null;
    const canEdit = () => window.CURATOR_ROLE !== 'viewer';
    const faceDefinitions = wall => [
        ['front', wall.movableFrontId, '前面', wall.cmWidth],
        ['back', wall.movableBackId, '裏面', wall.cmWidth],
        ['left', wall.movableLeftId, '左側面', wall.cmDepth],
        ['right', wall.movableRightId, '右側面', wall.cmDepth]
    ].filter(([, id]) => id);
    const linkedFaces = wall => faceDefinitions(wall).map(([, id]) => id);
    const circled = number => number <= 20 ? String.fromCodePoint(0x2460 + number - 1)
        : number <= 35 ? String.fromCodePoint(0x3251 + number - 21)
        : number <= 50 ? String.fromCodePoint(0x32b1 + number - 36) : `(${number})`;

    function renderFaceLabels() {
        faceLabelFrame = null;
        if (!faceLabelOverlay) return;
        const walls = currentViewMode === 'floor' && faceLabelsVisible
            ? canvas.getObjects().filter(object => object.isMovableWall && object.visible !== false) : [];
        faceLabelOverlay.toggleAttribute('hidden', !walls.length);
        if (!walls.length) { faceLabelOverlay.replaceChildren(); return; }
        const zoom = canvas.lowerCanvasEl.getBoundingClientRect().width / canvas.getWidth() || 1;
        faceLabelOverlay.setAttribute('viewBox', `0 0 ${canvas.getWidth()} ${canvas.getHeight()}`);
        faceLabelOverlay.setAttribute('width', canvas.getWidth());
        faceLabelOverlay.setAttribute('height', canvas.getHeight());
        faceLabelOverlay.replaceChildren();
        walls.forEach(wall => {
            const body = wall.item(0);
            const matrix = body.calcTransformMatrix();
            const center = fabric.util.transformPoint(new fabric.Point(0, 0), matrix);
            [-1, 1].forEach(side => {
                const edge = fabric.util.transformPoint(new fabric.Point(0, side * body.height / 2), matrix);
                const normal = fabric.util.transformPoint(new fabric.Point(0, side), matrix);
                const length = Math.hypot(normal.x - center.x, normal.y - center.y) || 1;
                const nx = (normal.x - center.x) / length, ny = (normal.y - center.y) / length;
                const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                const color = side < 0 ? '#345c70' : '#646a70';
                const text = document.createElementNS(group.namespaceURI, 'text');
                text.setAttribute('x', edge.x + nx * 13 / zoom);
                text.setAttribute('y', edge.y + ny * 13 / zoom);
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('dominant-baseline', 'central');
                text.setAttribute('font-size', 10 / zoom);
                text.setAttribute('font-family', 'sans-serif');
                text.setAttribute('fill', color);
                text.setAttribute('stroke', '#f3f5f6');
                text.setAttribute('stroke-width', 2.5 / zoom);
                text.setAttribute('paint-order', 'stroke');
                text.textContent = `${circled(wall.movableWallNumber)} ${side < 0 ? '前面' : '裏面'}`;
                group.appendChild(text);
                faceLabelOverlay.appendChild(group);
            });
        });
    }
    function scheduleFaceLabels() {
        if (faceLabelFrame === null) faceLabelFrame = requestAnimationFrame(renderFaceLabels);
    }
    canvas.on('after:render', scheduleFaceLabels);
    function numberFromName(name = '') {
        const digits = name.match(/^(?:移動壁\s*|壁\s*[（(]?)(\d+)/);
        if (digits) return Number(digits[1]);
        const symbol = name.match(/^壁([①-⑳㉑-㉟㊱-㊿])/);
        if (!symbol) return 0;
        const code = symbol[1].codePointAt(0);
        return code <= 0x2473 ? code - 0x2460 + 1 : code <= 0x325f ? code - 0x3251 + 21 : code - 0x32b1 + 36;
    }
    function nextNumber() {
        const numbers = Object.values(wallPlanJsonData).filter(face => face.movableWallId && face.face === 'front')
            .map(face => Number(face.movableWallNumber) || numberFromName(face.title));
        return Math.max(0, ...numbers) + 1;
    }
    function normalizeWallName(wall) {
        const front = wallPlanJsonData[wall.movableFrontId];
        let number = Number(front?.movableWallNumber) || Number(wall.movableWallNumber) || numberFromName(wall.movableWallName);
        const duplicate = Object.values(wallPlanJsonData).some(face => face.face === 'front' &&
            face.movableWallId !== wall.movableWallId &&
            (Number(face.movableWallNumber) || numberFromName(face.title)) === number);
        if (!Number.isInteger(number) || number <= 0 || duplicate) number = nextNumber();
        wall.movableWallNumber = number;
        wall.movableWallName = `壁${circled(number)}`;
        faceDefinitions(wall).forEach(([, id, name]) => {
            const face = wallPlanJsonData[id];
            if (!face) return;
            face.movableWallNumber = number;
            face.title = `${wall.movableWallName}・${name}`;
            if (selectedWallInfo.id === id) selectedWallInfo.title = face.title;
        });
    }

    function registerFaces(wall) {
        faceDefinitions(wall).forEach(([face, id, name, widthCm]) => {
            const previous = wallPlanJsonData[id];
            wallPlanJsonData[id] = { ...previous, title: `${wall.movableWallName}・${name}`,
                widthCm, heightCm, json: previous?.json || null,
                movableWallId: wall.movableWallId, movableWallNumber: wall.movableWallNumber, floorId: wall.movableFloorId, face };
        });
        const activeFace = wallPlanJsonData[selectedWallInfo.id];
        if (activeFace?.movableWallId === wall.movableWallId) {
            Object.assign(selectedWallInfo, { title: activeFace.title, widthCm: activeFace.widthCm, heightCm });
        }
        updateWallDropdownOptions();
    }

    window.configureMovableWall = wall => {
        if (!wall?.isMovableWall) return;
        normalizeWallName(wall);
        const scale = configuredScale ?? (Number(document.getElementById('scale')?.value) || .5);
        const width = wall.cmWidth * scale, depth = wall.cmDepth * scale;
        wall.cmHeight = heightCm;
        wall.item(0).set({ width, height: depth, fill: '#30373d', stroke: '#171d22' });
        const label = wall.item(1);
        label.set({ text: circled(wall.movableWallNumber), fill: '#edf2f5',
            fontSize: Math.min(14, depth * .95), visible: depth >= 6 && width >= 12 });
        label.initDimensions();
        if (label.width > width - 6) label.set('fontSize', label.fontSize * Math.max(1, width - 6) / label.width);
        wall.set({ width: width + 1, height: depth + 1, dirty: true,
            lockScalingX: true, lockScalingY: true, lockScalingFlip: true, lockSkewingX: true, lockSkewingY: true,
            selectable: canEdit(), evented: true, lockMovementX: !canEdit(), lockMovementY: !canEdit(), lockRotation: !canEdit() });
        wall.setControlsVisibility({ tl: false, tr: false, bl: false, br: false,
            ml: false, mt: false, mr: false, mb: false, mtr: canEdit() });
        wall.setCoords();
    };

    function refreshPanel(object = selected) {
        selected = object?.isMovableWall && canvas.getObjects().includes(object) ? object : null;
        const actions = document.getElementById('movableWallSelection');
        if (actions) actions.hidden = !selected;
        if (!selected) return;
        document.getElementById('movableWallName').value = selected.movableWallName;
        document.getElementById('movableWallWidth').value = selected.cmWidth;
        document.getElementById('movableWallDepth').value = selected.cmDepth;
        document.getElementById('movableWallAngle').value = Math.round(selected.angle || 0);
        [['Left', 'movableLeftId', '左'], ['Right', 'movableRightId', '右']].forEach(([suffix, key, name]) => {
            const button = document.getElementById(`btnMovableWall${suffix}`);
            if (button) button.textContent = wallPlanJsonData[selected[key]]
                ? `${name}側面の壁面図` : `${name}側面を追加`;
        });
    }

    function parameters() {
        const width = Number(document.getElementById('movableWallWidth').value);
        const depth = Number(document.getElementById('movableWallDepth').value);
        const angle = Number(document.getElementById('movableWallAngle').value);
        if (![width, depth, angle].every(Number.isFinite) || width <= 0 || depth <= 0 || width > 10000 || depth > 10000) {
            alert('幅・厚さは0より大きく10000cm以下、回転は数値で入力してください。');
            return null;
        }
        return { width, depth, angle: ((angle % 360) + 360) % 360 };
    }
    window.refreshMovableWallPanel = refreshPanel;

    async function addWall() {
        if (!canEdit() || isTransitioning || isUndoRedoOperation) return;
        const data = parameters();
        if (!data) return;
        window.cancelLightingPlacement?.();
        window.cancelDimensionDrawing?.();
        if (isFreeDrawingMode) toggleFreeDrawingMode(false);
        if (currentViewMode !== 'floor' && !await switchViewMode('floor')) return;
        if (!window.isDiagramReady?.()) return;
        const id = crypto.randomUUID();
        const number = nextNumber();
        const name = `壁${circled(number)}`;
        const center = canvas.getCenter();
        const wall = new fabric.Group([
            new fabric.Rect({ width: 1, height: 1, fill: '#30373d', stroke: '#171d22', strokeWidth: 1,
                originX: 'center', originY: 'center' }),
            new fabric.Text(circled(number), { fontSize: 8, fill: '#edf2f5', fontFamily: 'sans-serif',
                originX: 'center', originY: 'center' })
        ], { left: center.left, top: center.top, originX: 'center', originY: 'center', angle: data.angle,
            isMovableWall: true, movableWallId: id, movableWallName: name, movableWallNumber: number, movableFloorId: selectedFloorId,
            movableFrontId: `movable_${id}_front`, movableBackId: `movable_${id}_back`,
            cmWidth: data.width, cmDepth: data.depth, cmHeight: heightCm, objectCaching: false });
        window.configureMovableWall(wall);
        window.snapObjectToGrid?.(wall);
        isUndoRedoOperation = true;
        try { registerFaces(wall); canvas.add(wall); }
        finally { isUndoRedoOperation = false; }
        canvas.setActiveObject(wall);
        canvas.requestRenderAll();
        saveState();
    }

    function updateWall() {
        if (!selected || !canEdit() || isTransitioning) return;
        const data = parameters();
        if (!data) return;
        selected.cmWidth = data.width;
        selected.cmDepth = data.depth;
        selected.set('angle', data.angle);
        window.configureMovableWall(selected);
        registerFaces(selected);
        canvas.requestRenderAll();
        saveState();
    }

    async function openSideFace(side) {
        if (!selected || !canEdit() || isTransitioning || isUndoRedoOperation) return;
        const wall = selected;
        const key = side === 'left' ? 'movableLeftId' : 'movableRightId';
        if (!wallPlanJsonData[wall[key]]) {
            wall[key] = `movable_${wall.movableWallId}_${side}`;
            registerFaces(wall);
            refreshPanel(wall);
            saveState();
        }
        await handleWallSelectChange(wall[key]);
    }

    window.confirmMovableWallRemoval = walls => !walls.length || confirm(
        `移動壁 ${walls.length}台と、対応する全壁面の配置データを削除しますか？`);
    window.removeMovableWallFaces = walls => {
        walls.filter(wall => wall.isMovableWall).forEach(wall => linkedFaces(wall).forEach(id => delete wallPlanJsonData[id]));
        window.applyVenueWallsToPlans?.();
        if (!wallPlanJsonData[selectedWallInfo.id]) {
            const id = Object.keys(wallPlanJsonData)[0];
            selectedWallInfo = id ? { id, title: wallPlanJsonData[id].title,
                widthCm: wallPlanJsonData[id].widthCm, heightCm: wallPlanJsonData[id].heightCm }
                : { id: '', title: '', widthCm: 0, heightCm: 0 };
        }
        updateWallDropdownOptions();
    };

    async function deleteSelectedWall(wall = selected) {
        if (!wall || !canEdit() || !window.confirmMovableWallRemoval([wall])) return;
        isUndoRedoOperation = true;
        try {
            window.removeMovableWallFaces([wall]);
            canvas.discardActiveObject();
            canvas.remove(wall);
        } finally { isUndoRedoOperation = false; }
        refreshPanel(null);
        canvas.requestRenderAll();
        saveState();
    }

    window.deleteMovableWallByFace = async faceId => {
        const face = wallPlanJsonData[faceId];
        if (!face?.movableWallId || !canEdit() || isTransitioning) return;
        // Remove the actual wall and all its elevations together.
        await handleFloorSelectChange(face.floorId, true);
        const wall = canvas.getObjects().find(object => object.isMovableWall && object.movableWallId === face.movableWallId);
        if (wall) await deleteSelectedWall(wall);
    };

    window.snapArtworkToMovableWall = object => {
        if (!object?.isArtwork || object.isFixture || object.group || currentViewMode !== 'floor' || !canEdit()) return false;
        const point = object.getCenterPoint();
        const zoom = canvas.lowerCanvasEl.getBoundingClientRect().width / canvas.getWidth() || 1;
        const threshold = 22 / zoom;
        const body = object.item(0);
        const halfWidth = body.width * Math.abs(object.scaleX || 1) / 2;
        const halfDepth = body.height * Math.abs(object.scaleY || 1) / 2;
        let best = null;
        canvas.getObjects().filter(wall => wall.isMovableWall).forEach(wall => {
            const wallBody = wall.item(0);
            const wallWidth = wallBody.width * Math.abs(wall.scaleX || 1) / 2;
            const wallDepth = wallBody.height * Math.abs(wall.scaleY || 1) / 2;
            const center = wall.getCenterPoint();
            const angle = (wall.angle || 0) * Math.PI / 180;
            const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
            const dx = point.x - center.x, dy = point.y - center.y;
            const surfaces = [
                { tx: ux, ty: uy, nx: -nx, ny: -ny, halfLength: wallWidth, offset: wallDepth, rotation: 180 },
                { tx: ux, ty: uy, nx, ny, halfLength: wallWidth, offset: wallDepth, rotation: 0 }
            ];
            if (wallPlanJsonData[wall.movableLeftId]) surfaces.push({
                tx: nx, ty: ny, nx: -ux, ny: -uy, halfLength: wallDepth, offset: wallWidth, rotation: 90
            });
            if (wallPlanJsonData[wall.movableRightId]) surfaces.push({
                tx: nx, ty: ny, nx: ux, ny: uy, halfLength: wallDepth, offset: wallWidth, rotation: 270
            });
            surfaces.forEach(surface => {
                if (halfWidth > surface.halfLength || dx * surface.nx + dy * surface.ny < 0) return;
                const along = Math.max(-surface.halfLength + halfWidth,
                    Math.min(surface.halfLength - halfWidth, dx * surface.tx + dy * surface.ty));
                const distance = surface.offset + halfDepth + .75;
                const target = {
                    x: center.x + surface.tx * along + surface.nx * distance,
                    y: center.y + surface.ty * along + surface.ny * distance
                };
                const delta = Math.hypot(target.x - point.x, target.y - point.y);
                if (delta <= threshold && (!best || delta < best.delta)) {
                    best = { target, delta, angle: (wall.angle || 0) + surface.rotation };
                }
            });
        });
        if (!best) return false;
        const nextAngle = ((best.angle % 360) + 360) % 360;
        const changedAngle = Math.abs((object.angle || 0) - nextAngle) > .01;
        object.set('angle', nextAngle);
        object.setPositionByOrigin(new fabric.Point(best.target.x, best.target.y), 'center', 'center');
        object.setCoords();
        if (changedAngle && object.crowdCircle) updateCrowdSemicircle(object);
        return true;
    };

    function bodyCorners(object) {
        const body = object.item?.(0);
        if (!body) return null;
        const matrix = body.calcTransformMatrix();
        return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) =>
            fabric.util.transformPoint(new fabric.Point(x * body.width / 2, y * body.height / 2), matrix));
    }
    function overlaps(first, second) {
        for (const polygon of [first, second]) {
            for (let index = 0; index < polygon.length; index++) {
                const a = polygon[index], b = polygon[(index + 1) % polygon.length];
                const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
                const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
                const p = first.map(point => point.x * nx + point.y * ny);
                const q = second.map(point => point.x * nx + point.y * ny);
                if (Math.min(Math.max(...p), Math.max(...q)) - Math.max(Math.min(...p), Math.min(...q)) <= .5) return false;
            }
        }
        return true;
    }
    window.getMovableWallCollisionScore = object => {
        if (currentViewMode !== 'floor' || (!object?.isArtwork && !object?.isMovableWall)) return 0;
        const corners = bodyCorners(object);
        if (!corners) return 0;
        return canvas.getObjects().filter(wall => wall !== object && wall.isMovableWall)
            .filter(wall => { const other = bodyCorners(wall); return other && overlaps(corners, other); }).length;
    };

    const onSelection = event => {
        const wall = event.selected?.[0];
        refreshPanel(wall);
        if (wall?.isMovableWall) window.activateToolPanel?.('movable-walls');
    };
    canvas.on('selection:created', onSelection);
    canvas.on('selection:updated', onSelection);
    canvas.on('selection:cleared', () => refreshPanel(null));
    canvas.on('object:modified', event => { if (event.target?.isMovableWall) refreshPanel(event.target); });
    document.addEventListener('DOMContentLoaded', () => {
        // A display-only overlay keeps wall bounds, snapping and saved geometry intact.
        faceLabelOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        faceLabelOverlay.id = 'movableWallFaceOverlay';
        faceLabelOverlay.setAttribute('aria-hidden', 'true');
        faceLabelOverlay.setAttribute('hidden', '');
        faceLabelOverlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:3';
        canvas.wrapperEl.appendChild(faceLabelOverlay);
        const visibility = document.getElementById('movableWallFaceVisibility');
        if (visibility) {
            visibility.checked = faceLabelsVisible;
            visibility.addEventListener('change', () => {
                faceLabelsVisible = visibility.checked;
                try { localStorage.setItem(faceLabelStorageKey, String(faceLabelsVisible)); } catch {}
                scheduleFaceLabels();
            });
        }
        window.addEventListener('resize', scheduleFaceLabels);
        scheduleFaceLabels();
        document.getElementById('btnAddMovableWall')?.addEventListener('click', addWall);
        document.getElementById('btnUpdateMovableWall')?.addEventListener('click', updateWall);
        document.getElementById('btnDeleteMovableWall')?.addEventListener('click', () => deleteSelectedWall());
        document.getElementById('btnMovableWallFront')?.addEventListener('click', () => { if (selected) handleWallSelectChange(selected.movableFrontId); });
        document.getElementById('btnMovableWallBack')?.addEventListener('click', () => { if (selected) handleWallSelectChange(selected.movableBackId); });
        document.getElementById('btnMovableWallLeft')?.addEventListener('click', () => openSideFace('left'));
        document.getElementById('btnMovableWallRight')?.addEventListener('click', () => openSideFace('right'));
    });
})();
