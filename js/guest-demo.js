// Temporary presentation entry point. Set enabled=false to retire the demo.
// Guest mode never creates a Supabase client or reads signed-in users' storage.
(() => {
    const enabled = true;
    const active = enabled && /(^|\/)editor\.html$/.test(location.pathname) && new URLSearchParams(location.search).get('guest') === '1';
    const blockedTools = new Set(['setup', 'team', 'lighting']);
    const memory = new Map();
    const prefix = 'curator_canvas_guest_demo_v1:';
    const storage = {
        getItem(key) {
            if (memory.has(key)) return memory.get(key);
            try { return window.localStorage.getItem(prefix + key); }
            catch { return memory.get(key) ?? null; }
        },
        setItem(key, value) {
            memory.set(key, String(value));
            try { window.localStorage.setItem(prefix + key, String(value)); } catch {}
        },
        removeItem(key) {
            memory.delete(key);
            try { window.localStorage.removeItem(prefix + key); } catch {}
        }
    };
    if (active && !storage.getItem('curator_canvas_draft_data')) {
        const walls = Object.fromEntries([['lobby', 'ロビー階'], ['floor1', '1階'], ['floor2', '2階']].map(([floorId, name]) => [
            `guest_${floorId}_wall`, { title: `${name}・体験用壁面`, floorId, widthCm: 600, heightCm: 450, json: null }
        ]));
        storage.setItem('curator_canvas_floor_scale', '0.5');
        storage.setItem('curator_canvas_venue_walls_local', JSON.stringify({ walls, revision: 0 }));
        storage.setItem('curator_canvas_draft_data', JSON.stringify({
            exhibitionTitle: 'ゲスト体験', scale: .5, currentViewMode: 'floor', selectedFloorId: 'lobby',
            floorPlanData: { lobby: { json: null }, floor1: { json: null }, floor2: { json: null } },
            wallPlanJsonData: walls, savedArtworkCatalog: []
        }));
    }
    const applyRestrictions = () => {
        document.body.classList.add('guest-demo');
        document.querySelectorAll('[data-tool="setup"], [data-tool="team"], [data-tool="lighting"], #btnToggleAdminMode, #adminSettingsPanel input, #adminSettingsPanel button, #adminSettingsPanel select').forEach(control => {
            control.disabled = true;
        });
    };
    window.CURATOR_GUEST = Object.freeze({
        enabled, active, storage: active ? storage : null,
        allowsTool: tool => !active || !blockedTools.has(tool),
        initializeAuth() {
            window.CURATOR_USER = null;
            window.CURATOR_TEAM = null;
            window.CURATOR_ROLE = 'guest';
            window.CURATOR_AUTH_READY = Promise.resolve({ user: null, team: null, role: 'guest' });
            window.applyCuratorRoleRestrictions = applyRestrictions;
            document.documentElement.classList.remove('auth-loading');
        }
    });
    document.addEventListener('DOMContentLoaded', () => {
        const entry = document.getElementById('guestDemoEntry');
        if (entry) entry.hidden = !enabled;
        if (!active && !entry) return;
        const sheet = document.createElement('link');
        sheet.rel = 'stylesheet';
        sheet.href = 'css/guest-demo.css';
        document.head.appendChild(sheet);
        if (!active) return;
        applyRestrictions();
        const account = document.getElementById('accountLabel');
        if (account) account.textContent = 'ゲスト体験 · 体験用設定 · 端末内保存';
        const exit = document.getElementById('btnLogout');
        if (exit) {
            exit.textContent = 'ゲストを終了';
            exit.addEventListener('click', () => location.replace('login.html'));
        }
    });
})();
