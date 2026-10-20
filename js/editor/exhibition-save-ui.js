// Saving under a different title creates a copy; renaming changes only record metadata.
function refreshExhibitionSaveUi() {
    const record = getActiveExhibitionRecord();
    const readOnly = window.CURATOR_ROLE === 'viewer';
    const input = document.getElementById('exhibitionTitle');
    const save = document.getElementById('btnSaveData');
    const draftName = (input?.value || '').trim();
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
            localStorage.setItem(EXHIBITIONS_KEY, JSON.stringify(records));
        }
        const draft = document.getElementById('exhibitionTitle');
        if (draft?.value.trim() === oldTitle) draft.value = title;
        window.rebaseExhibitionHistoryTitle(oldTitle, title);
        localStorage.setItem(STORAGE_KEY, getSerializedCanvasData());
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
    refreshExhibitionSaveUi();
});
