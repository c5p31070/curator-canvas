// 壁面展示物の輪郭形状、頂点データ、描画と番号配置に使う形状計算をまとめています。
// Vertices describe the front face in fractions of the artwork's overall width and height.
const artworkOutlinePresets = {
    rectangle: [[0, 0], [1, 0], [1, 1], [0, 1]],
    triangle: [[.5, 0], [1, 1], [0, 1]],
    diamond: [[.5, 0], [1, .5], [.5, 1], [0, .5]],
    trapezoid: [[.22, 0], [.78, 0], [1, 1], [0, 1]],
    hexagon: [[.25, 0], [.75, 0], [1, .5], [.75, 1], [.25, 1], [0, .5]],
    joined: [[0, 0], [.55, 0], [.55, .42], [1, .42], [1, 1], [0, 1]],
    step: [[0, 0], [.36, 0], [.36, .33], [.68, .33], [.68, .66], [1, .66], [1, 1], [0, 1]]
};

const maxArtworkOutlineVertices = 12;
const artworkOutlineTurn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function triangulateArtworkOutline(points) {
    if (!Array.isArray(points) || points.length < 3 || points.length > maxArtworkOutlineVertices ||
        !points.every(point => Array.isArray(point) && point.length === 2 &&
            point.every(value => Number.isFinite(value) && value >= 0 && value <= 1))) return [];
    const next = i => (i + 1) % points.length;
    const epsilon = 1e-6;
    const side = (a, b, c) => {
        const cross = artworkOutlineTurn(a, b, c);
        return Math.abs(cross) <= epsilon ? 0 : Math.sign(cross);
    };
    const spansOverlap = (a, b, c, d) =>
        Math.max(Math.min(a, b), Math.min(c, d)) <= Math.min(Math.max(a, b), Math.max(c, d)) + epsilon;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[next(i)];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < .005) return [];
        area += a[0] * b[1] - b[0] * a[1];
        for (let j = i + 2; j < points.length; j++) {
            if (next(j) === i) continue;
            const c = points[j], d = points[next(j)];
            if (spansOverlap(a[0], b[0], c[0], d[0]) && spansOverlap(a[1], b[1], c[1], d[1]) &&
                side(a, b, c) * side(a, b, d) <= 0 && side(c, d, a) * side(c, d, b) <= 0) return [];
        }
    }
    if (Math.abs(area) < .02) return [];
    const remaining = area > 0 ? points.slice() : points.slice().reverse();
    const triangles = [];
    while (remaining.length > 3) {
        const index = remaining.findIndex((b, i) => {
            const a = remaining[(i + remaining.length - 1) % remaining.length];
            const c = remaining[(i + 1) % remaining.length];
            return artworkOutlineTurn(a, b, c) > epsilon &&
                !remaining.some(p => p !== a && p !== b && p !== c &&
                    side(a, b, p) >= 0 && side(b, c, p) >= 0 && side(c, a, p) >= 0);
        });
        if (index < 0) return [];
        triangles.push([remaining[(index + remaining.length - 1) % remaining.length], remaining[index],
            remaining[(index + 1) % remaining.length]]);
        remaining.splice(index, 1);
    }
    if (artworkOutlineTurn(...remaining) > epsilon) triangles.push(remaining);
    return triangles;
}

function artworkOutlineLabelArea(outline, triangles, width, height) {
    if (!triangles.length) return null;
    const toLocal = ([x, y]) => [(x - .5) * width, (y - .5) * height];
    const polygon = outline.map(toLocal);
    const candidates = [];
    const center = [.5, .5];
    if (triangles.some(([a, b, c]) => [artworkOutlineTurn(a, b, center),
        artworkOutlineTurn(b, c, center), artworkOutlineTurn(c, a, center)].every(value => value >= 0))) {
        candidates.push([0, 0]);
    }
    // Try each triangle's incenter, measuring clearance against the original outline.
    for (const triangle of triangles) {
        const points = triangle.map(toLocal);
        const weights = points.map((_, i) => {
            const a = points[(i + 1) % 3], b = points[(i + 2) % 3];
            return Math.hypot(a[0] - b[0], a[1] - b[1]);
        });
        const perimeter = weights.reduce((sum, value) => sum + value, 0);
        candidates.push([0, 1].map(axis => points.reduce((sum, point, i) => sum + point[axis] * weights[i], 0) / perimeter));
    }
    let best = null;
    for (const [x, y] of candidates) {
        const clearance = polygon.map(([ax, ay], i) => {
            const [bx, by] = polygon[(i + 1) % polygon.length];
            const dx = bx - ax, dy = by - ay;
            const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
            return Math.hypot(x - ax - t * dx, y - ay - t * dy);
        });
        const size = Math.SQRT2 * Math.min(...clearance);
        if (size > (best?.size || 0)) best = { x, y, size };
    }
    return best;
}

function configureArtworkOutline(artwork) {
    if (currentViewMode !== 'wall' || artwork.displayType !== 'wall' ||
        !triangulateArtworkOutline(artwork.artworkOutline).length) return;
    const body = artwork.item?.(0);
    if (body?.type !== 'rect') return;
    // The existing body rectangle remains the dimensional reference for Fabric controls and snapping.
    body._render = function (ctx) {
        ctx.beginPath();
        artwork.artworkOutline.forEach(([x, y], index) => {
            const method = index ? 'lineTo' : 'moveTo';
            ctx[method]((x - .5) * this.width, (y - .5) * this.height);
        });
        ctx.closePath();
        this._renderPaintInOrder(ctx);
    };
    body.dirty = true;
}
