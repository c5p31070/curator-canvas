// 固定壁タブの1秒長押しによる並べ替えと、端末ごとの表示順の保存を管理します。
(() => {
    const storageKey = () => 'curator_canvas_fixed_wall_tab_order_' + JSON.stringify([
        window.CURATOR_TEAM?.id || 'local', window.CURATOR_USER?.id || 'local', activeVenueId, selectedFloorId
    ]);
    window.getFixedWallTabOrder = () => {
        try {
            const saved = JSON.parse(editorStorage.getItem(storageKey()) || '[]');
            return Array.isArray(saved) ? [...new Set(saved.filter(id => typeof id === 'string'))] : [];
        } catch { return []; }
    };

    document.addEventListener('DOMContentLoaded', () => {
        const list = document.getElementById('wallTabList');
        if (!list) return;
        let gesture = null;
        let suppressClickUntil = 0;
        const tabs = () => [...list.querySelectorAll('[data-wall-group^="fixed:"]')];
        const blocked = () => isTransitioning || isUndoRedoOperation || window.isCombinedPdfBusy || window.isLayoutVariantBusy?.();
        const finish = (save = false) => {
            const state = gesture;
            if (!state) return;
            gesture = null;
            clearTimeout(state.timer);
            if (state.frame) cancelAnimationFrame(state.frame);
            if (state.dragging) {
                suppressClickUntil = performance.now() + 450;
                if (save && state.key === storageKey() && state.button.parentElement === list) {
                    try {
                        editorStorage.setItem(state.key, JSON.stringify(tabs().map(tab => tab.dataset.wallGroup.slice(6))));
                    } catch (error) { console.warn('固定壁タブの表示順を保存できませんでした。', error); }
                } else {
                    state.original.forEach(tab => { if (tab.parentElement === list) list.append(tab); });
                }
            } else if (state.scrolling) suppressClickUntil = performance.now() + 450;
            state.button.classList.remove('is-reordering');
            list.classList.remove('is-reordering');
            if (state.button.hasPointerCapture?.(state.pointerId)) state.button.releasePointerCapture(state.pointerId);
        };
        window.cancelFixedWallTabReorder = () => finish(false);

        const place = () => {
            const state = gesture;
            if (!state?.dragging) return;
            const bounds = list.getBoundingClientRect();
            const others = tabs().filter(tab => tab !== state.button);
            const before = others.find(tab => {
                const rect = tab.getBoundingClientRect();
                return state.x < rect.left + rect.width / 2;
            });
            if (before) list.insertBefore(state.button, before);
            else list.append(state.button);
            if (state.x < bounds.left + 24) list.scrollLeft -= 8;
            else if (state.x > bounds.right - 24) list.scrollLeft += 8;
        };
        const animate = () => {
            if (!gesture?.dragging) return;
            if (blocked() || gesture.key !== storageKey() || gesture.button.parentElement !== list) { finish(false); return; }
            place();
            gesture.frame = requestAnimationFrame(animate);
        };

        list.addEventListener('pointerdown', event => {
            const button = event.target.closest('[data-wall-group^="fixed:"]');
            if (!button || event.button !== 0 || !event.isPrimary || blocked()) return;
            finish(false);
            const state = gesture = {
                button, pointerId: event.pointerId, pointerType: event.pointerType,
                x: event.clientX, startX: event.clientX, startY: event.clientY,
                scroll: list.scrollLeft, key: storageKey(), original: tabs(), dragging: false, scrolling: false
            };
            state.timer = setTimeout(() => {
                if (gesture !== state || state.scrolling || blocked() || state.key !== storageKey() || button.parentElement !== list) return;
                state.dragging = true;
                button.setPointerCapture?.(state.pointerId);
                button.classList.add('is-reordering');
                list.classList.add('is-reordering');
                animate();
            }, 1000);
        });
        document.addEventListener('pointermove', event => {
            const state = gesture;
            if (!state || event.pointerId !== state.pointerId) return;
            state.x = event.clientX;
            if (state.dragging) {
                if (event.cancelable) event.preventDefault();
                place();
            } else if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > 8) {
                clearTimeout(state.timer);
                if (state.pointerType === 'touch') {
                    state.scrolling = true;
                    list.scrollLeft = state.scroll - (event.clientX - state.startX);
                } else finish(false);
            }
        }, { passive: false });
        document.addEventListener('pointerup', event => {
            if (gesture?.pointerId === event.pointerId) finish(true);
        });
        document.addEventListener('pointercancel', event => {
            if (gesture?.pointerId === event.pointerId) finish(false);
        });
        list.addEventListener('lostpointercapture', event => {
            if (gesture?.pointerId === event.pointerId) finish(false);
        });
        list.addEventListener('click', event => {
            if (event.target.closest('[data-wall-group^="fixed:"]') && performance.now() < suppressClickUntil) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        }, true);
        list.addEventListener('contextmenu', event => {
            if (event.target.closest('[data-wall-group^="fixed:"]')) event.preventDefault();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && gesture) { finish(false); event.preventDefault(); }
        });
        window.addEventListener('blur', () => finish(false));
    });
})();
