// ============================================================
// curator-canvas
// view.js
// 平面図・壁面図・背景画像・壁面管理
// ============================================================

let diagramReady = false;
let initialDiagramLoaded = false;
const floorImageRequests = new Map();
window.isDiagramReady = () => diagramReady;

function showDiagramStatus(message = '', failed = false) {
    const notice = document.getElementById('diagramLoadNotice');
    if (!notice) return;
    notice.hidden = !message;
    document.getElementById('diagramLoadMessage').textContent = message;
    document.getElementById('btnRetryDiagram').hidden = !failed;
    const viewport = document.getElementById('canvasViewport');
    if (viewport) viewport.inert = Boolean(message);
}

function loadCanvasState(json, afterLoad = null) {
    return new Promise((resolve, reject) => {
        const data = typeof json === 'string' ? JSON.parse(json) : json;
        canvas.loadFromJSON(data, () => {
            try { afterLoad?.(); resolve(); }
            catch (error) { reject(error); }
        });
    });
}

// ------------------------------------------------------------
// 壁面選択タブ更新（既存の呼び出し元と共通）
// ------------------------------------------------------------

function updateWallDropdownOptions() {

    updateWallTabs();
}

function updateWallTabs() {
    updateFloorTabs();
    const tabList = document.getElementById('wallTabs');
    if (!tabList) return;

    tabList.replaceChildren();
    tabList.hidden = currentViewMode !== 'wall';
    Object.entries(wallPlanJsonData).forEach(([id, wall], index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wall-tab';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(currentViewMode === 'wall' && id === selectedWallInfo?.id));
        button.classList.toggle('active', currentViewMode === 'wall' && id === selectedWallInfo?.id);
        button.textContent = wall.title || `壁面 ${index + 1}`;
        button.title = `${wall.title || `壁面 ${index + 1}`} · ${wall.widthCm} × ${wall.heightCm} cm`;
        button.addEventListener('click', () => handleWallSelectChange(id));
        tabList.appendChild(button);
    });
}

function updateFloorTabs() {
    const tabList = document.getElementById('floorTabs');
    if (!tabList) return;
    tabList.hidden = currentViewMode !== 'floor';
    tabList.replaceChildren();
    Object.entries(FLOOR_PLANS).forEach(([id, floor]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wall-tab';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(id === selectedFloorId));
        button.classList.toggle('active', id === selectedFloorId);
        button.textContent = floor.title;
        button.addEventListener('click', () => handleFloorSelectChange(id));
        tabList.appendChild(button);
    });
}

async function handleFloorSelectChange(floorId, skipSave = false) {
    if (!FLOOR_PLANS[floorId] || isTransitioning) return;
    if (selectedFloorId === floorId && currentViewMode === 'floor' && diagramReady) return;
    window.cancelDimensionDrawing?.();
    window.cancelLightingPlacement?.();
    window.flushPendingItemEditHistory?.();
    captureCurrentCanvasState();
    selectedFloorId = floorId;
    floorPlanJsonData = floorPlanData[floorId].json;
    cachedBackgroundImage = floorBackgroundImages.get(floorId) || null;
    const loaded = await switchViewMode('floor', true, null, true);
    if (loaded && !skipSave) saveState();
}

// ------------------------------------------------------------
// 壁面選択変更
// ------------------------------------------------------------

async function handleWallSelectChange(wallId) {
    window.cancelDimensionDrawing?.();
    window.cancelLightingPlacement?.();

    if (isFreeDrawingMode) toggleFreeDrawingMode(false);

    if (
        !wallPlanJsonData[wallId] ||
        isTransitioning
    ) {
        return;
    }

    if (
        selectedWallInfo.id === wallId &&
        currentViewMode === 'wall' && diagramReady
    ) {
        return;
    }

    // 現在の壁を保存
    captureCurrentCanvasState();
    // 新しい壁を選択
    const targetWall =
        wallPlanJsonData[wallId];

    selectedWallInfo = {
        id: wallId,
        title: targetWall.title,
        widthCm: targetWall.widthCm,
        heightCm: targetWall.heightCm
    };

    return switchViewMode('wall', false, null, true);
}

// ============================================================
// 平面図 ⇄ 壁面図
// ============================================================

async function switchViewMode(
    mode,
    skipSave = false,
    callback = null,
    skipCapture = false
) {
    window.cancelDimensionDrawing?.();
    window.cancelLightingPlacement?.();

    if (isFreeDrawingMode) toggleFreeDrawingMode(false);

    if (isTransitioning) {
        return false;
    }

    if (
        currentViewMode === mode &&
        !skipSave &&
        !callback &&
        !skipCapture && diagramReady
    ) {
        return true;
    }

    if (!skipCapture) captureCurrentCanvasState();
    isTransitioning = true;
    diagramReady = false;
    showDiagramStatus('図面を読み込み中…');

    try {
    currentViewMode = mode;

    removeWallRulers();

    const floorControls =
        document.getElementById("floorPlanControls");

    const wallControls =
        document.getElementById("wallPlanControls");

    const wallBanner =
        document.getElementById("wallInfoBanner");

    if (mode === 'floor') {
        floorPlanJsonData = floorPlanData[selectedFloorId].json;

        updateWallTabs();
        updateViewModeToolState('floor');

        if (floorControls) {
            floorControls.style.display = "block";
        }

        if (wallControls) {
            wallControls.style.display = "none";
        }

        if (wallBanner) {
            wallBanner.style.display = "none";
        }

        // Fetch before clearing the previous canvas so a network error cannot erase it.
        const background = await getFloorBackgroundImage(selectedFloorId);
        canvas.clear();

        let floorJson = floorPlanJsonData
            ? (typeof floorPlanJsonData === 'string' ? JSON.parse(floorPlanJsonData) : { ...floorPlanJsonData })
            : { objects: [] };
        floorJson = window.prepareFloorLighting?.(floorJson, selectedFloorId) || floorJson;
        if (floorPlanJsonData || floorJson.objects?.length) {

            delete floorJson.backgroundImage;
            await loadCanvasState(floorJson);
            applyFloorBackgroundImage(background);
            restoreCustomProperties();
            syncFloorArtworkScale();

        } else {

            applyFloorBackgroundImage(background);
            window.refreshLighting?.();
        }

    } else if (mode === 'wall') {

        updateWallTabs();
        updateViewModeToolState('wall');

        if (floorControls) {
            floorControls.style.display = "none";
        }

        if (wallControls) {
            wallControls.style.display = "block";
        }

        if (wallBanner) {
            wallBanner.style.display = "block";
        }

        updateWallDropdownOptions();

        updateWallBannerText();

        await renderWallCanvas();

    }

    diagramReady = true;
    showDiagramStatus();
    } catch (error) {
        console.error('図面の読み込みに失敗しました:', error);
        showDiagramStatus('図面を読み込めませんでした。再試行してください。', true);
        return false;
    } finally {
        isTransitioning = false;
    }

    if (!skipSave) {
        saveState();
    }

    if (callback) {
        callback();
    }

    if (window.refreshCanvasZoomForView) {
        requestAnimationFrame(() => window.refreshCanvasZoomForView(false));
    }
    window.applyCuratorRoleRestrictions?.();
    return true;
}

// ============================================================
// 壁情報バナー更新
// ============================================================

function updateWallBannerText() {

    const titleEl =
        document.getElementById("bannerWallTitle");

    const widthEl =
        document.getElementById("bannerWallWidth");

    const heightEl =
        document.getElementById("bannerWallHeight");

    const inputW =
        document.getElementById("wallWidthCm");

    const inputH =
        document.getElementById("wallHeightCm");

    if (titleEl) {
        titleEl.innerText =
            selectedWallInfo.title;
    }

    if (widthEl) {
        widthEl.innerText =
            selectedWallInfo.widthCm;
    }

    if (heightEl) {
        heightEl.innerText =
            selectedWallInfo.heightCm;
    }

    if (inputW) {
        inputW.value =
            selectedWallInfo.widthCm;
    }

    if (inputH) {
        inputH.value =
            selectedWallInfo.heightCm;
    }
}

// ============================================================
// 壁面キャンバス生成
// ============================================================

function removeWallRulers() {
    document.getElementById('wallRulerOverlay')?.remove();
    document.getElementById('floorRulerOverlay')?.remove();
}

function renderWallRulers() {
    removeWallRulers();
    if (currentViewMode !== 'wall' || !selectedWallInfo) return;

    const wrapper = canvas.wrapperEl;
    const container = document.getElementById('canvasViewport') ||
        document.querySelector('.canvas-container-wrapper');
    if (!wrapper || !container) return;

    const wall = canvas.getObjects().find(obj => obj.isWallOutline);
    if (!wall) return;

    const widthCm = Number(selectedWallInfo.widthCm) || 0;
    const heightCm = Number(selectedWallInfo.heightCm) || 0;
    if (!widthCm || !heightCm) return;

    const bounds = wall.getBoundingRect();
    const wallWidth = bounds.width;
    const wallHeight = bounds.height;
    const left = bounds.left;
    const top = bounds.top;
    const horizontalY = top - 16;
    const verticalX = left - 16;
    const verticalOffset = 0;
    const tickStep = dimension => dimension <= 300 ? 10 : dimension <= 1000 ? 20 : 50;
    const majorStep = dimension => dimension <= 300 ? 50 : 100;
    const horizontalTicks = [];
    const verticalTicks = [];

    for (let cm = 0; cm <= widthCm; cm += tickStep(widthCm)) {
        const x = left + wallWidth * cm / widthCm;
        const major = cm % majorStep(widthCm) === 0;
        horizontalTicks.push(`<line x1="${x}" y1="${horizontalY}" x2="${x}" y2="${horizontalY + (major ? 6 : 3)}" class="ruler-tick"/>`);
        if (major) horizontalTicks.push(`<text x="${x}" y="${horizontalY - 3}" text-anchor="middle" class="ruler-label">${cm}</text>`);
    }
    if (widthCm % tickStep(widthCm) !== 0) {
        const x = left + wallWidth;
        horizontalTicks.push(`<line x1="${x}" y1="${horizontalY}" x2="${x}" y2="${horizontalY + 6}" class="ruler-tick"/>`);
        horizontalTicks.push(`<text x="${x}" y="${horizontalY - 3}" text-anchor="middle" class="ruler-label">${widthCm}</text>`);
    }

    for (let cm = 0; cm <= heightCm; cm += tickStep(heightCm)) {
        const y = top + wallHeight * (heightCm - cm) / heightCm + verticalOffset;
        const major = cm % majorStep(heightCm) === 0;
        verticalTicks.push(`<line x1="${verticalX}" y1="${y}" x2="${verticalX + (major ? 6 : 3)}" y2="${y}" class="ruler-tick"/>`);
        if (major) verticalTicks.push(`<text x="${verticalX - 3}" y="${y + 2}" text-anchor="end" class="ruler-label">${cm}</text>`);
    }
    if (heightCm % tickStep(heightCm) !== 0) {
        const y = top + verticalOffset;
        verticalTicks.push(`<line x1="${verticalX}" y1="${y}" x2="${verticalX + 6}" y2="${y}" class="ruler-tick"/>`);
        verticalTicks.push(`<text x="${verticalX - 3}" y="${y + 2}" text-anchor="end" class="ruler-label">${heightCm}</text>`);
    }

    const wrapperRect = wrapper.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'wallRulerOverlay';
    svg.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = `position:absolute;left:${wrapperRect.left - containerRect.left + container.scrollLeft}px;top:${wrapperRect.top - containerRect.top + container.scrollTop}px;width:${wrapperRect.width}px;height:${wrapperRect.height}px;overflow:visible;pointer-events:none;z-index:5`;
    svg.innerHTML = `
        <g class="ruler-markings">
            <line x1="${left}" y1="${horizontalY}" x2="${left + wallWidth}" y2="${horizontalY}" class="ruler-line"/>
            ${horizontalTicks.join('')}
            <line x1="${verticalX}" y1="${top + verticalOffset}" x2="${verticalX}" y2="${top + wallHeight + verticalOffset}" class="ruler-line"/>
            ${verticalTicks.join('')}
        </g>`;
    container.appendChild(svg);
}


window.addEventListener('resize', () => {
    if (currentViewMode === 'wall') renderWallRulers();
});

async function renderWallCanvas(callback = null) {

    removeWallRulers();
    canvas.clear();

    canvas.setBackgroundImage(null);

    const scaleInput =
        document.getElementById("scale");

    const scale =
        scaleInput
            ? parseFloat(scaleInput.value) || 0.5
            : 0.5;

    const pxW =
        selectedWallInfo.widthCm * scale;

    const pxH =
        selectedWallInfo.heightCm * scale;

    const wallRect =
        new fabric.Rect({

            left:
                (canvas.width - pxW) / 2,

            top:
                (canvas.height - pxH) / 2,

            width: pxW,

            height: pxH,

            fill: '#f8fafc',

            stroke: '#334155',

            strokeWidth: 3,

            isWallOutline: true,

            selectable: false,

            evented: false
        });

    canvas.add(wallRect);

    const wallItem =
        wallPlanJsonData[
            selectedWallInfo.id
        ];

    if (
        wallItem &&
        wallItem.json
    ) {

        await loadCanvasState(wallItem.json, () => {
            canvas.renderAll();
            restoreCustomProperties();
        });

    } else {

        applyWallOutlineLock();

        canvas.renderAll();
    }

    renderWallRulers();

    if (callback) {
        callback();
    }

    if (window.refreshCanvasZoomForView) {
        requestAnimationFrame(() => window.refreshCanvasZoomForView(false));
    }
}

// ============================================================
// 全作品一括サイズ変更
// ============================================================

function applyArtworkDimensions(obj, scale) {
    if (!obj?.isArtwork) return;

    const newPxW = (Number(obj.cmWidth) || 150) * scale;
    const isFloorPlan = currentViewMode === 'floor';
    const newPxH = Math.max(
        (isFloorPlan ? (Number(obj.cmDepth) || 5) : (Number(obj.cmHeight) || 100)) * scale,
        isFloorPlan ? 8 : 6
    );

    obj.pxWidth = newPxW;
    obj.pxHeight = newPxH;
    const rect = obj.item?.(0);
    if (rect) rect.set({ width: newPxW, height: newPxH });

    const textObj = obj.item?.(1);
    if (textObj) textObj.set({ fontSize: obj.displayType === 'wall' ? 10 : 14 });

    obj.set({ width: newPxW, height: newPxH });
    obj.setCoords();

    if (obj.crowdCircle) {
        const diagonal = Math.sqrt(newPxW ** 2 + newPxH ** 2);
        obj.crowdCircle.crowdRadius = ((diagonal / 2) + 25) * 1.1;
        obj.crowdRadius = obj.crowdCircle.crowdRadius;
        updateCrowdSemicircle(obj);
    }
}

function syncFloorArtworkScale() {
    const scale = parseFloat(document.getElementById('scale')?.value) || 0.5;
    canvas.getObjects().forEach(obj => {
        if (!obj.isArtwork) return;
        const width = (Number(obj.cmWidth) || 150) * scale;
        const height = Math.max((Number(obj.cmDepth) || 5) * scale, 8);
        // Preserve existing crowd geometry when the size already matches.
        if (Math.abs(Number(obj.pxWidth) - width) > 0.01 ||
            Math.abs(Number(obj.pxHeight) - height) > 0.01 ||
            !Number.isFinite(Number(obj.pxWidth)) || !Number.isFinite(Number(obj.pxHeight))) {
            applyArtworkDimensions(obj, scale);
        }
    });
    canvas.renderAll();
    window.refreshLighting?.();
}

function applyScaleToAllArtworks(newScale) {

    canvas.getObjects().forEach(obj => {

        if (!obj.isArtwork) {
            return;
        }

        applyArtworkDimensions(obj, newScale);
    });
    window.refreshDimensionLabels?.();
    window.refreshLighting?.();

    canvas.renderAll();

    saveState();
}

// ============================================================
// 背景図面読み込み
// ============================================================

function requestFloorImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        let timer;
        const finish = (error = null) => {
            clearTimeout(timer);
            image.onload = image.onerror = null;
            if (error) { image.src = ''; reject(error); }
            else {
                try { resolve(new fabric.Image(image)); }
                catch (creationError) { reject(creationError); }
            }
        };
        image.crossOrigin = 'anonymous';
        image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0
            ? finish() : finish(new Error('Invalid floor image'));
        image.onerror = () => finish(new Error(`図面画像を取得できません: ${url}`));
        timer = setTimeout(() => finish(new Error('図面画像の取得がタイムアウトしました。')), 12000);
        image.src = url;
    });
}

async function getFloorBackgroundImage(floorId) {
    if (floorBackgroundImages.has(floorId)) return floorBackgroundImages.get(floorId);
    if (floorImageRequests.has(floorId)) return floorImageRequests.get(floorId);
    const request = (async () => {
        let lastError;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const image = await requestFloorImage(FLOOR_PLANS[floorId].image);
                floorBackgroundImages.set(floorId, image);
                return image;
            } catch (error) {
                lastError = error;
                if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
            }
        }
        throw lastError;
    })();
    floorImageRequests.set(floorId, request);
    try { return await request; }
    finally { floorImageRequests.delete(floorId); }
}

function applyFloorBackgroundImage(img) {
        const fit = Math.min(canvas.width / img.width, canvas.height / img.height);
        const left = (canvas.width - img.width * fit) / 2;
        const top = (canvas.height - img.height * fit) / 2;
        img.set({ scaleX: fit, scaleY: fit, left, top, originX: 'left', originY: 'top' });
        cachedBackgroundImage = img;
        canvas.setBackgroundImage(img);
            wallCanvas.width = canvas.width;
            wallCanvas.height = canvas.height;
            wallCtx.fillStyle = '#ffffff';
            wallCtx.fillRect(0, 0, wallCanvas.width, wallCanvas.height);
            wallCtx.drawImage(img._element, left, top, img.width * fit, img.height * fit);
            isWallDataLoaded = true;
            canvas.renderAll();
}

// ============================================================
// 初期読み込み
// ============================================================

document.addEventListener('DOMContentLoaded', async function() {
    const initializeDrawing = async () => {
        if (isTransitioning) return;
        try {
            showDiagramStatus('図面を読み込み中…');
            let scaleReady;
            try { scaleReady = await window.TEAM_SCALE_READY; }
            catch (error) {
                console.error('共有設定の初期化に失敗しました:', error);
                scaleReady = false;
            }
            if (scaleReady === false && !await window.refreshTeamFloorScale?.()) {
                showDiagramStatus('共有縮尺を読み込めません。通信状態を確認して再試行してください。', true);
                return;
            }
            const loaded = await switchViewMode(currentViewMode, true, null, true);
            if (loaded && !initialDiagramLoaded) {
                initialDiagramLoaded = true;
                loadSavedData();
            }
        } catch (error) {
            console.error('図面の初期化に失敗しました:', error);
            showDiagramStatus('図面を読み込めませんでした。再試行してください。', true);
        }
    };
    document.getElementById('btnRetryDiagram')?.addEventListener('click', initializeDrawing);
    window.addEventListener('online', () => {
        if (!diagramReady) initializeDrawing();
    });
    await initializeDrawing();
});
