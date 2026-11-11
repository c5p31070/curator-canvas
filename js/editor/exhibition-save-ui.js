// Saving under a different title creates a copy; renaming changes only record metadata.
function refreshExhibitionSaveUi() {
    const record = getActiveExhibitionRecord();
    const readOnly = window.CURATOR_ROLE === 'viewer';
    const input = document.getElementById('exhibitionTitle');
    const save = document.getElementById('btnSaveData');
    const draftName = (input?.value || '').trim();
    const headerName = document.getElementById('currentExhibitionName');
    if (headerName) {
        headerName.textContent = `【${VENUE_NAMES[activeVenueId]}】${draftName || '名称未設定'}`;
        headerName.title = headerName.textContent;
    }
    if (input) input.disabled = exhibitionWriteBusy || readOnly;
    if (save) {
        save.textContent = record && draftName && draftName !== record.title ? '名前を付けて保存' : '展覧会を保存';
        save.disabled = exhibitionWriteBusy || readOnly;
    }
    const rename = document.getElementById('renameExhibitionTitle');
    if (rename) {
        if (rename.dataset.sourceId !== (record?.id || '') || rename.dataset.sourceTitle !== (record?.title || '')) {
            rename.value = record?.title || '';
            rename.dataset.sourceId = record?.id || '';
            rename.dataset.sourceTitle = record?.title || '';
        }
        rename.disabled = exhibitionWriteBusy || readOnly || !record;
    }
    const renameButton = document.getElementById('btnRenameExhibition');
    if (renameButton) renameButton.disabled = exhibitionWriteBusy || readOnly || !record;
    const list = document.getElementById('savedExhibitions');
    if (list) list.disabled = exhibitionWriteBusy;
    const load = document.getElementById('btnLoadExhibition');
    if (load) load.disabled = exhibitionWriteBusy || !list?.value;
    const remove = document.getElementById('btnDeleteExhibition');
    if (remove) remove.disabled = exhibitionWriteBusy || readOnly || !list?.value;
}
window.refreshExhibitionSaveUi = refreshExhibitionSaveUi;

window.rebaseExhibitionHistoryTitle = (oldTitle, title) => {
    const update = raw => {
        const state = JSON.parse(raw);
        if ((state.exhibitionTitle || '').trim() === oldTitle) state.exhibitionTitle = title;
        return JSON.stringify(state);
    };
    historyStack = historyStack.map(update);
    redoStack = redoStack.map(update);
};

async function renameCurrentExhibition() {
    if (exhibitionWriteBusy || window.CURATOR_ROLE === 'viewer') return;
    const record = getActiveExhibitionRecord();
    if (!record) return alert('名前を編集する展覧会を開いてください。');
    const title = (document.getElementById('renameExhibitionTitle')?.value || '').trim();
    if (!title) return alert('新しい展覧会名を入力してください。');
    if (title === record.title) return;
    const records = window.CURATOR_TEAM ? cloudExhibitionCache : getSavedExhibitions();
    if (records.some(item => item.id !== record.id && item.title.trim() === title)) {
        return alert('同じ名前の展覧会があります。別の名前を入力してください。');
    }
    if (window.CURATOR_TEAM && (!canEditSharedExhibitions() || cloudExhibitionConflict)) {
        return alert('編集権限と最新の展覧会データを確認してください。');
    }
    exhibitionWriteBusy = true;
    if (cloudExhibitionSaveTimer) { clearTimeout(cloudExhibitionSaveTimer); cloudExhibitionSaveTimer = null; }
    refreshExhibitionSaveUi();
    try {
        const oldTitle = record.title;
        const data = typeof record.data === 'string' ? JSON.parse(record.data) : JSON.parse(JSON.stringify(record.data));
        data.exhibitionTitle = title;
        const updatedAt = new Date().toISOString();
        if (window.CURATOR_TEAM) {
            const { data: updated, error } = await window.curatorSupabase.from('exhibitions').update({
                title, data, updated_by: window.CURATOR_USER.id, updated_at: updatedAt
            }).eq('id', record.id).eq('team_id', window.CURATOR_TEAM.id)
                .eq('updated_at', record.updated_at).select('id, updated_at').maybeSingle();
            if (error) throw error;
            if (!updated) {
                cloudExhibitionConflict = true;
                return alert('他のメンバーが先に更新しました。最新の展覧会を読み込んでください。');
            }
            Object.assign(record, { title, data, updated_at: updated.updated_at });
        } else {
            const renamed = records.find(item => item.id === record.id);
            Object.assign(renamed, { title, data: typeof record.data === 'string' ? JSON.stringify(data) : data, updatedAt });
            editorStorage.setItem(EXHIBITIONS_KEY, JSON.stringify(records));
        }
        const draft = document.getElementById('exhibitionTitle');
        if (draft?.value.trim() === oldTitle) draft.value = title;
        window.rebaseExhibitionHistoryTitle(oldTitle, title);
        editorStorage.setItem(STORAGE_KEY, getSerializedCanvasData());
        refreshExhibitionList(false);
        const status = document.getElementById('saveStatus');
        if (status) status.textContent = `「${oldTitle}」を「${title}」に変更しました`;
    } catch (error) {
        console.error('展覧会名の変更に失敗しました:', error);
        alert('展覧会名を変更できませんでした。保存先とネットワークを確認してください。');
    } finally {
        exhibitionWriteBusy = false;
        refreshExhibitionSaveUi();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnRenameExhibition')?.addEventListener('click', renameCurrentExhibition);
    const dialog = document.getElementById('newExhibitionDialog');
    const form = document.getElementById('newExhibitionForm');
    const status = document.getElementById('newExhibitionStatus');
    const create = document.getElementById('btnCreateExhibition');
    const venueSelect = document.getElementById('newExhibitionVenue');
    if (window.CURATOR_GUEST?.active) {
        const option = venueSelect.querySelector('[value="public"]');
        option.disabled = true;
        option.textContent = '公募展会場（通常ログインで利用可）';
    }
    window.openNewExhibitionDialog = () => {
        if (window.CURATOR_ROLE === 'viewer' || !window.isDiagramReady?.() || isTransitioning ||
            isUndoRedoOperation || exhibitionWriteBusy || window.isCombinedPdfBusy || window.isLayoutVariantBusy?.() || dialog.open) return;
        window.cancelDimensionDrawing?.();
        window.cancelLightingPlacement?.();
        window.cancelPerspectivePick?.();
        form.reset();
        status.textContent = '';
        dialog.showModal();
    };
    document.getElementById('btnNewExhibition').addEventListener('click', window.openNewExhibitionDialog);
    document.getElementById('btnCancelNewExhibition').addEventListener('click', () => { if (!create.disabled) dialog.close(); });
    document.getElementById('btnOpenSavedFromNew').addEventListener('click', () => {
        if (create.disabled) return;
        dialog.close();
        window.activateToolPanel?.('data');
        document.getElementById('savedExhibitions')?.focus();
    });
    dialog.addEventListener('cancel', event => { if (create.disabled) event.preventDefault(); });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const title = document.getElementById('newExhibitionName').value.trim();
        const venueId = venueSelect.value;
        if (isTransitioning || isUndoRedoOperation || exhibitionWriteBusy) return;
        if (create.disabled || window.CURATOR_ROLE === 'viewer' || !title || !Object.hasOwn(VENUE_NAMES, venueId)) {
            status.textContent = '展覧会名と会場を指定してください。';
            return;
        }
        const records = window.CURATOR_TEAM ? cloudExhibitionCache : getSavedExhibitions();
        if (records.some(item => item.title.trim() === title)) {
            status.textContent = '同じ名前の展覧会があります。別の名前を入力してください。';
            return;
        }
        window.flushPendingItemEditHistory?.();
        const previous = getSerializedCanvasData();
        const previousVenue = activeVenueId;
        const draft = JSON.parse(previous);
        const hasLayout = Object.values(draft.floorPlanData).some(floor =>
            floor.json && (typeof floor.json === 'string' ? JSON.parse(floor.json) : floor.json).objects?.some(object => !object.isFixture)) ||
            Object.values(draft.wallPlanJsonData).some(wall => wall.movableWallId || (wall.json &&
                (typeof wall.json === 'string' ? JSON.parse(wall.json) : wall.json).objects?.some(object => !object.isFixture && !object.isWallOutline)));
        if ((hasLayout || draft.exhibitionTitle.trim()) &&
            !confirm('新規展覧会を作成します。現在の下書きを置き換えますが、保存済みの展覧会は残ります。続けますか？')) return;
        create.disabled = true;
        isUndoRedoOperation = true;
        status.textContent = '会場の図面を読み込み中…';
        try {
            const loaded = await applyStateData(JSON.stringify({
                venueId, exhibitionTitle: title, currentViewMode: 'floor',
                floorPlanData: {}, wallPlanJsonData: {}, savedArtworkCatalog: []
            }));
            if (!loaded) {
                if (activeVenueId !== previousVenue || !window.isDiagramReady?.()) await applyStateData(previous);
                status.textContent = venueId === 'public'
                    ? '公募展会場を開けませんでした。通信状態とSupabaseの会場別縮尺設定を確認してください。'
                    : '企画展会場を開けませんでした。通信状態を確認してください。';
                return;
            }
            selectedExhibitionId = '';
            cloudExhibitionConflict = false;
            historyStack = [getSerializedCanvasData()];
            redoStack = [];
            updateUndoRedoButtons();
            refreshExhibitionList(false);
            saveLocalStorage();
            dialog.close();
            window.activateToolPanel?.('data');
            document.getElementById('saveStatus').textContent = activeVenueId === 'public' && configuredScale === null
                ? '公募展会場を開きました。寸法付きの配置を始める前に、管理者モードで縮尺を設定してください。'
                : '新規展覧会を開きました。「展覧会を保存」で保存できます。';
        } finally {
            isUndoRedoOperation = false;
            create.disabled = false;
        }
    });
    refreshExhibitionSaveUi();
});
