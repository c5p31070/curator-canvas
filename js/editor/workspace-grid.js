// Grid settings belong to the current browser; geometry uses the common drawing scale.
(() => {
    const storageKey = 'curator_canvas_workspace_grid';
    let settings = { visible: true, snap: false, spacingCm: 50 };
    try {
        const saved = JSON.parse(editorStorage.getItem(storageKey) || 'null');
        if (saved) settings = { visible: saved.visible !== false, snap: saved.snap === true,
            spacingCm: Number.isInteger(saved.spacingCm) && saved.spacingCm >= 1 && saved.spacingCm <= 1000 ? saved.spacingCm : 50 };
    } catch {}
    let overlay;
    let frame = null;
    let lastGeometry = '';

    function gridGeometry() {
        if (!window.isDiagramReady?.() || isTransitioning) return null;
        const scale = getDimensionScale();
        if (!Number.isFinite(scale) || scale <= 0) return null;
        let bounds;
        if (currentViewMode === 'wall') {
            const wall = canvas.getObjects().find(object => object.isWallOutline);
            if (!wall) return null;
            const center = wall.getCenterPoint();
            const width = wall.width * Math.abs(wall.scaleX || 1);
            const height = wall.height * Math.abs(wall.scaleY || 1);
            bounds = { x: center.x - width / 2, y: center.y - height / 2, width, height };
        } else {
            const image = canvas.backgroundImage;
            if (!image) return null;
            bounds = { x: image.left || 0, y: image.top || 0,
                width: image.width * Math.abs(image.scaleX || 1), height: image.height * Math.abs(image.scaleY || 1) };
        }
        return { ...bounds, originX: bounds.x,
            originY: currentViewMode === 'wall' ? bounds.y + bounds.height : bounds.y,
            step: settings.spacingCm * scale };
    }

    function snapPoint(point) {
        if (!settings.snap || window.CURATOR_ROLE === 'viewer') return point;
        const grid = gridGeometry();
        if (!grid || point.x < grid.x || point.x > grid.x + grid.width ||
            point.y < grid.y || point.y > grid.y + grid.height) return point;
        const snapAxis = (value, origin, min, max) => origin + Math.max(
            Math.ceil((min - origin) / grid.step), Math.min(Math.floor((max - origin) / grid.step),
                Math.round((value - origin) / grid.step))) * grid.step;
        return { x: snapAxis(point.x, grid.originX, grid.x, grid.x + grid.width),
            y: snapAxis(point.y, grid.originY, grid.y, grid.y + grid.height) };
    }
    window.snapPointToGrid = snapPoint;

    window.snapObjectToGrid = object => {
        if (!object || !settings.snap || object.excludeFromExport || object.isCrowdCircle || object.isLightBeam ||
            (object.isLightObject && object.lightKind === 'spot') ||
            (object.isFixture && !isAdminMode) || (object.lockMovementX && object.lockMovementY)) return;
        if (!(object.isArtwork || object.isMovableWall || object.isPin || object.isFreePin || object.isGuard || object.isShapeObject ||
            object.isLightObject || object.isLightRail || object.isDimension || object.type === 'activeSelection')) return;
        let anchor = object.getCenterPoint();
        if (object.isLightRail) {
            const points = object.calcLinePoints();
            anchor = fabric.util.transformPoint(new fabric.Point(points.x1, points.y1), object.calcTransformMatrix());
        }
        const snapped = snapPoint(anchor);
        const dx = snapped.x - anchor.x, dy = snapped.y - anchor.y;
        if (!dx && !dy) return;
        object.set({ left: object.lockMovementX ? object.left : object.left + dx,
            top: object.lockMovementY ? object.top : object.top + dy });
        object.setCoords();
    };

    function renderGrid() {
        frame = null;
        if (!overlay) return;
        const grid = gridGeometry();
        const hidden = !settings.visible || !grid;
        overlay.toggleAttribute('hidden', hidden);
        const hint = document.getElementById('gridSpacingHint');
        if (hint) { hint.hidden = true; hint.textContent = ''; }
        if (hidden) return;
        const zoom = canvas.lowerCanvasEl.getBoundingClientRect().width / canvas.getWidth();
        if (!zoom) { overlay.setAttribute('hidden', ''); return; }
        // Avoid a solid-looking grid at low zoom. Snapping keeps the chosen precision.
        let stride = 1;
        while (grid.step * zoom * stride < 7) stride *= 5;
        const step = grid.step * stride;
        if (hint && stride > 1) {
            hint.textContent = `表示：${settings.spacingCm * stride} cmごと（吸着：${settings.spacingCm} cm）`;
            hint.hidden = false;
        }
        const geometryKey = JSON.stringify([grid, step, zoom, canvas.getWidth(), canvas.getHeight()]);
        if (lastGeometry === geometryKey) return;
        lastGeometry = geometryKey;
        overlay.setAttribute('viewBox', `0 0 ${canvas.getWidth()} ${canvas.getHeight()}`);
        overlay.setAttribute('width', canvas.getWidth());
        overlay.setAttribute('height', canvas.getHeight());
        overlay.innerHTML = `<defs>
            <pattern id="workspaceGridFine" patternUnits="userSpaceOnUse" x="${grid.originX}" y="${grid.originY}" width="${step}" height="${step}">
                <path d="M ${step} 0 H 0 V ${step}" fill="none" stroke="#657f8c" stroke-opacity=".22" stroke-width="${.7 / zoom}"/>
            </pattern>
            <pattern id="workspaceGridMajor" patternUnits="userSpaceOnUse" x="${grid.originX}" y="${grid.originY}" width="${step * 5}" height="${step * 5}">
                <path d="M ${step * 5} 0 H 0 V ${step * 5}" fill="none" stroke="#546f7d" stroke-opacity=".2" stroke-width="${1 / zoom}"/>
            </pattern>
            </defs>
            <rect x="${grid.x}" y="${grid.y}" width="${grid.width}" height="${grid.height}" fill="url(#workspaceGridFine)"/>
            <rect x="${grid.x}" y="${grid.y}" width="${grid.width}" height="${grid.height}" fill="url(#workspaceGridMajor)"/>`;
    }
    function scheduleGrid() {
        if (frame === null) frame = requestAnimationFrame(renderGrid);
    }
    window.refreshWorkspaceGrid = scheduleGrid;
    canvas.on('after:render', scheduleGrid);
    document.addEventListener('DOMContentLoaded', () => {
        overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        overlay.id = 'workspaceGridOverlay';
        overlay.classList.add('workspace-grid-overlay');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.setAttribute('hidden', '');
        canvas.wrapperEl.appendChild(overlay);
        const visible = document.getElementById('workspaceGridVisible');
        const snap = document.getElementById('workspaceGridSnap');
        const spacing = document.getElementById('workspaceGridSpacing');
        visible.checked = settings.visible;
        snap.checked = settings.snap;
        spacing.value = settings.spacingCm;
        const change = () => {
            const value = Number(spacing.value);
            if (!Number.isInteger(value) || value < 1 || value > 1000) {
                spacing.value = settings.spacingCm;
                return;
            }
            settings = { visible: visible.checked, snap: snap.checked, spacingCm: value };
            try { editorStorage.setItem(storageKey, JSON.stringify(settings)); } catch {}
            scheduleGrid();
        };
        [visible, snap, spacing].forEach(input => input.addEventListener('change', change));
        window.addEventListener('resize', scheduleGrid);
        scheduleGrid();
    });
})();
