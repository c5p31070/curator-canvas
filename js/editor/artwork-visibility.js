// 展示物の種類別表示と、機能欄に置く小さな表示設定メニューを管理します。
const artworkVisibilityTypes = {
    wall: '壁面展示',
    floor: '床置展示',
    sculpture: '彫刻',
    'hanging-panel': '吊り下げ（絵画・パネル）',
    'hanging-object': '吊り下げ（立体物）',
    'wall-exhibition': '壁面全体'
};
const artworkTypeVisibility = Object.fromEntries(Object.keys(artworkVisibilityTypes).map(type => [type, true]));
try {
    const saved = JSON.parse(editorStorage.getItem('curator_canvas_artwork_visibility') || 'null');
    for (const type of Object.keys(artworkTypeVisibility)) {
        if (typeof saved?.[type] === 'boolean') artworkTypeVisibility[type] = saved[type];
        else if (type.startsWith('hanging-')) artworkTypeVisibility[type] = editorStorage.getItem('curator_canvas_hanging_visible') !== 'false';
    }
} catch {}

function isArtworkTypeVisible(artwork) {
    if (typeof artwork !== 'string' && artwork?.isFixture) return true;
    const type = typeof artwork === 'string' ? artwork : artwork?.displayType || 'wall';
    return artworkTypeVisibility[type] !== false;
}

function configureArtworkVisibility(artwork) {
    if (artwork?.isArtwork) artwork.set({ visible: isArtworkTypeVisible(artwork) });
}

function setArtworkTypeVisibility(type, visible) {
    if (!Object.hasOwn(artworkVisibilityTypes, type)) return;
    artworkTypeVisibility[type] = Boolean(visible);
    try { editorStorage.setItem('curator_canvas_artwork_visibility', JSON.stringify(artworkTypeVisibility)); } catch {}
    if (canvas.getActiveObjects().some(object => object.isArtwork && !isArtworkTypeVisible(object))) canvas.discardActiveObject();
    canvas.getObjects().forEach(object => {
        configureArtworkVisibility(object);
        if (object.isWallExhibitionPreview) object.set({ visible: isArtworkTypeVisible('wall-exhibition') });
    });
    canvas.getObjects().filter(object => object.isCrowdCircle).forEach(configureCrowdCircle);
    syncArtworkVisibilityMenu();
    canvas.requestRenderAll();
}

function syncArtworkVisibilityMenu() {
    const button = document.querySelector('[data-action="artwork-visibility"]');
    const hiddenCount = Object.values(artworkTypeVisibility).filter(visible => !visible).length;
    button?.classList.toggle('visibility-filtered', hiddenCount > 0);
    button?.setAttribute('aria-label', `展示物の種類別表示${hiddenCount ? `（${hiddenCount}種類を非表示）` : ''}`);
    document.querySelectorAll('[data-artwork-visibility]').forEach(input => {
        input.checked = isArtworkTypeVisible(input.dataset.artworkVisibility);
    });
}

function closeArtworkVisibilityMenu(returnFocus = false) {
    const menu = document.getElementById('artworkVisibilityMenu');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    const button = document.querySelector('[data-action="artwork-visibility"]');
    button?.setAttribute('aria-expanded', 'false');
    if (returnFocus) button?.focus();
}

function toggleArtworkVisibilityMenu() {
    const menu = document.getElementById('artworkVisibilityMenu');
    const button = document.querySelector('[data-action="artwork-visibility"]');
    if (!menu || !button) return;
    if (!menu.hidden) { closeArtworkVisibilityMenu(); return; }
    syncArtworkVisibilityMenu();
    menu.hidden = false;
    const rect = button.getBoundingClientRect();
    menu.style.left = `${Math.max(6, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 6))}px`;
    menu.style.top = `${Math.max(6, Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 6))}px`;
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector('input')?.focus();
}

function initializeArtworkVisibilityMenu() {
    if (document.getElementById('artworkVisibilityMenu')) return;
    const menu = document.createElement('div');
    menu.id = 'artworkVisibilityMenu';
    menu.className = 'artwork-visibility-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'group');
    menu.setAttribute('aria-label', '展示物の種類別表示');
    for (const [type, label] of Object.entries(artworkVisibilityTypes)) {
        const row = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.artworkVisibility = type;
        input.addEventListener('change', () => setArtworkTypeVisibility(type, input.checked));
        row.append(input, document.createTextNode(label));
        menu.append(row);
    }
    document.body.append(menu);
    document.addEventListener('pointerdown', event => {
        if (!menu.contains(event.target) && !event.target.closest('[data-action="artwork-visibility"]')) closeArtworkVisibilityMenu();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); closeArtworkVisibilityMenu(true); }
    });
    document.addEventListener('focusin', event => {
        if (!menu.contains(event.target) && !event.target.closest('[data-action="artwork-visibility"]')) closeArtworkVisibilityMenu();
    });
    window.addEventListener('resize', () => closeArtworkVisibilityMenu());
    document.querySelector('.tool-palette')?.addEventListener('scroll', () => closeArtworkVisibilityMenu());
    syncArtworkVisibilityMenu();
}
