(() => {
    const pendingSnaps = new WeakMap();
    const canLink = artwork => currentViewMode === 'floor' && artwork?.isArtwork &&
        artwork.displayType === 'wall' && !artwork.isFixture && !artwork.group &&
        window.CURATOR_ROLE !== 'viewer';

    window.snapArtworkToFixedWall = (artwork, snappedToMovableWall = false) => {
        if (currentViewMode === 'floor' && artwork?.type === 'activeSelection') pendingSnaps.set(artwork, null);
        if (!canLink(artwork)) return false;
        pendingSnaps.set(artwork, null);
        if (snappedToMovableWall) return false;
        const body = artwork.item(0);
        if (!body) return false;
        const center = artwork.getCenterPoint();
        const zoom = canvas.lowerCanvasEl.getBoundingClientRect().width / canvas.getWidth() || 1;
        const threshold = Math.min(40, 22 / zoom);
        const halfWidth = body.width * Math.abs(artwork.scaleX || 1) / 2;
        const halfDepth = body.height * Math.abs(artwork.scaleY || 1) / 2;
        const candidates = [];
        for (const { id, start, end, faceSide } of window.getFixedWallSegments(selectedFloorId, configuredScale)) {
            const length = Math.hypot(end.x - start.x, end.z - start.z);
            if (!(length > 0) || halfWidth * 2 > length) continue;
            const tx = (end.x - start.x) / length, ty = (end.z - start.z) / length;
            const side = faceSide === -1 ? -1 : 1;
            const nx = -ty * side, ny = tx * side;
            const dx = center.x - start.x, dy = center.y - start.z;
            const away = dx * nx + dy * ny;
            if (away < 0) continue;
            const along = Math.max(halfWidth, Math.min(length - halfWidth, dx * tx + dy * ty));
            const x = start.x + tx * along, y = start.z + ty * along;
            const gap = Math.hypot(x + nx * halfDepth - center.x, y + ny * halfDepth - center.y);
            if (gap > threshold) continue;
            const angle = (Math.atan2(ty * side, tx * side) * 180 / Math.PI + 360) % 360;
            const fraction = (side > 0 ? along : length - along) / length;
            candidates.push({ id, x, y, nx, ny, gap, angle, fraction });
        }
        if (!candidates.length) return false;
        const original = { left: artwork.left, top: artwork.top, angle: artwork.angle };
        for (const candidate of candidates.sort((a, b) => a.gap - b.gap)) {
            artwork.set('angle', candidate.angle);
            // The registered line may sit inside the black pixels of the floor plan.
            // Step toward the room until the artwork clears the drawn wall.
            for (let clearance = .75; clearance <= threshold; clearance += 1) {
                const distance = halfDepth + clearance;
                const x = candidate.x + candidate.nx * distance;
                const y = candidate.y + candidate.ny * distance;
                if (Math.hypot(x - center.x, y - center.y) > threshold) continue;
                artwork.setPositionByOrigin(new fabric.Point(x, y), 'center', 'center');
                if (getWallCollisionScore(artwork) > 0) continue;
                artwork.setCoords();
                pendingSnaps.set(artwork, candidate);
                if (artwork.crowdCircle && original.angle !== candidate.angle) updateCrowdSemicircle(artwork);
                return true;
            }
        }
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

    window.shareFixedWallArtworkHeight = artwork => {
        if (!artwork?.fixedWallArtworkId || !artwork.fixedWallId) return false;
        const height = artwork.artworkCenterHeightCm;
        const update = raw => updateArtworkPlan(raw, object => {
            if (object.fixedWallArtworkId !== artwork.fixedWallArtworkId || object.artworkCenterHeightCm === height) return false;
            object.artworkCenterHeightCm = height;
            return true;
        });
        if (currentViewMode === 'wall') {
            const floor = floorPlanData[selectedFloorId];
            if (floor) {
                floor.json = update(floor.json);
                floorPlanJsonData = floor.json;
            }
        } else {
            const wall = wallPlanJsonData[artwork.fixedWallId];
            if (wall) wall.json = update(wall.json);
        }
        return true;
    };
})();
