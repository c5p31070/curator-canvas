// Basic shape geometry. Objects use Fabric's standard transform handles.
window.CuratorShapeEngine = (() => {
    function create(kind, { left, top, length, head, stroke, fill }) {
        const shaftWidth = Math.max(8, Math.min(18, length * .07));
        const headLength = Math.min(head, length * .4);
        const midY = 50;
        let object;

        if (kind === 'rect') {
            object = new fabric.Rect({ left, top, width: length, height: 90, fill, stroke, strokeWidth: 2 });
        } else if (kind === 'triangle') {
            object = new fabric.Triangle({ left, top, width: length, height: length * .72, fill, stroke, strokeWidth: 2 });
        } else if (kind === 'arrow') {
            const shaft = new fabric.Rect({
                left, top: top + midY - shaftWidth / 2,
                width: length - headLength, height: shaftWidth, fill: stroke, strokeWidth: 0
            });
            const halfHead = Math.max(shaftWidth * 1.4, headLength * .72);
            const tip = new fabric.Polygon([
                { x: length - headLength, y: midY - halfHead },
                { x: length, y: midY },
                { x: length - headLength, y: midY + halfHead }
            ], { left, top, fill: stroke, strokeWidth: 0 });
            object = new fabric.Group([shaft, tip], { left, top });
        } else {
            const end = { x: length, y: 34 };
            const control = { x: length * .76, y: 8 };
            const start = { x: 0, y: 100 };
            const tangent = { x: end.x - control.x, y: end.y - control.y };
            const tangentLength = Math.hypot(tangent.x, tangent.y) || 1;
            tangent.x /= tangentLength;
            tangent.y /= tangentLength;
            const normal = { x: -tangent.y, y: tangent.x };
            const base = { x: end.x - tangent.x * headLength, y: end.y - tangent.y * headLength };
            const shaft = new fabric.Path(
                `M ${start.x} ${start.y} C ${length * .12} 8 ${control.x} ${control.y} ${base.x} ${base.y}`,
                { left, top, fill: '', stroke, strokeWidth: shaftWidth, strokeLineCap: 'round', strokeLineJoin: 'round' }
            );
            const arrowHead = new fabric.Polygon([
                { x: base.x + normal.x * headLength * .72, y: base.y + normal.y * headLength * .72 },
                end,
                { x: base.x - normal.x * headLength * .72, y: base.y - normal.y * headLength * .72 }
            ], { left, top, fill: stroke, stroke, strokeWidth: 1, strokeLineJoin: 'round' });
            object = new fabric.Group([shaft, arrowHead], { left, top });
        }

        object.set({
            isShapeObject: true,
            shapeKind: kind,
            shapeLength: length,
            shapeHeadSize: head,
            shapeStroke: stroke,
            shapeFill: fill,
            selectable: true,
            evented: true,
            objectCaching: false
        });
        return object;
    }

    return { create };
})();
