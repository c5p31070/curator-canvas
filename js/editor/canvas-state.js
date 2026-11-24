// 配置図の保存形式、保存データの復元、元に戻す・やり直す処理を管理します。
// Layout serialization, restoration, and Undo / Redo.

// Fabric properties that must survive saving and restoring a layout.
function getCustomProperties() {
    return [
        'isArtwork',
        'isMovableWall', 'movableWallId', 'movableWallName', 'movableWallNumber', 'movableFloorId', 'movableFrontId', 'movableBackId',
        'movableWallSlotId',
        'movableLeftId', 'movableRightId',
        'isShapeObject',
        'shapeKind',
        'shapeLength',
        'shapeHeadSize',
        'shapeStroke',
        'shapeFill',
        'artworkName',
        'artworkNumber',
        'artworkCatalogId',
        'artworkOutline',
        'description',
        'isPin',
        'pinName',
        'pinType', 'isNumberPin', 'pinNumber',
        'isFreeDrawing',
        'isDimension',
        'isDimensionLabel',
        'dimensionLengthPx',
        'isLightObject', 'isLightRail', 'lightId', 'lightKind', 'lightName',
        'lightOn', 'lightRailId', 'lightRailT', 'lightDirectionDeg',
        'lightTiltDeg',
        'lightRailAngleDeg', 'lightRailNormalSide',
        'lightAimMode', 'lightAimTargetId', 'lightingTargetId',
        'lightTargetXPercent', 'lightTargetYPercent',
        'lightGroundX', 'lightGroundY',
        'isWallOutline',
        'displayType',
        'sculptureBaseShape',
        'sculpturePedestal',
        'cmWidth',
        'cmHeight',
        'cmDepth',
        'artworkCenterHeightCm',
        'fixedWallId', 'fixedWallArtworkId',
        'pxWidth',
        'pxHeight',
        'crowdCountValue',
        'crowdRadius',
        'isCrowdCircle',
        'crowdLinkId',
        'isFreePin',
        'pinLabel',
        'isGuard',
        'isFixture'
    ];
}

function captureCurrentCanvasState() {
    if (isTransitioning || window.isVenueWallRendering?.() || (window.isDiagramReady && !window.isDiagramReady())) return;
    window.syncWallArtworkHeights?.();

    const plan = canvas.toJSON(getCustomProperties());

    if (currentViewMode === 'floor') {
        delete plan.backgroundImage;
        floorPlanJsonData = JSON.stringify(plan);
        floorPlanData[selectedFloorId] = {
            json: floorPlanJsonData
        };

    } else if (currentViewMode === 'wall' && selectedWallInfo && selectedWallInfo.id) {
        if (!wallPlanJsonData[selectedWallInfo.id]) {
            wallPlanJsonData[selectedWallInfo.id] = {
                floorId: selectedFloorId,
                title: selectedWallInfo.title,
                widthCm: selectedWallInfo.widthCm,
                heightCm: selectedWallInfo.heightCm,
                json: null
            };
        }

        wallPlanJsonData[selectedWallInfo.id].json = JSON.stringify(plan);
        delete wallPlanJsonData[selectedWallInfo.id].legacyHeightCm;
        wallPlanJsonData[selectedWallInfo.id].title = selectedWallInfo.title;
        wallPlanJsonData[selectedWallInfo.id].widthCm = selectedWallInfo.widthCm;
        wallPlanJsonData[selectedWallInfo.id].heightCm = selectedWallInfo.heightCm;
    }
}

function getSerializedCanvasData() {
    captureCurrentCanvasState();

    const titleInput = document.getElementById("exhibitionTitle");
    const exhibitionTitle = titleInput
        ? titleInput.value
        : "";

    const currentScale = configuredScale ?? (activeVenueId === 'public' ? null : 0.5);

    const data = {
        exhibitionTitle: exhibitionTitle,
        venueId: activeVenueId,
        scale: currentScale,
        currentViewMode: currentViewMode,
        selectedWallInfo: selectedWallInfo,
        floorPlanJsonData: floorPlanJsonData,
        selectedFloorId: selectedFloorId,
        floorPlanData: floorPlanData,
        wallPlanJsonData: wallPlanJsonData,
        savedArtworkCatalog: savedArtworkCatalog
    };
    Object.assign(data, window.getLayoutVariantsData?.(data));
    if (window.getVenueLightingData) data.venueLightingData = window.getVenueLightingData();
    if (window.getVenueWallData) data.venueWallData = window.getVenueWallData();
    return JSON.stringify(data);
}

function saveLocalStorage(snapshot) {
    if (window.isDiagramReady && !window.isDiagramReady()) return;

    try {
        const json = snapshot ?? getSerializedCanvasData();
        editorStorage.setItem(STORAGE_KEY, json);
        queueCloudExhibitionSave(json);

        const statusEl = document.getElementById("saveStatus");
        if (statusEl) {
            const now = new Date();
            const timeStr = now.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            statusEl.innerText = `自動保存済み (${timeStr})`;
        }
    } catch (e) {
        console.error("ローカルストレージへの保存に失敗しました:", e);
    }
}

function saveState() {
    if (window.isVenueWallRendering?.()) return;
    if (window.isDiagramReady && !window.isDiagramReady()) return;

    if (
        isUndoRedoOperation ||
        isMeasuringMode ||
        isDimensionDrawingMode ||
        window.isLightingRenderBusy?.() || window.isLightingPlacementActive?.() ||
        isTransitioning
    ) {
        return;
    }

    const json = getSerializedCanvasData();

    // Fabric events and UI commands can both save the same completed operation.
    if (historyStack[historyStack.length - 1] !== json) {
        historyStack.push(json);
        redoStack = [];
    }

    updateUndoRedoButtons();

    saveLocalStorage(json);
}

function undo() {
    if (window.CURATOR_ROLE === 'viewer') return;
    if (window.isLayoutVariantBusy?.()) return;

    // 編集欄の自動保存待ちがあれば、Undo対象として先に履歴へ確定する。
    if (typeof window.flushPendingItemEditHistory === 'function') {
        window.flushPendingItemEditHistory();
    }
    window.flushPendingLightingEdit?.();

    if (historyStack.length <= 1) {
        return;
    }

    isUndoRedoOperation = true;

    const currentState = historyStack.pop();
    redoStack.push(currentState);
    const prevState = historyStack[historyStack.length - 1];
    window.applyVenueLightingHistory?.(JSON.parse(prevState));

    applyStateData(prevState, function() {
        isUndoRedoOperation = false;
        updateUndoRedoButtons();
        saveLocalStorage();
    });
}

function redo() {
    if (window.CURATOR_ROLE === 'viewer') return;
    if (window.isLayoutVariantBusy?.()) return;
    window.flushPendingLightingEdit?.();

    if (redoStack.length === 0) {
        return;
    }

    isUndoRedoOperation = true;

    const nextState = redoStack.pop();
    window.applyVenueLightingHistory?.(JSON.parse(nextState));

    historyStack.push(nextState);

    applyStateData(nextState, function() {
        isUndoRedoOperation = false;
        updateUndoRedoButtons();
        saveLocalStorage();
    });
}

// ============================================================
// 保存データを現在の状態へ適用
// ============================================================

async function applyStateData(jsonString, callback) {
    window.cancelDimensionDrawing?.();
    window.cancelLightingPlacement?.();

    try {

        const parsed = JSON.parse(jsonString);
        const venue = venueOf(parsed);
        if (venue !== activeVenueId) {
            if (!await window.refreshTeamFloorScale?.(venue)) {
                throw new Error('会場の縮尺設定を読み込めません。公募展の場合はSupabaseの会場別縮尺設定を確認してください。');
            }
            activeVenueId = venue;
            FLOOR_PLANS = venue === 'public' ? PUBLIC_FLOOR_PLANS : SPECIAL_FLOOR_PLANS;
            configuredScale = window.CURATOR_SUPABASE_CONFIG ? null : loadConfiguredScale(venue);
        }
        window.applyActiveVenueScale?.();
        window.rememberLegacyVenueWalls?.(parsed);
        window.restoreVenueLightingData?.(parsed);
        window.restoreLayoutVariants?.(parsed);

        const exhibitionTitle =
            parsed.exhibitionTitle || "";

        // Exhibition loads and Undo must not replace an explicitly configured scale.
        if (!window.CURATOR_SUPABASE_CONFIG && configuredScale === null && Number(parsed.scale) > 0) {
            setConfiguredScale(parsed.scale);
        }
        const scaleValue = configuredScale ?? 0.5;

        const titleInput =
            document.getElementById("exhibitionTitle");

        if (
            titleInput &&
            parsed.exhibitionTitle !== undefined
        ) {
            titleInput.value = exhibitionTitle;
        }
        window.refreshExhibitionSaveUi?.();

        const scaleInput =
            document.getElementById("scale");

        selectedFloorId = Object.hasOwn(FLOOR_PLANS, parsed.selectedFloorId) ? parsed.selectedFloorId : firstVenueFloor();
        floorPlanData = Object.fromEntries(Object.keys(FLOOR_PLANS).map(id => [id, {
            json: parsed.floorPlanData
                ? parsed.floorPlanData[id]?.json || null
                : (id === 'lobby' ? parsed.floorPlanJsonData || null : null)
        }]));
        floorPlanJsonData = floorPlanData[selectedFloorId].json;
        cachedBackgroundImage = floorBackgroundImages.get(selectedFloorId) || null;
        if (scaleInput) scaleInput.value = activeVenueId === 'public' && configuredScale === null ? '' : scaleToPxPerMm(scaleValue);

        wallPlanJsonData = Object.fromEntries(Object.entries(parsed.wallPlanJsonData || {})
            .filter(([, wall]) => wall && isVenueFloor(wall.floorId)));
        window.applyVenueWallsToPlans?.();

        const hasArtworkCatalog = Array.isArray(parsed.savedArtworkCatalog);
        savedArtworkCatalog = hasArtworkCatalog
            ? parsed.savedArtworkCatalog
            : [];
        if (!hasArtworkCatalog) window.migrateArtworkCatalogFromPlans?.();
        window.repairArtworkHeightLinks?.();
        window.normalizeArtworkNumbers?.();
        window.refreshArtworkCatalog?.();

        selectedWallInfo = parsed.selectedWallInfo || { id: '', title: '', widthCm: 0, heightCm: 0 };

        updateWallDropdownOptions();

        const targetMode = parsed.currentViewMode === 'wall' ? 'wall' : 'floor';

        const loaded = await switchViewMode(
            targetMode,
            true,
            null,
            true
        );
        callback?.(loaded);
        return loaded;

    } catch (e) {

        console.error(
            "状態の適用に失敗しました:",
            e
        );

        if (callback) {
            callback(false);
        }
        return false;
    }
}

// ============================================================
// Undo / Redoボタン更新
// ============================================================

function updateUndoRedoButtons() {

    const btnUndo =
        document.getElementById("btnUndo");

    const btnRedo =
        document.getElementById("btnRedo");

    if (btnUndo) {
        btnUndo.disabled =
            historyStack.length <= 1;
    }

    if (btnRedo) {
        btnRedo.disabled =
            redoStack.length === 0;
    }
}

// ============================================================
// カスタムプロパティ復元
// ============================================================

function restoreCustomProperties() {

    const objects = canvas.getObjects();
    const matchedCrowdCircles = new Set();
    const legacyCircleObjects = objects.filter(obj => obj.type === 'circle');
    const crowdCirclesByLinkId = new Map();

    objects.forEach(obj => {
        if (!obj.isCrowdCircle || !obj.crowdLinkId) return;
        const linked = crowdCirclesByLinkId.get(obj.crowdLinkId) || [];
        linked.push(obj);
        crowdCirclesByLinkId.set(obj.crowdLinkId, linked);
    });

    objects.forEach(obj => {

        if (obj.isMovableWall) window.configureMovableWall?.(obj);
        if (obj.isArtwork) configureArtworkTransform(obj);

        if (
            obj.isArtwork &&
            obj.crowdCountValue
        ) {

            const linkedCircles = obj.crowdLinkId
                ? crowdCirclesByLinkId.get(obj.crowdLinkId) || []
                : [];
            let circle = linkedCircles.find(c => !matchedCrowdCircles.has(c)) || null;
            if (!circle) {
                const candidates = legacyCircleObjects.filter(c => !matchedCrowdCircles.has(c) &&
                    (c.isCrowdCircle || (c.left === obj.left && c.top === obj.top)));
                circle = candidates.sort((a, b) =>
                    a.getCenterPoint().distanceFrom(obj.getCenterPoint()) -
                    b.getCenterPoint().distanceFrom(obj.getCenterPoint())
                )[0];
            }

            if (circle) {
                matchedCrowdCircles.add(circle);
                const diagonal = Math.sqrt(
                    (Number(obj.pxWidth) || obj.getScaledWidth()) ** 2 +
                    (Number(obj.pxHeight) || obj.getScaledHeight()) ** 2
                );
                const expectedRadius = ((diagonal / 2) + 25) * 1.1;
                const points = circle.points || [];
                const firstPoint = points[0];
                const lastPoint = points[points.length - 1];
                const inferredRadius = firstPoint && lastPoint
                    ? Math.hypot(lastPoint.x - firstPoint.x, lastPoint.y - firstPoint.y) / 2
                    : 0;
                // Older saved plans did not serialize crowdRadius. Rebuild a radius
                // that survives those plans even if a previous restore shrank the polygon.
                const radius = Math.max(
                    Number(circle.crowdRadius) || 0,
                    Number(obj.crowdRadius) || 0,
                    inferredRadius,
                    expectedRadius,
                    40
                );
                obj.crowdRadius = radius;
                const fill = circle.fill;
                const stroke = circle.stroke;
                const strokeWidth = circle.strokeWidth || 2;
                const oldIndex = canvas.getObjects().indexOf(circle);
                canvas.remove(circle);
                const semicircle = createCrowdSemicircle(obj, radius, fill, stroke, strokeWidth);
                if (!obj.crowdLinkId) obj.crowdLinkId = `crowd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                semicircle.crowdLinkId = obj.crowdLinkId;
                canvas.insertAt(semicircle, Math.max(0, oldIndex), false);
                obj.crowdCircle = semicircle;
            }
        }

        if (obj.isNumberPin) resizeNumberPin(obj);
        if (!obj.isNumberPin && (obj.isPin || obj.isFreePin || obj.isGuard || obj.pinLabel !== undefined)) {
            const iconBackground = obj.item?.(0);
            const labelBackground = obj.item?.(2);
            const label = obj.item?.(3);
            if (iconBackground) iconBackground.set({ fill: 'rgba(255, 255, 255, 0)', opacity: 0 });
            if (label && labelBackground) {
                label.set({ fontSize: 9 });
                label.initDimensions();
                labelBackground.set({
                    width: Math.max(label.width + 8, 24),
                    height: 15,
                    fill: 'rgba(255, 255, 255, 0)',
                    strokeWidth: 1
                });
            }
        }
    });

    applyFixtureEditability();
    applyWallOutlineLock();
    canvas.getObjects().filter(obj => obj.isCrowdCircle).forEach(configureCrowdCircle);
    window.refreshDimensionLabels?.();
    window.refreshLighting?.();
}
