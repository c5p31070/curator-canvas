// ============================================================
// curator-canvas
// view.js
// 平面図・壁面図・背景画像・壁面管理
// ============================================================

// ------------------------------------------------------------
// 壁面ドロップダウン更新
// ------------------------------------------------------------

function updateWallDropdownOptions() {

    const selectEls = [
        document.getElementById("wallListSelect"),
        document.getElementById("floorWallListSelect")
    ].filter(Boolean);

    if (selectEls.length === 0) return;

    const keys =
        Object.keys(wallPlanJsonData);
    selectEls.forEach(selectEl => {
        selectEl.replaceChildren();
        const isFloorSelector = selectEl.id === 'floorWallListSelect';
        if (isFloorSelector) {
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '壁面を選択してください';
            placeholder.selected = true;
            selectEl.appendChild(placeholder);
        }
        keys.forEach(key => {
            const wall = wallPlanJsonData[key];
            const opt = document.createElement('option');
            opt.value = key;
            opt.text = `${wall.title} (${wall.widthCm} × ${wall.heightCm} cm)`;
            opt.selected = !isFloorSelector && key === selectedWallInfo.id;
            selectEl.appendChild(opt);
        });
        if (isFloorSelector) selectEl.value = '';
    });
    updateWallTabs();
}

function updateWallTabs() {
    const tabList = document.getElementById('wallTabs');
    if (!tabList) return;

    tabList.replaceChildren();
    tabList.hidden = currentViewMode === 'pdf';
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

// ------------------------------------------------------------
// 壁面選択変更
// ------------------------------------------------------------

async function handleWallSelectChange(wallId) {

    if (
        !wallPlanJsonData[wallId] ||
        isTransitioning
    ) {
        return;
    }

    if (
        selectedWallInfo.id === wallId &&
        currentViewMode === 'wall'
    ) {
        return;
    }

    isTransitioning = true;

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

    currentViewMode = 'wall';
    updateWallTabs();

    const tabFloor =
        document.getElementById("tabFloorPlan");

    const tabWall =
        document.getElementById("tabWallPlan");

    const floorControls =
        document.getElementById("floorPlanControls");

    const wallControls =
        document.getElementById("wallPlanControls");

    const wallBanner =
        document.getElementById("wallInfoBanner");

    if (tabWall) {
        tabWall.classList.add("active");
    }

    if (tabFloor) {
        tabFloor.classList.remove("active");
    }

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

    await new Promise(resolve =>
        renderWallCanvas(resolve)
    );

    isTransitioning = false;

    saveState();
}

// ============================================================
// 平面図 ⇄ 壁面図
// ============================================================

async function switchViewMode(
    mode,
    skipSave = false,
    callback = null
) {

    if (isTransitioning) {
        return;
    }

    if (
        currentViewMode === mode &&
        !skipSave &&
        !callback
    ) {
        return;
    }

    isTransitioning = true;

    captureCurrentCanvasState();

    currentViewMode = mode;

    removeWallRulers();
    canvas.clear();

    const tabPdfExport = document.getElementById("tabPdfExport");
    const pdfWorkspace = document.getElementById("pdfExportWorkspace");
    document.body.classList.toggle('pdf-mode', mode === 'pdf');
    if (pdfWorkspace) pdfWorkspace.hidden = mode !== 'pdf';

    const tabFloor =
        document.getElementById("tabFloorPlan");

    const tabWall =
        document.getElementById("tabWallPlan");

    const floorControls =
        document.getElementById("floorPlanControls");

    const wallControls =
        document.getElementById("wallPlanControls");

    const wallBanner =
        document.getElementById("wallInfoBanner");

    if (mode === 'floor') {

        updateWallTabs();

        if (tabFloor) {
            tabFloor.classList.add("active");
        }

        if (tabWall) {
            tabWall.classList.remove("active");
        }

        if (tabPdfExport) tabPdfExport.classList.remove("active");

        if (floorControls) {
            floorControls.style.display = "block";
        }

        if (wallControls) {
            wallControls.style.display = "none";
        }

        if (wallBanner) {
            wallBanner.style.display = "none";
        }

        await new Promise(resolve =>
            loadBackgroundImage(resolve)
        );

        if (floorPlanJsonData) {

            await new Promise(resolve => {

                canvas.loadFromJSON(
                    floorPlanJsonData,
                    function() {

                        ensureBackgroundImage(
                            function() {

                                canvas.renderAll();

                                restoreCustomProperties();

                                resolve();
                            }
                        );
                    }
                );
            });

        } else {

            await new Promise(resolve =>
                ensureBackgroundImage(resolve)
            );
        }

    } else if (mode === 'wall') {

        updateWallTabs();

        if (tabWall) {
            tabWall.classList.add("active");
        }

        if (tabFloor) {
            tabFloor.classList.remove("active");
        }

        if (tabPdfExport) tabPdfExport.classList.remove("active");

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

        await new Promise(resolve =>
            renderWallCanvas(resolve)
        );

    } else if (mode === 'pdf') {
        updateWallTabs();
        if (tabFloor) tabFloor.classList.remove("active");
        if (tabWall) tabWall.classList.remove("active");
        if (tabPdfExport) tabPdfExport.classList.add("active");
        if (floorControls) floorControls.style.display = "none";
        if (wallControls) wallControls.style.display = "none";
        if (wallBanner) wallBanner.style.display = "none";
    }

    isTransitioning = false;

    if (!skipSave) {
        saveState();
    }

    if (callback) {
        callback();
    }

    if (window.refreshCanvasZoomForView) {
        requestAnimationFrame(() => window.refreshCanvasZoomForView(false));
    }
}

// ============================================================
// 背景画像確保
// ============================================================

function ensureBackgroundImage(callback) {

    if (cachedBackgroundImage) {

        canvas.setBackgroundImage(
            cachedBackgroundImage,
            function() {

                canvas.renderAll();

                if (callback) {
                    callback();
                }
            }
        );

    } else {

        loadBackgroundImage(callback);
    }
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
    const horizontalY = top - 34;
    const verticalX = left - 36;
    const verticalOffset = 0;
    const tickStep = dimension => dimension <= 300 ? 10 : dimension <= 1000 ? 20 : 50;
    const majorStep = dimension => dimension <= 300 ? 50 : 100;
    const horizontalTicks = [];
    const verticalTicks = [];

    for (let cm = 0; cm <= widthCm; cm += tickStep(widthCm)) {
        const x = left + wallWidth * cm / widthCm;
        const major = cm % majorStep(widthCm) === 0;
        horizontalTicks.push(`<line x1="${x}" y1="${horizontalY}" x2="${x}" y2="${horizontalY + (major ? 10 : 5)}" class="ruler-tick"/>`);
        if (major) horizontalTicks.push(`<text x="${x}" y="${horizontalY - 4}" text-anchor="middle" class="ruler-label">${cm}</text>`);
    }
    if (widthCm % tickStep(widthCm) !== 0) {
        const x = left + wallWidth;
        horizontalTicks.push(`<line x1="${x}" y1="${horizontalY}" x2="${x}" y2="${horizontalY + 10}" class="ruler-tick"/>`);
        horizontalTicks.push(`<text x="${x}" y="${horizontalY - 4}" text-anchor="middle" class="ruler-label">${widthCm}</text>`);
    }

    for (let cm = 0; cm <= heightCm; cm += tickStep(heightCm)) {
        const y = top + wallHeight * cm / heightCm + verticalOffset;
        const major = cm % majorStep(heightCm) === 0;
        verticalTicks.push(`<line x1="${verticalX}" y1="${y}" x2="${verticalX + (major ? 10 : 5)}" y2="${y}" class="ruler-tick"/>`);
        if (major) verticalTicks.push(`<text x="${verticalX - 5}" y="${y + 3}" text-anchor="end" class="ruler-label">${cm}</text>`);
    }
    if (heightCm % tickStep(heightCm) !== 0) {
        const y = top + wallHeight + verticalOffset;
        verticalTicks.push(`<line x1="${verticalX}" y1="${y}" x2="${verticalX + 10}" y2="${y}" class="ruler-tick"/>`);
        verticalTicks.push(`<text x="${verticalX - 5}" y="${y + 3}" text-anchor="end" class="ruler-label">${heightCm}</text>`);
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
            <text x="${left + wallWidth / 2}" y="${horizontalY - 17}" text-anchor="middle" class="ruler-dimension">幅 ${widthCm} cm</text>
            <text x="${verticalX - 32}" y="${top + wallHeight / 2 + verticalOffset}" text-anchor="middle" class="ruler-dimension" transform="rotate(-90 ${verticalX - 32} ${top + wallHeight / 2 + verticalOffset})">高さ ${heightCm} cm</text>
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

        await new Promise(resolve => {

            canvas.loadFromJSON(
                wallItem.json,
                function() {

                    canvas.renderAll();

                    restoreCustomProperties();

                    resolve();
                }
            );
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
    let newPxH = isFloorPlan && obj.displayType === 'wall'
        ? (Number(obj.cmDepth) || 5) * scale
        : (Number(obj.cmHeight) || 100) * scale;
    newPxH = Math.max(newPxH, isFloorPlan && obj.displayType === 'wall' ? 8 : 6);

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
        updateCrowdSemicircle(obj);
    }
}

function applyScaleToAllArtworks(newScale) {

    canvas.getObjects().forEach(obj => {

        if (!obj.isArtwork) {
            return;
        }

        applyArtworkDimensions(obj, newScale);
    });

    canvas.renderAll();

    saveState();
}

// ============================================================
// 背景図面読み込み
// ============================================================

function loadBackgroundImage(callback) {

    if (cachedBackgroundImage) {

        canvas.setBackgroundImage(
            cachedBackgroundImage,
            function() {

                canvas.renderAll();

                if (callback) {
                    callback();
                }
            }
        );

        return;
    }

    fabric.Image.fromURL(
        'images/zumen02.png',
        function(img) {

            if (img) {

                img.set({

                    scaleX:
                        canvas.width / img.width,

                    scaleY:
                        canvas.height / img.height,

                    originX: 'left',

                    originY: 'top'
                });

                cachedBackgroundImage = img;

                canvas.setBackgroundImage(
                    img,
                    function() {

                        canvas.renderAll();

                        wallCanvas.width =
                            canvas.width;

                        wallCanvas.height =
                            canvas.height;

                        wallCtx.drawImage(
                            img._element,
                            0,
                            0,
                            img.width,
                            img.height,
                            0,
                            0,
                            canvas.width,
                            canvas.height
                        );

                        isWallDataLoaded = true;

                        if (callback) {
                            callback();
                        }
                    }
                );

            } else {

                console.warn(
                    "背景画像 'images/zumen02.png' の読み込みに失敗しました。"
                );

                if (callback) {
                    callback();
                }
            }

        },
        {
            crossOrigin: 'anonymous'
        }
    );
}

// ============================================================
// 初期読み込み
// ============================================================

loadBackgroundImage(function() {
    loadSavedData();
});
