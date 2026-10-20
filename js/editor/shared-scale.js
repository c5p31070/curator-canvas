// The team's server value is authoritative; exhibition snapshots are backups only.
let sharedFloorScale = null;
let sharedScaleWriteBusy = false;
let sharedScaleRefreshPromise = null;
let sharedScaleApplyTimer = null;

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
        (sharedFloorScale === null || sharedScaleWriteBusy || !canEditSharedExhibitions());
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

function acceptSharedScale(value) {
    const scale = Number(value);
    if (!Number.isFinite(scale) || scale <= 0 || scale >= 1000000) {
        throw new Error('Invalid shared floor scale');
    }
    sharedFloorScale = scale;
    if (isTransitioning || isUndoRedoOperation || canvas._currentTransform ||
        window.isCombinedPdfBusy || window.isLayoutVariantBusy?.()) {
        clearTimeout(sharedScaleApplyTimer);
        sharedScaleApplyTimer = setTimeout(() => acceptSharedScale(sharedFloorScale), 150);
        return;
    }
    const changed = configuredScale !== scale;
    setConfiguredScale(scale);
    lockTeamScaleWorkspace();
    updateTeamScaleControls();
    teamScaleStatus(`チーム共通：${scale} px/cm`);
    if (changed) renderSharedScale();
}

async function refreshTeamFloorScale() {
    if (!window.CURATOR_SUPABASE_CONFIG) return true;
    if (sharedScaleWriteBusy) return sharedFloorScale !== null;
    if (sharedScaleRefreshPromise) return sharedScaleRefreshPromise;
    sharedScaleRefreshPromise = (async () => {
        try {
            if (!window.CURATOR_TEAM) throw new Error('Team is not available');
            const { data, error } = await window.curatorSupabase.from('teams')
                .select('floor_scale').eq('id', window.CURATOR_TEAM.id).single();
            if (error) throw error;
            acceptSharedScale(data.floor_scale);
            return true;
        } catch (error) {
            console.error('チーム共通の縮尺を取得できませんでした:', error);
            teamScaleStatus('共有縮尺の読み込みに失敗しました。');
            lockTeamScaleWorkspace('チーム共通の縮尺を取得できません。通信状態とSupabaseの共有縮尺設定を確認してください。');
            return false;
        }
    })();
    try { return await sharedScaleRefreshPromise; }
    finally { sharedScaleRefreshPromise = null; }
}
window.refreshTeamFloorScale = refreshTeamFloorScale;

async function saveTeamFloorScale(value) {
    const scale = Number(value);
    if (!Number.isFinite(scale) || scale <= 0 || scale >= 1000000) {
        const input = document.getElementById('scale');
        if (input) input.value = configuredScale ?? 0.5;
        alert('縮尺には0より大きく、1000000未満の数値を入力してください。');
        return false;
    }
    if (!window.CURATOR_SUPABASE_CONFIG) {
        if (!setConfiguredScale(scale)) return false;
        applyScaleToAllArtworks(scale);
        return true;
    }
    if (sharedScaleWriteBusy || !canEditSharedExhibitions()) return false;
    // Wait for any outstanding read before taking the expected server value.
    if (sharedScaleRefreshPromise) await sharedScaleRefreshPromise;
    if (sharedScaleWriteBusy) return false;
    if (sharedFloorScale === null) {
        await refreshTeamFloorScale();
        if (sharedFloorScale === null) return false;
    }
    const expected = sharedFloorScale;
    sharedScaleWriteBusy = true;
    updateTeamScaleControls();
    teamScaleStatus('チーム共通の縮尺を保存中…');
    lockTeamScaleWorkspace('チーム共通の縮尺を保存しています…');
    try {
        const { data, error } = await window.curatorSupabase.from('teams')
            .update({ floor_scale: scale }).eq('id', window.CURATOR_TEAM.id)
            .eq('floor_scale', expected).select('floor_scale').maybeSingle();
        if (error) throw error;
        if (!data) {
            alert('別のメンバーが縮尺を変更しました。最新の値を確認してから再設定してください。');
            return false;
        }
        acceptSharedScale(data.floor_scale);
        return true;
    } catch (error) {
        console.error('チーム共通の縮尺を保存できませんでした:', error);
        alert('縮尺を共有保存できませんでした。通信状態とSupabaseの設定を確認してください。');
        return false;
    } finally {
        sharedScaleWriteBusy = false;
        updateTeamScaleControls();
        // Confirm the authoritative value even after a timeout or conflicting update.
        await refreshTeamFloorScale();
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
