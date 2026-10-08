// Shape panel UI. Geometry lives in shape-engine.js.
function initializeShapeTools() {
    const kindInput = document.getElementById('shapeKind');
    const lengthInput = document.getElementById('shapeLength');
    const headInput = document.getElementById('shapeHeadSize');
    const strokeInput = document.getElementById('shapeStroke');
    const fillInput = document.getElementById('shapeFill');
    const addButton = document.getElementById('btnAddShape');
    const updateButton = document.getElementById('btnUpdateShape');
    if (!kindInput || !addButton || !window.CuratorShapeEngine) return;

    const number = (input, fallback, min, max) => Math.max(min, Math.min(max, Number(input?.value) || fallback));
    const createShape = (kind, length, head, stroke, fill) => {
        const center = canvas.getCenter();
        return CuratorShapeEngine.create(kind, {
            left: center.left - length / 2,
            top: center.top - 35,
            length, head, stroke, fill
        });
    };
    const getParameters = () => ({
        kind: kindInput.value,
        length: number(lengthInput, 180, 20, 1000),
        head: number(headInput, 22, 4, 120),
        stroke: strokeInput?.value || '#d9e0e3',
        fill: fillInput?.value || '#52616b'
    });

    addButton.addEventListener('click', () => {
        if (window.CURATOR_ROLE === 'viewer') return;
        const p = getParameters();
        const object = createShape(p.kind, p.length, p.head, p.stroke, p.fill);
        canvas.add(object);
        canvas.setActiveObject(object);
        canvas.requestRenderAll();
        saveState();
    });

    updateButton?.addEventListener('click', () => {
        if (window.CURATOR_ROLE === 'viewer') return;
        const selected = canvas.getActiveObject();
        if (!selected?.isShapeObject) return;
        const p = getParameters();
        const center = selected.getCenterPoint();
        const replacement = createShape(p.kind, p.length, p.head, p.stroke, p.fill);
        replacement.setPositionByOrigin(center, 'center', 'center');
        replacement.set('angle', selected.angle || 0);
        canvas.remove(selected);
        canvas.add(replacement);
        canvas.setActiveObject(replacement);
        replacement.setCoords();
        canvas.requestRenderAll();
        saveState();
    });

    canvas.on('selection:created', syncShapeFields);
    canvas.on('selection:updated', syncShapeFields);
    function syncShapeFields(event) {
        const selected = event.selected?.[0] || canvas.getActiveObject();
        if (!selected?.isShapeObject) return;
        kindInput.value = selected.shapeKind || 'rect';
        if (lengthInput) lengthInput.value = selected.shapeLength || 180;
        if (headInput) headInput.value = selected.shapeHeadSize || 22;
        if (strokeInput) strokeInput.value = selected.shapeStroke || '#d9e0e3';
        if (fillInput) fillInput.value = selected.shapeFill || '#52616b';
    }
}

document.addEventListener('DOMContentLoaded', initializeShapeTools);
