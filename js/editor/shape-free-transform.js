// Transient controls edit the saved Polygon/Path geometry directly.
(() => {
    let enabled = false;
    let editing = null;
    let originalControls = null;
    let applying = false;

    const editable = object => object?.isShapeObject && !object.group && window.CURATOR_ROLE !== 'viewer';
    const transformPoint = (point, matrix) => fabric.util.transformPoint(new fabric.Point(point.x, point.y), matrix);
    const rawPoint = (object, ref) => ref.point !== undefined ? object.points[ref.point]
        : { x: object.path[ref.command][ref.offset], y: object.path[ref.command][ref.offset + 1] };
    const worldPoint = (object, point) => transformPoint({
        x: point.x - object.pathOffset.x, y: point.y - object.pathOffset.y
    }, object.calcTransformMatrix());

    function refsFor(object) {
        if (object.type === 'polygon') return object.points.map((point, index) => ({ point: index }));
        if (object.type !== 'path') return [];
        const refs = [];
        object.path.forEach((command, index) => {
            const offsets = { M: [1], L: [1], C: [1, 3, 5], Q: [1, 3] }[command[0]] || [];
            offsets.forEach(offset => refs.push({ command: index, offset,
                curve: (command[0] === 'C' && offset < 5) || (command[0] === 'Q' && offset === 1) }));
        });
        return refs;
    }

    function restoreControls() {
        if (!editing) return;
        editing.controls = originalControls;
        editing.setCoords();
        editing = originalControls = null;
    }

    function asEditableGeometry(object) {
        if (object.type === 'polygon' || object.type === 'path') return object;
        let replacement;
        const w = object.width, h = object.height;
        if (object.type === 'rect' || object.type === 'triangle') {
            const points = object.type === 'rect'
                ? [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]
                : [{ x: w / 2, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
            replacement = new fabric.Polygon(points, { fill: object.fill, stroke: object.stroke,
                strokeWidth: object.strokeWidth, strokeDashArray: object.strokeDashArray });
        } else if (['arrow', 'curvedArrow'].includes(object.shapeKind)) {
            // Older saved arrows used separate grouped parts.
            replacement = CuratorShapeEngine.create(object.shapeKind, {
                left: 0, top: 0, length: object.shapeLength || 180, head: object.shapeHeadSize || 22,
                stroke: object.shapeStroke || '#d9e0e3', fill: object.shapeFill || '#52616b'
            });
        } else return object;
        const center = object.getCenterPoint();
        ['angle', 'scaleX', 'scaleY', 'flipX', 'flipY', 'skewX', 'skewY', 'opacity',
            'isShapeObject', 'shapeKind', 'shapeLength', 'shapeHeadSize', 'shapeStroke', 'shapeFill']
            .forEach(key => { if (object[key] !== undefined) replacement.set(key, object[key]); });
        replacement.set({ objectCaching: false });
        replacement.setPositionByOrigin(center, 'center', 'center');
        const index = canvas.getObjects().indexOf(object);
        canvas.remove(object);
        canvas.add(replacement);
        replacement.moveTo(index);
        canvas.setActiveObject(replacement);
        replacement.setCoords();
        saveState();
        return replacement;
    }

    function installControls(object) {
        if (applying) return;
        applying = true;
        try {
            restoreControls();
            if (!enabled || !editable(object)) return;
            object = asEditableGeometry(object);
            const refs = refsFor(object);
            if (refs.length < 2) return;
            editing = object;
            originalControls = object.controls;
            const controls = {};
            refs.forEach((ref, index) => {
                controls[`vertex${index}`] = new fabric.Control({
                    cursorStyle: 'crosshair', actionName: 'modifyShape',
                    sizeX: 10, sizeY: 10, touchSizeX: 28, touchSizeY: 28,
                    positionHandler(dim, matrix, target) {
                        return transformPoint(worldPoint(target, rawPoint(target, ref)), target.canvas.viewportTransform);
                    },
                    actionHandler(event, transform, x, y) {
                        const target = transform.target;
                        if (!enabled || !editable(target)) return false;
                        // Inverse transform accounts for rotation, flips, skew and scaling.
                        const local = transformPoint({ x, y }, fabric.util.invertTransform(target.calcTransformMatrix()));
                        const next = { x: local.x + target.pathOffset.x, y: local.y + target.pathOffset.y };
                        if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) return false;
                        const anchor = refs.find((candidate, candidateIndex) => candidateIndex !== index && !candidate.curve)
                            || refs[(index + 1) % refs.length];
                        const fixed = worldPoint(target, rawPoint(target, anchor));
                        if (ref.point !== undefined) {
                            target.points[ref.point] = next;
                            target._setPositionDimensions({ left: target.left, top: target.top });
                        } else {
                            const path = target.path.map(command => command.slice());
                            path[ref.command][ref.offset] = next.x;
                            path[ref.command][ref.offset + 1] = next.y;
                            target._setPath(path, { left: target.left, top: target.top });
                        }
                        const shifted = worldPoint(target, rawPoint(target, anchor));
                        target.set({ left: target.left + fixed.x - shifted.x,
                            top: target.top + fixed.y - shifted.y, dirty: true });
                        target.setCoords();
                        canvas.requestRenderAll();
                        return true;
                    },
                    render(context, x, y) {
                        context.save();
                        context.fillStyle = ref.curve ? '#e5c67c' : '#b8dfec';
                        context.strokeStyle = '#27323a';
                        context.lineWidth = 1;
                        context.fillRect(x - 4, y - 4, 8, 8);
                        context.strokeRect(x - 4, y - 4, 8, 8);
                        context.restore();
                    }
                });
            });
            object.controls = controls;
            object.setCoords();
        } finally {
            applying = false;
            canvas.requestRenderAll();
        }
    }

    function setEnabled(value) {
        enabled = Boolean(value) && window.CURATOR_ROLE !== 'viewer';
        if (enabled) {
            window.cancelDimensionDrawing?.();
            window.cancelLightingPlacement?.();
            if (isFreeDrawingMode) toggleFreeDrawingMode(false);
            if (isMeasuringMode) toggleMeasuringMode(false);
        }
        installControls(enabled ? canvas.getActiveObject() : null);
        const button = document.getElementById('btnShapeFreeTransform');
        if (button) {
            button.textContent = enabled ? '自由変形を終了' : '自由変形';
            button.setAttribute('aria-pressed', String(enabled));
        }
    }
    window.endShapeFreeTransform = () => setEnabled(false);
    canvas.on('selection:created', event => installControls(event.selected?.[0]));
    canvas.on('selection:updated', event => installControls(event.selected?.[0]));
    canvas.on('selection:cleared', () => { if (!applying) restoreControls(); });
    canvas.on('canvas:cleared', () => setEnabled(false));
    canvas.on('object:removed', event => { if (event.target === editing && !applying) restoreControls(); });
    window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && enabled) setEnabled(false);
    });
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('btnShapeFreeTransform')?.addEventListener('click', () => setEnabled(!enabled));
    });
})();
