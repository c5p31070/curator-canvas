// All layout alternatives belong to the same exhibition JSON record.
let layoutVariants = [{ id: 'plan_a', name: '配置案A', layout: null }];
let selectedLayoutVariantId = 'plan_a';
let isChangingLayoutVariant = false;
window.isLayoutVariantBusy = () => isChangingLayoutVariant;

function extractVariantLayout(state) {
    const keys = ['currentViewMode', 'selectedFloorId', 'selectedWallInfo',
        'floorPlanJsonData', 'floorPlanData', 'wallPlanJsonData'];
    const layout = {};
    keys.forEach(key => {
        if (state[key] !== undefined) layout[key] = state[key];
    });
    return JSON.parse(JSON.stringify(layout));
}

window.getLayoutVariantsData = state => {
    const current = layoutVariants.find(variant => variant.id === selectedLayoutVariantId);
    if (current) current.layout = extractVariantLayout(state);
    return { layoutVariants, selectedLayoutVariantId };
};

window.restoreLayoutVariants = state => {
    const usedIds = new Set();
    layoutVariants = (Array.isArray(state.layoutVariants) ? state.layoutVariants : [])
        .filter(variant => {
            if (!variant || typeof variant.id !== 'string' || usedIds.has(variant.id) ||
                !variant.layout || typeof variant.layout !== 'object') return false;
            usedIds.add(variant.id);
            return true;
        })
        .map(variant => ({
            id: variant.id,
            name: String(variant.name || '配置案').slice(0, 80),
            layout: extractVariantLayout(variant.layout)
        }));
    if (!layoutVariants.length) {
        layoutVariants = [{ id: 'plan_a', name: '配置案A', layout: extractVariantLayout(state) }];
    }
    selectedLayoutVariantId = layoutVariants.some(variant => variant.id === state.selectedLayoutVariantId)
        ? state.selectedLayoutVariantId : layoutVariants[0].id;
    refreshLayoutVariants();
};

function nextLayoutVariantName() {
    for (let index = 0; ; index++) {
        let number = index + 1;
        let suffix = '';
        while (number > 0) {
            number--;
            suffix = String.fromCharCode(65 + number % 26) + suffix;
            number = Math.floor(number / 26);
        }
        const name = `配置案${suffix}`;
        if (!layoutVariants.some(variant => variant.name === name)) return name;
    }
}

function refreshLayoutVariants() {
    const select = document.getElementById('layoutVariants');
    if (select) {
        select.replaceChildren();
        layoutVariants.forEach(variant => {
            const option = document.createElement('option');
            option.value = variant.id;
            option.textContent = variant.name;
            select.appendChild(option);
        });
        select.value = selectedLayoutVariantId;
        select.disabled = isChangingLayoutVariant;
    }
    const readOnly = window.CURATOR_ROLE === 'viewer';
    const save = document.getElementById('btnSaveLayoutVariant');
    const remove = document.getElementById('btnDeleteLayoutVariant');
    if (save) save.disabled = readOnly || isChangingLayoutVariant;
    if (remove) remove.disabled = readOnly || isChangingLayoutVariant || layoutVariants.length < 2;
}

async function applyVariantLayout(variant, sharedState) {
    const state = {
        ...variant.layout,
        exhibitionTitle: sharedState.exhibitionTitle,
        scale: sharedState.scale,
        savedArtworkCatalog: sharedState.savedArtworkCatalog,
        layoutVariants,
        selectedLayoutVariantId
    };
    isUndoRedoOperation = true;
    await new Promise(resolve => applyStateData(JSON.stringify(state), resolve));
    isUndoRedoOperation = false;
    window.applyCuratorRoleRestrictions?.();
}

async function switchLayoutVariant(id) {
    const variant = layoutVariants.find(item => item.id === id);
    if (!variant || id === selectedLayoutVariantId || isTransitioning || isUndoRedoOperation || isChangingLayoutVariant) {
        refreshLayoutVariants();
        return;
    }
    isChangingLayoutVariant = true;
    refreshLayoutVariants();
    try {
        window.cancelDimensionDrawing?.();
        window.cancelLightingPlacement?.();
        window.flushPendingItemEditHistory?.();
        const sharedState = JSON.parse(getSerializedCanvasData());
        selectedLayoutVariantId = id;
        await applyVariantLayout(variant, sharedState);
        saveState();
    } finally {
        isUndoRedoOperation = false;
        isChangingLayoutVariant = false;
        refreshLayoutVariants();
    }
}

function canSaveLayoutVariant() {
    if (window.CURATOR_ROLE === 'viewer' || isTransitioning || isUndoRedoOperation || isChangingLayoutVariant) return false;
    if (cloudExhibitionConflict) {
        alert('最新の展覧会を読み込んでから配置案を保存してください。');
        return false;
    }
    if (!(document.getElementById('exhibitionTitle')?.value || '').trim()) {
        alert('展覧会タイトルを入力してください。');
        return false;
    }
    return true;
}

async function saveNewLayoutVariant() {
    if (!canSaveLayoutVariant()) return;
    const nameInput = document.getElementById('newLayoutVariantName');
    const name = (nameInput?.value || '').trim() || nextLayoutVariantName();
    if (layoutVariants.some(variant => variant.name === name)) {
        alert('同じ名前の配置案があります。別の名前を入力してください。');
        return;
    }
    isChangingLayoutVariant = true;
    refreshLayoutVariants();
    try {
        window.cancelDimensionDrawing?.();
        window.cancelLightingPlacement?.();
        window.flushPendingItemEditHistory?.();
        const state = JSON.parse(getSerializedCanvasData());
        const variant = { id: crypto.randomUUID(), name, layout: extractVariantLayout(state) };
        layoutVariants.push(variant);
        selectedLayoutVariantId = variant.id;
        if (nameInput) nameInput.value = '';
        saveState();
        await saveExhibitionSnapshot();
    } finally {
        isChangingLayoutVariant = false;
        refreshLayoutVariants();
    }
}

async function deleteLayoutVariant() {
    if (!canSaveLayoutVariant() || layoutVariants.length < 2) return;
    const current = layoutVariants.find(variant => variant.id === selectedLayoutVariantId);
    if (!confirm(`「${current.name}」を削除しますか？`)) return;
    isChangingLayoutVariant = true;
    refreshLayoutVariants();
    try {
        window.cancelDimensionDrawing?.();
        window.cancelLightingPlacement?.();
        window.flushPendingItemEditHistory?.();
        const sharedState = JSON.parse(getSerializedCanvasData());
        layoutVariants = layoutVariants.filter(variant => variant.id !== selectedLayoutVariantId);
        selectedLayoutVariantId = layoutVariants[0].id;
        await applyVariantLayout(layoutVariants[0], sharedState);
        saveState();
        await saveExhibitionSnapshot();
    } finally {
        isUndoRedoOperation = false;
        isChangingLayoutVariant = false;
        refreshLayoutVariants();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    refreshLayoutVariants();
    document.getElementById('layoutVariants')?.addEventListener('change', event => switchLayoutVariant(event.target.value));
    document.getElementById('btnSaveLayoutVariant')?.addEventListener('click', saveNewLayoutVariant);
    document.getElementById('btnDeleteLayoutVariant')?.addEventListener('click', deleteLayoutVariant);
});
