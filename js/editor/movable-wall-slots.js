// Venue presets mark the center and angle of a wall on a single floor plan.
(() => {
    const $ = id => document.getElementById(id);
    const canManage = () => isAdminMode && window.CURATOR_ROLE !== 'viewer' && !window.CURATOR_GUEST?.active;
    const slots = () => window.getVenueMovableWallSlots?.(selectedFloorId) || {};
    const svgNs = 'http://www.w3.org/2000/svg';
    let overlay, picker, frame = null, saving = false;
    let signature = '';
    let currentSlots = {};
    const visibilityKey = 'curator_canvas_movable_slot_visible';
    let visible = true;
    try { visible = editorStorage.getItem(visibilityKey) !== 'false'; } catch {}
    const status = message => { $('movableWallSlotStatus').textContent = message; };

    window.getChosenMovableWallSlot = () => {
        const id = $('movableWallSlot').value;
        const slot = slots()[id];
        return slot ? { ...slot, id } : null;
    };
    window.isMovableWallSlotOccupied = (id, except) => canvas.getObjects().some(object =>
        object !== except && object.isMovableWall && object.movableWallSlotId === id);

    window.refreshMovableWallSlots = () => {
        const choose = $('movableWallSlot'), manage = $('venueMovableWallSlot');
        if (!choose || !manage) return;
        currentSlots = slots();
        const active = canvas.getActiveObject();
        const previous = choose.dataset.floor === selectedFloorId ? choose.value : '';
        choose.dataset.floor = selectedFloorId;
        const managed = manage.value;
        choose.replaceChildren(new Option(isPublicFloor(selectedFloorId) ? '固定位置を選択' : '自由配置', ''));
        manage.replaceChildren(new Option('固定位置を選択', ''));
        const ordered = Object.entries(currentSlots).sort(([, a], [, b]) =>
            a.title.localeCompare(b.title, 'ja', { numeric: true }));
        for (const [id, slot] of ordered) {
            const occupied = currentViewMode === 'floor' && window.isMovableWallSlotOccupied(id, active);
            const option = new Option(slot.title + (occupied ? '（設置済み）' : ''), id);
            option.disabled = occupied;
            choose.add(option);
            manage.add(new Option(slot.title, id));
        }
        if (currentSlots[previous]) choose.value = previous;
        if (currentSlots[managed]) manage.value = managed;
        updateButtons();
        updateAngle();
    };
    window.selectMovableWallSlot = id => {
        window.refreshMovableWallSlots();
        $('movableWallSlot').value = currentSlots[id] ? id : '';
        updateAngle();
    };

    function updateAngle() {
        const angle = $('movableWallAngle');
        const slot = currentSlots[$('movableWallSlot').value];
        if (slot) angle.value = Number(slot.angle.toFixed(2));
        angle.readOnly = Boolean(slot);
        scheduleGuide();
    }
    function updateButtons() {
        $('btnRegisterMovableWallSlot').disabled = !canManage() || saving;
        const unavailable = !canManage() || saving || !$('venueMovableWallSlot').value;
        $('btnMoveMovableWallSlot').disabled = unavailable;
        $('btnDeleteMovableWallSlot').disabled = unavailable;
    }
    function scheduleGuide() {
        if (frame === null) frame = requestAnimationFrame(renderGuide);
    }
    window.refreshMovableWallSlotGuide = scheduleGuide;
    function renderGuide() {
        frame = null;
        if (!overlay) return;
        const managing = canManage() && document.getElementById('adminSettingsPanel')?.classList.contains('is-open');
        const placing = document.querySelector('[data-tool-panel="movable-walls"].is-open');
        overlay.hidden = !visible || currentViewMode !== 'floor' || isTransitioning || !window.isDiagramReady?.()
            || (!managing && !placing) || !Object.keys(currentSlots).length;
        if (overlay.hidden) return;
        const selected = $(managing ? 'venueMovableWallSlot' : 'movableWallSlot').value;
        const w = canvas.getWidth(), h = canvas.getHeight();
        const zoom = canvas.lowerCanvasEl.getBoundingClientRect().width / w || 1;
        const key = JSON.stringify([currentSlots, selected, w, h, zoom]);
        if (signature === key) return;
        signature = key;
        const create = (tag, attrs) => {
            const node = document.createElementNS(svgNs, tag);
            Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, value));
            return node;
        };
        const svg = create('svg', { viewBox: '0 0 ' + w + ' ' + h, preserveAspectRatio: 'none' });
        for (const [id, slot] of Object.entries(currentSlots)) {
            const group = create('g', { class: id === selected ? 'movable-slot-mark active' : 'movable-slot-mark' });
            const radians = slot.angle * Math.PI / 180;
            const dx = Math.cos(radians) * 9 / zoom, dy = Math.sin(radians) * 9 / zoom;
            group.append(create('line', { x1: slot.x - dx, y1: slot.y - dy, x2: slot.x + dx, y2: slot.y + dy,
                'vector-effect': 'non-scaling-stroke' }));
            group.append(create('circle', { cx: slot.x, cy: slot.y, r: 3 / zoom, 'vector-effect': 'non-scaling-stroke' }));
            const label = create('text', { x: slot.x, y: slot.y - 10 / zoom, 'font-size': 11 / zoom,
                'stroke-width': 3 / zoom, 'text-anchor': 'middle' });
            label.textContent = slot.title;
            group.append(label);
            svg.append(group);
        }
        overlay.replaceChildren(svg);
    }

    window.cancelMovableWallSlotPick = () => {
        if (!picker) return;
        picker.remove();
        picker = null;
        status('');
    };
    async function saveSlot(id, slot, floorId, moveOnly = false) {
        saving = true;
        updateButtons();
        try {
            const saved = await window.saveVenueMovableWallSlot?.(id, slot, floorId, moveOnly);
            window.refreshMovableWallSlots();
            if (saved && slot && floorId === selectedFloorId) $('venueMovableWallSlot').value = id;
            status(saved ? (moveOnly ? '固定位置を移動しました。配置済みの壁を合わせるには「選択壁を更新」を押してください。'
                : slot ? '固定位置を登録しました。' : '登録を解除しました。配置済みの壁は残っています。')
                : '固定位置を保存できませんでした。会場設定と通信状態を確認してください。');
        } finally {
            saving = false;
            updateButtons();
            scheduleGuide();
        }
    }
    async function beginPick(moveId = '') {
        if (!canManage() || saving || isTransitioning || isUndoRedoOperation || window.isCombinedPdfBusy) return;
        if (picker) return window.cancelMovableWallSlotPick();
        if (!requireVenueScale()) return;
        window.cancelPerspectivePick?.();
        window.cancelDimensionDrawing?.();
        window.cancelLightingPlacement?.();
        if (currentViewMode !== 'floor' && !await switchViewMode('floor')) return;
        if (!window.isDiagramReady?.() || !canManage()) return;
        const floorId = selectedFloorId;
        const moving = moveId ? slots()[moveId] : null;
        if (moveId && !moving) return;
        const axisAligned = $('movableWallSlotAngleMode').value === 'axis';
        picker = document.createElement('div');
        picker.className = 'perspective-picker';
        canvas.wrapperEl.append(picker);
        status(moving ? '「' + moving.title + '」の新しい中心をクリックしてください。' : '平面図で壁の一端をクリックしてください。');
        let start = null;
        picker.addEventListener('pointerdown', event => {
            if (event.button !== 0 || !event.isPrimary || floorId !== selectedFloorId || !canManage()) return;
            event.preventDefault();
            const rect = picker.getBoundingClientRect();
            const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
            const point = { x: x * canvas.getWidth(), y: y * canvas.getHeight() };
            if (moving) {
                window.cancelMovableWallSlotPick();
                saveSlot(moveId, point, floorId, true);
                return;
            }
            if (!start) {
                start = point;
                const mark = document.createElement('span');
                mark.style.left = x * 100 + '%';
                mark.style.top = y * 100 + '%';
                picker.append(mark);
                status(axisAligned
                    ? '壁のもう一端をクリックしてください。水平・垂直のうち近い方向に揃えます。'
                    : '壁のもう一端をクリックしてください。指定した順に壁の向きが決まります。');
                return;
            }
            let dx = point.x - start.x, dy = point.y - start.y;
            if (axisAligned) {
                if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
                else dx = 0;
            }
            if (Math.hypot(dx, dy) < 2) return;
            window.cancelMovableWallSlotPick();
            saveSlot('slot_' + crypto.randomUUID(), { floorId, x: start.x + dx / 2,
                y: start.y + dy / 2, angle: Math.atan2(dy, dx) * 180 / Math.PI }, floorId);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        overlay = document.createElement('div');
        overlay.className = 'movable-slot-guide';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.hidden = true;
        canvas.wrapperEl.append(overlay);
        const toggles = document.querySelectorAll('[data-movable-slot-visibility]');
        toggles.forEach(input => {
            input.checked = visible;
            input.addEventListener('change', () => {
                visible = input.checked;
                toggles.forEach(toggle => { toggle.checked = visible; });
                try { editorStorage.setItem(visibilityKey, String(visible)); } catch {}
                scheduleGuide();
            });
        });
        $('movableWallSlot').addEventListener('change', updateAngle);
        $('movableWallSlotAngleMode').addEventListener('change', window.cancelMovableWallSlotPick);
        $('venueMovableWallSlot').addEventListener('change', () => {
            window.cancelMovableWallSlotPick();
            updateButtons();
            scheduleGuide();
        });
        $('btnRegisterMovableWallSlot').addEventListener('click', () => beginPick());
        $('btnMoveMovableWallSlot').addEventListener('click', () => {
            const id = $('venueMovableWallSlot').value;
            if (id) beginPick(id);
        });
        $('btnDeleteMovableWallSlot').addEventListener('click', () => {
            const id = $('venueMovableWallSlot').value, slot = slots()[id];
            if (!canManage() || saving || !slot || !confirm('「' + slot.title + '」の登録を解除しますか？ 配置済みの壁は残ります。')) return;
            window.cancelMovableWallSlotPick();
            saveSlot(id, null, selectedFloorId);
        });
        window.refreshMovableWallSlots();
    });
    canvas.on('after:render', scheduleGuide);
    window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && picker) { window.cancelMovableWallSlotPick(); event.preventDefault(); }
    });
})();
