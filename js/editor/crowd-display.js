// 展示物に追従する混雑予想半円の形・大きさ・向きと、表示の切り替えを管理します。
// Crowd indicator geometry, placement, and visibility.

function createCrowdSemicircle(artwork, radius, fill, stroke = '#333', strokeWidth = 2) {
    if (!artwork.crowdLinkId) artwork.crowdLinkId = `crowd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    artwork.crowdRadius = radius;
    const center = artwork.getCenterPoint();
    const angle = (artwork.angle || 0) * Math.PI / 180;
    const nx = Math.sin(angle), ny = Math.cos(angle);
    const tx = -ny, ty = nx;
    const halfExtent = artwork.getScaledHeight() / 2;
    const base = { x: center.x + nx * halfExtent, y: center.y + ny * halfExtent };
    const polygonCenter = { x: base.x + nx * radius / 2, y: base.y + ny * radius / 2 };
    const points = [];
    for (let i = 0; i <= 24; i++) {
        const angle = Math.PI * i / 24;
        points.push({
            x: tx * radius * Math.cos(angle) + nx * (radius * Math.sin(angle) - radius / 2),
            y: ty * radius * Math.cos(angle) + ny * (radius * Math.sin(angle) - radius / 2)
        });
    }
    const poly = new fabric.Polygon(points, {
        left: polygonCenter.x, top: polygonCenter.y, originX: 'center', originY: 'center',
        fill, stroke, strokeWidth, selectable: false, evented: false, isCrowdCircle: true,
        crowdRadius: radius, crowdLinkId: artwork.crowdLinkId || null
    });
    configureCrowdCircle(poly);
    return poly;
}

function updateCrowdSemicircle(artwork) {
    if (!artwork?.crowdCircle) return;
    const old = artwork.crowdCircle;
    const radius = old.crowdRadius || old.radius || 40;
    const replacement = createCrowdSemicircle(artwork, radius, old.fill, old.stroke, old.strokeWidth || 2);
    if (!artwork.crowdLinkId) artwork.crowdLinkId = `crowd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    replacement.crowdLinkId = artwork.crowdLinkId;
    const index = canvas.getObjects().indexOf(old);
    const wasUndoRedoOperation = isUndoRedoOperation;
    isUndoRedoOperation = true;
    canvas.remove(old);
    canvas.insertAt(replacement, Math.max(0, index), false);
    isUndoRedoOperation = wasUndoRedoOperation;
    artwork.crowdCircle = replacement;
}

function positionCrowdSemicircle(artwork) {
    const crowd = artwork?.crowdCircle;
    if (!crowd) return;
    const center = artwork.getCenterPoint();
    const angle = (artwork.angle || 0) * Math.PI / 180;
    const nx = Math.sin(angle), ny = Math.cos(angle);
    const radius = crowd.crowdRadius || 40;
    const distance = artwork.getScaledHeight() / 2 + radius / 2;
    crowd.set({ left: center.x + nx * distance, top: center.y + ny * distance });
    crowd.setCoords();
}

function setCrowdVisibility(visible) {
    crowdVisible = Boolean(visible);
    try { editorStorage.setItem('curator_canvas_crowd_visible', String(crowdVisible)); }
    catch (error) { console.warn('混雑予想の表示設定を保存できませんでした。', error); }
    canvas.getObjects().filter(obj => obj.isCrowdCircle).forEach(configureCrowdCircle);
    syncCrowdVisibilityButton();
    canvas.requestRenderAll();
}

function syncCrowdVisibilityButton() {
    const button = document.querySelector('[data-action="crowd-visibility"]');
    button?.setAttribute('aria-pressed', String(crowdVisible));
    button?.classList.toggle('active', crowdVisible);
}

function configureCrowdCircle(circle) {
    if (!circle) return;
    const hiddenArtwork = canvas.getObjects().some(artwork =>
        artwork.isArtwork && !isArtworkTypeVisible(artwork) && (artwork.crowdCircle === circle ||
            (circle.crowdLinkId && artwork.crowdLinkId === circle.crowdLinkId)));
    circle.set({
        isCrowdCircle: true,
        visible: crowdVisible && !hiddenArtwork,
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true
    });
    circle.setCoords();
}
