// ① Fabric.js キャンバスの初期化
const canvas = new fabric.Canvas('canvas');

const STORAGE_KEY = 'curator_canvas_draft_data';

// 現在のビューモード ('floor': 平面図, 'wall': 壁面図)
let currentViewMode = 'floor';

// 平面図・壁面図の独立状態保持用オブジェクト
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

// 背景画像（図面）のオフスクリーン Canvas
let wallCanvas = document.createElement('canvas');
let wallCtx = wallCanvas.getContext('2d', { willReadFrequently: true });
let isWallDataLoaded = false;
let cachedBackgroundImage = null;

// ロード中フラグ（競合防止用）
let isTransitioning = false;

// --- 測定 / 壁選択モード変数 ---
let isMeasuringMode = false;
let isMeasuring = false;
let measureLine = null;
let measureStartPt = null;
let isSelectingWallMode = false;

// --- Undo / Redo & 保存モジュール ---
let historyStack = [];
let redoStack = [];
let isUndoRedoOperation = false;

function getCustomProperties() {
    return [
        'isArtwork', 'displayType', 'cmWidth', 'cmHeight', 'cmDepth',
        'pxWidth', 'pxHeight', 'crowdCountValue', 
        'isFreePin', 'pinLabel', 'isGuard'
    ];
}

// 現在開いている画面の最新状態を退避保持する関数
function captureCurrentCanvasState() {
    if (isTransitioning) return;
    const jsonStr = JSON.stringify(canvas.toJSON(getCustomProperties()));
    if (currentViewMode === 'floor') {
        floorPlanJsonData = jsonStr;
    } else if (currentViewMode === 'wall' && selectedWallInfo && selectedWallInfo.id) {
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

function getSerializedCanvasData() {
    captureCurrentCanvasState();

    const titleInput = document.getElementById("exhibitionTitle");
    const exhibitionTitle = titleInput ? titleInput.value : "";
    const scaleInput = document.getElementById("scale");
    const currentScale = scaleInput ? parseFloat(scaleInput.value) || 0.5 : 0.5;

    return JSON.stringify({
        exhibitionTitle: exhibitionTitle,
        scale: currentScale,
        currentViewMode: currentViewMode,
        selectedWallInfo: selectedWallInfo,
        floorPlanJsonData: floorPlanJsonData,
        wallPlanJsonData: wallPlanJsonData
    });
}

function saveLocalStorage() {
    try {
        const json = getSerializedCanvasData();
        localStorage.setItem(STORAGE_KEY, json);
        const statusEl = document.getElementById("saveStatus");
        if (statusEl) {
            const now = new Date();
            const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            statusEl.innerText = `自動保存済み (${timeStr})`;
        }
    } catch (e) {
        console.error("ローカルストレージへの保存に失敗しました:", e);
    }
}

function saveState() {
    if (isUndoRedoOperation || isMeasuringMode || isSelectingWallMode || isTransitioning) return;
    const json = getSerializedCanvasData();
    historyStack.push(json);
    redoStack = [];
    updateUndoRedoButtons();
    saveLocalStorage();
}

function undo() {
    if (historyStack.length <= 1) return;
    isUndoRedoOperation = true;
    const currentState = historyStack.pop();
    redoStack.push(currentState);
    
    const prevState = historyStack[historyStack.length - 1];
    applyStateData(prevState, function() {
        isUndoRedoOperation = false;
        updateUndoRedoButtons();
        saveLocalStorage();
    });
}

function redo() {
    if (redoStack.length === 0) return;
    isUndoRedoOperation = true;
    const nextState = redoStack.pop();
    historyStack.push(nextState);
    
    applyStateData(nextState, function() {
        isUndoRedoOperation = false;
        updateUndoRedoButtons();
        saveLocalStorage();
    });
}

function applyStateData(jsonString, callback) {
    try {
        const parsed = JSON.parse(jsonString);
        
        const exhibitionTitle = parsed.exhibitionTitle || "";
        const scaleValue = parsed.scale || 0.5;

        const titleInput = document.getElementById("exhibitionTitle");
        if (titleInput && parsed.exhibitionTitle !== undefined) {
            titleInput.value = exhibitionTitle;
        }

        const scaleInput = document.getElementById("scale");
        if (scaleInput && parsed.scale !== undefined) {
            scaleInput.value = scaleValue;
        }

        if (parsed.floorPlanJsonData) floorPlanJsonData = parsed.floorPlanJsonData;
        if (parsed.wallPlanJsonData) wallPlanJsonData = parsed.wallPlanJsonData;
        if (parsed.selectedWallInfo) selectedWallInfo = parsed.selectedWallInfo;

        updateWallDropdownOptions();

        const targetMode = parsed.currentViewMode || 'floor';
        switchViewMode(targetMode, true, callback);

    } catch (e) {
        console.error("状態の適用に失敗しました:", e);
        if (callback) callback();
    }
}

function updateUndoRedoButtons() {
    const btnUndo = document.getElementById("btnUndo");
    const btnRedo = document.getElementById("btnRedo");
    if (btnUndo) btnUndo.disabled = historyStack.length <= 1;
    if (btnRedo) btnRedo.disabled = redoStack.length === 0;
}

function restoreCustomProperties() {
    const objects = canvas.getObjects();
    objects.forEach(obj => {
        if (obj.isArtwork && obj.crowdCountValue) {
            const circle = objects.find(c => c.type === 'circle' && c.left === obj.left && c.top === obj.top);
            if (circle) {
                obj.crowdCircle = circle;
            }
        }
    });
}

// ----------------------------------------------------
// 🧱 壁面ドロップダウンの更新・選択変更処理
// ----------------------------------------------------
function updateWallDropdownOptions() {
    const selectEl = document.getElementById("wallListSelect");
    if (!selectEl) return;

    selectEl.innerHTML = '';
    const keys = Object.keys(wallPlanJsonData);

    keys.forEach(key => {
        const wall = wallPlanJsonData[key];
        const opt = document.createElement('option');
        opt.value = key;
        opt.text = `${wall.title} (${wall.widthCm}cm × ${wall.heightCm}cm)`;
        if (key === selectedWallInfo.id) {
            opt.selected = true;
        }
        selectEl.appendChild(opt);
    });
}

async function handleWallSelectChange(wallId) {
    if (!wallPlanJsonData[wallId] || isTransitioning) return;
    if (selectedWallInfo.id === wallId && currentViewMode === 'wall') return;

    isTransitioning = true;

    // 1. 現在表示している壁のキャンバス状態を確実に退避保存
    captureCurrentCanvasState();

    // 2. 新しく選択された壁の情報を反映
    const targetWall = wallPlanJsonData[wallId];
    selectedWallInfo = {
        id: wallId,
        title: targetWall.title,
        widthCm: targetWall.widthCm,
        heightCm: targetWall.heightCm
    };

    currentViewMode = 'wall';

    const tabFloor = document.getElementById("tabFloorPlan");
    const tabWall = document.getElementById("tabWallPlan");
    const floorControls = document.getElementById("floorPlanControls");
    const wallControls = document.getElementById("wallPlanControls");
    const wallBanner = document.getElementById("wallInfoBanner");

    if (tabWall) tabWall.classList.add("active");
    if (tabFloor) tabFloor.classList.remove("active");
    if (floorControls) floorControls.style.display = "none";
    if (wallControls) wallControls.style.display = "block";
    if (wallBanner) wallBanner.style.display = "block";

    updateWallDropdownOptions();
    updateWallBannerText();
    
    // 3. 選択された壁のデータを描画
    await new Promise(resolve => renderWallCanvas(resolve));

    isTransitioning = false;
    saveState();
}

// ----------------------------------------------------
// 🗺️ 平面図 (Floor) ⇄ 🖼️ 壁面図 (Wall) 切り替えロジック
// ----------------------------------------------------
async function switchViewMode(mode, skipSave = false, callback = null) {
    if (isTransitioning) return;
    if (currentViewMode === mode && !skipSave && !callback) return;

    isTransitioning = true;

    captureCurrentCanvasState();

    currentViewMode = mode;
    canvas.clear();

    const tabFloor = document.getElementById("tabFloorPlan");
    const tabWall = document.getElementById("tabWallPlan");
    const floorControls = document.getElementById("floorPlanControls");
    const wallControls = document.getElementById("wallPlanControls");
    const wallBanner = document.getElementById("wallInfoBanner");

    if (mode === 'floor') {
        if (tabFloor) tabFloor.classList.add("active");
        if (tabWall) tabWall.classList.remove("active");
        if (floorControls) floorControls.style.display = "block";
        if (wallControls) wallControls.style.display = "none";
        if (wallBanner) wallBanner.style.display = "none";

        await new Promise(resolve => loadBackgroundImage(resolve));

        if (floorPlanJsonData) {
            await new Promise(resolve => {
                canvas.loadFromJSON(floorPlanJsonData, function() {
                    ensureBackgroundImage(function() {
                        canvas.renderAll();
                        restoreCustomProperties();
                        resolve();
                    });
                });
            });
        } else {
            await new Promise(resolve => ensureBackgroundImage(resolve));
        }
    } else {
        if (tabWall) tabWall.classList.add("active");
        if (tabFloor) tabFloor.classList.remove("active");
        if (floorControls) floorControls.style.display = "none";
        if (wallControls) wallControls.style.display = "block";
        if (wallBanner) wallBanner.style.display = "block";

        updateWallDropdownOptions();
        updateWallBannerText();
        await new Promise(resolve => renderWallCanvas(resolve));
    }

    isTransitioning = false;
    if (!skipSave) saveState();
    if (callback) callback();
}

function ensureBackgroundImage(callback) {
    if (cachedBackgroundImage) {
        canvas.setBackgroundImage(cachedBackgroundImage, function() {
            canvas.renderAll();
            if (callback) callback();
        });
    } else {
        loadBackgroundImage(callback);
    }
}

function updateWallBannerText() {
    const titleEl = document.getElementById("bannerWallTitle");
    const widthEl = document.getElementById("bannerWallWidth");
    const heightEl = document.getElementById("bannerWallHeight");
    const inputW = document.getElementById("wallWidthCm");
    const inputH = document.getElementById("wallHeightCm");

    if (titleEl) titleEl.innerText = selectedWallInfo.title;
    if (widthEl) widthEl.innerText = selectedWallInfo.widthCm;
    if (heightEl) heightEl.innerText = selectedWallInfo.heightCm;

    if (inputW) inputW.value = selectedWallInfo.widthCm;
    if (inputH) inputH.value = selectedWallInfo.heightCm;
}

// 壁面キャンバスの生成
async function renderWallCanvas(callback = null) {
    canvas.clear();
    canvas.setBackgroundImage(null);

    const scaleInput = document.getElementById("scale");
    const scale = scaleInput ? parseFloat(scaleInput.value) || 0.5 : 0.5;

    const pxW = selectedWallInfo.widthCm * scale;
    const pxH = selectedWallInfo.heightCm * scale;

    const wallRect = new fabric.Rect({
        left: (canvas.width - pxW) / 2,
        top: (canvas.height - pxH) / 2,
        width: pxW,
        height: pxH,
        fill: '#f8fafc',
        stroke: '#334155',
        strokeWidth: 3,
        selectable: false,
        evented: false
    });

    canvas.add(wallRect);

    const wallItem = wallPlanJsonData[selectedWallInfo.id];
    if (wallItem && wallItem.json) {
        await new Promise(resolve => {
            canvas.loadFromJSON(wallItem.json, function() {
                canvas.renderAll();
                restoreCustomProperties();
                resolve();
            });
        });
    } else {
        canvas.renderAll();
    }

    if (callback) callback();
}

// 全作品一括サイズリサイズ
function applyScaleToAllArtworks(newScale) {
    canvas.getObjects().forEach(obj => {
        if (obj.isArtwork) {
            let newPxW = obj.cmWidth * newScale;
            let newPxH = (obj.displayType === 'wall') 
                ? (obj.cmDepth || 5) * newScale 
                : (obj.cmHeight || 100) * newScale;

            newPxH = Math.max(newPxH, 6);

            obj.pxWidth = newPxW;
            obj.pxHeight = newPxH;

            const rect = obj.item ? obj.item(0) : null;
            if (rect) {
                rect.set({
                    width: newPxW,
                    height: newPxH
                });
            }

            const textObj = obj.item ? obj.item(1) : null;
            if (textObj) {
                textObj.set({
                    fontSize: (obj.displayType === 'wall') ? 10 : 14
                });
            }

            obj.set({
                width: newPxW,
                height: newPxH
            });
            obj.setCoords();

            if (obj.crowdCircle) {
                const diagonal = Math.sqrt(Math.pow(newPxW, 2) + Math.pow(newPxH, 2));
                const radius = (diagonal / 2) + 15;
                obj.crowdCircle.set({ radius: radius });
                obj.crowdCircle.setCoords();
            }
        }
    });

    canvas.renderAll();
    saveState();
}

// 背景図面の読み込み＆キャッシュ関数
function loadBackgroundImage(callback) {
    if (cachedBackgroundImage) {
        canvas.setBackgroundImage(cachedBackgroundImage, function() {
            canvas.renderAll();
            if (callback) callback();
        });
        return;
    }

    fabric.Image.fromURL('images/zumen02.png', function(img) {
        if (img) {
            img.set({
                scaleX: canvas.width / img.width,
                scaleY: canvas.height / img.height,
                originX: 'left',
                originY: 'top'
            });

            cachedBackgroundImage = img;

            canvas.setBackgroundImage(img, function() {
                canvas.renderAll();

                wallCanvas.width = canvas.width;
                wallCanvas.height = canvas.height;
                wallCtx.drawImage(
                    img._element, 
                    0, 0, img.width, img.height,
                    0, 0, canvas.width, canvas.height
                );
                isWallDataLoaded = true;

                if (callback) callback();
            });
        } else {
            console.warn("背景画像 'images/zumen02.png' の読み込みに失敗しました。");
            if (callback) callback();
        }
    }, { crossOrigin: 'anonymous' });
}

// 初期読み込み
loadBackgroundImage(function() {
    loadSavedData();
});

// 壁衝突判定
function checkCollisionWithWall(obj) {
    if (!isWallDataLoaded || !obj || currentViewMode === 'wall') return false;

    const boundingRect = obj.getBoundingRect();

    if (boundingRect.left < 2 || boundingRect.left + boundingRect.width > canvas.width - 2 ||
        boundingRect.top < 2 || boundingRect.top + boundingRect.height > canvas.height - 2) {
        return true;
    }

    const inset = Math.min(3, Math.min(boundingRect.width, boundingRect.height) / 4);
    const left = boundingRect.left + inset;
    const top = boundingRect.top + inset;
    const right = boundingRect.left + boundingRect.width - inset;
    const bottom = boundingRect.top + boundingRect.height - inset;
    const centerX = Math.floor(boundingRect.left + boundingRect.width / 2);
    const centerY = Math.floor(boundingRect.top + boundingRect.height / 2);

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
        for (let pt of samplePoints) {
            if (pt.x >= 0 && pt.x < canvas.width && pt.y >= 0 && pt.y < canvas.height) {
                const pixel = wallCtx.getImageData(pt.x, pt.y, 1, 1).data;
                if (pixel[0] < 50 && pixel[1] < 50 && pixel[2] < 50 && pixel[3] > 100) {
                    return true;
                }
            }
        }
    } catch (e) {
        console.error("壁衝突判定エラー:", e);
    }

    return false;
}

// 選択中オブジェクトの90度回転
function rotateActiveObject() {
    const activeObj = canvas.getActiveObject();
    if (!activeObj) {
        alert("回転させたいオブジェクトをキャンバス上で選択してください。");
        return;
    }

    const currentAngle = activeObj.angle || 0;
    const newAngle = (currentAngle + 90) % 360;

    const originalAngle = activeObj.angle;
    activeObj.set('angle', newAngle);
    activeObj.setCoords();

    if (checkCollisionWithWall(activeObj)) {
        activeObj.set('angle', originalAngle);
        activeObj.setCoords();
        alert("壁（黒線）をまたぐため回転できません。");
    } else {
        if (activeObj.isArtwork && activeObj.crowdCircle) {
            activeObj.crowdCircle.set({
                left: activeObj.left,
                top: activeObj.top
            });
            activeObj.crowdCircle.setCoords();
        }
        canvas.renderAll();
        saveState();
    }
}

function loadSavedData() {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
        try {
            isUndoRedoOperation = true;
            applyStateData(savedData, function() {
                isUndoRedoOperation = false;
                historyStack = [savedData];
                redoStack = [];
                updateUndoRedoButtons();
                
                const statusEl = document.getElementById("saveStatus");
                if (statusEl) statusEl.innerText = "前回のデータを読み込みました";
            });
        } catch (e) {
            console.error("保存データの読み込みに失敗しました:", e);
            saveState();
        }
    } else {
        saveState();
    }
}

let artworkCount = 0;
let pinCount = 0;

function getCrowdColor(count) {
    const MAX_PEOPLE = 15;
    const ratio = Math.min(Math.max(count / MAX_PEOPLE, 0), 1);
    
    let r, g, b;
    if (ratio < 0.5) {
        const factor = ratio * 2;
        r = Math.round(46 + (241 - 46) * factor);
        g = Math.round(204 + (196 - 204) * factor);
        b = Math.round(113 + (15 - 113) * factor);
    } else {
        const factor = (ratio - 0.5) * 2;
        r = Math.round(241 + (231 - 241) * factor);
        g = Math.round(196 + (76 - 196) * factor);
        b = Math.round(15 + (60 - 15) * factor);
    }

    return {
        fill: `rgba(${r}, ${g}, ${b}, 0.35)`,
        stroke: `rgba(${r}, ${g}, ${b}, 0.8)`
    };
}

canvas.on('object:modified', saveState);
canvas.on('object:added', function(e) {
    if (!isUndoRedoOperation && !isMeasuringMode && !isSelectingWallMode && !isTransitioning) saveState();
});
canvas.on('object:removed', function(e) {
    if (!isUndoRedoOperation && !isMeasuringMode && !isSelectingWallMode && !isTransitioning) saveState();
});

// 移動イベント
let lastValidPosition = { left: 0, top: 0 };

canvas.on('mouse:down', function(e) {
    if (isMeasuringMode || isSelectingWallMode) {
        isMeasuring = true;
        const pointer = canvas.getPointer(e.e);
        measureStartPt = pointer;

        measureLine = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
            stroke: isSelectingWallMode ? '#2563eb' : '#ef4444',
            strokeWidth: 4,
            strokeDashArray: isSelectingWallMode ? null : [6, 4],
            selectable: false,
            evented: false
        });
        canvas.add(measureLine);
        return;
    }

    if (e.target) {
        lastValidPosition = { left: e.target.left, top: e.target.top };
    }
});

canvas.on('mouse:move', function(e) {
    if ((isMeasuringMode || isSelectingWallMode) && isMeasuring && measureLine) {
        const pointer = canvas.getPointer(e.e);
        measureLine.set({ x2: pointer.x, y2: pointer.y });
        canvas.renderAll();
    }
});

canvas.on('mouse:up', async function(e) {
    if ((isMeasuringMode || isSelectingWallMode) && isMeasuring) {
        isMeasuring = false;
        const pointer = canvas.getPointer(e.e);
        
        const dx = pointer.x - measureStartPt.x;
        const dy = pointer.y - measureStartPt.y;
        const linePixelLength = Math.sqrt(dx * dx + dy * dy);

        if (measureLine) {
            canvas.remove(measureLine);
            measureLine = null;
        }

        if (linePixelLength < 10) {
            alert("ドラッグ線が短すぎます。もう一度壁の端から端までしっかりドラッグしてください。");
            return;
        }

        const scaleInput = document.getElementById("scale");
        const currentScale = scaleInput ? parseFloat(scaleInput.value) || 0.5 : 0.5;

        if (isSelectingWallMode) {
            const calculatedWallCm = Math.round(linePixelLength / currentScale);
            const wallName = prompt(`選択した壁の名称を入力してください:`, `壁面 ${Object.keys(wallPlanJsonData).length + 1}`);
            
            if (wallName) {
                captureCurrentCanvasState();

                const wallId = `wall_${Date.now()}`;
                
                wallPlanJsonData[wallId] = {
                    title: wallName,
                    widthCm: calculatedWallCm,
                    heightCm: 300,
                    json: null
                };

                selectedWallInfo = {
                    id: wallId,
                    title: wallName,
                    widthCm: calculatedWallCm,
                    heightCm: 300
                };

                updateWallDropdownOptions();
                toggleSelectingWallMode(false);
                await switchViewMode('wall', false);
            } else {
                toggleSelectingWallMode(false);
            }

        } else if (isMeasuringMode) {
            const realLengthCmStr = prompt(`測定した線の長さ（画面上 ${Math.round(linePixelLength)} px）は、現実で何 cm ですか？\n例: 300`, "300");
            
            if (realLengthCmStr) {
                const realLengthCm = parseFloat(realLengthCmStr);
                if (!isNaN(realLengthCm) && realLengthCm > 0) {
                    const calculatedScale = Math.round((linePixelLength / realLengthCm) * 1000) / 1000;
                    
                    if (scaleInput) {
                        scaleInput.value = calculatedScale;
                    }

                    alert(`縮尺スケールを [ ${calculatedScale} px/cm ] に自動更新しました！\n（配置済みの展示物サイズを一括適用します）`);
                    applyScaleToAllArtworks(calculatedScale);
                } else {
                    alert("正しい数値を入力してください。");
                }
            }
            toggleMeasuringMode(false);
        }
    }
});

canvas.on('object:moving', function(e) {
    const obj = e.target;
    if (!obj) return;

    if (checkCollisionWithWall(obj)) {
        obj.set({
            left: lastValidPosition.left,
            top: lastValidPosition.top
        });
        obj.setCoords();
    } else {
        lastValidPosition = { left: obj.left, top: obj.top };
    }

    if (obj.isArtwork && obj.crowdCircle) {
        obj.crowdCircle.set({
            left: obj.left,
            top: obj.top
        });
        obj.crowdCircle.setCoords();
    }
});

function toggleMeasuringMode(enable) {
    isMeasuringMode = enable !== undefined ? enable : !isMeasuringMode;
    const btn = document.getElementById("btnMeasureScale");
    
    if (isMeasuringMode) {
        isSelectingWallMode = false;
        canvas.selection = false;
        canvas.defaultCursor = 'crosshair';
        canvas.forEachObject(o => o.selectable = false);
        if (btn) {
            btn.classList.add("btn-active-measure");
            btn.innerText = "❌ 測定をキャンセル";
        }
    } else {
        canvas.selection = true;
        canvas.defaultCursor = 'default';
        canvas.forEachObject(o => o.selectable = true);
        if (btn) {
            btn.classList.remove("btn-active-measure");
            btn.innerText = "📐 基準線を引いて縮尺を自動計算";
        }
    }
}

function toggleSelectingWallMode(enable) {
    isSelectingWallMode = enable !== undefined ? enable : !isSelectingWallMode;
    const btn = document.getElementById("btnSelectWall");

    if (isSelectingWallMode) {
        isMeasuringMode = false;
        canvas.selection = false;
        canvas.defaultCursor = 'crosshair';
        canvas.forEachObject(o => o.selectable = false);
        if (btn) {
            btn.classList.add("btn-active-measure");
            btn.innerText = "❌ 壁選択をキャンセル";
        }
    } else {
        canvas.selection = true;
        canvas.defaultCursor = 'default';
        canvas.forEachObject(o => o.selectable = true);
        if (btn) {
            btn.classList.remove("btn-active-measure");
            btn.innerText = "👆 図面上の壁を選択して壁面図へ";
        }
    }
}

// ----------------------------------------------------
// 📄 平面＋全壁面をまとめたマルチページPDF生成機能
// ----------------------------------------------------
async function generateCombinedPdf() {
    const titleInput = document.getElementById("exhibitionTitle");
    const currentTitle = (titleInput && titleInput.value.trim()) ? titleInput.value.trim() : "展示配置指示書";
    const memoEl = document.getElementById("pdfMemo");
    const memoText = memoEl ? memoEl.value : "特記事項なし";

    const initialMode = currentViewMode;
    const initialWall = { ...selectedWallInfo };

    // 1. 平面図の画像を取得
    await switchViewMode('floor', true);
    await new Promise(r => setTimeout(r, 200));
    const floorCanvasUrl = canvas.toDataURL({ format: 'png', quality: 1.0 });

    const floorObjects = canvas.getObjects();
    const artworkList = [];
    const freePinList = [];

    floorObjects.forEach((obj, index) => {
        if (obj.isArtwork) {
            const textObj = obj.item ? obj.item(1) : null;
            const name = textObj ? textObj.text : `作品 ${index + 1}`;
            const cmW = obj.cmWidth || 150;
            const cmH = obj.cmHeight || 100;
            const cmD = obj.cmDepth || 5;
            const typeLabel = (obj.displayType === 'wall') ? '壁面展示' : '床置展示';
            const dimText = (obj.displayType === 'wall') 
                ? `幅:${cmW}×高:${cmH} (厚:${cmD}) cm` 
                : `幅:${cmW}×奥:${cmH} cm`;

            let crowdStatus = "未設定 / 0人";
            if (obj.crowdCountValue) {
                crowdStatus = `警戒人数: ${obj.crowdCountValue}人`;
            }

            artworkList.push({
                id: artworkList.length + 1,
                name: name,
                type: typeLabel,
                dimensions: dimText,
                crowd: crowdStatus
            });
        } else if (obj.isFreePin) {
            freePinList.push({
                id: freePinList.length + 1,
                label: obj.pinLabel || "フリーピン"
            });
        }
    });

    // 2. 登録されている全壁面の画像を取得
    const wallCaptureList = [];
    const wallKeys = Object.keys(wallPlanJsonData);

    for (let key of wallKeys) {
        const wallData = wallPlanJsonData[key];
        selectedWallInfo = {
            id: key,
            title: wallData.title || "壁面",
            widthCm: wallData.widthCm || 600,
            heightCm: wallData.heightCm || 300
        };

        await switchViewMode('wall', true);
        await new Promise(r => setTimeout(r, 200));

        const wallImgUrl = canvas.toDataURL({ format: 'png', quality: 1.0 });
        wallCaptureList.push({
            title: wallData.title,
            widthCm: wallData.widthCm,
            heightCm: wallData.heightCm,
            imgUrl: wallImgUrl
        });
    }

    selectedWallInfo = initialWall;
    await switchViewMode(initialMode, true);

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert("ポップアップがブロックされました。ブラウザのポップアップブロックを解除してください。");
        return;
    }

    const today = new Date().toLocaleDateString('ja-JP', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    let pagesHtml = `
        <div class="page">
            <div class="header">
                <div class="title">${currentTitle} (平面配置図)</div>
                <div class="date">発行日: ${today}</div>
            </div>

            <div class="section-title">1. 全体平面配置図</div>
            <div style="text-align: center;">
                <img src="${floorCanvasUrl}" class="canvas-img" />
            </div>

            <div class="section-title">2. 展示作品・設置物一覧</div>
            <table>
                <thead>
                    <tr>
                        <th style="width: 6%;">No.</th>
                        <th style="width: 34%;">作品名 / 展示物</th>
                        <th style="width: 15%;">展示種別</th>
                        <th style="width: 25%;">実寸サイズ</th>
                        <th style="width: 20%;">混雑警戒状態</th>
                    </tr>
                </thead>
                <tbody>
                    ${artworkList.length > 0 ? artworkList.map(item => `
                        <tr>
                            <td>${item.id}</td>
                            <td><strong>${item.name}</strong></td>
                            <td>${item.type}</td>
                            <td>${item.dimensions}</td>
                            <td>${item.crowd}</td>
                        </tr>
                    `).join('') : '<tr><td colspan="5" style="text-align:center;">配置されている作品はありません。</td></tr>'}
                </tbody>
            </table>

            ${freePinList.length > 0 ? `
                <div class="section-title">3. 設置済みフリーピン・注記</div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 10%;">No.</th>
                            <th style="width: 90%;">ピン名称・内容</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${freePinList.map(pin => `
                            <tr>
                                <td>${pin.id}</td>
                                <td>${pin.label}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : ''}

            <div class="section-title">${freePinList.length > 0 ? '4' : '3'}. 特記事項・注意事項</div>
            <div class="memo-box">${memoText}</div>

            <div class="footer">curator-canvas - 統合展示指示書 Page 1</div>
        </div>
    `;

    wallCaptureList.forEach((wall, idx) => {
        pagesHtml += `
            <div class="page page-break">
                <div class="header">
                    <div class="title">${currentTitle} (壁面立面図: ${wall.title})</div>
                    <div class="date">発行日: ${today}</div>
                </div>

                <div class="section-title">壁面仕様: ${wall.title} (幅: ${wall.widthCm} cm × 高さ: ${wall.heightCm} cm)</div>
                <div style="text-align: center; margin-top: 20px;">
                    <img src="${wall.imgUrl}" class="canvas-img-large" />
                </div>

                <div class="footer">curator-canvas - 統合展示指示書 Page ${idx + 2}</div>
            </div>
        `;
    });

    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="ja">
        <head>
            <meta charset="UTF-8">
            <title>${currentTitle} - curator-canvas 統合指示書</title>
            <style>
                @page { size: A4 portrait; margin: 12mm; }
                body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; margin: 0; padding: 0; background: #e2e8f0; }
                
                .page {
                    background: #ffffff;
                    width: 210mm;
                    min-height: 297mm;
                    padding: 15mm;
                    margin: 10px auto;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    box-sizing: border-box;
                    position: relative;
                }

                @media print {
                    body { background: none; }
                    .page { width: 100%; margin: 0; padding: 0; box-shadow: none; }
                    .page-break { page-break-before: always; }
                    .no-print { display: none !important; }
                }

                .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #2c3e50; padding-bottom: 8px; margin-bottom: 16px; }
                .title { font-size: 20px; font-weight: bold; color: #2c3e50; }
                .date { font-size: 11px; color: #666; }
                .section-title { font-size: 13px; font-weight: bold; background: #f2f4f7; padding: 6px 10px; border-left: 4px solid #2563eb; margin: 16px 0 8px 0; }
                
                .canvas-img { width: 100%; max-height: 350px; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 4px; }
                .canvas-img-large { width: 100%; max-height: 550px; object-fit: contain; border: 1px solid #cbd5e1; border-radius: 4px; }
                
                table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
                th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
                th { background-color: #f8fafc; font-weight: bold; }
                
                .memo-box { font-size: 11px; line-height: 1.5; white-space: pre-wrap; background: #fafafa; border: 1px solid #eee; padding: 10px; border-radius: 4px; min-height: 40px; }
                .footer { position: absolute; bottom: 12mm; right: 15mm; font-size: 10px; color: #888; }
            </style>
        </head>
        <body>
            <div class="no-print" style="background: #e0f2fe; padding: 12px; text-align: center; position: fixed; top: 0; left: 0; right: 0; z-index: 9999; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <button onclick="window.print()" style="padding: 10px 28px; background: #0284c7; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px;">🖨️ PDF保存・印刷する</button>
            </div>
            <div style="height: 50px;" class="no-print"></div>

            ${pagesHtml}

            <script>
                window.onload = function() {
                    setTimeout(function() {
                        window.print();
                    }, 600);
                };
            <\/script>
        </body>
        </html>
    `);

    printWindow.document.close();
}

document.addEventListener("DOMContentLoaded", function() {

    const tabFloor = document.getElementById("tabFloorPlan");
    const tabWall = document.getElementById("tabWallPlan");

    if (tabFloor) tabFloor.addEventListener("click", () => switchViewMode('floor'));
    if (tabWall) tabWall.addEventListener("click", () => switchViewMode('wall'));

    const wallListSelect = document.getElementById("wallListSelect");
    if (wallListSelect) {
        wallListSelect.addEventListener("change", function(e) {
            handleWallSelectChange(e.target.value);
        });
    }

    const btnSelectWall = document.getElementById("btnSelectWall");
    if (btnSelectWall) {
        btnSelectWall.addEventListener("click", function() {
            toggleSelectingWallMode();
        });
    }

    const btnApplyWallSize = document.getElementById("btnApplyWallSize");
    if (btnApplyWallSize) {
        btnApplyWallSize.addEventListener("click", function() {
            const wInput = document.getElementById("wallWidthCm");
            const hInput = document.getElementById("wallHeightCm");

            if (wInput && hInput) {
                const newW = parseFloat(wInput.value) || 600;
                const newH = parseFloat(hInput.value) || 300;

                selectedWallInfo.widthCm = newW;
                selectedWallInfo.heightCm = newH;

                if (wallPlanJsonData[selectedWallInfo.id]) {
                    wallPlanJsonData[selectedWallInfo.id].widthCm = newW;
                    wallPlanJsonData[selectedWallInfo.id].heightCm = newH;
                }

                updateWallDropdownOptions();
                updateWallBannerText();
                renderWallCanvas();
                saveState();
            }
        });
    }

    const titleInput = document.getElementById("exhibitionTitle");
    if (titleInput) {
        titleInput.addEventListener("input", saveState);
    }

    const btnRotate90 = document.getElementById("btnRotate90");
    if (btnRotate90) {
        btnRotate90.addEventListener("click", rotateActiveObject);
    }

    const btnMeasureScale = document.getElementById("btnMeasureScale");
    if (btnMeasureScale) {
        btnMeasureScale.addEventListener("click", function() {
            toggleMeasuringMode();
        });
    }

    const displayTypeSelect = document.getElementById("displayType");
    const typeHelpText = document.getElementById("typeHelpText");
    
    if (displayTypeSelect && typeHelpText) {
        displayTypeSelect.addEventListener("change", function() {
            if (displayTypeSelect.value === 'wall') {
                typeHelpText.innerText = '※壁面展示では「幅×厚み」の細長い形状で平面図に描画されます。';
            } else {
                typeHelpText.innerText = '※床置展示では「幅×奥行き」の領域で平面図に描画されます。';
            }
        });
    }

    const scaleInput = document.getElementById("scale");
    if (scaleInput) {
        scaleInput.addEventListener("change", function() {
            const newScale = parseFloat(scaleInput.value) || 0.5;
            applyScaleToAllArtworks(newScale);
        });
    }

    const addButton = document.getElementById("addArtwork");
    const addFreePinButton = document.getElementById("addFreePin");
    const addGuardButton = document.getElementById("addGuard");
    const updateCrowdButton = document.getElementById("updateCrowd");
    const pdfButton = document.getElementById("generatePdf");
    const btnUndo = document.getElementById("btnUndo");
    const btnRedo = document.getElementById("btnRedo");
    const btnSaveData = document.getElementById("btnSaveData");
    const btnClearData = document.getElementById("btnClearData");

    if (btnUndo) btnUndo.addEventListener("click", undo);
    if (btnRedo) btnRedo.addEventListener("click", redo);

    if (btnSaveData) {
        btnSaveData.addEventListener("click", function() {
            saveLocalStorage();
            alert("現在の配置データをブラウザに保存しました！");
        });
    }

    if (btnClearData) {
        btnClearData.addEventListener("click", function() {
            if (confirm("保存されている下書きデータを削除し、キャンバスを初期化しますか？")) {
                localStorage.removeItem(STORAGE_KEY);
                canvas.clear();
                
                if (titleInput) titleInput.value = "";

                loadBackgroundImage(function() {
                    historyStack = [];
                    redoStack = [];
                    artworkCount = 0;
                    pinCount = 0;
                    floorPlanJsonData = null;
                    wallPlanJsonData = {
                        'wall_default': {
                            title: '壁 A',
                            widthCm: 600,
                            heightCm: 300,
                            json: null
                        }
                    };
                    selectedWallInfo = {
                        id: 'wall_default',
                        title: '壁 A',
                        widthCm: 600,
                        heightCm: 300
                    };
                    currentViewMode = 'floor';
                    switchViewMode('floor');
                    saveState();

                    const statusEl = document.getElementById("saveStatus");
                    if (statusEl) statusEl.innerText = "データを初期化しました";
                });
            }
        });
    }

    // キーボードショートカット
    window.addEventListener("keydown", function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            return;
        }

        if (e.key === 'r' || e.key === 'R') {
            rotateActiveObject();
            e.preventDefault();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            if (e.shiftKey) {
                redo();
            } else {
                undo();
            }
            e.preventDefault();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
            redo();
            e.preventDefault();
        }
    });

    // 展示品（作品オブジェクト）の追加
    if (addButton) {
        addButton.addEventListener("click", function() {
            artworkCount++;

            const displayType = displayTypeSelect ? displayTypeSelect.value : 'wall';
            const nameEl = document.getElementById("artworkName");
            const widthEl = document.getElementById("artworkWidth");
            const heightEl = document.getElementById("artworkHeight");
            const depthEl = document.getElementById("artworkDepth");
            const currentScale = scaleInput ? parseFloat(scaleInput.value) || 0.5 : 0.5;

            const nameText = (nameEl && nameEl.value) ? nameEl.value : `作品 ${artworkCount}`;
            const cmW = (widthEl && widthEl.value) ? parseFloat(widthEl.value) : 150;
            const cmH = (heightEl && heightEl.value) ? parseFloat(heightEl.value) : 100;
            const cmD = (depthEl && depthEl.value) ? parseFloat(depthEl.value) : 5;

            let pxW = cmW * currentScale;
            let pxH;

            if (currentViewMode === 'floor') {
                if (displayType === 'wall') {
                    pxH = Math.max(cmD * currentScale, 8);
                } else {
                    pxH = cmH * currentScale;
                }
            } else {
                pxH = cmH * currentScale;
            }

            const rect = new fabric.Rect({
                width: pxW,
                height: pxH,
                fill: displayType === 'wall' ? 'rgba(231, 76, 60, 0.85)' : 'rgba(52, 152, 219, 0.8)',
                stroke: displayType === 'wall' ? '#c0392b' : '#2980b9',
                strokeWidth: 2,
                originX: 'center',
                originY: 'center'
            });

            const text = new fabric.Text(nameText, {
                fontSize: displayType === 'wall' ? 11 : 14,
                fill: '#ffffff',
                fontFamily: 'sans-serif',
                originX: 'center',
                originY: 'center'
            });

            const artworkGroup = new fabric.Group([rect, text], {
                left: 450,
                top: 300,
                originX: 'center',
                originY: 'center',
                hasRotatingPoint: true,
                isArtwork: true,
                displayType: displayType,
                cmWidth: cmW,
                cmHeight: cmH,
                cmDepth: cmD,
                pxWidth: pxW,
                pxHeight: pxH
            });

            canvas.add(artworkGroup);
            canvas.setActiveObject(artworkGroup);
            canvas.renderAll();
        });
    }

    // フリーピンの追加
    if (addFreePinButton) {
        addFreePinButton.addEventListener("click", function() {
            pinCount++;
            const textInput = document.getElementById("pinText");
            const iconSelect = document.getElementById("pinIcon");
            const colorInput = document.getElementById("pinColor");

            const labelText = (textInput && textInput.value) ? textInput.value : `ピン ${pinCount}`;
            const iconSymbol = iconSelect ? iconSelect.value : "📍";
            const selectedColor = colorInput ? colorInput.value : "#ef4444";

            const iconBgCircle = new fabric.Circle({
                radius: 12,
                fill: selectedColor,
                opacity: 0.2,
                originX: 'center',
                originY: 'center',
                top: -12
            });

            const iconTextObj = new fabric.Text(iconSymbol, {
                fontSize: 22,
                originX: 'center',
                originY: 'center',
                top: -12
            });

            const labelTextObj = new fabric.Text(labelText, {
                fontSize: 11,
                fill: '#1e293b',
                fontFamily: 'sans-serif',
                fontWeight: 'bold',
                originX: 'center',
                originY: 'center',
                top: 13
            });

            const labelWidth = Math.max(labelTextObj.width + 12, 30);
            const labelBg = new fabric.Rect({
                width: labelWidth,
                height: 18,
                rx: 4,
                ry: 4,
                fill: 'rgba(255, 255, 255, 0.95)',
                stroke: selectedColor,
                strokeWidth: 2,
                originX: 'center',
                originY: 'center',
                top: 13
            });

            const pinGroup = new fabric.Group([iconBgCircle, iconTextObj, labelBg, labelTextObj], {
                left: 450,
                top: 350,
                originX: 'center',
                originY: 'center',
                hasRotatingPoint: false,
                isFreePin: true,
                pinLabel: `${iconSymbol} ${labelText}`
            });

            canvas.add(pinGroup);
            canvas.setActiveObject(pinGroup);
            canvas.renderAll();
        });
    }

    // 混雑円追加
    if (updateCrowdButton) {
        updateCrowdButton.addEventListener("click", function() {
            const activeObj = canvas.getActiveObject();
            const crowdInput = document.getElementById("crowdCount");

            if (!activeObj || !activeObj.isArtwork) {
                alert("混雑度を更新したい作品をキャンバス上で選択してください。");
                return;
            }

            const count = crowdInput ? (parseInt(crowdInput.value) || 0) : 0;

            if (activeObj.crowdCircle) {
                canvas.remove(activeObj.crowdCircle);
                activeObj.crowdCircle = null;
            }

            if (count > 0) {
                const diagonal = Math.sqrt(Math.pow(activeObj.pxWidth, 2) + Math.pow(activeObj.pxHeight, 2));
                const radius = (diagonal / 2) + 15;

                const colorObj = getCrowdColor(count);

                const circle = new fabric.Circle({
                    radius: radius,
                    fill: colorObj.fill,
                    stroke: colorObj.stroke,
                    strokeWidth: 2,
                    left: activeObj.left,
                    top: activeObj.top,
                    originX: 'center',
                    originY: 'center',
                    selectable: false,
                    evented: false
                });

                canvas.add(circle);
                circle.sendToBack();

                if (canvas.backgroundImage) {
                    circle.bringForward();
                }

                activeObj.crowdCircle = circle;
                activeObj.crowdCountValue = count;
            }

            canvas.renderAll();
            saveState();
        });
    }

    // 警備員ピン
    if (addGuardButton) {
        addGuardButton.addEventListener("click", function() {
            const guardText = new fabric.Text('👤', {
                fontSize: 32,
                originX: 'center',
                originY: 'center',
                left: 450,
                top: 250,
                hasRotatingPoint: false,
                transparentCorners: false,
                isGuard: true
            });

            canvas.add(guardText);
            canvas.setActiveObject(guardText);
            canvas.renderAll();
        });
    }

    if (pdfButton) {
        pdfButton.addEventListener("click", generateCombinedPdf);
    }
});