// Dimension annotations are ordinary Fabric groups; previews never enter saved data.
let dimensionStartPoint = null;
let dimensionPreview = null;

function getDimensionScale() {
    if (currentViewMode === 'wall') {
        const outline = canvas.getObjects().find(obj => obj.isWallOutline);
        const heightCm = Number(selectedWallInfo?.heightCm);
        const scale = Number(outline?.height) * Math.abs(Number(outline?.scaleY) || 1) / heightCm;
        if (Number.isFinite(scale) && scale > 0) return scale;
    }
    const scale = Number(document.getElementById('scale')?.value);
    return Number.isFinite(scale) && scale > 0 ? scale : 0.5;
}

function formatDimensionLength(lengthPx) {
    return `${Number((lengthPx / getDimensionScale()).toFixed(1))} cm`;
}

function configureDimensionObject(obj) {
    obj.set({
        lockScalingX: true, lockScalingY: true, lockScalingFlip: true,
        lockSkewingX: true, lockSkewingY: true
    });
    obj.setControlsVisibility({
        tl: false, tr: false, bl: false, br: false,
        ml: false, mt: false, mr: false, mb: false, mtr: false
    });
    obj.setCoords();
}

function createDimensionObject(start, end, preview = false) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) return null;
    // Read dimension text left-to-right, including when dragged in reverse.
    if (dx < 0 || (dx === 0 && dy < 0)) return createDimensionObject(end, start, preview);
    const angle = Math.atan2(dy, dx);
    const offset = 26;
    const arrow = Math.min(7, length / 4);
    const line = points => new fabric.Line(points, {
        stroke: '#485b68', strokeWidth: 1, selectable: false, evented: false
    });
    const label = new fabric.Text(formatDimensionLength(length), {
        left: length / 2, top: offset - 9,
        originX: 'center', originY: 'center', fontFamily: 'Arial', fontSize: 11,
        fill: '#344650', backgroundColor: 'rgba(255,255,255,0.88)',
        isDimensionLabel: true, selectable: false, evented: false
    });
    const parts = [
        line([0, 0, 0, offset + 4]), line([length, 0, length, offset + 4]),
        line([0, offset, length, offset]),
        line([0, offset, arrow, offset - 3]), line([0, offset, arrow, offset + 3]),
        line([length, offset, length - arrow, offset - 3]),
        line([length, offset, length - arrow, offset + 3]), label
    ];
    const group = new fabric.Group(parts, {
        originX: 'center', originY: 'center',
        isDimension: true, dimensionLengthPx: length,
        selectable: !preview, evented: !preview, excludeFromExport: preview,
        objectCaching: false
    });
    const center = group.getCenterPoint();
    group.set({
        left: start.x + Math.cos(angle) * center.x - Math.sin(angle) * center.y,
        top: start.y + Math.sin(angle) * center.x + Math.cos(angle) * center.y,
        angle: angle * 180 / Math.PI
    });
    configureDimensionObject(group);
    return group;
}

function refreshDimensionLabels() {
    canvas.getObjects().filter(obj => obj.isDimension).forEach(obj => {
        configureDimensionObject(obj);
        const label = obj.getObjects().find(part => part.isDimensionLabel);
        if (label) {
            label.set('text', formatDimensionLength(Number(obj.dimensionLengthPx) || 0));
            label.initDimensions();
            obj.dirty = true;
        }
    });
    canvas.requestRenderAll();
}
window.refreshDimensionLabels = refreshDimensionLabels;

function cancelDimensionDrawing() {
    if (!isDimensionDrawingMode) return;
    if (dimensionPreview) canvas.remove(dimensionPreview);
    dimensionPreview = null;
    dimensionStartPoint = null;
    isDimensionDrawingMode = false;
    canvas.skipTargetFind = false;
    canvas.selection = true;
    canvas.defaultCursor = 'default';
    const button = document.getElementById('btnAddDimension');
    if (button) {
        button.textContent = '寸法線を追加';
        button.setAttribute('aria-pressed', 'false');
    }
    canvas.requestRenderAll();
}
window.cancelDimensionDrawing = cancelDimensionDrawing;

function startDimensionDrawing() {
    window.endShapeFreeTransform?.();
    if (window.CURATOR_ROLE === 'viewer') return;
    window.cancelLightingPlacement?.();
    if (isDimensionDrawingMode) return cancelDimensionDrawing();
    window.flushPendingItemEditHistory?.();
    if (isFreeDrawingMode) toggleFreeDrawingMode(false);
    if (isMeasuringMode) toggleMeasuringMode(false);
    canvas.discardActiveObject();
    isDimensionDrawingMode = true;
    canvas.skipTargetFind = true;
    canvas.selection = false;
    canvas.defaultCursor = 'crosshair';
    const button = document.getElementById('btnAddDimension');
    if (button) {
        button.textContent = '寸法線をキャンセル';
        button.setAttribute('aria-pressed', 'true');
    }
    canvas.requestRenderAll();
}

canvas.on('mouse:down', event => {
    if (!isDimensionDrawingMode || (event.e.button !== undefined && event.e.button !== 0)) return;
    dimensionStartPoint = canvas.getPointer(event.e);
});
canvas.on('mouse:move', event => {
    if (!isDimensionDrawingMode || !dimensionStartPoint) return;
    if (dimensionPreview) canvas.remove(dimensionPreview);
    dimensionPreview = createDimensionObject(dimensionStartPoint, canvas.getPointer(event.e), true);
    if (dimensionPreview) canvas.add(dimensionPreview);
    canvas.requestRenderAll();
});
canvas.on('mouse:up', event => {
    if (!isDimensionDrawingMode || !dimensionStartPoint) return;
    const end = canvas.getPointer(event.e);
    if (Math.hypot(end.x - dimensionStartPoint.x, end.y - dimensionStartPoint.y) < 8) {
        if (dimensionPreview) canvas.remove(dimensionPreview);
        dimensionPreview = null;
        dimensionStartPoint = null;
        return;
    }
    const dimension = createDimensionObject(dimensionStartPoint, end);
    // Keep save events suppressed until the preview is removed and creation is complete.
    if (dimensionPreview) canvas.remove(dimensionPreview);
    dimensionPreview = null;
    canvas.add(dimension);
    cancelDimensionDrawing();
    canvas.setActiveObject(dimension);
    canvas.requestRenderAll();
    saveState();
});

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnAddDimension')?.addEventListener('click', startDimensionDrawing);
});
window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isDimensionDrawingMode) {
        cancelDimensionDrawing();
        event.preventDefault();
    }
});
