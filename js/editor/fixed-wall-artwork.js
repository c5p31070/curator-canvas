(() => {
    const pendingSnaps = new WeakMap();
    const canLink = artwork => currentViewMode === 'floor' && artwork?.isArtwork &&
        artwork.displayType === 'wall' && !artwork.isFixture && !artwork.group &&
        window.CURATOR_ROLE !== 'viewer';

    window.snapArtworkToFixedWall = (artwork, snappedToMovableWall = false) => {
        if (currentViewMode === 'floor' && artwork?.type === 'activeSelection') pendingSnaps.set(artwork, null);
        if (!canLink(artwork)) return false;
        const previousWallId = pendingSnaps.has(artwork) ? pendingSnaps.get(artwork)?.id : artwork.fixedWallId;
        pendingSnaps.set(artwork, null);
        if (snappedToMovableWall) return false;
        const body = artwork.item(0);
        if (!body) return false;
        const center = artwork.getCenterPoint();
        const zoom = canvas.lowerCanvasEl.getBoundingClientRect().width / canvas.getWidth() || 1;
        const snapDistance = Math.min(64, 32 / zoom);
        const releaseDistance = Math.min(80, 42 / zoom);
        const maxClearance = 40;
        const halfWidth = body.width * Math.abs(artwork.scaleX || 1) / 2;
        const halfDepth = body.height * Math.abs(artwork.scaleY || 1) / 2;
        const original = { left: artwork.left, top: artwork.top, angle: artwork.angle };
        let best = null;
        for (const { id, start, end, faceSide } of window.getFixedWallSegments(selectedFloorId, configuredScale)) {
            const length = Math.hypot(end.x - start.x, end.z - start.z);
            if (!(length > 0) || halfWidth * 2 > length) continue;
            const tx = (end.x - start.x) / length, ty = (end.z - start.z) / length;
            const side = faceSide === -1 ? -1 : 1;
            const nx = -ty * side, ny = tx * side;
            const dx = center.x - start.x, dy = center.y - start.z;
            const away = dx * nx + dy * ny;
            if (away < 0) continue;
            const projection = dx * tx + dy * ty;
            const along = Math.max(halfWidth, Math.min(length - halfWidth, projection));
            const continuing = id === previousWallId && projection >= 0 && projection <= length;
            const threshold = continuing ? releaseDistance : snapDistance;
            const nearestClearance = Math.max(.75, Math.min(maxClearance, away - halfDepth));
            if (Math.hypot(along - projection, halfDepth + nearestClearance - away) > threshold) continue;
            const x = start.x + tx * along, y = start.z + ty * along;
            const angle = (Math.atan2(ty * side, tx * side) * 180 / Math.PI + 360) % 360;
            const fraction = (side > 0 ? along : length - along) / length;
            artwork.set('angle', angle);
            // The registered line may sit inside the black pixels of the floor plan.
            // Find the wall contact point before checking the snap distance.
            for (let clearance = .75; clearance <= maxClearance; clearance += 1) {
                const distance = halfDepth + clearance;
                const point = new fabric.Point(x + nx * distance, y + ny * distance);
                artwork.setPositionByOrigin(point, 'center', 'center');
                if (getWallCollisionScore(artwork) > 0) continue;
                const gap = Math.hypot(point.x - center.x, point.y - center.y);
                const score = gap - (continuing ? 5 / zoom : 0);
                if (gap <= threshold && (!best || score < best.score)) best = { id, point, angle, fraction, score };
                break;
            }
        }
        if (best) {
            artwork.set('angle', best.angle);
            artwork.setPositionByOrigin(best.point, 'center', 'center');
            artwork.setCoords();
            pendingSnaps.set(artwork, best);
            if (artwork.crowdCircle && original.angle !== best.angle) updateCrowdSemicircle(artwork);
            return true;
        }
        if (artwork.left === original.left && artwork.top === original.top && artwork.angle === original.angle) return false;
        artwork.set(original);
        artwork.setCoords();
        return false;
    };

    function readWallPlan(wall) {
        if (!wall) return null;
        try {
            return typeof wall.json === 'string' ? JSON.parse(wall.json) : (wall.json || { objects: [] });
        } catch (error) {
            console.error('固定壁の配置を読み込めませんでした。', error);
            return null;
        }
    }

    window.removeFixedWallArtwork = artwork => {
        if (currentViewMode !== 'floor' || !artwork?.fixedWallArtworkId) return;
        const wall = wallPlanJsonData[artwork.fixedWallId];
        const plan = readWallPlan(wall);
        if (!Array.isArray(plan?.objects)) return;
        const elevation = plan.objects.find(object => object.fixedWallArtworkId === artwork.fixedWallArtworkId);
        if (!elevation) return;
        const remaining = plan.objects.filter(object => object !== elevation &&
            !(object.isCrowdCircle && elevation.crowdLinkId && object.crowdLinkId === elevation.crowdLinkId));
        if (remaining.length !== plan.objects.length) wall.json = JSON.stringify({ ...plan, objects: remaining });
    };

    function detach(artwork) {
        if (!artwork.fixedWallArtworkId) return;
        window.removeFixedWallArtwork(artwork);
        artwork.fixedWallId = null;
        artwork.fixedWallArtworkId = null;
    }

    window.commitFixedWallArtwork = artwork => {
        if (currentViewMode !== 'floor' || !pendingSnaps.has(artwork)) return;
        const snap = pendingSnaps.get(artwork);
        pendingSnaps.delete(artwork);
        if (artwork.type === 'activeSelection') {
            artwork.getObjects().forEach(detach);
            return;
        }
        if (!canLink(artwork)) return;
        if (!snap) {
            detach(artwork);
            return;
        }
        const wall = wallPlanJsonData[snap.id];
        const plan = readWallPlan(wall);
        if (!Array.isArray(plan?.objects)) return;
        const height = Number(wall.heightCm);
        if (!(height > 0)) return;
        const frame = plan.objects.find(object => object.isWallOutline) ||
            createWallOutline(wall, configuredScale).toObject(getCustomProperties());
        const wallWidth = frame.width * (frame.scaleX || 1);
        const wallHeight = frame.height * (frame.scaleY || 1);
        const old = plan.objects.find(object => artwork.fixedWallArtworkId && object.fixedWallArtworkId === artwork.fixedWallArtworkId);
        const centerHeight = old?.artworkCenterHeightCm ?? artwork.artworkCenterHeightCm ?? height / 2;
        if (artwork.fixedWallId !== snap.id) window.removeFixedWallArtwork(artwork);
        artwork.fixedWallArtworkId ||= crypto.randomUUID();
        artwork.fixedWallId = snap.id;
        artwork.artworkCenterHeightCm = centerHeight;
        const elevation = {
            ...(old || {
                ...artwork.toObject(getCustomProperties()),
                angle: 0, crowdLinkId: null, crowdCountValue: 0, crowdRadius: null
            }),
            originX: 'center', originY: 'center',
            left: frame.left + snap.fraction * wallWidth,
            top: frame.top + wallHeight * (1 - centerHeight / height)
        };
        const objects = plan.objects.slice();
        if (!objects.includes(frame)) objects.unshift(frame);
        const previous = objects.indexOf(old);
        if (previous >= 0) objects[previous] = elevation;
        else objects.push(elevation);
        wall.json = JSON.stringify({ ...plan, objects });
    };

    function updateLinkedArtwork(plan, artwork, update) {
        plan.json = updateArtworkPlan(plan.json, object =>
            object.fixedWallArtworkId === artwork.fixedWallArtworkId && object.fixedWallId === artwork.fixedWallId
            && update(object));
    }

    window.syncFixedWallArtworkPosition = event => {
        const target = event.target;
        if (currentViewMode !== 'wall' || isTransitioning || isUndoRedoOperation || window.CURATOR_ROLE === 'viewer' ||
            (event.action || event.transform?.action) !== 'drag' || !target ||
            event.transform?.original?.left === target.left) return;
        const artworks = target.type === 'activeSelection' ? target.getObjects() : [target];
        const linked = artworks.filter(artwork => artwork.fixedWallArtworkId && artwork.fixedWallId === selectedWallInfo.id);
        if (!linked.length) return;
        const frame = canvas.getObjects().find(object => object.isWallOutline);
        const width = frame?.width * (frame?.scaleX || 1);
        const floor = floorPlanData[selectedFloorId];
        const segment = window.getFixedWallSegments(selectedFloorId, configuredScale).find(wall => wall.id === selectedWallInfo.id);
        if (!floor || !(width > 0) || !segment) return;
        // The wall's left edge is defined as seen from its exhibition side.
        const [start, end] = segment.faceSide === -1 ? [segment.end, segment.start] : [segment.start, segment.end];
        const length = Math.hypot(end.x - start.x, end.z - start.z);
        if (!(length > 0)) return;
        const tx = (end.x - start.x) / length, ty = (end.z - start.z) / length;
        for (const artwork of linked) {
            const body = artwork.item?.(0);
            const center = body ? fabric.util.transformPoint(new fabric.Point(0, 0), body.calcTransformMatrix()) : artwork.getCenterPoint();
            const along = (center.x - frame.left) * length / width;
            if (!Number.isFinite(along)) continue;
            updateLinkedArtwork(floor, artwork, object => {
                if (![object.left, object.top].every(Number.isFinite)) return false;
                const previous = (object.left - start.x) * tx + (object.top - start.z) * ty;
                const delta = along - previous;
                if (Math.abs(delta) < .01) return false;
                object.left += tx * delta;
                object.top += ty * delta;
                return true;
            });
        }
        floorPlanJsonData = floor.json;
    };

    window.shareFixedWallArtworkHeight = artwork => {
        if (!artwork?.fixedWallArtworkId || !artwork.fixedWallId) return false;
        const height = artwork.artworkCenterHeightCm;
        const update = object => {
            if (object.artworkCenterHeightCm === height) return false;
            object.artworkCenterHeightCm = height;
            return true;
        };
        if (currentViewMode === 'wall') {
            const floor = floorPlanData[selectedFloorId];
            if (floor) {
                updateLinkedArtwork(floor, artwork, update);
                floorPlanJsonData = floor.json;
            }
        } else {
            const wall = wallPlanJsonData[artwork.fixedWallId];
            if (wall) updateLinkedArtwork(wall, artwork, update);
        }
        return true;
    };
})();
