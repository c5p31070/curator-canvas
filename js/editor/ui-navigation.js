window.deleteFixedVenueWall = async wallId => {
    if (!isAdminMode || window.CURATOR_ROLE === 'viewer' || isTransitioning || isUndoRedoOperation) return false;
    const wall = wallPlanJsonData[wallId];
    if (!wall || wall.movableWallId) return false;
    if (!confirm(`共通壁「${wall.title}」を削除しますか？チーム内のすべての配置図から、この壁と固定設備が表示されなくなります。`)) return false;
    window.cancelLightingPlacement?.();
    window.flushPendingItemEditHistory?.();
    captureCurrentCanvasState();
    if (!await window.saveVenueWallDefinition(wallId, null)) return false;
    if (currentViewMode === 'wall') await switchViewMode('wall', true, null, true);
    updateWallDropdownOptions();
    window.refreshVenuePresetList?.();
    saveState();
    const status = document.getElementById('saveStatus');
    if (status) status.textContent = `共通壁「${wall.title}」を削除しました。`;
    return true;
};

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
        if (modeButton) modeButton.dataset.tooltip = enabled
            ? '壁・縮尺・固定設備を事前設定するモードです。'
            : '壁や縮尺、固定設備の設定を行います。';
        if (modeDescription) {
            modeDescription.textContent = enabled
                ? '壁・縮尺・固定設備を事前設定します。'
                : '壁を選び、展示物を配置します。事前登録された設備は固定表示されます。';
        }
        document.querySelectorAll('.admin-only').forEach(el => {
            el.hidden = !enabled;
        });
        applyFixtureEditability();
        window.cancelLightingPlacement?.();
        window.refreshLighting?.();
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
            const height = FIXED_WALL_HEIGHT_CM;
            if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
                alert('壁の長さと高さを1cm以上で入力してください。');
                return;
            }
            captureCurrentCanvasState();
            const id = `wall_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const title = name || `壁面 ${Object.keys(wallPlanJsonData).length + 1}`;
            const definition = { title, widthCm: width, heightCm: height, floorId: selectedFloorId, json: null };
            if (!await window.saveVenueWallDefinition(id, definition)) return;
            updateWallDropdownOptions();
            await handleWallSelectChange(id);
            const status = document.getElementById('saveStatus');
            if (status) status.innerText = `「${title}」を登録しました。固定設備を配置できます。`;
        });
    }

    refreshExhibitionList();
    window.CURATOR_AUTH_READY?.then(context => {
        if (context) refreshExhibitionList();
    });
    const savedExhibitions = document.getElementById('savedExhibitions');
    const btnLoadExhibition = document.getElementById('btnLoadExhibition');
    const btnDeleteExhibition = document.getElementById('btnDeleteExhibition');
    if (savedExhibitions) {
        savedExhibitions.addEventListener('change', e => {
            window.refreshExhibitionSaveUi?.();
        });
    }
    if (btnLoadExhibition) {
        btnLoadExhibition.addEventListener('click', () => {
            const id = savedExhibitions?.value;
            if (!id) {
                alert('呼び出す展覧会を選択してください。');
                return;
            }
            loadExhibitionSnapshot(id);
        });
    }
    if (btnDeleteExhibition) {
        btnDeleteExhibition.addEventListener('click', deleteExhibitionSnapshot);
    }

    const btnApplyWallSize = document.getElementById("btnApplyWallSize");
    document.getElementById('wallFloorSelect')?.addEventListener('change', async event => {
        const wall = wallPlanJsonData[selectedWallInfo.id];
        const floorId = event.target.value;
        if (!wall || wall.movableWallId || window.CURATOR_ROLE === 'viewer' || !FLOOR_PLANS[floorId]) return;
        const wallId = selectedWallInfo.id;
        captureCurrentCanvasState();
        const definition = { ...wallPlanJsonData[wallId], floorId };
        if (!await window.saveVenueWallDefinition(wallId, definition)) {
            updateWallBannerText();
            return;
        }
        await handleWallSelectChange(wallId);
        saveState();
    });

    if (btnApplyWallSize) {
        btnApplyWallSize.addEventListener("click", async function() {
            if (wallPlanJsonData[selectedWallInfo.id]?.movableWallId) return alert('移動壁の寸法は平面図の移動壁を選択して変更してください。');

            const wInput = document.getElementById("wallWidthCm");
            const hInput = document.getElementById("wallHeightCm");

            if (wInput && hInput) {

                const newW = parseFloat(wInput.value) || 600;
                const newH = FIXED_WALL_HEIGHT_CM;

                if (!Number.isFinite(newW) || newW <= 0) return;
                captureCurrentCanvasState();
                const definition = { ...wallPlanJsonData[selectedWallInfo.id], widthCm: newW, heightCm: newH };
                if (!await window.saveVenueWallDefinition(selectedWallInfo.id, definition)) return;
                selectedWallInfo.widthCm = newW;
                selectedWallInfo.heightCm = newH;

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
            if (wall.movableWallId) return window.deleteMovableWallByFace?.(wallId);

            await window.deleteFixedVenueWall(wallId);
        });
    }
}
