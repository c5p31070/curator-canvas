// 展覧会の保存・読み込み・削除と、ローカル保存・チーム共有保存を管理します。
// Exhibition records, team permissions, and local and cloud storage.

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
    return canEditSharedVenue() || Boolean(window.CURATOR_USER && window.CURATOR_TEAM && window.CURATOR_ROLE === 'guest');
}

function canEditSharedVenue() {
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
            let data = item.data;
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch { data = null; }
            }
            option.textContent = `【${VENUE_NAMES[venueOf(data)]}】${item.title || '名称未設定'}`;
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
    if (exhibitionWriteBusy || isTransitioning || isUndoRedoOperation || window.isCombinedPdfBusy || window.isLayoutVariantBusy?.()) return;
    const record = window.CURATOR_TEAM
        ? cloudExhibitionCache.find(item => item.id === id)
        : getSavedExhibitions().find(item => item.id === id);
    if (!record) return;
    window.flushPendingItemEditHistory?.();
    const previous = getSerializedCanvasData();
    const previousVenue = activeVenueId;
    isUndoRedoOperation = true;
    try {
        const data = typeof record.data === 'string' ? JSON.parse(record.data) : { ...record.data };
        data.exhibitionTitle = record.title;
        if (!await window.refreshTeamFloorScale?.(venueOf(data))) {
            return alert('会場の縮尺設定を読み込めません。公募展の場合はSupabaseの会場別縮尺設定を確認してください。');
        }
        if (!await applyStateData(JSON.stringify(data))) {
            if (activeVenueId !== previousVenue || !window.isDiagramReady?.()) await applyStateData(previous);
            return alert('展覧会の図面を読み込めませんでした。');
        }
        if (cloudExhibitionSaveTimer) { clearTimeout(cloudExhibitionSaveTimer); cloudExhibitionSaveTimer = null; }
        cloudExhibitionConflict = false;
        selectedExhibitionId = id;
        historyStack = [getSerializedCanvasData()];
        redoStack = [];
        updateUndoRedoButtons();
        saveLocalStorage();
        window.applyCuratorRoleRestrictions?.();
        const status = document.getElementById('saveStatus');
        if (status) status.innerText = `「${record.title}」を読み込みました`;
        refreshExhibitionList(false);
    } catch (error) {
        console.error('展覧会を読み込めませんでした:', error);
        alert('展覧会のデータを読み込めませんでした。');
    } finally { isUndoRedoOperation = false; }
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
