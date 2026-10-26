// A screen scale bar is a view preference, independent of exhibition data.
(() => {
    const key = 'curator_canvas_workspace_scale_visible';
    let visible = true;
    let frame = null;
    try { visible = editorStorage.getItem(key) !== 'false'; } catch {}

    function update() {
        frame = null;
        const bar = document.getElementById('workspaceScaleBar');
        const viewport = document.getElementById('canvasViewport');
        if (!bar || !viewport) return;
        bar.hidden = !visible || !window.isDiagramReady?.() || isTransitioning || (currentViewMode === 'wall' && !selectedWallInfo.id);
        if (bar.hidden) return;
        // Use the actual CSS display size, including the zoom slider and touch zoom.
        const zoom = canvas.lowerCanvasEl.getBoundingClientRect().width / canvas.getWidth();
        const pixelsPerCm = getDimensionScale() * zoom;
        if (!Number.isFinite(pixelsPerCm) || pixelsPerCm <= 0) { bar.hidden = true; return; }
        const targetWidth = Math.min(100, viewport.clientWidth * .3);
        const rawLength = targetWidth / pixelsPerCm;
        const exponent = Math.floor(Math.log10(rawLength));
        const lengths = [];
        for (let power = exponent - 1; power <= exponent + 1; power++) {
            [1, 2, 5].forEach(n => lengths.push(n * 10 ** power));
        }
        const length = lengths.filter(cm => cm * pixelsPerCm <= targetWidth * 1.2)
            .sort((a, b) => Math.abs(a * pixelsPerCm - targetWidth) - Math.abs(b * pixelsPerCm - targetWidth))[0];
        if (!length) { bar.hidden = true; return; }
        const label = length >= 100
            ? `${Number((length / 100).toPrecision(4))} m`
            : `${Number(length.toPrecision(4))} cm`;
        document.getElementById('workspaceScaleRule').style.width = `${length * pixelsPerCm}px`;
        document.getElementById('workspaceScaleLength').textContent = label;
        bar.setAttribute('aria-label', `縮尺バーの長さ ${label}`);
    }
    function scheduleUpdate() {
        if (frame === null) frame = requestAnimationFrame(update);
    }
    window.refreshWorkspaceScaleBar = scheduleUpdate;
    canvas.on('after:render', scheduleUpdate);
    document.addEventListener('DOMContentLoaded', () => {
        const input = document.getElementById('workspaceScaleVisibility');
        if (input) {
            input.checked = visible;
            input.addEventListener('change', () => {
                visible = input.checked;
                try { editorStorage.setItem(key, String(visible)); } catch {}
                scheduleUpdate();
            });
        }
        if (window.ResizeObserver) {
            const observer = new ResizeObserver(scheduleUpdate);
            const viewport = document.getElementById('canvasViewport');
            if (viewport) observer.observe(viewport);
        }
        window.addEventListener('resize', scheduleUpdate);
        scheduleUpdate();
    });
})();
