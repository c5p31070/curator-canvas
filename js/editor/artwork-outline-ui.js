function artworkOutlineDragPosition(origin, displacement, frame, free) {
    const [x, y] = origin;
    const [dx, dy] = displacement;
    const clamp = value => Math.min(1, Math.max(0, value));
    if (free) return [clamp(x + dx / frame.width), clamp(y + dy / frame.height)];
    const step = Math.PI / 4;
    const heading = Math.round(Math.atan2(dy, dx) / step);
    const directions = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const [ux, uy] = directions[(heading + 8) % 8];
    const travel = (dx * ux + dy * uy) / (ux * ux + uy * uy);
    const limit = (position, direction, extent) =>
        direction === 0 ? Infinity : (direction > 0 ? 1 - position : position) * extent;
    const distance = Math.min(travel, limit(x, ux, frame.width), limit(y, uy, frame.height));
    return [clamp(x + ux * distance / frame.width), clamp(y + uy * distance / frame.height)];
}

function measureArtworkOutline(points, frame, edge, lengthMm) {
    if (!(Number.isFinite(lengthMm) && lengthMm >= .01)) return null;
    const xs = points.map(point => point[0] * frame.width);
    const ys = points.map(point => point[1] * frame.height);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    const next = (edge + 1) % points.length;
    const edgeLength = Math.hypot(xs[next] - xs[edge], ys[next] - ys[edge]);
    if (!(edgeLength > 0)) return null;
    const widthMm = lengthMm * (width / edgeLength);
    const heightMm = lengthMm * (height / edgeLength);
    return [widthMm, heightMm].every(value => Number.isFinite(value) && value > 0) ? { widthMm, heightMm } : null;
}

function initializeArtworkOutlineEditor() {
    const $ = id => document.getElementById(id);
    const displayType = $('displayType');
    const edit = $('btnEditArtworkOutline');
    const reset = $('btnResetArtworkOutline');
    const dialog = $('artworkOutlineDialog');
    const preset = $('artworkOutlinePreset');
    const svg = $('artworkOutlinePreview');
    const [bounds, face, edges, edge, handles] = svg.children;
    const confirm = $('btnApplyArtworkOutline');
    const status = $('artworkOutlineStatus');
    const freeMove = $('artworkOutlineFreeMove');
    const insert = $('btnInsertArtworkVertex');
    const remove = $('btnRemoveArtworkVertex');
    const widthInput = $('artworkWidth');
    const heightInput = $('artworkHeight');
    const edgeLabel = $('artworkOutlineEdgeLabel');
    const edgeLength = $('artworkOutlineEdgeLength');
    const dimensions = $('artworkOutlineDimensions');
    const copy = points => points.map(point => point.slice());
    let outline = null;
    let draft = [];
    let frame;
    let drag = null;
    let selected = 0;

    function set(points) {
        outline = triangulateArtworkOutline(points).length ? copy(points) : null;
        edit.textContent = outline ? '形を編集（設定済み）' : '形を編集';
        reset.hidden = !outline;
        refreshDimensions();
    }

    const refreshDimensions = () => {
        const derived = Boolean(outline && displayType.value === 'wall');
        widthInput.readOnly = derived;
        heightInput.readOnly = derived;
    };
    const refreshVisibility = () => { $('artworkOutlineControls').hidden = displayType.value !== 'wall'; };
    displayType.addEventListener('change', refreshVisibility);
    displayType.addEventListener('change', refreshDimensions);
    refreshVisibility();

    function normalize() {
        const xs = draft.map(point => point[0]);
        const ys = draft.map(point => point[1]);
        const x = Math.min(...xs), y = Math.min(...ys);
        const width = Math.max(...xs) - x, height = Math.max(...ys) - y;
        if (width < .025 || height < .025) return [];
        const points = draft.map(([px, py]) => [(px - x) / width, (py - y) / height]);
        return triangulateArtworkOutline(points).length ? points : [];
    }

    const formatMm = value => Number(value.toPrecision(12)).toString();
    function updateMeasurement(normalized) {
        const measured = normalized.length ? measureArtworkOutline(draft, frame, selected, edgeLength.valueAsNumber) : null;
        confirm.disabled = !measured;
        dimensions.textContent = measured
            ? `幅 ${Number(measured.widthMm.toFixed(2))} × 高さ ${Number(measured.heightMm.toFixed(2))} mm` : '';
        return measured;
    }

    function render() {
        const points = draft.map(([x, y]) => [frame.x + x * frame.width, frame.y + y * frame.height]);
        face.setAttribute('points', points.map(point => point.join(',')).join(' '));
        points.forEach(([x, y], index) => {
            const handle = handles.children[index];
            handle.setAttribute('cx', x);
            handle.setAttribute('cy', y);
            handle.classList.toggle('is-selected', index === selected);
            handle.setAttribute('aria-pressed', String(index === selected));
        });
        const [x1, y1] = points[selected];
        const [x2, y2] = points[(selected + 1) % points.length];
        for (const [key, value] of Object.entries({ x1, y1, x2, y2 })) edge.setAttribute(key, value);
        points.forEach(([ax, ay], index) => {
            const [bx, by] = points[(index + 1) % points.length];
            const hit = edges.children[index];
            for (const [key, value] of Object.entries({ x1: ax, y1: ay, x2: bx, y2: by })) hit.setAttribute(key, value);
        });
        edgeLabel.textContent = `辺 ${selected + 1}–${(selected + 1) % points.length + 1} の長さ (mm)`;
        insert.disabled = draft.length >= maxArtworkOutlineVertices;
        remove.disabled = draft.length <= 3;
        const normalized = normalize();
        const valid = normalized.length > 0;
        face.classList.toggle('invalid', !valid);
        updateMeasurement(normalized);
        const message = valid
            ? (freeMove.checked ? '頂点は自由に移動できます。基準にする辺をクリックしてください。'
                : '頂点は45°刻みで移動します。基準にする辺をクリックしてください。')
            : '輪郭が交差しているか、つぶれています。頂点を調整してください。';
        if (status.textContent !== message) status.textContent = message;
    }

    function load(points, selectedIndex = 0) {
        draft = copy(points);
        selected = selectedIndex;
        edges.replaceChildren(...draft.map((_, index) => {
            const hit = document.createElementNS(svg.namespaceURI, 'line');
            hit.dataset.edge = index;
            return hit;
        }));
        handles.replaceChildren(...draft.map((_, index) => {
            const handle = document.createElementNS(svg.namespaceURI, 'circle');
            handle.setAttribute('class', 'artwork-outline-vertex');
            handle.setAttribute('r', '6');
            handle.setAttribute('tabindex', '0');
            handle.setAttribute('role', 'button');
            handle.setAttribute('aria-label', `頂点 ${index + 1}`);
            handle.dataset.vertex = index;
            return handle;
        }));
        render();
    }

    edit.addEventListener('click', () => {
        if (window.CURATOR_ROLE === 'viewer' || displayType.value !== 'wall' || dialog.open) return;
        const widthMm = Number(widthInput.value) || 1500;
        const heightMm = Number(heightInput.value) || 1000;
        const aspectRatio = widthMm / heightMm;
        const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
        const width = Math.min(210, 120 * ratio), height = Math.min(120, 210 / ratio);
        frame = { x: (240 - width) / 2, y: (150 - height) / 2, width, height };
        for (const [key, value] of Object.entries(frame)) bounds.setAttribute(key, value);
        const previous = Object.entries(artworkOutlinePresets).find(([, points]) =>
            JSON.stringify(points) === JSON.stringify(outline));
        preset.value = outline ? previous?.[0] || 'custom' : 'rectangle';
        edgeLength.value = outline ? formatMm(Math.hypot((outline[1][0] - outline[0][0]) * widthMm,
            (outline[1][1] - outline[0][1]) * heightMm)) : '';
        load(outline || artworkOutlinePresets.rectangle);
        dialog.showModal();
    });
    preset.addEventListener('change', () => {
        const points = artworkOutlinePresets[preset.value];
        if (points) load(points);
    });
    freeMove.addEventListener('change', render);
    edgeLength.addEventListener('input', () => updateMeasurement(normalize()));
    edges.addEventListener('click', event => {
        if (event.target.dataset?.edge === undefined) return;
        selected = Number(event.target.dataset.edge);
        render();
    });
    insert.addEventListener('click', () => {
        if (insert.disabled) return;
        const a = draft[selected], b = draft[(selected + 1) % draft.length];
        const index = selected + 1;
        draft.splice(index, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        preset.value = 'custom';
        load(draft, index);
        handles.children[index].focus();
    });
    remove.addEventListener('click', () => {
        if (remove.disabled) return;
        draft.splice(selected, 1);
        preset.value = 'custom';
        const index = Math.min(selected, draft.length - 1);
        load(draft, index);
        handles.children[index].focus();
    });
    reset.addEventListener('click', () => set(null));
    $('btnCancelArtworkOutline').addEventListener('click', () => dialog.close());
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('close', () => { drag = null; });
    $('artworkOutlineForm').addEventListener('submit', event => {
        event.preventDefault();
        const points = normalize();
        const measured = updateMeasurement(points);
        if (!measured) return;
        widthInput.value = formatMm(measured.widthMm);
        heightInput.value = formatMm(measured.heightMm);
        set(JSON.stringify(points) === JSON.stringify(artworkOutlinePresets.rectangle) ? null : points);
        dialog.close();
    });

    function moveVertex(index, point) {
        draft[index] = point;
        preset.value = 'custom';
        render();
    }
    const pointerPosition = event => new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    svg.addEventListener('pointerdown', event => {
        if (event.button !== 0 || drag || event.target.dataset?.vertex === undefined) return;
        selected = Number(event.target.dataset.vertex);
        drag = { index: selected, origin: draft[selected], start: pointerPosition(event), pointerId: event.pointerId };
        render();
        svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove', event => {
        if (drag?.pointerId !== event.pointerId) return;
        const point = pointerPosition(event);
        moveVertex(drag.index, artworkOutlineDragPosition(drag.origin,
            [point.x - drag.start.x, point.y - drag.start.y], frame, freeMove.checked));
    });
    svg.addEventListener('lostpointercapture', () => { drag = null; });
    handles.addEventListener('focusin', event => {
        if (event.target.dataset?.vertex === undefined) return;
        selected = Number(event.target.dataset.vertex);
        render();
    });
    handles.addEventListener('keydown', event => {
        if (event.target.dataset?.vertex === undefined) return;
        const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        const index = Number(event.target.dataset.vertex);
        const step = event.shiftKey ? .1 : .02;
        moveVertex(index, artworkOutlineDragPosition(draft[index],
            [direction[0] * step * frame.width, direction[1] * step * frame.height], frame, freeMove.checked));
    });
    return { get: () => displayType.value === 'wall' ? outline : null, set };
}
