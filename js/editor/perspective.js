// 図面の位置と実寸から会場の3Dモデルを組み立て、展示物・照明を含むパースを描画します。
// The floor guide and perspective scene use the same venue wall positions.
(() => {
    // 縦方向の視野角50度から、透視投影と番号表示に共通の倍率を求めます。
    const perspectiveProjectionScale = 1 / Math.tan(50 * Math.PI / 360);
    const $ = id => document.getElementById(id);
    const loadAnchors = () => Object.fromEntries(Object.entries(wallPlanJsonData)
        .filter(([, wall]) => !wall.movableWallId && wall.planPosition)
        .map(([id, wall]) => [id, wall.planPosition]));
    const canLink = () => isAdminMode && window.CURATOR_ROLE !== 'viewer';
    const say = message => { $('perspectiveStatus').textContent = message; };
    const sayWall = message => { $('fixedWallPositionStatus').textContent = message; };
    let picker = null;
    let busy = false;
    let savingWallPosition = false;
    let renderer = null;
    let wallGuide = null;
    let guideFrame = null;
    let guideSignature = '';
    let floorWallSegments = [];
    let guideFloorId = null;
    const svgNamespace = 'http://www.w3.org/2000/svg';

    function scheduleWallGuide() {
        if (guideFrame === null) guideFrame = requestAnimationFrame(renderWallGuide);
    }
    window.refreshPerspectiveGuide = scheduleWallGuide;

    function renderWallGuide() {
        guideFrame = null;
        if (currentViewMode !== 'floor' || isTransitioning || !window.isDiagramReady?.() ||
            !(configuredScale > 0) || picker) {
            if (wallGuide) wallGuide.hidden = true;
            floorWallSegments = [];
            return;
        }
        const detailed = Boolean(document.querySelector('[data-tool-panel="perspective"].is-open, [data-tool-panel="setup"].is-open'));
        const selected = detailed && canLink() ? $('perspectiveWall').value : '';
        const walls = window.getFixedWallSegments(selectedFloorId, configuredScale).map(segment => ({
            ...segment, title: wallPlanJsonData[segment.id].title || '固定壁', active: segment.id === selected
        }));
        guideFloorId = selectedFloorId;
        floorWallSegments = walls;
        const width = canvas.getWidth(), height = canvas.getHeight();
        const zoom = canvas.wrapperEl.getBoundingClientRect().width / width || 1;
        const signature = JSON.stringify([width, height, zoom, detailed, walls]);
        if (!wallGuide) {
            wallGuide = document.createElement('div');
            wallGuide.className = 'perspective-registered-guide';
            wallGuide.setAttribute('aria-hidden', 'true');
            canvas.wrapperEl.appendChild(wallGuide);
        }
        wallGuide.hidden = !walls.length;
        if (guideSignature === signature) return;
        guideSignature = signature;
        const element = (tag, attrs = {}) => {
            const node = document.createElementNS(svgNamespace, tag);
            for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
            return node;
        };
        const svg = element('svg', { viewBox: '0 0 ' + width + ' ' + height, preserveAspectRatio: 'none' });
        for (const { start, end, faceSide, title, active } of walls) {
            const group = element('g', { class: 'perspective-registered-wall' + (active ? ' active' : '') + (detailed ? '' : ' subtle') });
            group.appendChild(element('line', { x1: start.x, y1: start.z, x2: end.x, y2: end.z,
                'vector-effect': 'non-scaling-stroke' }));
            svg.appendChild(group);
            if (!detailed) continue;
            for (const point of [start, end]) group.appendChild(element('circle', {
                cx: point.x, cy: point.z, r: 3 / zoom, 'vector-effect': 'non-scaling-stroke'
            }));
            const direction = unit(start, end);
            const x = (start.x + end.x) / 2, y = (start.z + end.z) / 2;
            const side = faceSide === -1 ? -1 : 1;
            const offsetX = -direction.z * side / zoom, offsetY = direction.x * side / zoom;
            group.appendChild(element('line', { x1: x, y1: y, x2: x + offsetX * 7, y2: y + offsetY * 7,
                'vector-effect': 'non-scaling-stroke' }));
            const label = element('text', { x: x + offsetX * 16, y: y + offsetY * 16, 'font-size': 11 / zoom,
                'stroke-width': 3 / zoom, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
            label.textContent = title;
            group.appendChild(label);
        }
        wallGuide.replaceChildren(svg);
    }

    window.getFixedWallAtPointer = event => {
        if (event.target || event.e?.altKey || event.e?.button > 0 || picker ||
            currentViewMode !== 'floor' || guideFloorId !== selectedFloorId || isTransitioning ||
            isFreeDrawingMode || isMeasuringMode || isDimensionDrawingMode ||
            window.isLightingPlacementActive?.() || window.isCombinedPdfBusy || !floorWallSegments.length) return null;
        const pointer = canvas.getPointer(event.e);
        const zoom = canvas.wrapperEl.getBoundingClientRect().width / canvas.getWidth() || 1;
        let closest = null;
        let limit = (window.matchMedia('(pointer: coarse)').matches ? 13 : 7) / zoom;
        for (const wall of floorWallSegments) {
            if (!wallPlanJsonData[wall.id]?.planPosition) continue;
            const { start, end } = wall;
            const dx = end.x - start.x, dz = end.z - start.z;
            const t = Math.max(0, Math.min(1, ((pointer.x - start.x) * dx + (pointer.y - start.z) * dz) / (dx * dx + dz * dz)));
            const distance = Math.hypot(pointer.x - start.x - t * dx, pointer.y - start.z - t * dz);
            if (distance < limit) { closest = wall; limit = distance; }
        }
        return closest;
    };

    function resolveWallEnds(id, anchors, scale, visited = new Set()) {
        const wall = wallPlanJsonData[id], anchor = anchors[id];
        if (!wall || wall.movableWallId || !anchor?.start || !anchor.end ||
            anchor.floorId !== getWallFloorId(wall) || visited.has(id)) return null;
        const length = Number(wall.widthCm) * scale;
        const direction = unit(anchor.start, anchor.end);
        if (!(length > 0) || !Number.isFinite(direction.x)) return null;
        const connection = anchor.connection;
        let attached = null;
        if (connection && anchors[connection.wallId]?.floorId === anchor.floorId) {
            attached = resolveWallEnds(connection.wallId, anchors, scale, new Set([...visited, id]))?.[connection.endpoint];
        }
        if (anchor.joinedEnd === 'end') {
            const end = attached || anchor.end;
            return { start: { x: end.x - direction.x * length, z: end.z - direction.z * length }, end };
        }
        const start = attached || anchor.start;
        return { start, end: { x: start.x + direction.x * length, z: start.z + direction.z * length } };
    }

    window.getFixedWallSegments = (floorId, scale) => {
        const anchors = loadAnchors();
        return Object.entries(anchors).flatMap(([id, anchor]) => {
            if (anchor.floorId !== floorId) return [];
            const ends = resolveWallEnds(id, anchors, scale);
            return ends ? [{ id, ...ends, faceSide: anchor.faceSide }] : [];
        });
    };

    function dependsOnWall(id, target, anchors) {
        const seen = new Set();
        while (id && !seen.has(id)) {
            if (id === target) return true;
            seen.add(id);
            id = anchors[id]?.connection?.wallId;
        }
        return false;
    }

    function cancelPick() {
        if (!picker) return;
        const kind = picker.dataset.kind;
        picker.remove();
        picker = null;
        scheduleWallGuide();
        if (kind === 'wall') sayWall('');
        else say('平面図で立つ位置 → 見る方向の順に指定します。');
    }
    window.cancelPerspectivePick = cancelPick;

    window.refreshPerspectiveControls = () => {
        const select = $('perspectiveWall');
        if (!select) return;
        $('perspectiveWallSettings').hidden = !canLink();
        const previous = select.value;
        const anchors = loadAnchors();
        const walls = Object.entries(wallPlanJsonData).filter(([, wall]) =>
            !wall.movableWallId && getWallFloorId(wall) === selectedFloorId);
        select.replaceChildren(...walls.map(([id, wall]) =>
            new Option(wall.title + (anchors[id] ? '（登録済み）' : ''), id)));
        if (walls.some(([id]) => id === previous)) select.value = previous;
        $('btnLinkPerspectiveWall').disabled = !walls.length || !canLink() || savingWallPosition;
        updateUnlinkButton();
        scheduleWallGuide();
    };

    function updateUnlinkButton() {
        $('btnUnlinkPerspectiveWall').disabled = !canLink() || savingWallPosition || !loadAnchors()[$('perspectiveWall').value];
    }

    async function saveWallPositions(floorId, changes, message) {
        savingWallPosition = true;
        window.refreshPerspectiveControls();
        try {
            const saved = await window.saveVenueWallPositions(floorId, changes);
            sayWall(saved ? message : '位置を保存できませんでした。共通壁の保存状態を確認してください。');
        } catch (error) {
            console.error('固定壁の位置を保存できませんでした。', error);
            sayWall('位置を保存できませんでした。共通壁の保存状態を確認してください。');
        } finally {
            savingWallPosition = false;
            window.refreshPerspectiveControls();
        }
    }

    async function unlinkWall() {
        if (!canLink() || savingWallPosition || busy || isTransitioning) return;
        const id = $('perspectiveWall').value;
        const wall = wallPlanJsonData[id];
        const anchors = loadAnchors();
        if (!wall || getWallFloorId(wall) !== selectedFloorId || !anchors[id]) return;
        if (!confirm('「' + wall.title + '」の共通の位置登録を解除しますか？ 壁面図と作品配置は残ります。')) return;
        cancelPick();
        const detached = Object.entries(anchors)
            .filter(([, anchor]) => anchor?.connection?.wallId === id)
            .map(([otherId, anchor]) => [otherId, anchor, resolveWallEnds(otherId, anchors, configuredScale)]);
        const changes = Object.fromEntries(detached.map(([otherId, anchor, ends]) =>
            [otherId, { ...anchor, ...(ends || {}), connection: null }]));
        changes[id] = null;
        await saveWallPositions(selectedFloorId, changes, '位置登録を解除しました。');
    }

    async function pickPoints(kind) {
        if (busy || isTransitioning || window.isCombinedPdfBusy || (kind === 'wall' && (!canLink() || savingWallPosition))) return;
        cancelPick();
        window.cancelMovableWallSlotPick?.();
        window.cancelDimensionDrawing?.();
        window.cancelLightingPlacement?.();
        if (isFreeDrawingMode) toggleFreeDrawingMode(false);
        if (currentViewMode !== 'floor' && !await switchViewMode('floor')) return;
        if (!window.isDiagramReady?.()) return;
        const status = kind === 'wall' ? sayWall : say;
        if (!(configuredScale > 0)) return status('先に平面図の縮尺を設定してください。');
        const wallId = $('perspectiveWall').value;
        if (kind === 'wall' && !wallPlanJsonData[wallId]) return;
        if (kind === 'wall' && !(Number(wallPlanJsonData[wallId].widthCm) > 0)) return say('壁の長さを登録してください。');
        const eyeHeight = mmToCm($('perspectiveEyeHeight').value);
        if (kind === 'camera' && !(eyeHeight >= 50 && eyeHeight <= 250)) {
            return say('視点の高さは500〜2500 mmで指定してください。');
        }
        const overlay = document.createElement('div');
        overlay.className = 'perspective-picker';
        overlay.dataset.kind = kind;
        canvas.wrapperEl.appendChild(overlay);
        picker = overlay;
        scheduleWallGuide();
        const floorId = selectedFloorId;
        const length = Number(wallPlanJsonData[wallId]?.widthCm) * configuredScale;
        const anchors = kind === 'wall' ? loadAnchors() : {};
        const segments = Object.keys(anchors).flatMap(id => {
            if (anchors[id]?.floorId !== floorId || id === wallId) return [];
            const ends = resolveWallEnds(id, anchors, configuredScale);
            return ends ? [{ id, ends, snap: !dependsOnWall(id, wallId, anchors) }] : [];
        });
        const endpoints = segments.filter(segment => segment.snap).flatMap(({ id, ends }) =>
            ['start', 'end'].map(endpoint => ({ wallId: id, endpoint, point: ends[endpoint] })));
        let first = null;
        let second = null;
        let connection = null;
        let cameraPointer = null;
        let previewCameraDirection = () => {};
        const coordinates = event => {
            const bounds = overlay.getBoundingClientRect();
            const x = (event.clientX - bounds.left) / bounds.width;
            const z = (event.clientY - bounds.top) / bounds.height;
            return { x: x * canvas.getWidth(), z: z * canvas.getHeight() };
        };
        const wallEnd = point => {
            const dx = point.x - first.x, dz = point.z - first.z;
            return Math.abs(dx) >= Math.abs(dz)
                ? { x: first.x + (dx < 0 ? -length : length), z: first.z }
                : { x: first.x, z: first.z + (dz < 0 ? -length : length) };
        };
        if (kind === 'wall') {
            const namespace = 'http://www.w3.org/2000/svg';
            const guide = document.createElementNS(namespace, 'svg');
            guide.classList.add('perspective-wall-guide');
            guide.setAttribute('viewBox', '0 0 ' + canvas.getWidth() + ' ' + canvas.getHeight());
            guide.setAttribute('preserveAspectRatio', 'none');
            guide.setAttribute('aria-hidden', 'true');
            overlay.appendChild(guide);
            const line = (className, a, b) => {
                const element = document.createElementNS(namespace, 'line');
                element.setAttribute('class', className);
                element.setAttribute('vector-effect', 'non-scaling-stroke');
                guide.appendChild(element);
                if (a && b) positionLine(element, a, b);
                return element;
            };
            function positionLine(element, a, b) {
                element.setAttribute('x1', a.x);
                element.setAttribute('y1', a.z);
                element.setAttribute('x2', b.x);
                element.setAttribute('y2', b.z);
            }
            for (const { ends } of segments) line('perspective-wall-existing', ends.start, ends.end);
            for (const { point } of endpoints) line('perspective-wall-endpoint', point, point);
            const snapMarker = line('perspective-wall-endpoint perspective-wall-endpoint-active');
            snapMarker.style.display = 'none';
            function nearestEndpoint(point) {
                const zoom = overlay.getBoundingClientRect().width / canvas.getWidth() || 1;
                let closest = 22 / zoom;
                let match = null;
                for (const endpoint of endpoints) {
                    const distance = Math.hypot(endpoint.point.x - point.x, endpoint.point.z - point.z);
                    if (distance < closest) { closest = distance; match = endpoint; }
                }
                return match;
            }
            const preview = line('perspective-wall-preview');
            const faceGuide = line('perspective-wall-preview');
            const showSide = point => {
                const direction = unit(first, second);
                const side = Math.sign(direction.x * (point.z - first.z) - direction.z * (point.x - first.x));
                const offset = 14 / (overlay.getBoundingClientRect().width / canvas.getWidth() || 1);
                const middle = { x: (first.x + second.x) / 2, z: (first.z + second.z) / 2 };
                positionLine(faceGuide, middle, { x: middle.x - side * direction.z * offset, z: middle.z + side * direction.x * offset });
                return side;
            };
            overlay.addEventListener('pointermove', event => {
                const point = coordinates(event);
                if (second) showSide(point);
                else if (first) positionLine(preview, first, wallEnd(point));
                else {
                    const endpoint = nearestEndpoint(point);
                    snapMarker.style.display = endpoint ? '' : 'none';
                    if (endpoint) positionLine(snapMarker, endpoint.point, endpoint.point);
                }
            });
            overlay.addEventListener('pointerdown', event => {
                if (event.button !== 0 || !event.isPrimary || floorId !== selectedFloorId || currentViewMode !== 'floor' || !canLink()) return;
                event.preventDefault();
                const point = coordinates(event);
                if (!first) {
                    connection = nearestEndpoint(point);
                    first = connection?.point || point;
                    snapMarker.style.display = 'none';
                    addMarker(first);
                    sayWall((connection ? '壁の端に接続しました。' : '') + '壁を伸ばす方向（上下左右）を指定してください。');
                    return;
                }
                if (!second) {
                    if (Math.hypot(point.x - first.x, point.z - first.z) < 2) return;
                    second = wallEnd(point);
                    positionLine(preview, first, second);
                    sayWall('平面図で、作品を展示する側をクリックしてください。');
                    return;
                }
                const side = showSide(point);
                if (!side) return;
                cancelPick();
                void saveWallPositions(floorId, { [wallId]: {
                    floorId, start: first, end: second, faceSide: side,
                    connection: connection ? { wallId: connection.wallId, endpoint: connection.endpoint } : null
                } }, '壁の位置を会場設定に保存しました。');
            });
            sayWall('壁の端を指定してください。登録済みの壁の端につなげられます。');
            return;
        } else {
            const guide = document.createElementNS(svgNamespace, 'svg');
            guide.classList.add('perspective-wall-guide');
            guide.setAttribute('viewBox', '0 0 ' + canvas.getWidth() + ' ' + canvas.getHeight());
            guide.setAttribute('preserveAspectRatio', 'none');
            guide.setAttribute('aria-hidden', 'true');
            const outline = document.createElementNS(svgNamespace, 'path');
            const arrow = document.createElementNS(svgNamespace, 'path');
            outline.classList.add('perspective-camera-arrow-outline');
            arrow.classList.add('perspective-camera-arrow');
            for (const path of [outline, arrow]) path.setAttribute('vector-effect', 'non-scaling-stroke');
            guide.append(outline, arrow);
            overlay.append(guide);
            previewCameraDirection = point => {
                if (!first) return;
                const dx = point.x - first.x, dz = point.z - first.z;
                const distance = Math.hypot(dx, dz);
                if (distance < 2) {
                    outline.removeAttribute('d');
                    arrow.removeAttribute('d');
                    return;
                }
                const zoom = overlay.getBoundingClientRect().width / canvas.getWidth() || 1;
                const head = Math.min(12 / zoom, distance * .4);
                const ux = dx / distance, uz = dz / distance;
                const bx = point.x - ux * head, bz = point.z - uz * head;
                const wing = head * .48;
                const d = `M${first.x} ${first.z}L${point.x} ${point.z}M${bx - uz * wing} ${bz + ux * wing}L${point.x} ${point.z}L${bx + uz * wing} ${bz - ux * wing}`;
                outline.setAttribute('d', d);
                arrow.setAttribute('d', d);
            };
            overlay.addEventListener('pointermove', event => {
                if (event.isPrimary) previewCameraDirection(coordinates(event));
            });
            overlay.addEventListener('pointerup', event => {
                if (cameraPointer !== event.pointerId) return;
                cameraPointer = null;
                const point = coordinates(event);
                if (Math.hypot(point.x - first.x, point.z - first.z) < 2) return;
                cancelPick();
                showPerspective(first, point, eyeHeight);
            });
            overlay.addEventListener('pointercancel', () => {
                cameraPointer = null;
                if (first) previewCameraDirection(first);
            });
        }
        say('立つ位置を指定してください。');
        function addMarker(point) {
            const marker = document.createElement('span');
            marker.style.left = point.x / canvas.getWidth() * 100 + '%';
            marker.style.top = point.z / canvas.getHeight() * 100 + '%';
            overlay.appendChild(marker);
        }
        overlay.addEventListener('pointerdown', event => {
            if (event.button !== 0 || !event.isPrimary || currentViewMode !== 'floor' || floorId !== selectedFloorId) return;
            event.preventDefault();
            const point = coordinates(event);
            if (!first) {
                first = point;
                addMarker(first);
                say('見る方向を指定してください。');
                return;
            }
            if (event.pointerType !== 'mouse') {
                cameraPointer = event.pointerId;
                overlay.setPointerCapture(event.pointerId);
                previewCameraDirection(point);
                return;
            }
            if (Math.hypot(point.x - first.x, point.z - first.z) < 2) return;
            cancelPick();
            showPerspective(first, point, eyeHeight);
        });
    }

    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const subtract = (a, b) => a.map((value, i) => value - b[i]);
    const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
    function meshFace(out, corners, color, opacity = [1, 1, 1, 1]) {
        const [a, b, c, d] = corners;
        const normal = cross(subtract(b, a), subtract(d || c, a));
        const size = Math.hypot(...normal);
        if (!(size > 0)) return;
        const direction = normal.map(value => value / size);
        for (const i of d ? [0, 1, 2, 0, 2, 3] : [0, 1, 2]) out.push(...corners[i], ...direction, ...color, opacity[i]);
    }
    const quad = (out, a, b, c, d, color, opacity) => meshFace(out, [a, b, c, d], color, opacity);
    // A soft contact shadow around a floor footprint, without a full scene light simulation.
    function contactShadow(out, points, spread = 18) {
        const outer = points.map((point, i) => {
            const fromPrevious = unit(points[(i + points.length - 1) % points.length], point);
            const fromNext = unit(points[(i + 1) % points.length], point);
            return { x: point.x + spread * (fromPrevious.x + fromNext.x),
                z: point.z + spread * (fromPrevious.z + fromNext.z) };
        });
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            quad(out, pointAt(points[i], .25), pointAt(points[j], .25),
                pointAt(outer[j], .25), pointAt(outer[i], .25), [.07, .09, .1], [.36, .36, 0, 0]);
        }
    }
    const pointAt = (p, height) => [p.x, height, p.z];
    const colors = {
        floor: [.18, .12, .10], ceiling: [.32, .33, .35], rail: [.035, .036, .038], wall: [.49, .47, .44],
        artwork: [.78, .77, .73], frame: [.21, .18, .15], plinth: [.43, .44, .43],
        caseMetal: [.48, .51, .52], glass: [.64, .78, .82], ink: [.055, .06, .065],
        wallExhibition: [.59, .54, .45]
    };
    const digits = ['012345', '12', '01643', '01236', '5612', '05623', '056234', '012', '0123456', '012356'];
    const segments = [[1,0,5,1],[5,1,6,4],[5,5,6,8],[1,8,5,9],[0,5,1,8],[0,1,1,4],[1,4,5,5]];
    function numberOnFace(out, number, a, b, d, markBottom = false) {
        const value = String(number ?? '');
        if (!/^\d{1,6}$/.test(value)) return;
        const p = (u, v) => a.map((coordinate, i) => coordinate + (b[i] - coordinate) * u + (d[i] - coordinate) * v);
        const unit = Math.min(.07, .74 / (value.length * 7));
        const left = (.999 - (value.length * 7 - 1) * unit) / 2;
        [...value].forEach((digit, i) => {
            for (const segment of digits[Number(digit)]) {
                const [x1, y1, x2, y2] = segments[Number(segment)];
                const u = x => left + (i * 7 + x) * unit;
                const v = y => .25 + y / 18;
                quad(out, p(u(x1), v(y1)), p(u(x2), v(y1)), p(u(x2), v(y2)), p(u(x1), v(y2)), colors.ink);
            }
        });
        if (markBottom) {
            const right = left + (value.length * 7 - 1) * unit;
            quad(out, p(left,.81), p(right,.81), p(right,.84), p(left,.84), colors.ink);
        }
    }

    function addDisplayCase(vertices, glass, points, height, number) {
        const base = height * .6;
        const lift = Math.min(.05, height * .002);
        const p = (u, v, y) => [
            points[0].x + (points[1].x - points[0].x) * u + (points[3].x - points[0].x) * v,
            y,
            points[0].z + (points[1].z - points[0].z) * u + (points[3].z - points[0].z) * v
        ];
        // The case, tray and manuscript all fit inside the entered dimensions.
        quad(vertices, p(.03,.03,base+lift), p(.97,.03,base+lift),
            p(.97,.97,base+lift), p(.03,.97,base+lift), [.64,.62,.57]);
        const pageHeight = base + Math.min(2, height * .015);
        quad(vertices, p(.16,.2,base+lift*2), p(.5,.2,pageHeight),
            p(.5,.8,pageHeight), p(.16,.8,base+lift*2), colors.artwork);
        quad(vertices, p(.5,.2,pageHeight), p(.84,.2,base+lift*2),
            p(.84,.8,base+lift*2), p(.5,.8,pageHeight), [.73,.72,.68]);
        numberOnFace(vertices, number, p(.78,.78,pageHeight+lift),
            p(.22,.78,pageHeight+lift), p(.78,.22,pageHeight+lift), true);
        const edges = [[0,0,1,0], [1,0,1,1], [1,1,0,1], [0,1,0,0]];
        const band = Math.min(height * .012, 1.2);
        for (const [u,v,U,V] of edges) {
            quad(glass, p(u,v,base), p(U,V,base), p(U,V,height), p(u,v,height), colors.glass, [.12,.12,.12,.12]);
            for (const y of [base, height - band]) {
                quad(vertices, p(u,v,y), p(U,V,y), p(U,V,y+band), p(u,v,y+band), colors.caseMetal);
            }
            const inset = .012;
            quad(vertices, p(u,v,base), p(u+(U-u)*inset,v+(V-v)*inset,base),
                p(u+(U-u)*inset,v+(V-v)*inset,height), p(u,v,height), colors.caseMetal);
        }
        quad(glass, p(0,0,height), p(1,0,height), p(1,1,height), p(0,1,height),
            colors.glass, [.1,.1,.1,.1]);
        const left = points[3], right = points[2];
        const facing = unit(left, right);
        const label = (u, y) => [left.x + (right.x-left.x)*u - facing.z*.08,
            y, left.z + (right.z-left.z)*u + facing.x*.08];
        quad(vertices, label(.37,base*.83), label(.63,base*.83),
            label(.63,base*.53), label(.37,base*.53), colors.artwork);
        const front = (u, y) => {
            const point = label(u,y);
            point[0] -= facing.z*.02;
            point[2] += facing.x*.02;
            return point;
        };
        numberOnFace(vertices, number, front(.37,base*.83), front(.63,base*.83), front(.37,base*.53), true);
    }

    function addHangingArtwork(vertices, points, artwork, ceiling) {
        const height = Number(artwork.cmHeight), drop = hangingArtworkDropCm(artwork);
        const top = ceiling-drop, bottom = top-height;
        if (!Number.isFinite(drop) || drop < 0 || !(height > 0) || bottom < 0) return null;
        const panel = artwork.displayType === 'hanging-panel';
        const material = panel ? colors.frame : [.61,.62,.58];
        for (let i = 0; i < 4; i++) {
            const a = points[i], b = points[(i+1)%4];
            quad(vertices,pointAt(a,top),pointAt(b,top),pointAt(b,bottom),pointAt(a,bottom),
                i%2 ? material.map(value => value*.86) : material);
        }
        quad(vertices,...points.map(point => pointAt(point,top)),material);
        quad(vertices,...points.slice().reverse().map(point => pointAt(point,bottom)),material);
        for (const [a,b] of [[points[3],points[2]],[points[1],points[0]]]) {
            const direction = unit(a,b);
            const width = Math.hypot(b.x-a.x,b.z-a.z);
            const p = (u,v,offset) => [a.x+(b.x-a.x)*u-direction.z*offset,
                top-height*v,a.z+(b.z-a.z)*u+direction.x*offset];
            const border = Math.min(4,width*.04,height*.04);
            const insetX = panel ? border/width : .22;
            const insetY = panel ? border/height : .25;
            quad(vertices,p(insetX,insetY,.03),p(1-insetX,insetY,.03),
                p(1-insetX,1-insetY,.03),p(insetX,1-insetY,.03),colors.artwork);
            numberOnFace(vertices,artwork.artworkNumber,p(insetX,insetY,.08),
                p(1-insetX,insetY,.08),p(insetX,1-insetY,.08),true);
        }
        for (const along of panel ? [.15,.85] : [.5]) {
            const anchor = {
                x: points[0].x+(points[1].x-points[0].x)*along+(points[3].x-points[0].x)*.5,
                z: points[0].z+(points[1].z-points[0].z)*along+(points[3].z-points[0].z)*.5
            };
            for (let side = 0; side < 8; side++) {
                const a = side*Math.PI/4, b = (side+1)*Math.PI/4;
                const p = (angle,y) => [anchor.x+Math.cos(angle)*.23,y,anchor.z+Math.sin(angle)*.23];
                quad(vertices,p(a,ceiling),p(b,ceiling),p(b,top),p(a,top),[.19,.20,.20]);
            }
        }
        const [left,right] = [points[3],points[2]];
        const front = unit(left,right);
        return { object: artwork, normal: [-front.z,0,front.x], depth: 0,
            point: (x,y) => [left.x+(right.x-left.x)*x,bottom+height*y,left.z+(right.z-left.z)*x] };
    }

    function sculptureBasePoints(points, shape) {
        if (!['circle', 'ellipse'].includes(shape)) return points;
        return Array.from({ length: 32 }, (_, index) => {
            const angle = index * Math.PI * 2 / 32;
            const u = .5 + .5 * Math.cos(angle), v = .5 + .5 * Math.sin(angle);
            return { x: points[0].x + (points[1].x-points[0].x)*u + (points[3].x-points[0].x)*v,
                z: points[0].z + (points[1].z-points[0].z)*u + (points[3].z-points[0].z)*v };
        });
    }

    function addSculpture(vertices, points, height, number, shape = 'rectangle', pedestal = null) {
        const assembly = normalizeSculpturePedestal(pedestal);
        const baseHeight = assembly?.baseHeightCm ?? height * .16;
        const width = Math.hypot(points[1].x-points[0].x, points[1].z-points[0].z);
        const depth = Math.hypot(points[3].x-points[0].x, points[3].z-points[0].z);
        const basePoint = (u, v, y) => [
            points[0].x + (points[1].x - points[0].x) * u + (points[3].x - points[0].x) * v,
            y * height,
            points[0].z + (points[1].z - points[0].z) * u + (points[3].z - points[0].z) * v
        ];
        const p = assembly ? (u,v,y) => basePoint(
            .5 + (u-.5)*assembly.workWidthCm/(.92*width),
            .5 + (v-.51)*assembly.workDepthCm/(.56*depth),
            (baseHeight + assembly.columnHeightCm + (y-.16)/.84*assembly.workHeightCm)/height
        ) : basePoint;
        const basePoints = sculptureBasePoints(points, shape);
        const center = basePoint(.5,.5,baseHeight/height);
        for (let i = 0; i < basePoints.length; i++) {
            const a = basePoints[i], b = basePoints[(i+1) % basePoints.length];
            const shade = .82 + .18 * Math.max(0, Math.cos(i * Math.PI * 2 / basePoints.length));
            quad(vertices, pointAt(a,0), pointAt(b,0), pointAt(b,baseHeight), pointAt(a,baseHeight),
                colors.plinth.map(value => value * shade));
            meshFace(vertices, [center, pointAt(a,baseHeight), pointAt(b,baseHeight)], colors.plinth);
        }
        if (assembly) {
            const columnWidth = Math.min(width*.6, Math.max(width*.2,assembly.workWidthCm*1.1))/width;
            const columnDepth = Math.min(depth*.6, Math.max(depth*.2,assembly.workDepthCm*1.1))/depth;
            const corners = [[-1,-1],[1,-1],[1,1],[-1,1]];
            const bottom = corners.map(([u,v]) => basePoint(.5+u*columnWidth/2,.5+v*columnDepth/2,baseHeight/height));
            const top = corners.map(([u,v]) => basePoint(.5+u*columnWidth/2,.5+v*columnDepth/2,(baseHeight+assembly.columnHeightCm)/height));
            for (let i = 0; i < 4; i++) {
                const j = (i+1)%4;
                quad(vertices,bottom[i],bottom[j],top[j],top[i],i%2 ? [.47,.48,.47] : [.56,.57,.55]);
            }
            quad(vertices,...top,[.62,.63,.60]);
        }
        // The plinth and stylized bust share the artwork's overall dimensions.
        const rings = [
            [.16,.24,.22], [.32,.34,.27], [.48,.46,.25], [.59,.16,.14], [.64,.11,.12],
            [.68,.18,.18], [.80,.23,.23], [.91,.19,.20], [1,0,0]
        ];
        const ringPoint = ([y, width, depth], angle) => p(.5 + width * Math.cos(angle), .5 + depth * Math.sin(angle), y);
        const sides = 16;
        for (let row = 0; row < rings.length - 1; row++) {
            for (let side = 0; side < sides; side++) {
                const angle = side * Math.PI * 2 / sides;
                const nextAngle = (side + 1) * Math.PI * 2 / sides;
                const shade = .78 + .22 * Math.max(0, Math.cos(angle - Math.PI / 3));
                const color = [.64,.62,.57].map(value => value * shade);
                const a = ringPoint(rings[row], angle), b = ringPoint(rings[row], nextAngle);
                const c = ringPoint(rings[row+1], nextAngle), d = ringPoint(rings[row+1], angle);
                if (row === rings.length - 2) meshFace(vertices, [a,b,c], color);
                else quad(vertices, a,b,c,d, color);
            }
        }
        const noseTop = p(.5,.70,.84), noseTip = p(.5,.79,.78);
        const noseLeft = p(.465,.715,.75), noseRight = p(.535,.715,.75);
        meshFace(vertices, [noseTop,noseLeft,noseTip], [.55,.53,.49]);
        meshFace(vertices, [noseTop,noseTip,noseRight], [.62,.60,.55]);
        meshFace(vertices, [noseLeft,noseRight,noseTip], [.49,.47,.43]);
        return { number, x: (points[0].x + points[2].x) / 2,
            z: (points[0].z + points[2].z) / 2, height: baseHeight,
            radius: assembly ? Math.hypot(Math.max(width,assembly.workWidthCm),Math.max(depth,assembly.workDepthCm))/2
                : Math.hypot(points[2].x-points[0].x, points[2].z-points[0].z)/2 };
    }

    function renderPerspective(vertices, shadows, spots, start, direction, eyeHeight, pitch = 0, glass = [], sculptureLabels = []) {
        const surface = $('perspectiveCanvas');
        if (!renderer) {
            const gl = surface.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
            if (!gl) throw new Error('このブラウザーでは3D描画を利用できません。');
            const compile = (type, source) => {
                const shader = gl.createShader(type);
                gl.shaderSource(shader, source);
                gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('3D描画を準備できませんでした。');
                return shader;
            };
            const program = gl.createProgram();
            const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ? 'highp' : 'mediump';
            gl.attachShader(program, compile(gl.VERTEX_SHADER, [
                'precision ' + precision + ' float;',
                'attribute vec3 p; attribute vec3 n; attribute vec4 c;',
                'varying vec3 position; varying vec3 normal; varying vec4 color;',
                'uniform float aspect; uniform float projectionScale;',
                'void main(){',
                'position=p; normal=n; color=c;',
                'gl_Position=vec4(p.x*projectionScale/aspect,p.y*projectionScale,p.z*1.000004-4.000008,p.z);',
                '}'
            ].join('\n')));
            gl.attachShader(program, compile(gl.FRAGMENT_SHADER, [
                'precision ' + precision + ' float;',
                'varying vec3 position; varying vec3 normal; varying vec4 color;',
                'uniform int lightPass; uniform vec3 lightPosition; uniform vec3 lightDirection;',
                'uniform vec3 patchCenter; uniform vec3 patchNormal; uniform vec3 patchLong; uniform vec3 patchCross;',
                'uniform vec3 patchSize; uniform bool fixedPatch;',
                'uniform bool useLightDepth; uniform sampler2D lightDepth;',
                'uniform vec3 lightRight; uniform vec3 lightUp;',
                'void main(){',
                'if(lightPass==0){gl_FragColor=color;return;}',
                'vec3 ray=lightPosition-position;',
                'float distanceMeters=max(length(ray/100.0),0.01);',
                'vec3 towardLight=(ray/100.0)/distanceMeters;',
                'float cone=smoothstep(0.9681,0.9998,dot(-towardLight,lightDirection));',
                'vec3 facing=dot(normal,-position)>=0.0?normal:-normal;',
                'float intensity=cone*max(dot(facing,towardLight),0.0)/(1.0+0.022*distanceMeters*distanceMeters);',
                'if(fixedPatch) intensity=0.0;',
                'if(patchSize.x>0.0 && abs(dot(normal,patchNormal))>0.995){',
                'vec3 offset=position-patchCenter;',
                'if(abs(dot(offset,patchNormal))<=patchSize.z){',
                'vec2 uv=vec2(dot(offset,patchLong)/patchSize.x,dot(offset,patchCross)/patchSize.y);',
                'float meters=length((patchCenter-lightPosition)/100.0);',
                'float strength=fixedPatch?0.72*step(0.995,dot(facing,patchNormal)):max(dot(facing,-lightDirection),0.0)/(1.0+0.022*meters*meters);',
                'intensity=(1.0-smoothstep(0.18,1.0,length(uv)))*strength;',
                '}',
                '}',
                'if(useLightDepth && intensity>0.0){',
                'vec3 delta=position-lightPosition;',
                'float depth=dot(delta,lightDirection);',
                'if(depth>2.0 && depth<6000.0){',
                'vec2 uv=vec2(dot(delta,lightRight),dot(delta,lightUp))/depth*0.5+0.5;',
                'if(all(greaterThanEqual(uv,vec2(0.0))) && all(lessThanEqual(uv,vec2(1.0)))){',
                'vec2 stored=texture2D(lightDepth,uv).rg;',
                'float barrier=(stored.x+stored.y/255.0)*6000.0;',
                'float bias=2.0+0.009*depth;',
                'intensity*=1.0-smoothstep(bias,bias+5.0,depth-barrier);',
                '}',
                '}',
                '}',
                'vec3 reflectance=clamp(color.rgb*2.25,0.0,1.0);',
                'gl_FragColor=vec4(reflectance*vec3(0.68,0.65,0.59)*intensity,0.0);',
                '}'
            ].join('\n')));
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('3D描画を準備できませんでした。');
            const depthProgram = gl.createProgram();
            gl.attachShader(depthProgram, compile(gl.VERTEX_SHADER, [
                'precision ' + precision + ' float;',
                'attribute vec3 p; uniform vec3 source; uniform vec3 axis; uniform vec3 right; uniform vec3 up;',
                'varying float depth;',
                'void main(){vec3 v=p-source; depth=dot(v,axis);',
                'gl_Position=vec4(dot(v,right),dot(v,up),depth*1.000667-4.001334,depth);}'
            ].join('\n')));
            gl.attachShader(depthProgram, compile(gl.FRAGMENT_SHADER, [
                'precision ' + precision + ' float; varying float depth;',
                'void main(){float value=clamp(depth/6000.0,0.0,1.0)*255.0;',
                'gl_FragColor=vec4(floor(value)/255.0,fract(value),0.0,1.0);}'
            ].join('\n')));
            gl.linkProgram(depthProgram);
            // Keep the optional light depth map separate from the camera's depth buffer.
            const resolution = 512;
            const depthTexture = gl.createTexture(), depthBuffer = gl.createRenderbuffer(), depthFrame = gl.createFramebuffer();
            gl.bindTexture(gl.TEXTURE_2D, depthTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, resolution, resolution, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, resolution, resolution);
            gl.bindFramebuffer(gl.FRAMEBUFFER, depthFrame);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, depthTexture, 0);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
            const canMapDepth = gl.getProgramParameter(depthProgram, gl.LINK_STATUS) &&
                gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.bindRenderbuffer(gl.RENDERBUFFER, null);
            gl.bindTexture(gl.TEXTURE_2D, null);
            renderer = { gl, program, buffer: gl.createBuffer(), shadowBuffer: gl.createBuffer(), glassBuffer: gl.createBuffer(), labelBuffer: gl.createBuffer(),
                depthMap: canMapDepth ? { program: depthProgram, texture: depthTexture, frame: depthFrame, resolution } : null };
        }
        const { gl, program, buffer, shadowBuffer, glassBuffer, labelBuffer, depthMap } = renderer;
        // Plan coordinates increase down the page; the camera transform also applies to light rays.
        const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
        const toViewVector = ([x, y, z]) => {
            const forward = x * direction.x + z * direction.z;
            return [z * direction.x - x * direction.z,
                y * cosPitch - forward * sinPitch, y * sinPitch + forward * cosPitch];
        };
        const toViewPoint = ([x, y, z]) => toViewVector([x - start.x, y - eyeHeight, z - start.z]);
        const stride = 10;
        const upload = (data, destination) => {
            // Keep world coordinates intact when the camera renders the scene again.
            const transformed = new Float32Array(data);
            for (let i = 0; i < data.length; i += stride) {
                const point = toViewPoint(data.slice(i, i + 3));
                const normal = toViewVector(data.slice(i + 3, i + 6));
                for (let j = 0; j < 3; j++) {
                    transformed[i + j] = point[j];
                    transformed[i + 3 + j] = normal[j];
                }
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, destination);
            gl.bufferData(gl.ARRAY_BUFFER, transformed, gl.DYNAMIC_DRAW);
        };
        const bind = destination => {
            gl.bindBuffer(gl.ARRAY_BUFFER, destination);
            for (const [attribute, size, offset] of [['p', 3, 0], ['n', 3, 12], ['c', 4, 24]]) {
                const location = gl.getAttribLocation(program, attribute);
                gl.enableVertexAttribArray(location);
                gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset);
            }
        };
        gl.viewport(0, 0, surface.width, surface.height);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.clearColor(.12, .12, .13, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniform1f(gl.getUniformLocation(program, 'aspect'), surface.width / surface.height);
        gl.uniform1f(gl.getUniformLocation(program, 'projectionScale'), perspectiveProjectionScale);
        const pass = gl.getUniformLocation(program, 'lightPass');
        gl.uniform1i(pass, 0);
        upload(vertices, buffer);
        bind(buffer);
        gl.drawArrays(gl.TRIANGLES, 0, vertices.length / stride);
        gl.depthMask(false);
        gl.enable(gl.BLEND);
        if (shadows.length) {
            upload(shadows, shadowBuffer);
            bind(shadowBuffer);
            gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
            gl.drawArrays(gl.TRIANGLES, 0, shadows.length / stride);
        }
        if (spots.length) {
            bind(buffer);
            gl.depthFunc(gl.EQUAL);
            gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
            gl.uniform1i(pass, 1);
            const lightPosition = gl.getUniformLocation(program, 'lightPosition');
            const lightDirection = gl.getUniformLocation(program, 'lightDirection');
            const patchUniforms = Object.fromEntries(['patchCenter', 'patchNormal', 'patchLong', 'patchCross', 'patchSize']
                .map(name => [name, gl.getUniformLocation(program, name)]));
            const useLightDepth = gl.getUniformLocation(program, 'useLightDepth');
            const fixedPatch = gl.getUniformLocation(program, 'fixedPatch');
            const lightRight = gl.getUniformLocation(program, 'lightRight');
            const lightUp = gl.getUniformLocation(program, 'lightUp');
            gl.activeTexture(gl.TEXTURE0);
            gl.uniform1i(gl.getUniformLocation(program, 'lightDepth'), 0);
            for (const spot of spots) {
                const source = toViewPoint(spot.position), axis = toViewVector(spot.direction);
                const patch = spot.patch;
                const useDepth = Boolean(depthMap && !patch?.fixed);
                if (useDepth) {
                    const horizontal = Math.hypot(axis[0], axis[2]);
                    const right = horizontal > 1e-5 ? [axis[2] / horizontal, 0, -axis[0] / horizontal] : [1, 0, 0];
                    const up = cross(axis, right);
                    gl.bindTexture(gl.TEXTURE_2D, null);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, depthMap.frame);
                    gl.viewport(0, 0, depthMap.resolution, depthMap.resolution);
                    gl.depthFunc(gl.LESS);
                    gl.depthMask(true);
                    gl.disable(gl.BLEND);
                    gl.disable(gl.DITHER);
                    gl.clearColor(1, 0, 0, 1);
                    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                    gl.useProgram(depthMap.program);
                    for (const [name, value] of [['source', source], ['axis', axis], ['right', right], ['up', up]]) {
                        gl.uniform3fv(gl.getUniformLocation(depthMap.program, name), value);
                    }
                    const vertex = gl.getAttribLocation(depthMap.program, 'p');
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                    gl.enableVertexAttribArray(vertex);
                    gl.vertexAttribPointer(vertex, 3, gl.FLOAT, false, stride * 4, 0);
                    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / stride);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                    gl.viewport(0, 0, surface.width, surface.height);
                    gl.depthFunc(gl.EQUAL);
                    gl.depthMask(false);
                    gl.enable(gl.BLEND);
                    gl.enable(gl.DITHER);
                    gl.useProgram(program);
                    bind(buffer);
                    gl.bindTexture(gl.TEXTURE_2D, depthMap.texture);
                    gl.uniform3fv(lightRight, right);
                    gl.uniform3fv(lightUp, up);
                }
                gl.uniform1i(useLightDepth, useDepth ? 1 : 0);
                gl.uniform1i(fixedPatch, patch?.fixed ? 1 : 0);
                gl.uniform3fv(lightPosition, source);
                gl.uniform3fv(lightDirection, axis);
                gl.uniform3fv(patchUniforms.patchSize, patch?.size || [0, 0, 0]);
                if (patch) {
                    gl.uniform3fv(patchUniforms.patchCenter, toViewPoint(patch.center));
                    gl.uniform3fv(patchUniforms.patchNormal, toViewVector(patch.normal));
                    gl.uniform3fv(patchUniforms.patchLong, toViewVector(patch.long));
                    gl.uniform3fv(patchUniforms.patchCross, toViewVector(patch.across));
                }
                gl.drawArrays(gl.TRIANGLES, 0, vertices.length / stride);
            }
        }
        if (glass.length) {
            // Blend transparent panes back-to-front after opaque geometry and lights.
            const triangles = [];
            for (let i = 0; i < glass.length; i += stride * 3) {
                const triangle = glass.slice(i, i + stride * 3);
                const depth = [0, stride, stride * 2].reduce((sum, j) =>
                    sum + toViewPoint(triangle.slice(j, j + 3))[2], 0);
                triangles.push({ triangle, depth });
            }
            triangles.sort((a, b) => b.depth - a.depth);
            const panes = triangles.flatMap(entry => entry.triangle);
            gl.uniform1i(pass, 0);
            gl.depthFunc(gl.LESS);
            gl.depthMask(false);
            gl.enable(gl.BLEND);
            gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
            upload(panes, glassBuffer);
            bind(glassBuffer);
            gl.drawArrays(gl.TRIANGLES, 0, panes.length / stride);
        }
        const labelBounds = surface.getBoundingClientRect();
        const displayScale = Math.min(labelBounds.width/surface.width, labelBounds.height/surface.height);
        if (sculptureLabels.length && Number.isFinite(displayScale) && displayScale > 0) {
            const labels = [];
            const right = [-direction.z,0,direction.x];
            const up = [-direction.x*sinPitch,cosPitch,-direction.z*sinPitch];
            const forward = [direction.x*cosPitch,sinPitch,direction.z*cosPitch];
            const ordered = sculptureLabels.slice().sort((a,b) =>
                toViewPoint([b.x,b.height,b.z])[2] - toViewPoint([a.x,a.height,a.z])[2]);
            for (const label of ordered) {
                if (!/^\d{1,6}$/.test(String(label.number ?? ''))) continue;
                const dx = start.x-label.x, dz = start.z-label.z;
                const distance = Math.hypot(dx,dz);
                const offset = Math.min(label.radius+1, distance*.5);
                const center = [label.x + dx/(distance || 1)*offset, label.height+1,
                    label.z + dz/(distance || 1)*offset];
                const depth = toViewPoint(center)[2];
                if (depth <= 2) continue;
                // Keep the annotation upright and readable at the displayed CSS size.
                const worldPerPixel = 2*depth/(perspectiveProjectionScale*surface.height*displayScale);
                const width = Math.max(36,String(label.number).length*12+12)*worldPerPixel;
                const height = 32*worldPerPixel;
                for (let i = 0; i < 3; i++) center[i] += up[i]*height/2;
                const corner = (x,y) => center.map((value,i) => value + right[i]*x + up[i]*y);
                const a = corner(-width/2,height/2), b = corner(width/2,height/2),
                    c = corner(width/2,-height/2), d = corner(-width/2,-height/2);
                quad(labels,a,b,c,d,[.90,.89,.85]);
                const front = point => point.map((value,i) => value-forward[i]*.05);
                numberOnFace(labels,label.number,front(a),front(b),front(d),true);
            }
            gl.uniform1i(pass,0);
            gl.depthFunc(gl.LESS);
            gl.depthMask(false);
            gl.disable(gl.BLEND);
            upload(labels,labelBuffer);
            bind(labelBuffer);
            gl.drawArrays(gl.TRIANGLES,0,labels.length/stride);
        }
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    function planObjects(raw) {
        try { return (typeof raw === 'string' ? JSON.parse(raw) : raw)?.objects || []; }
        catch { return []; }
    }
    const objectPoint = (matrix, x, y) => fabric.util.transformPoint(new fabric.Point(x, y), matrix);
    const unit = (a, b) => {
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        return { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
    };

    function renderedArtworkTarget(target, artworkSurfaces, scale) {
        const direct = artworkSurfaces.find(surface => surface.object === target);
        if (direct) return direct;
        const targetId = target.lightingTargetId;
        const catalogId = target.artworkCatalogId;
        const number = target.artworkNumber;
        const center = target.getCenterPoint();
        let best = null;
        for (const surface of artworkSurfaces) {
            const work = surface.object;
            // Floor plans and elevations can use separate copies of the same catalogued work.
            const priority = target.fixedWallArtworkId && work.fixedWallArtworkId === target.fixedWallArtworkId ? 4
                : targetId && work.lightingTargetId === targetId ? 3
                : catalogId && work.artworkCatalogId === catalogId ? 2
                : number != null && work.artworkNumber === number &&
                    (!catalogId || !work.artworkCatalogId) ? 1 : 0;
            if (!priority) continue;
            const midpoint = surface.point(.5, .5);
            const distance = Math.hypot(midpoint[0] - center.x / scale, midpoint[2] - center.y / scale);
            if (!best || priority > best.priority || (priority === best.priority && distance < best.distance)) {
                best = { surface, priority, distance };
            }
        }
        return best?.surface;
    }

    function wallLightPatch(light, surface, center, direction, distance) {
        const normal = surface.normal;
        const incidence = dot(direction, normal);
        const projected = direction.map((value, i) => value - incidence * normal[i]);
        const projectedLength = Math.hypot(...projected);
        const probe = { ...light, getCenterPoint: () => light.getCenterPoint() };
        lightingDirection(probe);
        const reference = spotlightRailReference(probe);
        const rail = lightingById(light.lightRailId);
        const ends = rail?.isLightRail ? railEndpoints(rail) : null;
        const railLength = ends ? Math.hypot(ends.end.x - ends.start.x, ends.end.y - ends.start.y) : 0;
        const parallel = railLength > 0 && Math.abs(
            ((ends.end.x - ends.start.x) * normal[0] + (ends.end.y - ends.start.y) * normal[2]) / railLength
        ) < .02;
        const straight = parallel && reference && Math.abs(reference.relative) < .25;
        // On a wall, keep the footprint centred and keep a straight-on beam vertical.
        const long = straight || projectedLength < 1e-6 ? [0, 1, 0] : projected.map(value => value / projectedLength);
        const radius = distance * Math.tan(14.5 * Math.PI / 180);
        return { center, normal, long, across: cross(normal, long),
            size: [radius / Math.max(.38, Math.abs(incidence)), radius, surface.depth + 4] };
    }

    function perspectiveSpotlights(objects, artworkSurfaces, scale, height) {
        const spots = [];
        let omitted = 0;
        for (const light of objects) {
            if (!light.isLightObject || light.lightKind !== 'spot' || light.lightOn === false) continue;
            const center = light.getCenterPoint();
            const position = [center.x / scale, height, center.y / scale];
            if (isArtworkLightAim(light)) {
                const target = objects.find(object => object.isArtwork && object.lightingTargetId === light.lightAimTargetId);
                if (!target) { omitted++; continue; }
                const pointMode = light.lightAimMode === 'artwork-point';
                const x = pointMode ? lightTargetPercent(light.lightTargetXPercent) / 100 : .5;
                const y = pointMode ? lightTargetPercent(light.lightTargetYPercent) / 100 : .5;
                const surface = renderedArtworkTarget(target, artworkSurfaces, scale);
                const destination = surface?.point(x, y);
                if (pointMode) {
                    if (!destination || !surface.normal) { omitted++; continue; }
                    const normal = surface.normal;
                    const long = [0, 1, 0];
                    spots.push({ position, direction: normal.map(value => -value),
                        patch: { fixed: true, center: destination, normal, long, across: cross(normal, long),
                            size: [80, 55, surface.depth + 4] } });
                    continue;
                }
                if (destination) {
                    const ray = subtract(destination, position);
                    const distance = Math.hypot(...ray);
                    if (!(distance > 0)) { omitted++; continue; }
                    const direction = ray.map(value => value / distance);
                    const patch = surface.depth > 0 ? wallLightPatch(light, surface, destination, direction, distance) : null;
                    spots.push({ position, direction, patch });
                    continue;
                }
            }
            // The floor-plan helper updates derived angles; keep the actual layout untouched.
            const { angle, tilt } = lightingDirection({ ...light, getCenterPoint: () => center });
            if (!Number.isFinite(angle) || !Number.isFinite(tilt)) { omitted++; continue; }
            const inclination = tilt * Math.PI / 180;
            const horizontal = Math.sin(inclination);
            spots.push({
                position,
                direction: [horizontal * Math.cos(angle), -Math.cos(inclination), horizontal * Math.sin(angle)]
            });
        }
        return { spots, omitted };
    }

    async function showPerspective(from, toward, eyeHeight) {
        busy = true;
        let openedDialog = false;
        say('パースを作成中…');
        try {
            const scale = configuredScale;
            const floorId = selectedFloorId;
            const inCm = p => ({ x: p.x / scale, z: p.z / scale });
            const vertices = [];
            const shadows = [];
            const glass = [];
            const sculptureLabels = [];
            const w = canvas.getWidth() / scale, h = canvas.getHeight() / scale;
            quad(vertices, [0,0,0], [w,0,0], [w,0,h], [0,0,h], colors.floor);
            const ceiling = venueCeilingHeightCm(floorId);
            const objects = canvas.getObjects();
            const artworkSurfaces = [];
            quad(vertices, [0,ceiling,0], [0,ceiling,h], [w,ceiling,h], [w,ceiling,0], colors.ceiling);
            for (const rail of objects) {
                if (!rail.isLightRail || rail.excludeFromExport) continue;
                const { start, end } = railEndpoints(rail);
                const a = inCm({ x: start.x, z: start.y });
                const b = inCm({ x: end.x, z: end.y });
                const direction = unit(a, b);
                if (!Number.isFinite(direction.x) || !Number.isFinite(direction.z)) continue;
                const halfWidthCm = 1.8;
                // Keep the strip slightly below the ceiling so the surfaces do not flicker.
                const underside = ceiling - .4;
                const edge = (point, side) => [
                    point.x - direction.z * side * halfWidthCm, underside,
                    point.z + direction.x * side * halfWidthCm
                ];
                quad(vertices, edge(a, 1), edge(b, 1), edge(b, -1), edge(a, -1), colors.rail);
            }
            const faces = new Map();
            const corners = object => {
                const body = object.item?.(0);
                if (!body || !(body.width > 0 && body.height > 0)) return null;
                const matrix = body.calcTransformMatrix();
                const depth = Number(object.cmDepth) * scale || body.height;
                return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x, y]) => {
                    const p = objectPoint(matrix, x * body.width / 2, y * depth / 2);
                    return inCm({ x: p.x, z: p.y });
                });
            };
            const box = (points, height, color, faceIds = []) => {
                for (let i = 0; i < 4; i++) {
                    const a = points[i], b = points[(i + 1) % 4];
                    const faceColor = wallPlanJsonData[faceIds[i]]?.wallExhibition && isArtworkTypeVisible('wall-exhibition') ? colors.wallExhibition : color;
                    quad(vertices, pointAt(a, height), pointAt(b, height), pointAt(b, 0), pointAt(a, 0),
                        i % 2 ? faceColor.map(value => value * .86) : faceColor);
                }
                quad(vertices, ...points.map(p => pointAt(p, height)), color);
            };
            for (const object of objects) {
                if (!object.isMovableWall && !(object.isArtwork && !object.isFixture &&
                    (['floor', 'sculpture'].includes(object.displayType) || isHangingArtwork(object)))) continue;
                if (object.isArtwork && !isArtworkTypeVisible(object)) continue;
                const points = corners(object);
                const height = Number(object.cmHeight);
                if (!points || !(height > 0)) continue;
                if (isHangingArtwork(object)) {
                    const surface = addHangingArtwork(vertices,points,object,ceiling);
                    if (surface) artworkSurfaces.push(surface);
                    continue;
                }
                const faceIds = object.isMovableWall
                    ? [object.movableFrontId, object.movableRightId, object.movableBackId, object.movableLeftId] : [];
                if (object.displayType !== 'sculpture') {
                    box(points, object.isMovableWall ? height : height * .6,
                        object.isMovableWall ? colors.wall : colors.plinth, faceIds);
                }
                contactShadow(shadows, object.displayType === 'sculpture'
                    ? sculptureBasePoints(points, object.sculptureBaseShape) : points);
                if (object.isMovableWall) {
                    faceIds.forEach((id, i) => {
                        // Elevation coordinates run left to right as seen
                        // from outside the corresponding face.
                        if (id) faces.set(id, [points[(i + 1) % 4], points[i]]);
                    });
                } else {
                    const [left, right] = [points[3], points[2]];
                    const front = unit(left, right);
                    const pedestal = object.displayType === 'sculpture' ? normalizeSculpturePedestal(object.sculpturePedestal) : null;
                    const center = { x: (points[0].x+points[2].x)/2, z: (points[0].z+points[2].z)/2 };
                    artworkSurfaces.push({ object, normal: [-front.z, 0, front.x], depth: 0, point: (x, y) => pedestal ? [
                        center.x + front.x*(x-.5)*pedestal.workWidthCm - front.z*pedestal.workDepthCm/2,
                        pedestal.baseHeightCm + pedestal.columnHeightCm + pedestal.workHeightCm*y,
                        center.z + front.z*(x-.5)*pedestal.workWidthCm + front.x*pedestal.workDepthCm/2
                    ] : [left.x + (right.x - left.x) * x, height * y, left.z + (right.z - left.z) * x] });
                    if (object.displayType === 'sculpture') sculptureLabels.push(addSculpture(vertices, points, height, object.artworkNumber, object.sculptureBaseShape, pedestal));
                    else addDisplayCase(vertices, glass, points, height, object.artworkNumber);
                }
            }
            const anchors = loadAnchors();
            let missingWalls = 0;
            const jobs = [];
            for (const [id, wall] of Object.entries(wallPlanJsonData)) {
                if (getWallFloorId(wall) !== floorId) continue;
                const width = Number(wall.widthCm), height = Number(wall.heightCm);
                if (!(width > 0 && height > 0)) continue;
                let ends = faces.get(id);
                if (!wall.movableWallId) {
                    const position = resolveWallEnds(id, anchors, scale);
                    if (!position) { missingWalls++; continue; }
                    const a = inCm(position.start), b = inCm(position.end);
                    ends = anchors[id].faceSide === -1 ? [b, a] : [a, b];
                    quad(vertices, pointAt(a, height), pointAt(b, height), pointAt(b, 0), pointAt(a, 0),
                        wall.wallExhibition && isArtworkTypeVisible('wall-exhibition') ? colors.wallExhibition : colors.wall);
                    const direction = unit(a, b);
                    const edge = (point, side) => ({ x: point.x - direction.z * side, z: point.z + direction.x * side });
                    contactShadow(shadows, [edge(a, -1), edge(b, -1), edge(b, 1), edge(a, 1)], 12);
                }
                if (!ends) continue;
                const [a, b] = ends, t = unit(a, b);
                if (!Number.isFinite(t.x)) continue;
                const objects = planObjects(wall.json);
                const outline = objects.find(item => item.isWallOutline);
                const savedWidth = Number(outline?.width) * Math.abs(outline?.scaleX || 1);
                const savedHeight = Number(outline?.height) * Math.abs(outline?.scaleY || 1);
                const scaleX = savedWidth > 0 ? savedWidth / width : scale;
                const scaleY = savedHeight > 0 ? savedHeight / (wall.legacyHeightCm || height) : scale;
                const left = Number(outline?.left) || 0, bottom = (Number(outline?.top) || 0) + (savedHeight || height * scaleY);
                const works = objects.filter(item => item.isArtwork && !item.isFixture && isArtworkTypeVisible(item));
                if (!works.length) continue;
                jobs.push(new Promise(resolve => fabric.util.enlivenObjects(works, resolve)).then(items => {
                    for (const object of items) {
                        const body = object.item?.(0);
                        if (!body) continue;
                        const center = objectPoint(body.calcTransformMatrix(), 0, 0);
                        const x = (center.x - left) / scaleX;
                        const y = window.getArtworkCenterHeightCm(object) ?? (bottom - center.y) / scaleY;
                        const halfW = Number(object.cmWidth) / 2, halfH = Number(object.cmHeight) / 2;
                        if (!(halfW > 0 && halfH > 0 && Number.isFinite(x) && Number.isFinite(y))) continue;
                        const angle = (Number(object.angle) || 0) * Math.PI / 180;
                        const cos = Math.cos(angle), sin = Math.sin(angle);
                        const faceLength = Math.hypot(b.x - a.x, b.z - a.z);
                        const p = (u, v, offset) => {
                            const distance = (x + u * cos - v * sin) * faceLength / width;
                            return [a.x + t.x * distance - t.z * offset, y - u * sin - v * cos,
                                a.z + t.z * distance + t.x * offset];
                        };
                        const offset = 1 + Math.max(0, Number(object.cmDepth) || 0);
                        if (object.displayType === 'sculpture') {
                            const alreadyOnFloor = object.artworkCatalogId && canvas.getObjects().some(item =>
                                item.isArtwork && item.displayType === 'sculpture' && item.artworkCatalogId === object.artworkCatalogId);
                            if (alreadyOnFloor) continue;
                            const depth = Number(object.cmDepth);
                            if (!(depth > 0)) continue;
                            const footprint = [p(-halfW,0,1), p(halfW,0,1),
                                p(halfW,0,depth+1), p(-halfW,0,depth+1)].map(point => ({ x: point[0], z: point[2] }));
                            sculptureLabels.push(addSculpture(vertices, footprint, halfH * 2, object.artworkNumber, object.sculptureBaseShape, object.sculpturePedestal));
                            contactShadow(shadows, sculptureBasePoints(footprint, object.sculptureBaseShape));
                            continue;
                        }
                        artworkSurfaces.push({ object, normal: [-t.z, 0, t.x], depth: offset,
                            point: (x, y) => p((2 * x - 1) * halfW, (1 - 2 * y) * halfH, offset) });
                        const triangles = object.displayType === 'wall' ? triangulateArtworkOutline(object.artworkOutline) : [];
                        if (triangles.length) {
                            for (const triangle of triangles) {
                                const vertices3d = triangle.map(([x, y]) => p((2 * x - 1) * halfW, (2 * y - 1) * halfH, offset));
                                meshFace(vertices, vertices3d, colors.artwork);
                            }
                            object.artworkOutline.forEach(([x,y], index, outline) => {
                                const [X,Y] = outline[(index+1) % outline.length];
                                quad(vertices, p((2*x-1)*halfW,(2*y-1)*halfH,1),
                                    p((2*X-1)*halfW,(2*Y-1)*halfH,1),
                                    p((2*X-1)*halfW,(2*Y-1)*halfH,offset),
                                    p((2*x-1)*halfW,(2*y-1)*halfH,offset), colors.frame);
                            });
                            const area = artworkOutlineLabelArea(object.artworkOutline, triangles, halfW * 2, halfH * 2);
                            if (area) {
                                const size = area.size / 2;
                                numberOnFace(vertices, object.artworkNumber, p(area.x - size, area.y - size, offset + .15),
                                    p(area.x + size, area.y - size, offset + .15), p(area.x - size, area.y + size, offset + .15));
                            }
                            continue;
                        }
                        quad(vertices, p(-halfW,-halfH,offset), p(halfW,-halfH,offset),
                            p(halfW,halfH,offset), p(-halfW,halfH,offset), colors.artwork);
                        const border = Math.min(4, Math.min(halfW,halfH)*.09);
                        const outer = [[-halfW,-halfH], [halfW,-halfH], [halfW,halfH], [-halfW,halfH]];
                        const inner = [[-halfW+border,-halfH+border], [halfW-border,-halfH+border],
                            [halfW-border,halfH-border], [-halfW+border,halfH-border]];
                        for (let i = 0; i < 4; i++) {
                            const j = (i+1) % 4;
                            quad(vertices, p(...outer[i],offset+.08), p(...outer[j],offset+.08),
                                p(...inner[j],offset+.08), p(...inner[i],offset+.08), colors.frame);
                            quad(vertices, p(...outer[i],1), p(...outer[j],1),
                                p(...outer[j],offset), p(...outer[i],offset), colors.frame);
                        }
                        numberOnFace(vertices, object.artworkNumber, p(...inner[0],offset + .15),
                            p(...inner[1],offset + .15), p(...inner[3],offset + .15));
                    }
                }));
            }
            await Promise.all(jobs);
            if (floorId !== selectedFloorId || currentViewMode !== 'floor') return;
            const { spots, omitted } = perspectiveSpotlights(objects, artworkSurfaces, scale, ceiling);
            $('perspectiveDialogTitle').textContent = FLOOR_PLANS[floorId].title + ' — パース試作';
            $('perspectiveSummary').textContent = '影と照射範囲は簡易表示です。'
                + (missingWalls ? ' 位置未登録の固定壁 ' + missingWalls + ' 面は省略しています。' : '')
                + (omitted ? ' 照射先や高さを確定できないライト ' + omitted + ' 灯は省略しています。' : '');
            $('perspectiveDialog').showModal();
            openedDialog = true;
            // Measure the visible canvas before sizing the screen-readable number labels.
            renderPerspective(vertices, shadows, spots, inCm(from), unit(from, toward), eyeHeight, 0, glass, sculptureLabels);
            window.startPerspectiveNavigation({
                start: inCm(from), direction: unit(from, toward),
                bounds: { width: w, depth: h },
                render: (position, direction, pitch) => renderPerspective(vertices, shadows, spots, position, direction, eyeHeight, pitch, glass, sculptureLabels)
            });
            say('視点を指定し直すと、別の位置から確認できます。');
        } catch (error) {
            if (openedDialog) $('perspectiveDialog').close();
            console.error('パースの表示に失敗しました。', error);
            say(error.message || 'パースの表示に失敗しました。');
        } finally { busy = false; }
    }

    document.addEventListener('DOMContentLoaded', () => {
        $('btnPickPerspective').addEventListener('click', () => pickPoints('camera'));
        $('btnLinkPerspectiveWall').addEventListener('click', () => pickPoints('wall'));
        $('btnUnlinkPerspectiveWall').addEventListener('click', unlinkWall);
        $('perspectiveWall').addEventListener('change', () => {
            cancelPick();
            updateUnlinkButton();
            scheduleWallGuide();
        });
        window.refreshPerspectiveControls();
    });
    canvas.on('after:render', scheduleWallGuide);
    window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && picker) { cancelPick(); event.preventDefault(); }
    });
})();
