// エディターの共通状態、描画キャンバス、会場・階・縮尺などの基本設定を用意します。
// Shared editor state, canvas initialization, and venue scale settings.

const editorStorage = {
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: key => window.localStorage.removeItem(key)
};
// Saved geometry and calibration use cm and px/cm. Convert only at the UI boundary.
const cmToMm = value => Number((Number(value) * 10).toPrecision(15));
const mmToCm = value => Number(value) / 10;
const scaleToPxPerMm = value => Number((value / 10).toPrecision(15));
const canvas = new fabric.Canvas('canvas');
// Selection must not lift an artwork above ceiling light markers.
canvas.preserveObjectStacking = true;
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
const VENUE_NAMES = { special: '企画展', public: '公募展' };
const venueOf = data => data?.venueId === 'public' ? 'public' : 'special';
let activeVenueId = 'special';
const venueScaleStorageKey = venue => venue === 'public' ? SCALE_SETTINGS_KEY + '_public' : SCALE_SETTINGS_KEY;
let crowdVisible = true;
try { crowdVisible = editorStorage.getItem('curator_canvas_crowd_visible') !== 'false'; } catch {}
let configuredScale = loadConfiguredScale();
if (configuredScale !== null) {
    const input = document.getElementById('scale');
    if (input) input.value = scaleToPxPerMm(configuredScale);
}

function loadConfiguredScale(venue = activeVenueId) {
    if (window.CURATOR_SUPABASE_CONFIG) return null;
    try {
        const saved = editorStorage.getItem(venueScaleStorageKey(venue));
        const value = Number(saved);
        if (saved !== null && Number.isFinite(value) && value > 0) return value;
        // Preserve calibration from drafts created before scale had its own setting.
        const draft = JSON.parse(editorStorage.getItem(STORAGE_KEY) || 'null');
        const legacy = venueOf(draft) === venue ? Number(draft?.scale) : 0;
        if (Number.isFinite(legacy) && legacy > 0) {
            editorStorage.setItem(venueScaleStorageKey(venue), String(legacy));
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
        if (input) input.value = configuredScale == null ? '' : scaleToPxPerMm(configuredScale);
        return false;
    }
    configuredScale = scale;
    if (input) input.value = scaleToPxPerMm(scale);
    window.refreshWorkspaceScaleBar?.();
    try {
        // Signed-in teams always obtain this value from the server.
        if (!window.CURATOR_SUPABASE_CONFIG) editorStorage.setItem(venueScaleStorageKey(activeVenueId), String(scale));
    } catch (error) {
        console.warn('縮尺設定の保存に失敗しました。', error);
    }
    return true;
}
function requireVenueScale() {
    if (activeVenueId !== 'public' || configuredScale > 0) return true;
    alert('先に管理者モードで公募展会場の縮尺を設定してください。');
    return false;
}

// Active drawing and venue.
let currentViewMode = 'floor';
let isAdminMode = false;
let floorPlanJsonData = null;
const SPECIAL_FLOOR_PLANS = {
    lobby: { title: 'ロビー階', image: 'images/LBF01.png' },
    floor1: { title: '1階', image: 'images/1F01.png' },
    floor2: { title: '2階', image: 'images/2F01.png' }
};
const PUBLIC_ROOMS = ['01', '02', '03', '04'];
const publicRoomTitle = room => `第${Number(room)}公募展会場`;
const PUBLIC_FLOOR_PLANS = Object.fromEntries(PUBLIC_ROOMS.flatMap(room =>
    [
        ['LBF', 'LBF', 'ロビー階'],
        // Keep the former combined ID for 1F so previously saved layouts still open.
        ['12F', '12F', '1階'],
        ['2F', '12F', '2階']
    ].map(([level, imageGroup, levelTitle]) => [
        `koubo_${level}_${room}`,
        { room, level, levelTitle, title: `${publicRoomTitle(room)}・${levelTitle}`, image: `images/koubo${imageGroup}${room}.png` }
    ])
));
const ALL_FLOOR_PLANS = { ...SPECIAL_FLOOR_PLANS, ...PUBLIC_FLOOR_PLANS };
let FLOOR_PLANS = SPECIAL_FLOOR_PLANS;
const isPublicFloor = id => Object.hasOwn(PUBLIC_FLOOR_PLANS, id);
const venueCeilingHeightCm = (id = selectedFloorId) => isPublicFloor(id) ? 480 : 450;
const venueMovableWallDefaults = (id = selectedFloorId) => isPublicFloor(id)
    ? { width: 620, depth: 10, height: 480 }
    : { width: 180, depth: 20, height: 440 };
const firstVenueFloor = () => Object.keys(FLOOR_PLANS)[0];
const isVenueFloor = id => Object.hasOwn(FLOOR_PLANS, id || 'lobby');
function fillVenueFloorSelect(select, fallback = selectedFloorId) {
    if (!select || select.dataset.venue === activeVenueId) return;
    const previous = select.value;
    select.replaceChildren(...Object.entries(FLOOR_PLANS).map(([id, floor]) => new Option(floor.title, id)));
    select.value = isVenueFloor(previous) && previous ? previous : fallback;
    select.dataset.venue = activeVenueId;
}
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

// The collision mask is drawn independently of the visible canvas.
let wallCanvas = document.createElement('canvas');
let wallCtx = wallCanvas.getContext('2d', {
    willReadFrequently: true
});

let isWallDataLoaded = false;
let cachedBackgroundImage = null;

let isTransitioning = false;

// Active drawing tools and undo history.
let isMeasuringMode = false;
let isMeasuring = false;
let isFreeDrawingMode = false;
let isDimensionDrawingMode = false;
let measureLine = null;
let measureStartPt = null;

let historyStack = [];
let redoStack = [];
let isUndoRedoOperation = false;
