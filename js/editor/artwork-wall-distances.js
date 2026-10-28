// Selection guides stay outside Fabric: no hit testing, saved data or PDF marks.
(() => {
    const namespace = 'http://www.w3.org/2000/svg';
    let overlay = null;
    let frame = null;
    const svg = (name, attributes = {}) => {
        const node = document.createElementNS(namespace, name);
        Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
        return node;
    };
    const transform = (matrix, x, y) => fabric.util.transformPoint(new fabric.Point(x, y), matrix);

    function render() {
        frame = null;
        if (!overlay) return;
        const object = canvas.getActiveObject();
        const wall = canvas.getObjects().find(item => item.isWallOutline);
        const show = currentViewMode === 'wall' && !isTransitioning && window.isDiagramReady?.()
            && object?.isArtwork && !object.isFixture && object.visible !== false && wall;
        overlay.toggleAttribute('hidden', !show);
        overlay.replaceChildren();
        if (!show) return;
        const body = object.item?.(0);
        const widthCm = Number(selectedWallInfo?.widthCm), heightCm = Number(selectedWallInfo?.heightCm);
        const wallWidth = wall.width * Math.abs(wall.scaleX || 1);
        const wallHeight = wall.height * Math.abs(wall.scaleY || 1);
        if (!body || !(widthCm > 0 && heightCm > 0 && wallWidth > 0 && wallHeight > 0)) return;

        // Match wall height placement: physical edges exclude outline stroke.
        const left = wall.left, top = wall.top;
        const right = left + wallWidth, bottom = top + wallHeight;
        const scaleX = wallWidth / widthCm, scaleY = wallHeight / heightCm;
        const zoom = canvas.lowerCanvasEl.getBoundingClientRect().width / canvas.getWidth() || 1;
        const pixel = 1 / zoom;
        overlay.setAttribute('viewBox', `0 0 ${canvas.getWidth()} ${canvas.getHeight()}`);
        overlay.setAttribute('width', canvas.getWidth());
        overlay.setAttribute('height', canvas.getHeight());

        const matrix = body.calcTransformMatrix();
        const center = transform(matrix, 0, 0);
        const localRight = transform(matrix, body.width / 2, 0);
        const quarterTurns = Math.round(Math.atan2(localRight.y - center.y, localRight.x - center.x) / (Math.PI / 2));
        const midpoints = [
            transform(matrix, 0, -body.height / 2), transform(matrix, body.width / 2, 0),
            transform(matrix, 0, body.height / 2), transform(matrix, -body.width / 2, 0)
        ];
        // Assign the actual four edge midpoints to the nearest wall directions,
        // including when the work has been rotated by 90 degrees or freely.
        const sides = [];
        midpoints.forEach((point, index) => { sides[((index + quarterTurns) % 4 + 4) % 4] = point; });
        const guides = [
            { name: '上', start: sides[0], end: { x: sides[0].x, y: top }, cm: (sides[0].y - top) / scaleY, vertical: true },
            { name: '右', start: sides[1], end: { x: right, y: sides[1].y }, cm: (right - sides[1].x) / scaleX },
            { name: '下', start: sides[2], end: { x: sides[2].x, y: bottom }, cm: (bottom - sides[2].y) / scaleY, vertical: true },
            { name: '左', start: sides[3], end: { x: left, y: sides[3].y }, cm: (sides[3].x - left) / scaleX }
        ];
        guides.forEach(guide => {
            const group = svg('g');
            const color = guide.cm < -.05 ? '#a15f45' : '#466b80';
            const line = (x1, y1, x2, y2) => group.appendChild(svg('line', {
                x1, y1, x2, y2, stroke: color, 'stroke-width': 1,
                'vector-effect': 'non-scaling-stroke'
            }));
            line(guide.start.x, guide.start.y, guide.end.x, guide.end.y);
            [guide.start, guide.end].forEach(point => {
                const cap = 3 * pixel;
                if (guide.vertical) line(point.x - cap, point.y, point.x + cap, point.y);
                else line(point.x, point.y - cap, point.x, point.y + cap);
            });
            const distance = Math.round(guide.cm * 10) / 10;
            const label = `${guide.name} ${Object.is(distance, -0) ? 0 : distance} cm`;
            const labelWidth = (label.length * 6 + 10) * pixel;
            const labelHeight = 16 * pixel;
            const margin = 2 * pixel;
            const desiredX = (guide.start.x + guide.end.x) / 2 + (guide.vertical ? labelWidth / 2 + 5 * pixel : 0);
            const desiredY = (guide.start.y + guide.end.y) / 2 - (guide.vertical ? 0 : 10 * pixel);
            const x = Math.max(labelWidth / 2 + margin, Math.min(canvas.width - labelWidth / 2 - margin, desiredX));
            const y = Math.max(labelHeight / 2 + margin, Math.min(canvas.height - labelHeight / 2 - margin, desiredY));
            group.appendChild(svg('rect', { x: x - labelWidth / 2, y: y - labelHeight / 2,
                width: labelWidth, height: labelHeight, fill: '#f8fafc', 'fill-opacity': .9 }));
            const text = svg('text', { x, y, fill: color, 'font-family': 'Arial, sans-serif',
                'font-size': 10 * pixel, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
            text.textContent = label;
            group.appendChild(text);
            overlay.appendChild(group);
        });
    }

    function schedule() {
        if (frame === null) frame = requestAnimationFrame(render);
    }
    canvas.on('after:render', schedule);
    ['selection:created', 'selection:updated', 'selection:cleared', 'object:moving', 'object:rotating', 'object:modified', 'object:removed'].forEach(event => canvas.on(event, schedule));
    document.addEventListener('DOMContentLoaded', () => {
        overlay = svg('svg', { id: 'artworkWallDistanceOverlay', 'aria-hidden': 'true', preserveAspectRatio: 'none', hidden: '' });
        overlay.style.cssText = 'position:absolute;inset:0;overflow:visible;pointer-events:none;z-index:4';
        canvas.wrapperEl.appendChild(overlay);
        window.addEventListener('resize', schedule);
        schedule();
    });
})();
