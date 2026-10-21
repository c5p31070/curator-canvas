// Basic shape geometry. Objects use Fabric's standard transform handles.
window.CuratorShapeEngine = (() => {
    function create(kind, { left, top, length, head, stroke, fill }) {
        const shaftWidth = Math.max(8, Math.min(18, length * .07));
        const headLength = Math.min(head, length * .4);
        const halfShaft = shaftWidth / 2;
        const halfHead = Math.max(halfShaft + 3, headLength * .72);
        const baseX = length - headLength;
        let object;

        if (kind === 'rect') {
            object = new fabric.Rect({ left, top, width: length, height: 90, fill, stroke, strokeWidth: 2 });
        } else if (kind === 'triangle') {
            object = new fabric.Triangle({ left, top, width: length, height: length * .72, fill, stroke, strokeWidth: 2 });
        } else if (kind === 'arrow') {
            // One outline keeps the shaft and arrowhead aligned under every transform.
            object = new fabric.Polygon([
                { x: 0, y: -halfShaft },
                { x: baseX, y: -halfShaft },
                { x: baseX, y: -halfHead },
                { x: length, y: 0 },
                { x: baseX, y: halfHead },
                { x: baseX, y: halfShaft },
                { x: 0, y: halfShaft }
            ], { left, top, fill: stroke, strokeWidth: 0 });
        } else {
            const bend = Math.min(80, length * .38);
            const c1 = baseX * .4;
            const c2 = baseX * .6;
            // Closed ribbon with a horizontal end tangent, joined directly to the head.
            object = new fabric.Path([
                `M 0 ${bend - halfShaft}`,
                `C ${c1} ${bend - halfShaft} ${c2} ${-halfShaft} ${baseX} ${-halfShaft}`,
                `L ${baseX} ${-halfHead} L ${length} 0 L ${baseX} ${halfHead}`,
                `L ${baseX} ${halfShaft}`,
                `C ${c2} ${halfShaft} ${c1} ${bend + halfShaft} 0 ${bend + halfShaft}`,
                'Z'
            ].join(' '), { left, top, fill: stroke, strokeWidth: 0 });
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
