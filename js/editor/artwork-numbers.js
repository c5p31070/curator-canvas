// Numbers belong to catalogued works, so plan and elevation share a label.
(() => {
    const valid = value => Number.isSafeInteger(value) && value > 0;
    const visitPlans = visitor => {
        Object.values(floorPlanData).forEach(floor => { floor.json = updateArtworkPlan(floor.json, visitor); });
        Object.values(wallPlanJsonData).forEach(wall => { wall.json = updateArtworkPlan(wall.json, visitor); });
    };
    window.nextArtworkNumber = () => {
        let max = 0;
        const include = number => { if (valid(number)) max = Math.max(max, number); };
        savedArtworkCatalog.forEach(item => include(item.artworkNumber));
        visitPlans(object => { include(object.artworkNumber); return false; });
        canvas.getObjects().filter(object => object.isArtwork && !object.isFixture).forEach(object => include(object.artworkNumber));
        return max + 1;
    };
    window.ensureArtworkCatalogNumbers = () => {
        const used = new Set();
        savedArtworkCatalog.forEach(item => {
            if (!valid(item.artworkNumber) || used.has(item.artworkNumber)) item.artworkNumber = window.nextArtworkNumber();
            used.add(item.artworkNumber);
        });
    };
    window.getArtworkNumber = object => {
        if (!object?.isArtwork || object.isFixture) return null;
        window.ensureArtworkCatalogNumbers();
        const entry = findArtworkCatalogReference(object);
        object.artworkNumber = entry?.artworkNumber || (valid(object.artworkNumber) ? object.artworkNumber : window.nextArtworkNumber());
        return object.artworkNumber;
    };
    window.normalizeArtworkNumbers = () => {
        window.ensureArtworkCatalogNumbers();
        let next = window.nextArtworkNumber();
        const orphanNumbers = new Map();
        visitPlans(object => {
            if (object.isFixture) return false;
            const previous = object.artworkNumber;
            const previousId = object.artworkCatalogId;
            if (!valid(object.artworkNumber) && !findArtworkCatalogReference(object)) {
                object.artworkNumber = orphanNumbers.get(object.artworkCatalogId) || next++;
                if (object.artworkCatalogId) orphanNumbers.set(object.artworkCatalogId, object.artworkNumber);
            }
            window.getArtworkNumber(object);
            return previous !== object.artworkNumber || previousId !== object.artworkCatalogId;
        });
    };
    window.refreshArtworkNumberLabel = object => {
        if (!object?.isArtwork || object.isFixture) return;
        const label = object.item?.(1);
        const body = object.item?.(0);
        if (!label || !body) return;
        const number = window.getArtworkNumber(object);
        label.set({ text: `No.${number}`, fontSize: 9, scaleX: 1, scaleY: 1 });
        label.initDimensions();
        const fit = Math.min(1, Math.max(1, body.width - 2) / Math.max(1, label.width),
            Math.max(1, body.height - 2) / Math.max(1, label.height));
        label.set({ fontSize: 9 * fit });
        label.initDimensions();
        // The text must not enlarge the physical bounds used for placement.
        object.set({ width: body.width, height: body.height, dirty: true });
        object.setCoords();
    };
})();
