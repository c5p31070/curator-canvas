let canvasZoomByView = new Map();
let activeCanvasZoomKey = null;
let currentCanvasZoom = 1;
let canvasZoomApiReady = false;

function getCanvasZoomKey() {
    if (currentViewMode === 'floor') return `floor:${selectedFloorId}`;
    if (currentViewMode === 'wall') return `wall:${selectedWallInfo?.id || 'default'}`;
    return null;
}

function refreshCanvasRenderDensity(zoom) {
    // Fabric maps hit tests using its retina ratio and the CSS bounds together.
    // Change only its drawing buffers, keeping both logical dimensions intact.
    const screenDensity = window.devicePixelRatio || 1;
    const density = Math.min(4, Math.ceil(screenDensity * Math.max(1, zoom)));
    if (fabric.devicePixelRatio === density) return;
    fabric.devicePixelRatio = density;
    canvas.setDimensions({ width: canvas.getWidth(), height: canvas.getHeight() }, { backstoreOnly: true });
}

function initializeCanvasZoom() {
    const viewport = document.getElementById('canvasViewport');
    const zoomSlider = document.getElementById('canvasZoom');
    const zoomValue = document.getElementById('canvasZoomValue');
    const fitButton = document.getElementById('btnZoomFit');
    if (!viewport || !zoomSlider || !canvas.wrapperEl) return;

    const canvasWrapper = canvas.wrapperEl;
    canvasWrapper.style.position = 'absolute';
    canvasWrapper.style.left = '0px';
    canvasWrapper.style.top = '0px';
    canvasWrapper.style.transformOrigin = 'top left';

    // Keep rotation controls at a stable screen distance despite the CSS zoom.
    const controlStyles = new WeakMap();
    const refreshSelectionControls = () => {
        const object = canvas.getActiveObject();
        if (!object?.controls?.mtr) return;
        if (!object.isArtwork && !object.isMovableWall && object.type !== 'activeSelection') return;
        let style = controlStyles.get(object);
        if (!style) {
            const rotation = object.controls.mtr;
            style = {
                offsetX: rotation.offsetX,
                offsetY: rotation.offsetY,
                cornerSize: object.cornerSize,
                touchCornerSize: object.touchCornerSize,
                zoom: null
            };
            // Fabric controls are shared by default; isolate this object's
            // rotation control while preserving any custom vertex controls.
            object.controls = { ...object.controls, mtr: new fabric.Control({ ...rotation }) };
            controlStyles.set(object, style);
        }
        if (style.zoom === currentCanvasZoom) return;
        const zoom = Math.max(.001, currentCanvasZoom);
        object.controls.mtr.offsetX = style.offsetX / zoom;
        object.controls.mtr.offsetY = style.offsetY / zoom;
        object.cornerSize = style.cornerSize / zoom;
        object.touchCornerSize = style.touchCornerSize / zoom;
        style.zoom = currentCanvasZoom;
        object.setCoords();
    };
    canvas.on('before:render', refreshSelectionControls);

    const getWallBounds = () => {
        if (currentViewMode !== 'wall') return null;
        const wall = canvas.getObjects().find(obj => obj.isWallOutline);
        if (!wall) return null;
        const bounds = wall.getBoundingRect(true, true);
        return {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height
        };
    };

    const getContentBounds = () => getWallBounds() || {
        left: 0, top: 0, width: canvas.getWidth(), height: canvas.getHeight()
    };

    const getMargins = () => currentViewMode === 'wall'
        ? { left: 40, right: 8, top: 36, bottom: 8 }
        : { left: 0, right: 0, top: 0, bottom: 0 };

    const getFitZoom = () => {
        const bounds = getContentBounds();
        const margins = getMargins();
        return Math.max(.001, Math.min(
            Math.max(1, viewport.clientWidth - margins.left - margins.right) / Math.max(1, bounds.width),
            Math.max(1, viewport.clientHeight - margins.top - margins.bottom) / Math.max(1, bounds.height)
        ));
    };
    const getZoomLimits = () => currentViewMode === 'wall'
        ? { min: Math.min(.1, getFitZoom()), max: Math.max(20, getFitZoom() * 4) }
        : { min: .1, max: 2 };
    const clampZoom = zoom => {
        const limits = getZoomLimits();
        return Math.max(limits.min, Math.min(limits.max, zoom));
    };

    const getOffsets = zoom => {
        const margins = getMargins();
        const totalWidth = canvas.getWidth() * zoom + margins.left + margins.right;
        const totalHeight = canvas.getHeight() * zoom + margins.top + margins.bottom;
        return {
            left: Math.max(margins.left, (viewport.clientWidth - totalWidth) / 2 + margins.left),
            top: Math.max(margins.top, (viewport.clientHeight - totalHeight) / 2 + margins.top)
        };
    };

    const applyZoom = (zoom, anchor = null) => {
        const nextZoom = clampZoom(zoom);
        const oldOffsets = {
            left: parseFloat(canvasWrapper.style.left) || 0,
            top: parseFloat(canvasWrapper.style.top) || 0
        };
        let worldX;
        let worldY;
        if (anchor) {
            worldX = (viewport.scrollLeft + anchor.x - oldOffsets.left) / currentCanvasZoom;
            worldY = (viewport.scrollTop + anchor.y - oldOffsets.top) / currentCanvasZoom;
        }

        const offsets = getOffsets(nextZoom);
        canvasWrapper.style.left = `${offsets.left}px`;
        canvasWrapper.style.top = `${offsets.top}px`;
        canvasWrapper.style.transform = `scale(${nextZoom})`;
        currentCanvasZoom = nextZoom;
        refreshCanvasRenderDensity(nextZoom);
        refreshSelectionControls();
        canvas.requestRenderAll();

        const content = getContentBounds();
        const scrollLeft = anchor
            ? offsets.left + worldX * nextZoom - anchor.x
            : offsets.left + (content.left + content.width / 2) * nextZoom - viewport.clientWidth / 2;
        const scrollTop = anchor
            ? offsets.top + worldY * nextZoom - anchor.y
            : offsets.top + (content.top + content.height / 2) * nextZoom - viewport.clientHeight / 2;
        viewport.scrollLeft = Math.max(0, scrollLeft);
        viewport.scrollTop = Math.max(0, scrollTop);
        canvas.calcOffset();

        const percent = Math.round(nextZoom * 100);
        const limits = getZoomLimits();
        zoomSlider.min = String(Math.max(.01, limits.min * 100));
        zoomSlider.max = String(Math.ceil(limits.max * 100));
        zoomSlider.value = String(percent);
        zoomSlider.setAttribute('aria-valuetext', `${percent}%`);
        if (zoomValue) zoomValue.value = `${percent}%`;
        if (currentViewMode === 'wall') renderWallRulers();
        window.refreshWorkspaceScaleBar?.();
        window.refreshWorkspaceGrid?.();
    };

    const fitCanvas = () => {
        if (!viewport.clientWidth || !viewport.clientHeight) return;
        applyZoom(getFitZoom());
    };

    const refreshCanvasZoomForView = forceFit => {
        const key = getCanvasZoomKey();
        if (!key) return;
        if (forceFit) canvasZoomByView.delete(key);
        if (activeCanvasZoomKey !== key) activeCanvasZoomKey = key;
        if (canvasZoomByView.has(key)) applyZoom(canvasZoomByView.get(key));
        else fitCanvas();
    };
    window.refreshCanvasZoomForView = refreshCanvasZoomForView;

    const setManualZoom = (zoom, anchor) => {
        const key = getCanvasZoomKey();
        if (!key) return;
        const nextZoom = clampZoom(zoom);
        canvasZoomByView.set(key, nextZoom);
        activeCanvasZoomKey = key;
        applyZoom(nextZoom, anchor);
    };

    zoomSlider.addEventListener('input', () => {
        setManualZoom(Number(zoomSlider.value) / 100, {
            x: viewport.clientWidth / 2,
            y: viewport.clientHeight / 2
        });
    });
    fitButton?.addEventListener('click', () => refreshCanvasZoomForView(true));

    viewport.addEventListener('wheel', event => {
        if (event.shiftKey) {
            viewport.scrollLeft += event.deltaY;
            viewport.scrollTop += event.deltaX;
            event.preventDefault();
            return;
        }
        const rect = viewport.getBoundingClientRect();
        const factor = Math.pow(1.1, -event.deltaY / 100);
        setManualZoom(currentCanvasZoom * factor, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        });
        event.preventDefault();
    }, { passive: false });

    let panStart = null;
    viewport.addEventListener('pointerdown', event => {
        if (event.button !== 1) return;
        panStart = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
        viewport.classList.add('is-panning');
        viewport.setPointerCapture(event.pointerId);
        event.preventDefault();
    });
    viewport.addEventListener('pointermove', event => {
        if (!panStart) return;
        viewport.scrollLeft = panStart.left - (event.clientX - panStart.x);
        viewport.scrollTop = panStart.top - (event.clientY - panStart.y);
    });
    const finishPan = () => {
        panStart = null;
        viewport.classList.remove('is-panning');
    };
    viewport.addEventListener('pointerup', finishPan);
    viewport.addEventListener('pointercancel', finishPan);

    // On touch screens, reserve one-finger gestures for Fabric object
    // editing and use two fingers to pan/zoom the drawing viewport.
    const touchPoints = new Map();
    let touchGestureConsumed = false;
    let previousTouchDistance = 0;
    let previousTouchCenter = null;

    const getTouchGeometry = () => {
        const points = [...touchPoints.values()];
        if (points.length < 2) return null;
        const rect = viewport.getBoundingClientRect();
        const a = points[0];
        const b = points[1];
        return {
            distance: Math.hypot(b.x - a.x, b.y - a.y),
            center: {
                x: (a.x + b.x) / 2 - rect.left,
                y: (a.y + b.y) / 2 - rect.top
            }
        };
    };

    viewport.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'touch') return;
        touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touchPoints.size >= 2) {
            touchGestureConsumed = true;
            previousTouchDistance = getTouchGeometry()?.distance || 0;
            previousTouchCenter = getTouchGeometry()?.center || null;
            event.preventDefault();
            event.stopPropagation();
            window.cancelDimensionDrawing?.();
            window.cancelLightingPlacement?.();
            window.cancelPerspectivePick?.();
            window.cancelMovableWallSlotPick?.();
            canvas.discardActiveObject();
            canvas.requestRenderAll();
        }
    }, true);

    viewport.addEventListener('pointermove', event => {
        if (event.pointerType !== 'touch' || !touchPoints.has(event.pointerId)) return;
        touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (!touchGestureConsumed) return;
        event.preventDefault();
        event.stopPropagation();
        const geometry = getTouchGeometry();
        if (!geometry || geometry.distance < 1 || !previousTouchDistance || !previousTouchCenter) return;
        const factor = geometry.distance / previousTouchDistance;
        setManualZoom(currentCanvasZoom * factor, previousTouchCenter);
        viewport.scrollLeft -= geometry.center.x - previousTouchCenter.x;
        viewport.scrollTop -= geometry.center.y - previousTouchCenter.y;
        canvas.calcOffset();
        previousTouchDistance = geometry.distance;
        previousTouchCenter = geometry.center;
    }, true);

    // Fabric 5 also listens to native touchmove, independently of pointermove.
    viewport.addEventListener('touchmove', event => {
        if (!touchGestureConsumed) return;
        event.preventDefault();
        event.stopPropagation();
    }, { capture: true, passive: false });

    const finishTouchGesture = event => {
        if (event.pointerType !== 'touch' || !touchPoints.has(event.pointerId)) return;
        if (touchGestureConsumed) {
            event.preventDefault();
            event.stopPropagation();
        }
        touchPoints.delete(event.pointerId);
        const geometry = getTouchGeometry();
        previousTouchDistance = geometry?.distance || 0;
        previousTouchCenter = geometry?.center || null;
        if (touchPoints.size === 0) touchGestureConsumed = false;
    };
    window.addEventListener('pointerup', finishTouchGesture, true);
    window.addEventListener('pointercancel', finishTouchGesture, true);
    window.addEventListener('blur', () => {
        touchPoints.clear();
        touchGestureConsumed = false;
        previousTouchDistance = 0;
        previousTouchCenter = null;
        finishPan();
    });

    const refreshViewport = () => {
        if (!canvasZoomApiReady || !viewport.clientWidth || !viewport.clientHeight) return;
        if (!canvasZoomByView.has(getCanvasZoomKey())) fitCanvas();
        else applyZoom(currentCanvasZoom, { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 });
    };
    const resizeObserver = window.ResizeObserver ? new ResizeObserver(refreshViewport) : null;
    resizeObserver?.observe(viewport);
    window.addEventListener('resize', refreshViewport);
    const watchScreenDensity = () => {
        const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
        query.addEventListener('change', () => {
            refreshCanvasRenderDensity(currentCanvasZoom);
            watchScreenDensity();
        }, { once: true });
    };
    watchScreenDensity();

    canvasZoomApiReady = true;
    requestAnimationFrame(() => requestAnimationFrame(() => refreshCanvasZoomForView(false)));
}

document.addEventListener('DOMContentLoaded', initializeCanvasZoom);
