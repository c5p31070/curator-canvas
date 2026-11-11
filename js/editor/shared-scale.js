// The team's server value is authoritative; exhibition snapshots are backups only.
const sharedVenueScales = new Map();
let sharedScaleWriteBusy = false;
const sharedScaleRequests = new Map();
let sharedScaleApplyTimer = null;
const scaleColumn = venue => venue === 'public' ? 'public_floor_scale' : 'floor_scale';

function teamScaleStatus(message) {
    const status = document.getElementById('teamScaleStatus');
    if (status) status.textContent = message;
}

function lockTeamScaleWorkspace(message = '') {
    const notice = document.getElementById('teamScaleNotice');
    const text = document.getElementById('teamScaleNoticeText');
    const workspace = document.querySelector('.main-layout');
    if (notice) notice.hidden = !message;
    if (text) text.textContent = message;
    if (workspace) workspace.inert = Boolean(message);
}

function updateTeamScaleControls() {
    const disabled = Boolean(window.CURATOR_SUPABASE_CONFIG) &&
        (!sharedVenueScales.has(activeVenueId) || sharedScaleWriteBusy || !canEditSharedExhibitions());
    for (const id of ['scale', 'btnMeasureScale']) {
        const field = document.getElementById(id);
        if (field) field.disabled = disabled;
    }
}

function renderSharedScale() {
    clearTimeout(sharedScaleApplyTimer);
    // Finish a view load, PDF capture or pointer operation before changing geometry.
    if (isTransitioning || isUndoRedoOperation || canvas._currentTransform ||
        window.isCombinedPdfBusy || window.isLayoutVariantBusy?.()) {
        sharedScaleApplyTimer = setTimeout(renderSharedScale, 150);
        return;
    }
    if (currentViewMode === 'floor') syncFloorArtworkScale();
    window.refreshDimensionLabels?.();
    canvas.requestRenderAll();
}

function applyActiveVenueScale(render = false) {
    const venue = activeVenueId;
    if (window.CURATOR_SUPABASE_CONFIG && !sharedVenueScales.has(venue)) return;
    const scale = window.CURATOR_SUPABASE_CONFIG ? sharedVenueScales.get(venue) : configuredScale;
    clearTimeout(sharedScaleApplyTimer);
    if (render && (isTransitioning || isUndoRedoOperation || canvas._currentTransform ||
        window.isCombinedPdfBusy || window.isLayoutVariantBusy?.())) {
        sharedScaleApplyTimer = setTimeout(() => {
            if (activeVenueId === venue) applyActiveVenueScale(true);
        }, 150);
        return;
    }
    const changed = configuredScale !== scale;
    if (scale === null) {
        configuredScale = null;
        const input = document.getElementById('scale');
        if (input) input.value = '';
    } else setConfiguredScale(scale);
    lockTeamScaleWorkspace();
    updateTeamScaleControls();
    teamScaleStatus(scale === null ? `${VENUE_NAMES[venue]}会場：縮尺未設定` :
        `${VENUE_NAMES[venue]}会場${window.CURATOR_SUPABASE_CONFIG ? '（チーム共通）' : ''}：${scaleToPxPerMm(scale)} px/mm`);
    if (render && changed && scale !== null) renderSharedScale();
}
window.applyActiveVenueScale = applyActiveVenueScale;

async function refreshTeamFloorScale(venue = activeVenueId) {
    if (!window.CURATOR_SUPABASE_CONFIG) return true;
    if (sharedScaleWriteBusy) return sharedVenueScales.has(venue);
    if (sharedScaleRequests.has(venue)) return sharedScaleRequests.get(venue);
    const column = scaleColumn(venue);
    const request = (async () => {
        try {
            if (!window.CURATOR_TEAM) throw new Error('Team is not available');
            const { data, error } = await window.curatorSupabase.from('teams')
                .select(column).eq('id', window.CURATOR_TEAM.id).single();
            if (error) throw error;
            const value = data[column];
            const scale = value === null && venue === 'public' ? null : Number(value);
            if (scale !== null && (!Number.isFinite(scale) || scale <= 0 || scale >= 1000000)) throw new Error('Invalid shared floor scale');
            sharedVenueScales.set(venue, scale);
            if (activeVenueId === venue) applyActiveVenueScale(true);
            return true;
        } catch (error) {
            console.error('チーム共通の縮尺を取得できませんでした:', error);
            if (activeVenueId === venue) {
                teamScaleStatus('共有縮尺の読み込みに失敗しました。');
                if (venue === 'special' && !sharedVenueScales.has(venue)) lockTeamScaleWorkspace('チーム共通の縮尺を取得できません。通信状態とSupabaseの共有縮尺設定を確認してください。');
            }
            return false;
        }
    })();
    sharedScaleRequests.set(venue, request);
    try { return await request; }
    finally { sharedScaleRequests.delete(venue); }
}
window.refreshTeamFloorScale = refreshTeamFloorScale;

async function saveTeamFloorScale(value) {
    const scale = Number(value);
    if (!Number.isFinite(scale) || scale <= 0 || scale >= 1000000) {
        const input = document.getElementById('scale');
        if (input) input.value = configuredScale === null ? '' : scaleToPxPerMm(configuredScale);
        alert('縮尺には0より大きく、100000未満の数値を入力してください。');
        return false;
    }
    if (!window.CURATOR_SUPABASE_CONFIG) {
        if (!setConfiguredScale(scale)) return false;
        applyActiveVenueScale();
        applyScaleToAllArtworks(scale);
        return true;
    }
    if (sharedScaleWriteBusy || !canEditSharedExhibitions()) return false;
    const venue = activeVenueId;
    const column = scaleColumn(venue);
    // Wait for any outstanding read before taking the expected server value.
    if (sharedScaleRequests.has(venue)) await sharedScaleRequests.get(venue);
    if (sharedScaleWriteBusy || activeVenueId !== venue) return false;
    if (!sharedVenueScales.has(venue) && !await refreshTeamFloorScale(venue)) return false;
    if (sharedScaleWriteBusy || activeVenueId !== venue) return false;
    const expected = sharedVenueScales.get(venue);
    sharedScaleWriteBusy = true;
    updateTeamScaleControls();
    teamScaleStatus('チーム共通の縮尺を保存中…');
    lockTeamScaleWorkspace('チーム共通の縮尺を保存しています…');
    try {
        const query = window.curatorSupabase.from('teams')
            .update({ [column]: scale }).eq('id', window.CURATOR_TEAM.id);
        const { data, error } = await (expected === null ? query.is(column, null) : query.eq(column, expected))
            .select(column).maybeSingle();
        if (error) throw error;
        if (!data) {
            alert('別のメンバーが縮尺を変更しました。最新の値を確認してから再設定してください。');
            return false;
        }
        sharedVenueScales.set(venue, Number(data[column]));
        if (activeVenueId === venue) applyActiveVenueScale(true);
        return true;
    } catch (error) {
        console.error('チーム共通の縮尺を保存できませんでした:', error);
        alert('縮尺を共有保存できませんでした。通信状態とSupabaseの設定を確認してください。');
        return false;
    } finally {
        sharedScaleWriteBusy = false;
        updateTeamScaleControls();
        // Confirm the authoritative value even after a timeout or conflicting update.
        lockTeamScaleWorkspace();
        await refreshTeamFloorScale(venue);
    }
}
window.saveTeamFloorScale = saveTeamFloorScale;

const teamScaleDomReady = new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
window.TEAM_SCALE_READY = (async () => {
    await teamScaleDomReady;
    if (!window.CURATOR_SUPABASE_CONFIG) return true;
    lockTeamScaleWorkspace('チーム共通の縮尺を読み込み中…');
    updateTeamScaleControls();
    document.getElementById('btnRetryTeamScale')?.addEventListener('click', () => location.reload());
    const context = await window.CURATOR_AUTH_READY;
    if (!context) return false;
    const loaded = await refreshTeamFloorScale();
    window.curatorSupabase.channel(`team-scale-${context.team.id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'teams', filter: `id=eq.${context.team.id}` },
            () => refreshTeamFloorScale())
        .subscribe(status => { if (status === 'SUBSCRIBED') refreshTeamFloorScale(); });
    window.addEventListener('focus', () => refreshTeamFloorScale());
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshTeamFloorScale();
    });
    return loaded;
})();
