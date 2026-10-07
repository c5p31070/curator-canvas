// ============================================================
// curator-canvas
// interaction.js
// 壁衝突・回転・測定・マウス操作
// ============================================================

// ============================================================
// 壁衝突判定
// ============================================================

function getWallCollisionScore(obj) {

    if (
        !isWallDataLoaded ||
        !obj ||
        obj.isPin ||
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
        obj.getBoundingRect();

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
        for (let pt of samplePoints) {

            if (
                pt.x >= 0 &&
                pt.x < canvas.width &&
                pt.y >= 0 &&
                pt.y < canvas.height
            ) {

                const pixel =
                    wallCtx.getImageData(
                        pt.x,
                        pt.y,
                        1,
                        1
                    ).data;

                if (
                    pixel[0] < 50 &&
                    pixel[1] < 50 &&
                    pixel[2] < 50 &&
                    pixel[3] > 100
                ) {
                    collisionScore++;
                }
            }
        }
        return collisionScore;

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

        alert(
            "壁（黒線）をまたぐため回転できません。"
        );

    } else {

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
    if (window.CURATOR_SUPABASE_CONFIG && !window.CURATOR_DEMO_MODE) {
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
    saveState
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
    function(e) {

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

            const scaleInput =
                document.getElementById("scale");

            {

                const realLengthCmStr =
                    prompt(
                        `測定した線の長さ（画面上 ${Math.round(linePixelLength)} px）は、現実で何 cm ですか？\n例: 300`,
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

                        if (scaleInput) {
                            scaleInput.value =
                                calculatedScale;
                        }

                        alert(
                            `縮尺スケールを [ ${calculatedScale} px/cm ] に自動更新しました！\n（配置済みの展示物サイズを一括適用します）`
                        );

                        applyScaleToAllArtworks(
                            calculatedScale
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

        const collisionScore = getWallCollisionScore(obj);
        const canMoveOutOfExistingCollision =
            draggingOutOfWallCollision &&
            collisionScore <= lastValidCollisionScore;

        if (collisionScore > 0 && !canMoveOutOfExistingCollision) {

            obj.set({
                left: lastValidPosition.left,
                top: lastValidPosition.top
            });

            obj.setCoords();

        } else {

            lastValidPosition = {
                left: obj.left,
                top: obj.top
            };
            lastValidCollisionScore = collisionScore;
            if (collisionScore === 0) {
                draggingOutOfWallCollision = false;
            }
        }

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

