// Artwork appearance and shared object editing rules.

function getArtworkAppearance(artwork) {
    if (artwork.isFixture) return { fill: '#d4d9de', stroke: '#66727d', text: '#26323b', dash: [4, 3] };
    return artwork.displayType === 'floor'
        ? { fill: '#f3d58b', stroke: '#94702f', text: '#172127', dash: null }
        : { fill: '#a9dce9', stroke: '#427c91', text: '#172127', dash: null };
}

function configureArtworkTransform(artwork) {
    if (!artwork?.isArtwork) return;
    const appearance = getArtworkAppearance(artwork);
    artwork.item?.(0)?.set({ fill: appearance.fill, stroke: appearance.stroke,
        strokeWidth: 1.5, strokeDashArray: appearance.dash });
    artwork.item?.(1)?.set({ fill: appearance.text });
    configureArtworkOutline(artwork);
    window.refreshArtworkNumberLabel?.(artwork);
    artwork.set({
        dirty: true,
        lockScalingX: true,
        lockScalingY: true,
        lockScalingFlip: true,
        lockSkewingX: true,
        lockSkewingY: true
    });
    artwork.setControlsVisibility?.({
        tl: false,
        tr: false,
        bl: false,
        br: false,
        ml: false,
        mt: false,
        mr: false,
        mb: false,
        mtr: true
    });
    artwork.setCoords();
}

function resizeNumberPin(pin) {
    const text = pin.item?.(1);
    const ring = pin.item?.(0);
    if (!text || !ring) return;
    text.set('fontSize', 12);
    text.initDimensions();
    ring.set({ radius: Math.max(10, text.width / 2 + 4), strokeWidth: 1 });
    pin.addWithUpdate();
    pin.setCoords();
}

function applyFixtureEditability() {
    canvas.getObjects().forEach(obj => {
        if (!obj.isFixture) return;
        obj.set({
            selectable: isAdminMode,
            evented: isAdminMode,
            hasControls: isAdminMode,
            lockMovementX: !isAdminMode,
            lockMovementY: !isAdminMode
        });
        if (obj.isArtwork) configureArtworkTransform(obj);
    });
    if (!isAdminMode && canvas.getActiveObjects().some(obj => obj.isFixture)) {
        canvas.discardActiveObject();
    }
    canvas.requestRenderAll();
}

function applyWallOutlineLock() {
    canvas.getObjects().forEach(obj => {
        const isLegacyWallOutline = obj.type === 'rect' &&
            obj.fill === '#f8fafc' && obj.stroke === '#334155';
        if (!obj.isWallOutline && !isLegacyWallOutline) return;
        obj.set({
            isWallOutline: true,
            // Retain stroke geometry so existing placement coordinates stay put.
            stroke: 'transparent',
            selectable: false,
            evented: false,
            hasControls: false,
            lockMovementX: true,
            lockMovementY: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true
        });
        obj.setCoords();
    });
    if (canvas.getActiveObjects().some(obj => obj.isWallOutline)) {
        canvas.discardActiveObject();
    }
}
