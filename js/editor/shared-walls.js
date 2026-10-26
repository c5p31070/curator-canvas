// Permanent venue walls are independent of exhibition layouts and Undo history.
(() => {
    let walls = {};
    let revision = 0;
    let ready = false;
    let busy = false;
    let rendering = 0;
    let pending = null;
    let publishing = null;
    let conflicted = false;
    let timer = null;
    let refreshPromise = null;
    let legacyWalls = {};
    const clone = value => JSON.parse(JSON.stringify(value));
    const cloud = () => Boolean(window.CURATOR_SUPABASE_CONFIG);
    const editable = () => !cloud() || canEditSharedExhibitions();
    const storageKey = () => `curator_canvas_venue_walls_${window.CURATOR_TEAM?.id || 'local'}`;
    const parsePlan = raw => {
        try { return typeof raw === 'string' ? JSON.parse(raw) : clone(raw || { objects: [] }); }
        catch { return { objects: [] }; }
    };
    const status = (message, failed = false) => {
        const output = document.getElementById('venueWallsStatus');
        if (output) output.textContent = message;
        const notice = document.getElementById('venueWallsNotice');
        if (notice) notice.hidden = !failed;
        const text = document.getElementById('venueWallsNoticeText');
        if (text) text.textContent = message;
    };
    const backup = () => {
        try { localStorage.setItem(storageKey(), JSON.stringify({ walls, revision })); } catch {}
    };
    function template(wall) {
        const plan = parsePlan(wall.json);
        const objects = (plan.objects || []).filter(object => object.isFixture || object.isWallOutline);
        const outline = objects.find(object => object.isWallOutline);
        return { title: wall.title, floorId: FLOOR_PLANS[wall.floorId] ? wall.floorId : 'lobby',
            widthCm: Number(wall.widthCm), heightCm: FIXED_WALL_HEIGHT_CM,
            fixtureScale: Number(wall.fixtureScale) || (outline
                ? outline.height * (outline.scaleY || 1) / (Number(wall.legacyHeightCm) || Number(wall.heightCm) || 450)
                : Number(configuredScale) || .5),
            json: JSON.stringify({ version: plan.version, objects }) };
    }
    function normalize(data) {
        const result = {};
        Object.entries(data || {}).forEach(([id, wall]) => {
            if (wall && !wall.movableWallId && Number(wall.widthCm) > 0) result[id] = template(wall);
        });
        return result;
    }
    window.rememberLegacyVenueWalls = data => {
        if (!data?.wallPlanJsonData) return;
        legacyWalls = normalize(data.venueWallData || data.wallPlanJsonData);
    };
    try { window.rememberLegacyVenueWalls(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); } catch {}
    const currentWalls = () => pending || publishing || walls;
    window.getVenueWallData = () => clone(currentWalls());
    window.beginVenueWallRender = () => { rendering++; };
    window.endVenueWallRender = () => { rendering = Math.max(0, rendering - 1); };
    window.isVenueWallRendering = () => rendering > 0;

    window.applyVenueWallsToPlans = () => {
        if (!ready) return;
        const previous = wallPlanJsonData;
        const next = {};
        Object.entries(currentWalls()).forEach(([id, definition]) => {
            const layout = previous[id];
            next[id] = { ...definition, json: layout?.json || null };
            if (layout?.legacyHeightCm) next[id].legacyHeightCm = layout.legacyHeightCm;
            else if (Number(layout?.heightCm) > 0 && Number(layout.heightCm) !== FIXED_WALL_HEIGHT_CM) next[id].legacyHeightCm = Number(layout.heightCm);
        });
        Object.entries(previous).forEach(([id, wall]) => { if (wall.movableWallId) next[id] = wall; });
        wallPlanJsonData = next;
        window.refreshVenuePresetList?.();
    };
    window.prepareVenueWallPlan = (raw, id, outline) => {
        if (!ready || !currentWalls()[id]) return parsePlan(raw);
        const layout = parsePlan(raw);
        const definition = currentWalls()[id];
        const source = parsePlan(definition.json);
        const frame = source.objects?.find(object => object.isWallOutline);
        const oldScale = definition.fixtureScale || .5;
        const newScale = outline.height / FIXED_WALL_HEIGHT_CM;
        const factor = newScale / oldScale;
        const oldLeft = Number(frame?.left) || 0;
        const oldFloor = frame ? frame.top + frame.height * (frame.scaleY || 1) : 0;
        const newFloor = outline.top + outline.height;
        const fixtures = (source.objects || []).filter(object => object.isFixture).map(original => {
            const object = clone(original);
            object.left = outline.left + ((Number(original.left) || 0) - oldLeft) * factor;
            object.top = newFloor - (oldFloor - (Number(original.top) || 0)) * factor;
            if (object.isArtwork) {
                object.artworkCenterHeightCm = (oldFloor - (Number(original.top) || 0)) / oldScale;
                object.scaleX = 1;
                object.scaleY = 1;
            } else {
                object.scaleX = (Number(original.scaleX) || 1) * factor;
                object.scaleY = (Number(original.scaleY) || 1) * factor;
            }
            return object;
        });
        layout.objects = [...(layout.objects || []).filter(object => !object.isFixture), ...fixtures];
        return layout;
    };

    async function renderSharedWalls() {
        if (!window.isDiagramReady?.()) return;
        if (isTransitioning || isUndoRedoOperation || canvas._currentTransform || window.isCombinedPdfBusy || window.isLayoutVariantBusy?.()) {
            setTimeout(renderSharedWalls, 200);
            return;
        }
        captureCurrentCanvasState();
        window.applyVenueWallsToPlans();
        updateWallDropdownOptions();
        if (currentViewMode === 'wall') await switchViewMode('wall', true, null, true);
    }
    async function refresh() {
        if (!cloud()) return true;
        if (busy || pending) return ready;
        if (refreshPromise) return refreshPromise;
        refreshPromise = (async () => {
            try {
                if (!window.CURATOR_TEAM) throw new Error('Team unavailable');
                const { data, error } = await window.curatorSupabase.from('teams')
                    .select('venue_walls, venue_walls_revision').eq('id', window.CURATOR_TEAM.id).single();
                if (error) throw error;
                const next = normalize(data.venue_walls);
                const changed = JSON.stringify(next) !== JSON.stringify(walls);
                walls = next;
                revision = Number(data.venue_walls_revision) || 0;
                ready = true;
                backup();
                status('固定壁：チーム共通');
                if (changed) await renderSharedWalls();
                return true;
            } catch (error) {
                console.error('共通壁の取得に失敗しました:', error);
                status('共通壁を取得できません。通信状態とSupabaseの共通壁設定SQLを確認し、再試行してください。', true);
                return false;
            }
        })();
        try { return await refreshPromise; }
        finally { refreshPromise = null; }
    }
    window.refreshVenueWalls = refresh;

    async function publish(next) {
        if (!ready || busy || !editable()) return false;
        busy = true;
        publishing = next;
        conflicted = false;
        let committed = false;
        status('共通壁を保存中…');
        try {
            if (cloud()) {
                const { data, error } = await window.curatorSupabase.from('teams')
                    .update({ venue_walls: next, venue_walls_revision: revision + 1 })
                    .eq('id', window.CURATOR_TEAM.id).eq('venue_walls_revision', revision)
                    .select('venue_walls_revision').maybeSingle();
                if (error) throw error;
                if (!data) {
                    // Never replace another member's newer venue configuration.
                    try { localStorage.setItem(`${storageKey()}_unsaved`, JSON.stringify(next)); } catch {}
                    pending = null;
                    publishing = null;
                    conflicted = true;
                    busy = false;
                    await refresh();
                    alert('別のメンバーが共通壁を更新しました。最新の設定を読み込みました。変更を確認してから再設定してください。');
                    return false;
                }
                revision = Number(data.venue_walls_revision);
            } else revision++;
            walls = clone(next);
            committed = true;
            backup();
            status(cloud() ? '固定壁をチームに保存しました' : '固定壁を会場設定に保存しました');
            await renderSharedWalls();
            return true;
        } catch (error) {
            console.error('共通壁の保存に失敗しました:', error);
            if (!pending) pending = clone(next);
            try { localStorage.setItem(`${storageKey()}_unsaved`, JSON.stringify(pending)); } catch {}
            status('固定壁の共有保存に失敗しました。通信状態を確認して再試行してください。', true);
            return false;
        } finally {
            busy = false;
            publishing = null;
            if (committed && pending) {
                clearTimeout(timer);
                timer = setTimeout(flush, 700);
            }
        }
    }
    async function flush() {
        clearTimeout(timer);
        timer = null;
        if (!pending || busy) return !pending;
        const next = pending;
        pending = null;
        const saved = await publish(next);
        if (!saved && !pending && !conflicted) pending = next;
        return saved;
    }
    window.flushVenueWallChanges = flush;
    window.saveVenueWallDefinition = async (id, wall) => {
        if (!ready || !editable() || busy) return false;
        if (pending && !await flush()) return false;
        const next = clone(walls);
        if (wall) next[id] = template({ ...wall, fixtureScale: null });
        else delete next[id];
        const saved = await publish(next);
        if (saved) window.applyVenueWallsToPlans();
        return saved;
    };
    window.queueVenueWallFixtureChange = object => {
        if (!object?.isFixture || object.isLightObject || object.isLightRail || !ready || rendering ||
            !isAdminMode || !editable() || isTransitioning || isUndoRedoOperation || currentViewMode !== 'wall') return;
        const id = selectedWallInfo.id;
        if (!walls[id]) return;
        const definition = { ...wallPlanJsonData[id], fixtureScale: null, json: JSON.stringify(canvas.toJSON(getCustomProperties())) };
        const next = clone(currentWalls());
        next[id] = template(definition);
        pending = next;
        try { localStorage.setItem(`${storageKey()}_unsaved`, JSON.stringify(next)); } catch {}
        status('共通壁の変更を保存待ち…');
        clearTimeout(timer);
        timer = setTimeout(flush, 700);
    };

    const domReady = new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    window.TEAM_WALLS_READY = (async () => {
        await domReady;
        document.getElementById('btnRetryVenueWalls')?.addEventListener('click', async () => {
            if (pending) await flush();
            else if (await refresh()) document.getElementById('btnRetryDiagram')?.click();
        });
        document.getElementById('btnImportVenueWalls')?.addEventListener('click', async () => {
            if (!editable() || busy || !ready) return;
            if (pending && !await flush()) return;
            const entries = Object.entries(legacyWalls);
            if (!entries.length) return alert('取り込める既存の固定壁がありません。以前の展覧会を読み込んでから実行してください。');
            if (!confirm(`既存の固定壁 ${entries.length}件をチーム共通設定へ取り込みます。同じIDの壁の事前設定を上書きします。\n${entries.map(([, wall]) => wall.title).join('、')}`)) return;
            await publish({ ...walls, ...legacyWalls });
        });
        if (!cloud()) {
            try { walls = normalize(JSON.parse(localStorage.getItem(storageKey()) || 'null')?.walls || legacyWalls); } catch { walls = clone(legacyWalls); }
            if (!Object.keys(walls).length) walls = normalize(wallPlanJsonData);
            ready = true;
            backup();
            status('固定壁：会場共通');
            return true;
        }
        const context = await window.CURATOR_AUTH_READY;
        if (!context) return false;
        const loaded = await refresh();
        window.curatorSupabase.channel(`venue-walls-${context.team.id}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'teams', filter: `id=eq.${context.team.id}` }, () => refresh())
            .subscribe(state => { if (state === 'SUBSCRIBED') refresh(); });
        window.addEventListener('focus', refresh);
        return loaded;
    })();
})();
