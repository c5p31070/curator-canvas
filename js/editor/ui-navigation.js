function initializeNavigationUi() {
    const modeButton = document.getElementById('btnToggleAdminMode');
    const adminPanel = document.getElementById('adminSettingsPanel');
    const modeDescription = document.getElementById('modeDescription');
    const adminModeBanner = document.getElementById('adminModeBanner');
    const setAdminMode = enabled => {
        isAdminMode = enabled;
        document.body.classList.toggle('admin-mode', enabled);
        if (adminPanel) adminPanel.hidden = !enabled;
        if (adminModeBanner) adminModeBanner.hidden = !enabled;
        if (modeButton) modeButton.textContent = enabled ? '配置図作成に戻る' : '管理設定を開く';
        if (modeDescription) {
            modeDescription.textContent = enabled
                ? '壁・縮尺・固定設備を事前設定します。'
                : '壁を選び、展示物を配置します。事前登録された設備は固定表示されます。';
        }
        document.querySelectorAll('.admin-only').forEach(el => {
            el.hidden = !enabled;
        });
        applyFixtureEditability();
    };
    setAdminMode(false);
    updateWallDropdownOptions();
    if (modeButton) {
        modeButton.addEventListener('click', () => setAdminMode(!isAdminMode));
    }

    const btnAddWall = document.getElementById('btnAddWall');
    if (btnAddWall) {
        btnAddWall.addEventListener('click', async () => {
            const name = (document.getElementById('newWallTitle')?.value || '').trim();
            const width = parseFloat(document.getElementById('newWallWidthCm')?.value);
            const height = parseFloat(document.getElementById('newWallHeightCm')?.value);
            if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
                alert('壁の長さと高さを1cm以上で入力してください。');
                return;
            }
            captureCurrentCanvasState();
            const id = `wall_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const title = name || `壁面 ${Object.keys(wallPlanJsonData).length + 1}`;
            wallPlanJsonData[id] = { title, widthCm: width, heightCm: height, json: null };
            updateWallDropdownOptions();
            await handleWallSelectChange(id);
            const status = document.getElementById('saveStatus');
            if (status) status.innerText = `「${title}」を登録しました。固定設備を配置できます。`;
        });
    }

    refreshExhibitionList();
    const savedExhibitions = document.getElementById('savedExhibitions');
    const btnLoadExhibition = document.getElementById('btnLoadExhibition');
    const btnDeleteExhibition = document.getElementById('btnDeleteExhibition');
    if (savedExhibitions) {
        savedExhibitions.addEventListener('change', e => {
            selectedExhibitionId = e.target.value;
        });
    }
    if (btnLoadExhibition) {
        btnLoadExhibition.addEventListener('click', () => {
            if (!selectedExhibitionId) {
                alert('呼び出す展覧会を選択してください。');
                return;
            }
            loadExhibitionSnapshot(selectedExhibitionId);
        });
    }
    if (btnDeleteExhibition) {
        btnDeleteExhibition.addEventListener('click', deleteExhibitionSnapshot);
    }

    const tabFloor = document.getElementById("tabFloorPlan");
    const tabWall = document.getElementById("tabWallPlan");
    const tabPdfExport = document.getElementById("tabPdfExport");

    if (tabFloor) {
        tabFloor.addEventListener("click", () => switchViewMode('floor'));
    }

    if (tabWall) {
        tabWall.addEventListener("click", () => switchViewMode('wall'));
    }

    if (tabPdfExport) {
        tabPdfExport.addEventListener("click", () => switchViewMode('pdf'));
    }

    // ----------------------------------------------------
    // 壁面選択
    // ----------------------------------------------------

    const wallListSelect = document.getElementById("wallListSelect");

    if (wallListSelect) {
        wallListSelect.addEventListener("change", function(e) {
            handleWallSelectChange(e.target.value);
        });
    }

    const floorWallListSelect = document.getElementById('floorWallListSelect');
    if (floorWallListSelect) {
        floorWallListSelect.addEventListener('change', e => {
            handleWallSelectChange(e.target.value);
        });
    }

    const btnApplyWallSize = document.getElementById("btnApplyWallSize");

    if (btnApplyWallSize) {
        btnApplyWallSize.addEventListener("click", async function() {

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
                await renderWallCanvas();
                saveState();
            }
        });
    }

    const btnDeleteWall = document.getElementById('btnDeleteWall');
    if (btnDeleteWall) {
        btnDeleteWall.addEventListener('click', async function() {
            const wallId = selectedWallInfo?.id;
            const wall = wallPlanJsonData[wallId];
            if (!wall) return;

            const wallIds = Object.keys(wallPlanJsonData);
            if (wallIds.length <= 1) {
                alert('最後の壁は削除できません。別の壁を登録してから削除してください。');
                return;
            }
            if (!confirm(`「${wall.title}」と、この壁面に登録された配置・備品を削除しますか？`)) return;

            captureCurrentCanvasState();
            delete wallPlanJsonData[wallId];
            const nextWallId = Object.keys(wallPlanJsonData)[0];
            const nextWall = wallPlanJsonData[nextWallId];
            selectedWallInfo = {
                id: nextWallId,
                title: nextWall.title,
                widthCm: nextWall.widthCm,
                heightCm: nextWall.heightCm
            };

            isTransitioning = true;
            updateWallDropdownOptions();
            updateWallBannerText();
            await renderWallCanvas();
            isTransitioning = false;
            saveState();

            const status = document.getElementById('saveStatus');
            if (status) status.innerText = `「${wall.title}」を削除しました。`;
        });
    }
}
