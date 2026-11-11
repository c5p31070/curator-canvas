// The floor guide and perspective scene use the same venue wall positions.
(() => {
    const $ = id => document.getElementById(id);
    const loadAnchors = () => Object.fromEntries(Object.entries(wallPlanJsonData)
        .filter(([, wall]) => !wall.movableWallId && wall.planPosition)
        .map(([id, wall]) => [id, wall.planPosition]));
    const canLink = () => isAdminMode && !window.CURATOR_GUEST?.active && window.CURATOR_ROLE !== 'viewer';
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
        const anchors = loadAnchors();
        const selected = detailed && canLink() ? $('perspectiveWall').value : '';
        const walls = Object.keys(anchors).flatMap(id => {
            if (anchors[id]?.floorId !== selectedFloorId) return [];
            const ends = resolveWallEnds(id, anchors, configuredScale);
            return ends ? [{ id, ...ends, faceSide: anchors[id].faceSide, title: wallPlanJsonData[id].title || '固定壁', active: id === selected }] : [];
        });
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
                element.classList.add(className);
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
                if (second) showSide(coordinates(event));
                else if (first) positionLine(preview, first, wallEnd(coordinates(event)));
            });
            overlay.addEventListener('pointerdown', event => {
                if (event.button !== 0 || !event.isPrimary || floorId !== selectedFloorId || currentViewMode !== 'floor' || !canLink()) return;
                event.preventDefault();
                const point = coordinates(event);
                if (!first) {
                    const zoom = overlay.getBoundingClientRect().width / canvas.getWidth() || 1;
                    let closest = 16 / zoom;
                    for (const endpoint of endpoints) {
                        const distance = Math.hypot(endpoint.point.x - point.x, endpoint.point.z - point.z);
                        if (distance < closest) { closest = distance; connection = endpoint; }
                    }
                    first = connection?.point || point;
                    addMarker(first);
                    sayWall('壁を伸ばす方向（上下左右）を指定してください。');
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
    const quad = (out, a, b, c, d, color, opacity = [1, 1, 1, 1]) => {
        const normal = cross(subtract(b, a), subtract(d, a));
        const size = Math.hypot(...normal);
        if (!(size > 0)) return;
        const direction = normal.map(value => value / size);
        const corners = [a, b, c, d];
        for (const i of [0, 1, 2, 0, 2, 3]) out.push(...corners[i], ...direction, ...color, opacity[i]);
    };
    // A soft contact shadow around a floor footprint, without a full scene light simulation.
    function contactShadow(out, points, spread = 18) {
        const outer = points.map((point, i) => {
            const fromPrevious = unit(points[(i + 3) % 4], point);
            const fromNext = unit(points[(i + 1) % 4], point);
            return { x: point.x + spread * (fromPrevious.x + fromNext.x),
                z: point.z + spread * (fromPrevious.z + fromNext.z) };
        });
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            quad(out, pointAt(points[i], .25), pointAt(points[j], .25),
                pointAt(outer[j], .25), pointAt(outer[i], .25), [.07, .09, .1], [.36, .36, 0, 0]);
        }
    }
    const pointAt = (p, height) => [p.x, height, p.z];
    const colors = {
        floor: [.18, .12, .10], ceiling: [.32, .33, .35], wall: [.49, .47, .44],
        artwork: [.19, .34, .40], plinth: [.37, .39, .41], ink: [.69, .70, .70]
    };
    const digits = ['012345', '12', '01643', '01236', '5612', '05623', '056234', '012', '0123456', '012356'];
    const segments = [[1,0,5,1],[5,1,6,4],[5,5,6,8],[1,8,5,9],[0,5,1,8],[0,1,1,4],[1,4,5,5]];
    function numberOnFace(out, number, a, b, d) {
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
    }

    function renderPerspective(vertices, shadows, spots, start, direction, eyeHeight) {
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
                'uniform float aspect;',
                'void main(){',
                'position=p; normal=n; color=c;',
                'gl_Position=vec4(p.x*1.55/aspect,p.y*1.55,p.z*1.000004-4.000008,p.z);',
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
            renderer = { gl, program, buffer: gl.createBuffer(), shadowBuffer: gl.createBuffer(),
                depthMap: canMapDepth ? { program: depthProgram, texture: depthTexture, frame: depthFrame, resolution } : null };
        }
        const { gl, program, buffer, shadowBuffer, depthMap } = renderer;
        // Plan coordinates increase down the page; the camera transform also applies to light rays.
        const toViewVector = ([x, y, z]) => [z * direction.x - x * direction.z, y, x * direction.x + z * direction.z];
        const toViewPoint = ([x, y, z]) => toViewVector([x - start.x, y - eyeHeight, z - start.z]);
        const stride = 10;
        const upload = (data, destination) => {
            for (let i = 0; i < data.length; i += stride) {
                const point = toViewPoint(data.slice(i, i + 3));
                const normal = toViewVector(data.slice(i + 3, i + 6));
                for (let j = 0; j < 3; j++) {
                    data[i + j] = point[j];
                    data[i + 3 + j] = normal[j];
                }
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, destination);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
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
            const priority = targetId && work.lightingTargetId === targetId ? 3
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
        say('パースを作成中…');
        try {
            const scale = configuredScale;
            const floorId = selectedFloorId;
            const inCm = p => ({ x: p.x / scale, z: p.z / scale });
            const vertices = [];
            const shadows = [];
            const w = canvas.getWidth() / scale, h = canvas.getHeight() / scale;
            quad(vertices, [0,0,0], [w,0,0], [w,0,h], [0,0,h], colors.floor);
            const ceiling = venueCeilingHeightCm(floorId);
            const objects = canvas.getObjects();
            const artworkSurfaces = [];
            quad(vertices, [0,ceiling,0], [0,ceiling,h], [w,ceiling,h], [w,ceiling,0], colors.ceiling);
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
            const box = (points, height, color) => {
                for (let i = 0; i < 4; i++) {
                    const a = points[i], b = points[(i + 1) % 4];
                    quad(vertices, pointAt(a, height), pointAt(b, height), pointAt(b, 0), pointAt(a, 0),
                        i % 2 ? color.map(value => value * .86) : color);
                }
                quad(vertices, ...points.map(p => pointAt(p, height)), color);
            };
            for (const object of objects) {
                if (!object.isMovableWall && !(object.isArtwork && !object.isFixture && object.displayType === 'floor')) continue;
                const points = corners(object);
                const height = Number(object.cmHeight);
                if (!points || !(height > 0)) continue;
                box(points, height, object.isMovableWall ? colors.wall : colors.plinth);
                contactShadow(shadows, points);
                if (object.isMovableWall) {
                    ['movableFrontId','movableRightId','movableBackId','movableLeftId'].forEach((key, i) => {
                        // Elevation coordinates run left to right as seen
                        // from outside the corresponding face.
                        if (object[key]) faces.set(object[key], [points[(i + 1) % 4], points[i]]);
                    });
                } else {
                    const [left, right] = [points[3], points[2]];
                    const front = unit(left, right);
                    artworkSurfaces.push({ object, normal: [-front.z, 0, front.x], depth: 0, point: (x, y) => [
                        left.x + (right.x - left.x) * x, height * y, left.z + (right.z - left.z) * x
                    ] });
                    numberOnFace(vertices, object.artworkNumber, pointAt(points[2], height + .2),
                        pointAt(points[3], height + .2), pointAt(points[1], height + .2));
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
                    quad(vertices, pointAt(a, height), pointAt(b, height), pointAt(b, 0), pointAt(a, 0), colors.wall);
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
                const works = objects.filter(item => item.isArtwork && !item.isFixture);
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
                        artworkSurfaces.push({ object, normal: [-t.z, 0, t.x], depth: offset,
                            point: (x, y) => p((2 * x - 1) * halfW, (1 - 2 * y) * halfH, offset) });
                        quad(vertices, p(-halfW,-halfH,offset), p(halfW,-halfH,offset),
                            p(halfW,halfH,offset), p(-halfW,halfH,offset), colors.artwork);
                        numberOnFace(vertices, object.artworkNumber, p(-halfW,-halfH,offset + .15),
                            p(halfW,-halfH,offset + .15), p(-halfW,halfH,offset + .15));
                    }
                }));
            }
            await Promise.all(jobs);
            if (floorId !== selectedFloorId || currentViewMode !== 'floor') return;
            const { spots, omitted } = perspectiveSpotlights(objects, artworkSurfaces, scale, ceiling);
            renderPerspective(vertices, shadows, spots, inCm(from), unit(from, toward), eyeHeight);
            $('perspectiveDialogTitle').textContent = FLOOR_PLANS[floorId].title + ' — パース試作';
            $('perspectiveSummary').textContent = '影と照射範囲は簡易表示です。'
                + (missingWalls ? ' 位置未登録の固定壁 ' + missingWalls + ' 面は省略しています。' : '')
                + (omitted ? ' 照射先や高さを確定できないライト ' + omitted + ' 灯は省略しています。' : '');
            $('perspectiveDialog').showModal();
            say('視点を指定し直すと、別の位置から確認できます。');
        } catch (error) {
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
