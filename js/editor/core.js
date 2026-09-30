// ============================================================
// curator-canvas
// core.js
// データ管理・保存・Undo / Redo・状態復元
// ============================================================

// Fabric.js キャンバス
const canvas = new fabric.Canvas('canvas');

const STORAGE_KEY = 'curator_canvas_draft_data';
const EXHIBITIONS_KEY = 'curator_canvas_saved_exhibitions';
let selectedExhibitionId = '';

function getSavedExhibitions() {
    try {
        const data = JSON.parse(localStorage.getItem(EXHIBITIONS_KEY) || '[]');
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error('保存済み展覧会の読み込みに失敗しました:', e);
        return [];
    }
}

function refreshExhibitionList() {
    const select = document.getElementById('savedExhibitions');
    if (!select) return;
    const exhibitions = getSavedExhibitions();
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '保存済み展覧会を選択';
    select.appendChild(placeholder);
    exhibitions.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
        .forEach(item => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.title || '名称未設定';
            select.appendChild(option);
        });
    select.value = selectedExhibitionId;
    if (select.value !== selectedExhibitionId) selectedExhibitionId = '';
}

function saveExhibitionSnapshot() {
    const title = (document.getElementById('exhibitionTitle')?.value || '').trim();
    if (!title) {
        alert('展覧会タイトルを入力してください。');
        return;
    }
    const exhibitions = getSavedExhibitions();
    let record = exhibitions.find(item => item.id === selectedExhibitionId);
    if (!record) record = exhibitions.find(item => item.title === title);
    const id = record?.id || `exhibition_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const snapshot = getSerializedCanvasData();
    const next = { id, title, data: snapshot, updatedAt: new Date().toISOString() };
    const index = exhibitions.findIndex(item => item.id === id);
    if (index >= 0) exhibitions[index] = next;
    else exhibitions.push(next);
    try {
        localStorage.setItem(EXHIBITIONS_KEY, JSON.stringify(exhibitions));
        localStorage.setItem(STORAGE_KEY, snapshot);
        selectedExhibitionId = id;
        refreshExhibitionList();
        const status = document.getElementById('saveStatus');
        if (status) status.innerText = `「${title}」を保存しました`;
    } catch (e) {
        console.error('展覧会の保存に失敗しました:', e);
        alert('保存できませんでした。ブラウザの保存容量を確認してください。');
    }
}

function loadExhibitionSnapshot(id) {
    const record = getSavedExhibitions().find(item => item.id === id);
    if (!record) return;
    selectedExhibitionId = id;
    isUndoRedoOperation = true;
    applyStateData(record.data, function() {
        isUndoRedoOperation = false;
        historyStack = [getSerializedCanvasData()];
        redoStack = [];
        updateUndoRedoButtons();
        saveLocalStorage();
        const status = document.getElementById('saveStatus');
        if (status) status.innerText = `「${record.title}」を読み込みました`;
    });
}

function deleteExhibitionSnapshot() {
    if (!selectedExhibitionId) {
        alert('削除する展覧会を選択してください。');
        return;
    }
    const record = getSavedExhibitions().find(item => item.id === selectedExhibitionId);
    if (!record || !confirm(`「${record.title}」の保存データを削除しますか？`)) return;
    localStorage.setItem(EXHIBITIONS_KEY, JSON.stringify(getSavedExhibitions().filter(item => item.id !== selectedExhibitionId)));
    selectedExhibitionId = '';
    refreshExhibitionList();
}

// ------------------------------------------------------------
// 現在のビューモード
// 'floor' : 平面図
// 'wall'  : 壁面図
// ------------------------------------------------------------

let currentViewMode = 'floor';
let isAdminMode = false;

// ------------------------------------------------------------
// 平面図・壁面図の独立状態
// ------------------------------------------------------------

let floorPlanJsonData = null;

let wallPlanJsonData = {
    'wall_default': {
        title: '壁 A',
        widthCm: 600,
        heightCm: 300,
        json: null
    }
};

let selectedWallInfo = {
    id: 'wall_default',
    title: '壁 A',
    widthCm: 600,
    heightCm: 300
};

// ------------------------------------------------------------
// 背景画像関連
// ------------------------------------------------------------

let wallCanvas = document.createElement('canvas');

let wallCtx = wallCanvas.getContext('2d', {
    willReadFrequently: true
});

let isWallDataLoaded = false;
let cachedBackgroundImage = null;

// ------------------------------------------------------------
// ロード中フラグ
// ------------------------------------------------------------

let isTransitioning = false;

// ------------------------------------------------------------
// 測定 / 壁選択モード
// ------------------------------------------------------------

let isMeasuringMode = false;
let isMeasuring = false;
let isFreeDrawingMode = false;
let measureLine = null;
let measureStartPt = null;

// ------------------------------------------------------------
// Undo / Redo
// ------------------------------------------------------------

let historyStack = [];
let redoStack = [];
let isUndoRedoOperation = false;

// ============================================================
// Fabric.js 保存対象カスタムプロパティ
// ============================================================

function getCustomProperties() {
    return [
        'isArtwork',
        'artworkName',
        'description',
        'isPin',
        'pinName',
        'isFreeDrawing',
        'isWallOutline',
        'displayType',
        'cmWidth',
        'cmHeight',
        'cmDepth',
        'pxWidth',
        'pxHeight',
        'crowdCountValue',
        'isFreePin',
        'pinLabel',
        'isGuard',
        'isFixture'
    ];
}

// ============================================================
// 現在のキャンバス状態を保存用データへ反映
// ============================================================

function captureCurrentCanvasState() {

    if (isTransitioning) return;

    const jsonStr = JSON.stringify(
        canvas.toJSON(getCustomProperties())
    );

    if (currentViewMode === 'floor') {

        floorPlanJsonData = jsonStr;

    } else if (
        currentViewMode === 'wall' &&
        selectedWallInfo &&
        selectedWallInfo.id
    ) {

        if (!wallPlanJsonData[selectedWallInfo.id]) {

            wallPlanJsonData[selectedWallInfo.id] = {
                title: selectedWallInfo.title,
                widthCm: selectedWallInfo.widthCm,
                heightCm: selectedWallInfo.heightCm,
                json: null
            };
        }

        wallPlanJsonData[selectedWallInfo.id].json = jsonStr;
        wallPlanJsonData[selectedWallInfo.id].title = selectedWallInfo.title;
        wallPlanJsonData[selectedWallInfo.id].widthCm = selectedWallInfo.widthCm;
        wallPlanJsonData[selectedWallInfo.id].heightCm = selectedWallInfo.heightCm;
    }
}

// ============================================================
// アプリ全体を保存用JSONへ変換
// ============================================================

function getSerializedCanvasData() {

    captureCurrentCanvasState();

    const titleInput = document.getElementById("exhibitionTitle");
    const exhibitionTitle = titleInput
        ? titleInput.value
        : "";

    const scaleInput = document.getElementById("scale");

    const currentScale = scaleInput
        ? parseFloat(scaleInput.value) || 0.5
        : 0.5;

    return JSON.stringify({
        exhibitionTitle: exhibitionTitle,
        scale: currentScale,
        currentViewMode: currentViewMode,
        selectedWallInfo: selectedWallInfo,
        floorPlanJsonData: floorPlanJsonData,
        wallPlanJsonData: wallPlanJsonData
    });
}

// ============================================================
// LocalStorage保存
// ============================================================

function saveLocalStorage() {

    try {

        const json = getSerializedCanvasData();

        localStorage.setItem(STORAGE_KEY, json);

        const statusEl = document.getElementById("saveStatus");

        if (statusEl) {

            const now = new Date();

            const timeStr = now.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            statusEl.innerText =
                `自動保存済み (${timeStr})`;
        }

    } catch (e) {

        console.error(
            "ローカルストレージへの保存に失敗しました:",
            e
        );
    }
}

// ============================================================
// Undo / Redo用状態保存
// ============================================================

function saveState() {

    if (
        isUndoRedoOperation ||
        isMeasuringMode ||
        isTransitioning ||
        currentViewMode === 'pdf'
    ) {
        return;
    }

    const json = getSerializedCanvasData();

    historyStack.push(json);

    redoStack = [];

    updateUndoRedoButtons();

    saveLocalStorage();
}

// ============================================================
// Undo
// ============================================================

function undo() {

    if (historyStack.length <= 1) {
        return;
    }

    isUndoRedoOperation = true;

    const currentState = historyStack.pop();

    redoStack.push(currentState);

    const prevState =
        historyStack[historyStack.length - 1];

    applyStateData(prevState, function() {

        isUndoRedoOperation = false;

        updateUndoRedoButtons();

        saveLocalStorage();
    });
}

// ============================================================
// Redo
// ============================================================

function redo() {

    if (redoStack.length === 0) {
        return;
    }

    isUndoRedoOperation = true;

    const nextState = redoStack.pop();

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

function applyStateData(jsonString, callback) {

    try {

        const parsed = JSON.parse(jsonString);

        const exhibitionTitle =
            parsed.exhibitionTitle || "";

        const scaleValue =
            parsed.scale || 0.5;

        const titleInput =
            document.getElementById("exhibitionTitle");

        if (
            titleInput &&
            parsed.exhibitionTitle !== undefined
        ) {
            titleInput.value = exhibitionTitle;
        }

        const scaleInput =
            document.getElementById("scale");

        if (
            scaleInput &&
            parsed.scale !== undefined
        ) {
            scaleInput.value = scaleValue;
        }

        if (parsed.floorPlanJsonData) {
            floorPlanJsonData =
                parsed.floorPlanJsonData;
        }

        if (parsed.wallPlanJsonData) {
            wallPlanJsonData =
                parsed.wallPlanJsonData;
        }

        if (parsed.selectedWallInfo) {
            selectedWallInfo =
                parsed.selectedWallInfo;
        }

        updateWallDropdownOptions();

        const targetMode =
            parsed.currentViewMode || 'floor';

        switchViewMode(
            targetMode,
            true,
            callback
        );

    } catch (e) {

        console.error(
            "状態の適用に失敗しました:",
            e
        );

        if (callback) {
            callback();
        }
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

    objects.forEach(obj => {

        if (
            obj.isArtwork &&
            obj.crowdCountValue
        ) {

            const circle = objects.find(
                c =>
                    c.type === 'circle' &&
                    c.left === obj.left &&
                    c.top === obj.top
            );

            if (circle) {
                obj.crowdCircle = circle;
            }
        }

        if (obj.isPin || obj.isFreePin || obj.isGuard || obj.pinLabel !== undefined) {
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
}

function applyFixtureEditability() {
    canvas.getObjects().forEach(obj => {
        if (!obj.isFixture) return;
        obj.set({
            selectable: isAdminMode,
            evented: isAdminMode,
            hasControls: isAdminMode,
            lockMovementX: !isAdminMode,
            lockMovementY: !isAdminMode
        });
    });
    if (!isAdminMode && canvas.getActiveObjects().some(obj => obj.isFixture)) {
        canvas.discardActiveObject();
    }
    canvas.requestRenderAll();
}

function applyWallOutlineLock() {
    canvas.getObjects().forEach(obj => {
        const isLegacyWallOutline = obj.type === 'rect' &&
            obj.fill === '#f8fafc' && obj.stroke === '#334155';
        if (!obj.isWallOutline && !isLegacyWallOutline) return;
        obj.set({
            isWallOutline: true,
            selectable: false,
            evented: false,
            hasControls: false,
            lockMovementX: true,
            lockMovementY: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true
        });
        obj.setCoords();
    });
    if (canvas.getActiveObjects().some(obj => obj.isWallOutline)) {
        canvas.discardActiveObject();
    }
}
