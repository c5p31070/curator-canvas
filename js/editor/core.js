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
let cloudExhibitionCache = [];
let cloudExhibitionRefreshPending = false;
let cloudExhibitionSaveTimer = null;
let cloudExhibitionConflict = false;

function canEditSharedExhibitions() {
    return Boolean(window.CURATOR_USER && window.CURATOR_TEAM && ['owner', 'editor'].includes(window.CURATOR_ROLE));
}

async function refreshCloudExhibitions() {
    if (!window.curatorSupabase || !window.CURATOR_TEAM || cloudExhibitionRefreshPending) return;
    cloudExhibitionRefreshPending = true;
    const { data, error } = await window.curatorSupabase
        .from('exhibitions')
        .select('id, team_id, title, data, updated_at')
        .eq('team_id', window.CURATOR_TEAM.id)
        .order('updated_at', { ascending: false });
    cloudExhibitionRefreshPending = false;
    if (error) {
        const status = document.getElementById('saveStatus');
        if (status) status.textContent = '共有データを読み込めませんでした。管理者に設定を確認してください。';
        console.error('共有展覧会の取得に失敗しました:', error);
        return;
    }
    cloudExhibitionCache = data || [];
    refreshExhibitionList(false);
}

function queueCloudExhibitionSave(json) {
    if (!canEditSharedExhibitions() || !selectedExhibitionId || cloudExhibitionConflict) return;
    if (cloudExhibitionSaveTimer) clearTimeout(cloudExhibitionSaveTimer);
    cloudExhibitionSaveTimer = setTimeout(async () => {
        cloudExhibitionSaveTimer = null;
        const record = cloudExhibitionCache.find(item => item.id === selectedExhibitionId);
        if (!record) return;
        const parsed = JSON.parse(json);
        const nextTitle = (document.getElementById('exhibitionTitle')?.value || record.title).trim() || record.title;
        const updatedAt = new Date().toISOString();
        const { data: updated, error } = await window.curatorSupabase.from('exhibitions').update({
            title: nextTitle,
            data: parsed,
            updated_by: window.CURATOR_USER.id,
            updated_at: updatedAt
        }).eq('id', selectedExhibitionId).eq('team_id', window.CURATOR_TEAM.id)
            .eq('updated_at', record.updated_at).select('id, updated_at').maybeSingle();
        if (error) {
            console.error('共有配置図の自動保存に失敗しました:', error);
            const status = document.getElementById('saveStatus');
            if (status) status.textContent = '共有保存に失敗しました。ネットワークを確認してください。';
            return;
        }
        if (!updated) {
            cloudExhibitionConflict = true;
            await refreshCloudExhibitions();
            const status = document.getElementById('saveStatus');
            if (status) status.textContent = '他のメンバーが先に更新しました。最新の配置図を再読み込みしてください。';
            return;
        }
        record.data = parsed;
        record.title = nextTitle;
        record.updated_at = updated.updated_at;
        refreshExhibitionList(false);
        const status = document.getElementById('saveStatus');
        if (status) status.textContent = `「${nextTitle}」をチームに自動保存しました`;
    }, 900);
}

function getSavedExhibitions() {
    try {
        const data = JSON.parse(localStorage.getItem(EXHIBITIONS_KEY) || '[]');
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error('保存済み展覧会の読み込みに失敗しました:', e);
        return [];
    }
}

function refreshExhibitionList(fetchCloud = true) {
    const select = document.getElementById('savedExhibitions');
    if (!select) return;
    const exhibitions = window.CURATOR_SUPABASE_CONFIG ? cloudExhibitionCache : getSavedExhibitions();
    if (fetchCloud && window.CURATOR_TEAM) refreshCloudExhibitions();
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '保存済み展覧会を選択';
    select.appendChild(placeholder);
    exhibitions.sort((a, b) => (b.updated_at || b.updatedAt || '').localeCompare(a.updated_at || a.updatedAt || ''))
        .forEach(item => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.title || '名称未設定';
            select.appendChild(option);
        });
    select.value = selectedExhibitionId;
    if (select.value !== selectedExhibitionId) selectedExhibitionId = '';
}

async function saveExhibitionSnapshot() {
    const title = (document.getElementById('exhibitionTitle')?.value || '').trim();
    if (!title) {
        alert('展覧会タイトルを入力してください。');
        return;
    }
    if (window.CURATOR_TEAM) {
        if (!canEditSharedExhibitions()) {
            alert('閲覧者は展覧会を保存できません。');
            return;
        }
        if (cloudExhibitionConflict) {
            alert('他のメンバーが先に更新しました。最新の配置図を読み込んでから保存してください。');
            return;
        }
        const id = selectedExhibitionId || crypto.randomUUID();
        const snapshot = getSerializedCanvasData();
        const record = {
            id,
            team_id: window.CURATOR_TEAM.id,
            title,
            data: JSON.parse(snapshot),
            updated_by: window.CURATOR_USER.id,
            updated_at: new Date().toISOString()
        };
        const existing = cloudExhibitionCache.find(item => item.id === id);
        const query = existing
            ? window.curatorSupabase.from('exhibitions').update({
                title: record.title,
                data: record.data,
                updated_by: record.updated_by,
                updated_at: record.updated_at
            }).eq('id', id).eq('team_id', record.team_id).eq('updated_at', existing.updated_at).select('id, updated_at').maybeSingle()
            : window.curatorSupabase.from('exhibitions').insert(record).select('id, updated_at').maybeSingle();
        const { data: savedRecord, error } = await query;
        if (error) {
            console.error('共有展覧会の保存に失敗しました:', error);
            alert('共有保存に失敗しました。ネットワークとデータベース設定を確認してください。');
            return;
        }
        if (!savedRecord) {
            cloudExhibitionConflict = true;
            await refreshCloudExhibitions();
            alert('他のメンバーが先に更新しました。最新の配置図を読み込んでから、もう一度保存してください。');
            return;
        }
        record.updated_at = savedRecord.updated_at;
        selectedExhibitionId = id;
        cloudExhibitionCache = [record, ...cloudExhibitionCache.filter(item => item.id !== id)];
        localStorage.setItem(STORAGE_KEY, snapshot);
        refreshExhibitionList(false);
        const status = document.getElementById('saveStatus');
        if (status) status.innerText = `「${title}」をチームに保存しました`;
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

async function loadExhibitionSnapshot(id) {
    const record = window.CURATOR_TEAM
        ? cloudExhibitionCache.find(item => item.id === id)
        : getSavedExhibitions().find(item => item.id === id);
    if (!record) return;
    cloudExhibitionConflict = false;
    selectedExhibitionId = id;
    isUndoRedoOperation = true;
    const snapshot = typeof record.data === 'string' ? record.data : JSON.stringify(record.data);
    applyStateData(snapshot, function() {
        isUndoRedoOperation = false;
        historyStack = [getSerializedCanvasData()];
        redoStack = [];
        updateUndoRedoButtons();
        saveLocalStorage();
        window.applyCuratorRoleRestrictions?.();
        const status = document.getElementById('saveStatus');
        if (status) status.innerText = `「${record.title}」を読み込みました`;
    });
}

async function deleteExhibitionSnapshot() {
    if (!selectedExhibitionId) {
        alert('削除する展覧会を選択してください。');
        return;
    }
    const record = window.CURATOR_TEAM
        ? cloudExhibitionCache.find(item => item.id === selectedExhibitionId)
        : getSavedExhibitions().find(item => item.id === selectedExhibitionId);
    if (!record || !confirm(`「${record.title}」の保存データを削除しますか？`)) return;
    if (window.CURATOR_TEAM) {
        if (!canEditSharedExhibitions()) return alert('閲覧者は展覧会を削除できません。');
        const { error } = await window.curatorSupabase.from('exhibitions')
            .delete().eq('id', selectedExhibitionId).eq('team_id', window.CURATOR_TEAM.id);
        if (error) return alert('共有展覧会を削除できませんでした。');
        cloudExhibitionCache = cloudExhibitionCache.filter(item => item.id !== selectedExhibitionId);
        selectedExhibitionId = '';
        refreshExhibitionList(false);
        return;
    }
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
        'isCrowdCircle',
        'crowdLinkId',
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
        queueCloudExhibitionSave(json);

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

    if (window.CURATOR_ROLE === 'viewer') return;

    // 編集欄の自動保存待ちがあれば、Undo対象として先に履歴へ確定する。
    if (typeof window.flushPendingItemEditHistory === 'function') {
        window.flushPendingItemEditHistory();
    }

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

    if (window.CURATOR_ROLE === 'viewer') return;

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
    const matchedCrowdCircles = new Set();

    objects.forEach(obj => {

        if (
            obj.isArtwork &&
            obj.crowdCountValue
        ) {

            let circle = obj.crowdLinkId
                ? objects.find(c => c.isCrowdCircle && c.crowdLinkId === obj.crowdLinkId && !matchedCrowdCircles.has(c))
                : null;
            if (!circle) {
                const candidates = objects.filter(c => !matchedCrowdCircles.has(c) &&
                    ((c.isCrowdCircle && c.type === 'circle') ||
                     (c.type === 'circle' && c.left === obj.left && c.top === obj.top)));
                circle = candidates.sort((a, b) =>
                    a.getCenterPoint().distanceFrom(obj.getCenterPoint()) -
                    b.getCenterPoint().distanceFrom(obj.getCenterPoint())
                )[0];
            }

            if (circle) {
                matchedCrowdCircles.add(circle);
                const radius = circle.radius || 40;
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

function createCrowdSemicircle(artwork, radius, fill, stroke = '#333', strokeWidth = 2) {
    if (!artwork.crowdLinkId) artwork.crowdLinkId = `crowd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const center = artwork.getCenterPoint();
    const angle = (artwork.angle || 0) * Math.PI / 180;
    const nx = Math.sin(angle), ny = Math.cos(angle);
    const tx = -ny, ty = nx;
    const halfExtent = artwork.getScaledHeight() / 2;
    const base = { x: center.x + nx * halfExtent, y: center.y + ny * halfExtent };
    const polygonCenter = { x: base.x + nx * radius / 2, y: base.y + ny * radius / 2 };
    const points = [];
    for (let i = 0; i <= 24; i++) {
        const angle = Math.PI * i / 24;
        points.push({
            x: tx * radius * Math.cos(angle) + nx * (radius * Math.sin(angle) - radius / 2),
            y: ty * radius * Math.cos(angle) + ny * (radius * Math.sin(angle) - radius / 2)
        });
    }
    const poly = new fabric.Polygon(points, {
        left: polygonCenter.x, top: polygonCenter.y, originX: 'center', originY: 'center',
        fill, stroke, strokeWidth, selectable: false, evented: false, isCrowdCircle: true,
        crowdRadius: radius, crowdLinkId: artwork.crowdLinkId || null
    });
    configureCrowdCircle(poly);
    return poly;
}

function updateCrowdSemicircle(artwork) {
    if (!artwork?.crowdCircle) return;
    const old = artwork.crowdCircle;
    const radius = old.crowdRadius || old.radius || 40;
    const replacement = createCrowdSemicircle(artwork, radius, old.fill, old.stroke, old.strokeWidth || 2);
    if (!artwork.crowdLinkId) artwork.crowdLinkId = `crowd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    replacement.crowdLinkId = artwork.crowdLinkId;
    const index = canvas.getObjects().indexOf(old);
    const wasUndoRedoOperation = isUndoRedoOperation;
    isUndoRedoOperation = true;
    canvas.remove(old);
    canvas.insertAt(replacement, Math.max(0, index), false);
    isUndoRedoOperation = wasUndoRedoOperation;
    artwork.crowdCircle = replacement;
}

function positionCrowdSemicircle(artwork) {
    const crowd = artwork?.crowdCircle;
    if (!crowd) return;
    const center = artwork.getCenterPoint();
    const angle = (artwork.angle || 0) * Math.PI / 180;
    const nx = Math.sin(angle), ny = Math.cos(angle);
    const radius = crowd.crowdRadius || 40;
    const distance = artwork.getScaledHeight() / 2 + radius / 2;
    crowd.set({ left: center.x + nx * distance, top: center.y + ny * distance });
    crowd.setCoords();
}

function configureCrowdCircle(circle, artwork = null) {
    if (!circle) return;
    circle.set({
        isCrowdCircle: true,
        selectable: false,
        evented: false,
        hasControls: false,
        hasBorders: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true
    });
    circle.setCoords();
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
