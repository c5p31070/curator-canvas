let canvasZoomByView = new Map();
let activeCanvasZoomKey = null;
let currentCanvasZoom = 1;
let canvasZoomApiReady = false;

function getCanvasZoomKey() {
    if (currentViewMode === 'floor') return `floor:${selectedFloorId}`;
    if (currentViewMode === 'wall') return `wall:${selectedWallInfo?.id || 'default'}`;
    return null;
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

    const getOffsets = zoom => {
        const margins = getMargins();
        const totalWidth = (canvas.getWidth() + margins.left + margins.right) * zoom;
        const totalHeight = (canvas.getHeight() + margins.top + margins.bottom) * zoom;
        return {
            left: Math.max(margins.left * zoom, (viewport.clientWidth - totalWidth) / 2 + margins.left * zoom),
            top: Math.max(margins.top * zoom, (viewport.clientHeight - totalHeight) / 2 + margins.top * zoom)
        };
    };

    const applyZoom = (zoom, anchor = null) => {
        const nextZoom = Math.max(.1, Math.min(2, zoom));
        const oldOffsets = getOffsets(currentCanvasZoom);
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

        const content = getContentBounds();
        const scrollLeft = anchor
            ? offsets.left + worldX * nextZoom - anchor.x
            : offsets.left + (content.left + content.width / 2) * nextZoom - viewport.clientWidth / 2;
        const scrollTop = anchor
            ? offsets.top + worldY * nextZoom - anchor.y
            : offsets.top + (content.top + content.height / 2) * nextZoom - viewport.clientHeight / 2;
        viewport.scrollLeft = Math.max(0, scrollLeft);
        viewport.scrollTop = Math.max(0, scrollTop);

        const percent = Math.round(nextZoom * 100);
        zoomSlider.value = String(percent);
        if (zoomValue) zoomValue.value = `${percent}%`;
        if (currentViewMode === 'wall') renderWallRulers();
    };

    const fitCanvas = () => {
        if (!viewport.clientWidth || !viewport.clientHeight) return;
        const bounds = getContentBounds();
        const margins = getMargins();
        const widthRatio = (viewport.clientWidth - (margins.left + margins.right) * .9) / bounds.width;
        const heightRatio = (viewport.clientHeight - (margins.top + margins.bottom) * .9) / bounds.height;
        applyZoom(Math.min(2, widthRatio, heightRatio));
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
        const nextZoom = Math.max(.1, Math.min(2, zoom));
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

    // On phones in landscape, reserve one-finger gestures for Fabric object
    // editing and use two fingers to pan/zoom the drawing viewport.
    const touchPoints = new Map();
    let touchGestureConsumed = false;
    let previousTouchDistance = 0;

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
            event.preventDefault();
            event.stopPropagation();
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
        if (!geometry || !previousTouchDistance) return;
        const factor = geometry.distance / previousTouchDistance;
        setManualZoom(currentCanvasZoom * factor, geometry.center);
        previousTouchDistance = geometry.distance;
    }, true);

    const finishTouchGesture = event => {
        if (event.pointerType !== 'touch') return;
        if (touchGestureConsumed) {
            event.preventDefault();
            event.stopPropagation();
        }
        touchPoints.delete(event.pointerId);
        if (touchPoints.size < 2) previousTouchDistance = 0;
        if (touchPoints.size === 0) touchGestureConsumed = false;
    };
    viewport.addEventListener('pointerup', finishTouchGesture, true);
    viewport.addEventListener('pointercancel', finishTouchGesture, true);

    const resizeObserver = window.ResizeObserver ? new ResizeObserver(() => {
        if (canvasZoomApiReady && !canvasZoomByView.has(getCanvasZoomKey())) fitCanvas();
    }) : null;
    resizeObserver?.observe(viewport);
    window.addEventListener('resize', () => {
        if (!canvasZoomByView.has(getCanvasZoomKey())) fitCanvas();
    });

    canvasZoomApiReady = true;
    requestAnimationFrame(() => requestAnimationFrame(() => refreshCanvasZoomForView(false)));
}

document.addEventListener('DOMContentLoaded', initializeCanvasZoom);
