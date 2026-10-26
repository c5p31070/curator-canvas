// ============================================================
// curator-canvas
// core.js
// データ管理・保存・Undo / Redo・状態復元
// ============================================================

// Fabric.js キャンバス
const editorStorage = window.CURATOR_GUEST?.storage || {
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: key => window.localStorage.removeItem(key)
};
const canvas = new fabric.Canvas('canvas');
canvas.selectionColor = 'rgba(178, 187, 190, 0.10)';
canvas.selectionBorderColor = '#879195';
canvas.selectionLineWidth = 1;
fabric.Object.prototype.borderColor = '#879195';
fabric.Object.prototype.cornerColor = '#aab2b5';
fabric.Object.prototype.cornerStrokeColor = '#1a1d1f';
fabric.Object.prototype.transparentCorners = false;

const STORAGE_KEY = 'curator_canvas_draft_data';
const EXHIBITIONS_KEY = 'curator_canvas_saved_exhibitions';
const SCALE_SETTINGS_KEY = 'curator_canvas_floor_scale';
let crowdVisible = true;
try { crowdVisible = editorStorage.getItem('curator_canvas_crowd_visible') !== 'false'; } catch {}
let configuredScale = loadConfiguredScale();
if (configuredScale !== null) {
    const input = document.getElementById('scale');
    if (input) input.value = configuredScale;
}

function loadConfiguredScale() {
    if (window.CURATOR_SUPABASE_CONFIG) return null;
    try {
        const saved = editorStorage.getItem(SCALE_SETTINGS_KEY);
        const value = Number(saved);
        if (saved !== null && Number.isFinite(value) && value > 0) return value;
        // Preserve calibration from drafts created before scale had its own setting.
        const legacy = Number(JSON.parse(editorStorage.getItem(STORAGE_KEY) || 'null')?.scale);
        if (Number.isFinite(legacy) && legacy > 0) {
            editorStorage.setItem(SCALE_SETTINGS_KEY, String(legacy));
            return legacy;
        }
    } catch (error) {
        console.warn('縮尺設定の読み込みに失敗しました。', error);
    }
    return null;
}

function setConfiguredScale(value) {
    const scale = Number(value);
    const input = document.getElementById('scale');
    if (!Number.isFinite(scale) || scale <= 0 || scale >= 1000000) {
        if (input) input.value = configuredScale ?? 0.5;
        return false;
    }
    configuredScale = scale;
    if (input) input.value = scale;
    window.refreshWorkspaceScaleBar?.();
    try {
        // Signed-in teams always obtain this value from the server.
        if (!window.CURATOR_SUPABASE_CONFIG) editorStorage.setItem(SCALE_SETTINGS_KEY, String(scale));
    } catch (error) {
        console.warn('縮尺設定の保存に失敗しました。', error);
    }
    return true;
}
let selectedExhibitionId = '';
let cloudExhibitionCache = [];
let cloudExhibitionRefreshPending = false;
let cloudExhibitionSaveTimer = null;
let cloudExhibitionConflict = false;
let exhibitionWriteBusy = false;

function getActiveExhibitionRecord() {
    return (window.CURATOR_TEAM ? cloudExhibitionCache : getSavedExhibitions())
        .find(item => item.id === selectedExhibitionId);
}

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
    if (!canEditSharedExhibitions() || !selectedExhibitionId || cloudExhibitionConflict || exhibitionWriteBusy) return;
    const exhibitionId = selectedExhibitionId;
    if (cloudExhibitionSaveTimer) clearTimeout(cloudExhibitionSaveTimer);
    cloudExhibitionSaveTimer = null;
    const source = cloudExhibitionCache.find(item => item.id === exhibitionId);
    if (!source || (JSON.parse(json).exhibitionTitle || '').trim() !== source.title.trim()) return;
    cloudExhibitionSaveTimer = setTimeout(async () => {
        cloudExhibitionSaveTimer = null;
        const record = cloudExhibitionCache.find(item => item.id === exhibitionId);
        if (!record) return;
        const parsed = JSON.parse(json);
        const nextTitle = record.title;
        parsed.exhibitionTitle = nextTitle;
        const updatedAt = new Date().toISOString();
        const { data: updated, error } = await window.curatorSupabase.from('exhibitions').update({
            title: nextTitle,
            data: parsed,
            updated_by: window.CURATOR_USER.id,
            updated_at: updatedAt
        }).eq('id', exhibitionId).eq('team_id', window.CURATOR_TEAM.id)
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
        const data = JSON.parse(editorStorage.getItem(EXHIBITIONS_KEY) || '[]');
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error('保存済み展覧会の読み込みに失敗しました:', e);
        return [];
    }
}

function refreshExhibitionList(fetchCloud = true) {
    const select = document.getElementById('savedExhibitions');
    if (!select) return;
    const exhibitions = [
        ...(window.CURATOR_SUPABASE_CONFIG ? cloudExhibitionCache : getSavedExhibitions())
    ];
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
    window.refreshExhibitionSaveUi?.();
}

async function saveExhibitionSnapshot() {
    if (exhibitionWriteBusy) return;
    exhibitionWriteBusy = true;
    window.refreshExhibitionSaveUi?.();
    try { return await persistExhibitionSnapshot(); }
    finally { exhibitionWriteBusy = false; window.refreshExhibitionSaveUi?.(); }
}

async function persistExhibitionSnapshot() {
    if (window.isDiagramReady && !window.isDiagramReady()) return alert('図面の読み込み完了後に保存してください。');
    if (window.CURATOR_ROLE === 'viewer') return alert('閲覧者は展覧会を保存できません。');
    if (window.refreshTeamFloorScale && !await window.refreshTeamFloorScale()) return;
    const title = (document.getElementById('exhibitionTitle')?.value || '').trim();
    if (!title) {
        alert('展覧会タイトルを入力してください。');
        return;
    }
    const source = getActiveExhibitionRecord();
    const saveAs = !source || title !== source.title;
    const records = window.CURATOR_TEAM ? cloudExhibitionCache : getSavedExhibitions();
    if (records.some(item => item.title.trim() === title && (saveAs || item.id !== source?.id))) {
        alert('同じ名前の展覧会があります。別の名前を入力してください。');
        return;
    }
    document.getElementById('exhibitionTitle').value = title;
    if (cloudExhibitionSaveTimer) {
        clearTimeout(cloudExhibitionSaveTimer);
        cloudExhibitionSaveTimer = null;
    }
    if (window.CURATOR_TEAM) {
        if (!canEditSharedExhibitions()) {
            alert('閲覧者は展覧会を保存できません。');
            return;
        }
        if (cloudExhibitionConflict && !saveAs) {
            alert('他のメンバーが先に更新しました。最新の配置図を読み込んでから保存してください。');
            return;
        }
        const id = saveAs ? crypto.randomUUID() : source.id;
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
        cloudExhibitionConflict = false;
        if (source && saveAs) window.rebaseExhibitionHistoryTitle?.(source.title, title);
        cloudExhibitionCache = [record, ...cloudExhibitionCache.filter(item => item.id !== id)];
        editorStorage.setItem(STORAGE_KEY, snapshot);
        refreshExhibitionList(false);
        const status = document.getElementById('saveStatus');
        if (status) status.innerText = saveAs ? `「${title}」を新しい展覧会としてチームに保存しました` : `「${title}」をチームに保存しました`;
        return;
    }
    const exhibitions = getSavedExhibitions();
    const id = saveAs ? crypto.randomUUID() : source.id;
    const snapshot = getSerializedCanvasData();
    const next = { id, title, data: snapshot, updatedAt: new Date().toISOString() };
    const index = exhibitions.findIndex(item => item.id === id);
    if (index >= 0) exhibitions[index] = next;
    else exhibitions.push(next);
    try {
        editorStorage.setItem(EXHIBITIONS_KEY, JSON.stringify(exhibitions));
        editorStorage.setItem(STORAGE_KEY, snapshot);
        selectedExhibitionId = id;
        if (source && saveAs) window.rebaseExhibitionHistoryTitle?.(source.title, title);
        refreshExhibitionList();
        const status = document.getElementById('saveStatus');
        if (status) status.innerText = saveAs ? `「${title}」を新しい展覧会として保存しました` : `「${title}」を保存しました`;
    } catch (e) {
        console.error('展覧会の保存に失敗しました:', e);
        alert('保存できませんでした。ブラウザの保存容量を確認してください。');
    }
}

async function loadExhibitionSnapshot(id) {
    if (exhibitionWriteBusy || isTransitioning) return;
    if (window.refreshTeamFloorScale && !await window.refreshTeamFloorScale()) return;
    const record = window.CURATOR_TEAM
        ? cloudExhibitionCache.find(item => item.id === id)
        : getSavedExhibitions().find(item => item.id === id);
    if (!record) return;
    if (cloudExhibitionSaveTimer) { clearTimeout(cloudExhibitionSaveTimer); cloudExhibitionSaveTimer = null; }
    cloudExhibitionConflict = false;
    selectedExhibitionId = id;
    isUndoRedoOperation = true;
    const data = typeof record.data === 'string' ? JSON.parse(record.data) : { ...record.data };
    data.exhibitionTitle = record.title;
    const snapshot = JSON.stringify(data);
    applyStateData(snapshot, function(loaded) {
        isUndoRedoOperation = false;
        if (loaded === false) return;
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
    if (exhibitionWriteBusy || window.CURATOR_ROLE === 'viewer') return;
    const targetId = document.getElementById('savedExhibitions')?.value || selectedExhibitionId;
    if (!targetId) {
        alert('削除する展覧会を選択してください。');
        return;
    }
    const record = window.CURATOR_TEAM
        ? cloudExhibitionCache.find(item => item.id === targetId)
        : getSavedExhibitions().find(item => item.id === targetId);
    if (!record || !confirm(`「${record.title}」の保存データを削除しますか？`)) return;
    if (window.CURATOR_TEAM) {
        if (!canEditSharedExhibitions()) return alert('閲覧者は展覧会を削除できません。');
        const { error } = await window.curatorSupabase.from('exhibitions')
            .delete().eq('id', targetId).eq('team_id', window.CURATOR_TEAM.id);
        if (error) return alert('共有展覧会を削除できませんでした。');
        cloudExhibitionCache = cloudExhibitionCache.filter(item => item.id !== targetId);
        if (selectedExhibitionId === targetId) selectedExhibitionId = '';
        refreshExhibitionList(false);
        return;
    }
    editorStorage.setItem(EXHIBITIONS_KEY, JSON.stringify(getSavedExhibitions().filter(item => item.id !== targetId)));
    if (selectedExhibitionId === targetId) selectedExhibitionId = '';
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
const FLOOR_PLANS = {
    lobby: { title: 'ロビー階', image: 'images/LBF01.png' },
    floor1: { title: '1階', image: 'images/1F01.png' },
    floor2: { title: '2階', image: 'images/2F01.png' }
};
let selectedFloorId = 'lobby';
let floorPlanData = Object.fromEntries(Object.keys(FLOOR_PLANS).map(id => [id, { json: null }]));
const floorBackgroundImages = new Map();
let savedArtworkCatalog = [];

let wallPlanJsonData = {
    'wall_default': {
        title: '壁 A',
        floorId: 'lobby',
        widthCm: 600,
        heightCm: 450,
        json: null
    }
};

let selectedWallInfo = {
    id: 'wall_default',
    title: '壁 A',
    widthCm: 600,
    heightCm: 450
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
let isDimensionDrawingMode = false;
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
        'isMovableWall', 'movableWallId', 'movableWallName', 'movableWallNumber', 'movableFloorId', 'movableFrontId', 'movableBackId',
        'movableLeftId', 'movableRightId',
        'isShapeObject',
        'shapeKind',
        'shapeLength',
        'shapeHeadSize',
        'shapeStroke',
        'shapeFill',
        'artworkName',
        'artworkCatalogId',
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
        'isWallOutline',
        'displayType',
        'cmWidth',
        'cmHeight',
        'cmDepth',
        'artworkCenterHeightCm',
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

function getArtworkAppearance(artwork) {
    if (artwork.isFixture) return { fill: '#d4d9de', stroke: '#66727d', text: '#26323b', dash: [4, 3] };
    return artwork.displayType === 'floor'
        ? { fill: '#f3d58b', stroke: '#94702f', text: '#42341b', dash: null }
        : { fill: '#a9dce9', stroke: '#427c91', text: '#193e4c', dash: null };
}

function configureArtworkTransform(artwork) {
    if (!artwork?.isArtwork) return;
    const appearance = getArtworkAppearance(artwork);
    artwork.item?.(0)?.set({ fill: appearance.fill, stroke: appearance.stroke,
        strokeWidth: 1.5, strokeDashArray: appearance.dash });
    artwork.item?.(1)?.set({ fill: appearance.text });
    artwork.set({
        dirty: true,
        lockScalingX: true,
        lockScalingY: true,
        lockScalingFlip: true,
        lockSkewingX: true,
        lockSkewingY: true
    });
    artwork.setControlsVisibility?.({
        tl: false,
        tr: false,
        bl: false,
        br: false,
        ml: false,
        mt: false,
        mr: false,
        mb: false,
        mtr: true
    });
    artwork.setCoords();
}

// ============================================================
// 現在のキャンバス状態を保存用データへ反映
// ============================================================

function captureCurrentCanvasState() {

    if (isTransitioning || window.isVenueWallRendering?.() || (window.isDiagramReady && !window.isDiagramReady())) return;
    window.syncWallArtworkHeights?.();

    const jsonStr = JSON.stringify(
        canvas.toJSON(getCustomProperties())
    );

    if (currentViewMode === 'floor') {

        const floorJson = JSON.parse(jsonStr);
        delete floorJson.backgroundImage;
        floorPlanJsonData = JSON.stringify(floorJson);
        floorPlanData[selectedFloorId] = {
            json: floorPlanJsonData
        };

    } else if (
        currentViewMode === 'wall' &&
        selectedWallInfo &&
        selectedWallInfo.id
    ) {

        if (!wallPlanJsonData[selectedWallInfo.id]) {

            wallPlanJsonData[selectedWallInfo.id] = {
                floorId: selectedFloorId,
                title: selectedWallInfo.title,
                widthCm: selectedWallInfo.widthCm,
                heightCm: selectedWallInfo.heightCm,
                json: null
            };
        }

        wallPlanJsonData[selectedWallInfo.id].json = jsonStr;
        delete wallPlanJsonData[selectedWallInfo.id].legacyHeightCm;
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

    const currentScale = configuredScale ?? (scaleInput
        ? parseFloat(scaleInput.value) || 0.5
        : 0.5);

    const data = {
        exhibitionTitle: exhibitionTitle,
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

// ============================================================
// LocalStorage保存
// ============================================================

function saveLocalStorage() {
    if (window.isDiagramReady && !window.isDiagramReady()) return;

    try {

        const json = getSerializedCanvasData();

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

    saveLocalStorage();
}

// ============================================================
// Undo
// ============================================================

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

    const prevState =
        historyStack[historyStack.length - 1];
    window.applyVenueLightingHistory?.(JSON.parse(prevState));

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

        selectedFloorId = FLOOR_PLANS[parsed.selectedFloorId] ? parsed.selectedFloorId : 'lobby';
        floorPlanData = Object.fromEntries(Object.keys(FLOOR_PLANS).map(id => [id, {
            json: parsed.floorPlanData
                ? parsed.floorPlanData[id]?.json || null
                : (id === 'lobby' ? parsed.floorPlanJsonData || null : null)
        }]));
        floorPlanJsonData = floorPlanData[selectedFloorId].json;
        cachedBackgroundImage = floorBackgroundImages.get(selectedFloorId) || null;
        if (scaleInput) scaleInput.value = scaleValue;

        if (parsed.wallPlanJsonData) {
            wallPlanJsonData =
                parsed.wallPlanJsonData;
        }
        window.applyVenueWallsToPlans?.();

        const hasArtworkCatalog = Array.isArray(parsed.savedArtworkCatalog);
        savedArtworkCatalog = hasArtworkCatalog
            ? parsed.savedArtworkCatalog
            : [];
        if (!hasArtworkCatalog) window.migrateArtworkCatalogFromPlans?.();
        window.repairArtworkHeightLinks?.();
        window.refreshArtworkCatalog?.();

        if (parsed.selectedWallInfo) {
            selectedWallInfo =
                parsed.selectedWallInfo;
        }

        updateWallDropdownOptions();

        const targetMode = parsed.currentViewMode === 'wall' ? 'wall' : 'floor';

        const loaded = await switchViewMode(
            targetMode,
            true,
            null,
            true
        );
        callback?.(loaded);

    } catch (e) {

        console.error(
            "状態の適用に失敗しました:",
            e
        );

        if (callback) {
            callback(false);
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

function createCrowdSemicircle(artwork, radius, fill, stroke = '#333', strokeWidth = 2) {
    if (!artwork.crowdLinkId) artwork.crowdLinkId = `crowd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    artwork.crowdRadius = radius;
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

function resizeNumberPin(pin) {
    const text = pin.item?.(1);
    const ring = pin.item?.(0);
    if (!text || !ring) return;
    text.set('fontSize', 12);
    text.initDimensions();
    ring.set({ radius: Math.max(10, text.width / 2 + 4), strokeWidth: 1 });
    pin.addWithUpdate();
    pin.setCoords();
}

function setCrowdVisibility(visible) {
    crowdVisible = Boolean(visible);
    try { editorStorage.setItem('curator_canvas_crowd_visible', String(crowdVisible)); }
    catch (error) { console.warn('混雑予想の表示設定を保存できませんでした。', error); }
    canvas.getObjects().filter(obj => obj.isCrowdCircle).forEach(configureCrowdCircle);
    const input = document.getElementById('crowdVisibility');
    if (input) input.checked = crowdVisible;
    canvas.requestRenderAll();
}

function configureCrowdCircle(circle) {
    if (!circle) return;
    circle.set({
        isCrowdCircle: true,
        visible: crowdVisible,
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
        if (obj.isArtwork) configureArtworkTransform(obj);
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
