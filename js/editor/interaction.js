// ============================================================
// curator-canvas
// interaction.js
// 壁衝突・回転・測定・マウス操作
// ============================================================

// ============================================================
// 壁衝突判定
// ============================================================

let wallCollisionPixels = null;
window.invalidateWallCollisionData = () => { wallCollisionPixels = null; };

function getWallCollisionScore(obj, includeMovableWalls = true) {

    if (
        !isWallDataLoaded ||
        !obj ||
        obj.isPin ||
        obj.isShapeObject ||
        obj.isDimension ||
        obj.isLightObject || obj.isLightRail || obj.isLightBeam ||
        obj.isFreePin ||
        obj.isGuard ||
        obj.pinLabel !== undefined ||
        obj.isFreeDrawing ||
        obj.type === 'path' ||
        currentViewMode === 'wall'
    ) {
        return 0;
    }

    const boundingRect =
        obj.getBoundingRect(true, true);

    if (
        boundingRect.left < 2 ||
        boundingRect.left + boundingRect.width >
            canvas.width - 2 ||
        boundingRect.top < 2 ||
        boundingRect.top + boundingRect.height >
            canvas.height - 2
    ) {
        return 10;
    }

    const inset =
        Math.min(
            3,
            Math.min(
                boundingRect.width,
                boundingRect.height
            ) / 4
        );

    const left =
        boundingRect.left + inset;

    const top =
        boundingRect.top + inset;

    const right =
        boundingRect.left +
        boundingRect.width -
        inset;

    const bottom =
        boundingRect.top +
        boundingRect.height -
        inset;

    const centerX =
        Math.floor(
            boundingRect.left +
            boundingRect.width / 2
        );

    const centerY =
        Math.floor(
            boundingRect.top +
            boundingRect.height / 2
        );

    const samplePoints = [
        { x: centerX, y: centerY },
        { x: Math.floor(left), y: Math.floor(top) },
        { x: Math.floor(right), y: Math.floor(top) },
        { x: Math.floor(left), y: Math.floor(bottom) },
        { x: Math.floor(right), y: Math.floor(bottom) },
        { x: Math.floor(centerX), y: Math.floor(top) },
        { x: Math.floor(centerX), y: Math.floor(bottom) },
        { x: Math.floor(left), y: Math.floor(centerY) },
        { x: Math.floor(right), y: Math.floor(centerY) }
    ];

    try {

        let collisionScore = 0;
        const pixels = wallCollisionPixels || (wallCollisionPixels =
            wallCtx.getImageData(0, 0, wallCanvas.width, wallCanvas.height).data);
        for (let pt of samplePoints) {

            if (
                pt.x >= 0 &&
                pt.x < canvas.width &&
                pt.y >= 0 &&
                pt.y < canvas.height
            ) {

                const index = (pt.y * wallCanvas.width + pt.x) * 4;

                if (
                    pixels[index] < 50 &&
                    pixels[index + 1] < 50 &&
                    pixels[index + 2] < 50 &&
                    pixels[index + 3] > 100
                ) {
                    collisionScore++;
                }
            }
        }
        return collisionScore + (includeMovableWalls ? (window.getMovableWallCollisionScore?.(obj) || 0) : 0);

    } catch (e) {

        console.error(
            "壁衝突判定エラー:",
            e
        );
    }

    return 0;
}

function checkCollisionWithWall(obj) {
    return getWallCollisionScore(obj) > 0;
}

function snapObjectToFloorWall(obj) {
    if (currentViewMode !== 'floor' || !isWallDataLoaded ||
        (!obj?.isArtwork && !obj?.isMovableWall) || obj.isFixture || obj.group ||
        window.CURATOR_ROLE === 'viewer' || getWallCollisionScore(obj) > 0) return false;
    const origin = { left: obj.left, top: obj.top };
    const zoom = canvas.lowerCanvasEl.getBoundingClientRect().width / canvas.getWidth() || 1;
    const threshold = Math.min(40, 22 / zoom);
    let best = null;
    // Find the first contact from the room side; never search through a wall
    // to a far face. Preserve rotation and let the next drag detach naturally.
    for (let direction = 0; direction < 8; direction++) {
        const angle = direction * Math.PI / 4;
        const dx = Math.cos(angle), dy = Math.sin(angle);
        const limit = Math.min(threshold, best?.distance ?? threshold);
        let previous = 0;
        for (let distance = Math.min(1, limit); distance <= limit + .0001; distance = Math.min(distance + 1, limit)) {
            obj.set({ left: origin.left + dx * distance, top: origin.top + dy * distance });
            if (getWallCollisionScore(obj, false) > 0) {
                let low = previous, high = distance;
                for (let iteration = 0; iteration < 7; iteration++) {
                    const middle = (low + high) / 2;
                    obj.set({ left: origin.left + dx * middle, top: origin.top + dy * middle });
                    if (getWallCollisionScore(obj, false) > 0) high = middle;
                    else low = middle;
                }
                const candidate = { left: origin.left + dx * low, top: origin.top + dy * low };
                obj.set(candidate);
                if (getWallCollisionScore(obj) === 0) best = { ...candidate, distance: low };
                break;
            }
            previous = distance;
            if (distance >= limit) break;
        }
    }
    obj.set(best ? { left: best.left, top: best.top } : origin);
    obj.setCoords();
    return Boolean(best);
}

// Keep the free component of a drag instead of cancelling the entire movement
// when the pointer pushes an object into a wall. No attachment is persisted.
function slideObjectAlongWall(obj, origin, destination, allowedScore = 0) {
    const evaluate = point => {
        obj.set({ left: point.left, top: point.top });
        return getWallCollisionScore(obj);
    };
    let best = { ...origin };
    let bestDistance = Math.hypot(destination.left - origin.left, destination.top - origin.top);
    const consider = point => {
        const distance = Math.hypot(destination.left - point.left, destination.top - point.top);
        if (distance < bestDistance && evaluate(point) <= allowedScore) {
            best = { ...point };
            bestDistance = distance;
        }
    };
    consider({ left: destination.left, top: origin.top });
    consider({ left: origin.left, top: destination.top });

    // Advance to the contact boundary, including diagonal wall approaches.
    // Refine from both the original position and the best sliding position.
    [origin, { ...best }].forEach(start => {
        let low = 0, high = 1;
        for (let iteration = 0; iteration < 10; iteration++) {
            const fraction = (low + high) / 2;
            const point = {
                left: start.left + (destination.left - start.left) * fraction,
                top: start.top + (destination.top - start.top) * fraction
            };
            if (evaluate(point) <= allowedScore) {
                low = fraction;
                consider(point);
            } else high = fraction;
        }
    });
    obj.set(best);
    obj.setCoords();
    return getWallCollisionScore(obj);
}

// ============================================================
// 選択オブジェクト90度回転
// ============================================================

function rotateActiveObject() {

    const activeObj =
        canvas.getActiveObject();

    if (!activeObj) {

        alert(
            "回転させたいオブジェクトをキャンバス上で選択してください。"
        );

        return;
    }
    if (activeObj.isLightObject || activeObj.isLightRail) {
        window.rotateLightingObject?.(activeObj);
        return;
    }

    const currentAngle =
        activeObj.angle || 0;

    const newAngle =
        (currentAngle + 90) % 360;

    const originalAngle =
        activeObj.angle;

    activeObj.set(
        'angle',
        newAngle
    );

    activeObj.setCoords();

    if (checkCollisionWithWall(activeObj)) {

        activeObj.set(
            'angle',
            originalAngle
        );

        activeObj.setCoords();

        const angleInput = document.getElementById('editItemAngle');
        if (activeObj.isArtwork && angleInput) {
            angleInput.value = Math.round(originalAngle || 0);
        }

        alert(
            "壁（黒線）をまたぐため回転できません。"
        );

    } else {

        const angleInput = document.getElementById('editItemAngle');
        if (activeObj.isArtwork && angleInput) {
            angleInput.value = Math.round(newAngle);
        }
        if (activeObj.isMovableWall) window.refreshMovableWallPanel?.(activeObj);

        if (
            activeObj.isArtwork &&
            activeObj.crowdCircle
        ) {

            updateCrowdSemicircle(activeObj);
        }

        canvas.renderAll();

        saveState();
    }
}

// ============================================================
// 保存データ読み込み
// ============================================================

function loadSavedData() {

    // Signed-in users open shared exhibitions explicitly; don't mix per-browser drafts between accounts.
    if (window.CURATOR_SUPABASE_CONFIG) {
        historyStack = [getSerializedCanvasData()];
        redoStack = [];
        updateUndoRedoButtons();
        window.applyCuratorRoleRestrictions?.();
        return;
    }

    const savedData =
        localStorage.getItem(STORAGE_KEY);

    if (savedData) {

        try {

            isUndoRedoOperation = true;

            applyStateData(
                savedData,
                function() {

                    isUndoRedoOperation = false;

                    historyStack = [savedData];

                    redoStack = [];

                    updateUndoRedoButtons();

                    const statusEl =
                        document.getElementById(
                            "saveStatus"
                        );

                    if (statusEl) {
                        statusEl.innerText =
                            "前回のデータを読み込みました";
                    }
                    window.applyCuratorRoleRestrictions?.();
                }
            );

        } catch (e) {

            console.error(
                "保存データの読み込みに失敗しました:",
                e
            );

            saveState();
        }

    } else {

        saveState();
        window.applyCuratorRoleRestrictions?.();
    }
}

// ============================================================
// カウンター
// ============================================================

let artworkCount = 0;
let pinCount = 0;

// ============================================================
// 混雑度カラー
// ============================================================

function getCrowdColor(count) {

    const MAX_PEOPLE = 15;

    const ratio =
        Math.min(
            Math.max(
                count / MAX_PEOPLE,
                0
            ),
            1
        );

    let r, g, b;

    if (ratio < 0.5) {

        const factor =
            ratio * 2;

        r =
            Math.round(
                46 +
                (241 - 46) *
                factor
            );

        g =
            Math.round(
                204 +
                (196 - 204) *
                factor
            );

        b =
            Math.round(
                113 +
                (15 - 113) *
                factor
            );

    } else {

        const factor =
            (ratio - 0.5) * 2;

        r =
            Math.round(
                241 +
                (231 - 241) *
                factor
            );

        g =
            Math.round(
                196 +
                (76 - 196) *
                factor
            );

        b =
            Math.round(
                15 +
                (60 - 15) *
                factor
            );
    }

    return {
        fill:
            `rgba(${r}, ${g}, ${b}, 0.28)`,

        stroke:
            `rgba(${r}, ${g}, ${b}, 0.68)`
    };
}

// ============================================================
// Fabric.jsイベント
// ============================================================

canvas.on(
    'object:modified',
    function(event) {
        window.updateArtworkHeightFromWall?.(event.target, true);
        window.persistLightingEquipmentChange?.(event.target);
        saveState();
    }
);

canvas.on(
    'object:added',
    function(e) {

        if (
            !isUndoRedoOperation &&
            !isMeasuringMode &&
            !isTransitioning
        ) {
            saveState();
        }
    }
);

canvas.on(
    'object:removed',
    function(e) {
        window.handleLightingObjectRemoved?.(e.target);

        if (
            !isUndoRedoOperation &&
            !isMeasuringMode &&
            !isTransitioning
        ) {
            saveState();
        }
    }
);

canvas.on('path:created', function(e) {
    if (!e.path) return;
    e.path.set({ isFreeDrawing: true, selectable: true, evented: true });
    e.path.setCoords();
    saveState();
});

// ============================================================
// 移動イベント
// ============================================================

let lastValidPosition = {
    left: 0,
    top: 0
};
let draggingOutOfWallCollision = false;
let lastValidCollisionScore = 0;

// ------------------------------------------------------------
// マウスダウン
// ------------------------------------------------------------

canvas.on(
    'mouse:down',
    function(e) {

        if (isMeasuringMode) {

            isMeasuring = true;

            const pointer =
                canvas.getPointer(e.e);

            measureStartPt = pointer;

            measureLine =
                new fabric.Line(
                    [
                        pointer.x,
                        pointer.y,
                        pointer.x,
                        pointer.y
                    ],
                    {
                        stroke: '#ef4444',

                        strokeWidth: 4,

                        strokeDashArray: [6, 4],

                        selectable: false,

                        evented: false
                    }
                );

            canvas.add(measureLine);

            return;
        }

        if (e.target) {

            lastValidPosition = {
                left: e.target.left,
                top: e.target.top
            };
            lastValidCollisionScore = getWallCollisionScore(e.target);
            draggingOutOfWallCollision = lastValidCollisionScore > 0;
        }
    }
);

// ------------------------------------------------------------
// マウス移動
// ------------------------------------------------------------

canvas.on(
    'mouse:move',
    function(e) {

        if (
            isMeasuringMode &&
            isMeasuring &&
            measureLine
        ) {

            const pointer =
                canvas.getPointer(e.e);

            measureLine.set({
                x2: pointer.x,
                y2: pointer.y
            });

            canvas.renderAll();
        }
    }
);

// ------------------------------------------------------------
// マウスアップ
// ------------------------------------------------------------

canvas.on(
    'mouse:up',
    async function(e) {

        draggingOutOfWallCollision = false;

        if (isMeasuringMode && isMeasuring) {

            isMeasuring = false;

            const pointer =
                canvas.getPointer(e.e);

            const dx =
                pointer.x -
                measureStartPt.x;

            const dy =
                pointer.y -
                measureStartPt.y;

            const linePixelLength =
                Math.sqrt(
                    dx * dx +
                    dy * dy
                );

            if (measureLine) {

                canvas.remove(
                    measureLine
                );

                measureLine = null;
            }

            if (linePixelLength < 10) {

                alert(
                    "ドラッグ線が短すぎます。もう一度壁の端から端までしっかりドラッグしてください。"
                );

                return;
            }

            {

                const realLengthCmStr =
                    prompt(
                        `測定した線の長さ（画面上 ${Math.round(linePixelLength)} px）は、現実で何 cm ですか？`,
                        "300"
                    );

                if (realLengthCmStr) {

                    const realLengthCm =
                        parseFloat(
                            realLengthCmStr
                        );

                    if (
                        !isNaN(realLengthCm) &&
                        realLengthCm > 0
                    ) {

                        const calculatedScale =
                            Math.round(
                                (
                                    linePixelLength /
                                    realLengthCm
                                ) * 1000
                            ) / 1000;

                        if (!await window.saveTeamFloorScale(calculatedScale)) {
                            toggleMeasuringMode(false);
                            return;
                        }

                        alert(
                            `縮尺スケールを [ ${calculatedScale} px/cm ] に自動更新しました！\n（配置済みの展示物サイズを一括適用します）`
                        );

                    } else {

                        alert(
                            "正しい数値を入力してください。"
                        );
                    }
                }

                toggleMeasuringMode(false);
            }
        }
    }
);

// ============================================================
// オブジェクト移動
// ============================================================

canvas.on(
    'object:moving',
    function(e) {

        const obj = e.target;

        if (!obj) return;

        const previousAngle = obj.angle || 0;
        const wallSnapped = window.snapArtworkToMovableWall?.(obj);
        const floorWallSnapped = !wallSnapped && snapObjectToFloorWall(obj);
        if (!wallSnapped && !floorWallSnapped) window.snapObjectToGrid?.(obj);
        let collisionScore = getWallCollisionScore(obj);
        const canMoveOutOfExistingCollision =
            draggingOutOfWallCollision &&
            collisionScore <= lastValidCollisionScore;

        if (collisionScore > 0 && !canMoveOutOfExistingCollision) {
            const destination = { left: obj.left, top: obj.top };
            if (wallSnapped) {
                obj.set('angle', previousAngle);
                if (obj.crowdCircle) updateCrowdSemicircle(obj);
            }
            collisionScore = slideObjectAlongWall(obj, lastValidPosition, destination,
                draggingOutOfWallCollision ? lastValidCollisionScore : 0);
        }

        lastValidPosition = {
            left: obj.left,
            top: obj.top
        };
        lastValidCollisionScore = collisionScore;
        if (collisionScore === 0) {
            draggingOutOfWallCollision = false;
        }

        window.updateArtworkHeightFromWall?.(obj);

        if (
            obj.isArtwork &&
            obj.crowdCircle
        ) {

            positionCrowdSemicircle(obj);
        }
    }
);

// ============================================================
// 縮尺測定モード切り替え
// ============================================================

function updateFreeDrawingBrush() {
    if (!canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    }
    const color = document.getElementById('freeDrawColor');
    const width = document.getElementById('freeDrawWidth');
    const parsedWidth = width ? parseFloat(width.value) : 4;
    canvas.freeDrawingBrush.color = color ? color.value : '#26776f';
    canvas.freeDrawingBrush.width = Math.min(30, Math.max(1, parsedWidth || 4));
}

function toggleFreeDrawingMode(enable) {
    const nextMode = enable === undefined ? !isFreeDrawingMode : Boolean(enable);
    if (nextMode) window.endShapeFreeTransform?.();
    if (nextMode) window.cancelDimensionDrawing?.();
    if (nextMode) window.cancelLightingPlacement?.();
    if (nextMode && isMeasuringMode) toggleMeasuringMode(false);

    isFreeDrawingMode = nextMode;
    canvas.isDrawingMode = isFreeDrawingMode;
    if (isFreeDrawingMode) {
        updateFreeDrawingBrush();
        canvas.selection = false;
        canvas.defaultCursor = 'crosshair';
    } else {
        canvas.selection = true;
        canvas.defaultCursor = 'default';
    }

    const button = document.getElementById('btnToggleFreeDraw');
    if (button) {
        button.classList.toggle('btn-drawing-active', isFreeDrawingMode);
        button.textContent = isFreeDrawingMode ? '描き込みを終了' : '描き込みを開始';
        button.setAttribute('aria-pressed', String(isFreeDrawingMode));
    }
    canvas.requestRenderAll();
}

function toggleMeasuringMode(enable) {

    isMeasuringMode =
        enable !== undefined
            ? enable
            : !isMeasuringMode;

    const btn =
        document.getElementById(
            "btnMeasureScale"
        );

    if (isMeasuringMode) {
        window.cancelDimensionDrawing?.();
        window.cancelLightingPlacement?.();

        if (isFreeDrawingMode) toggleFreeDrawingMode(false);

        canvas.selection = false;

        canvas.defaultCursor = 'crosshair';

        canvas.forEachObject(
            o => o.selectable = false
        );

        if (btn) {

            btn.classList.add(
                "btn-active-measure"
            );

            btn.innerText =
                "測定をキャンセル";
        }

    } else {

        canvas.selection = true;

        canvas.defaultCursor = 'default';

        canvas.forEachObject(o => {
            o.selectable = o.isFixture ? isAdminMode : true;
        });

        if (btn) {

            btn.classList.remove(
                "btn-active-measure"
            );

            btn.innerText =
                "基準線から縮尺を計算";
        }
    }
}

