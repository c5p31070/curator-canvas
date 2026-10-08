function initializeToolPalette() {
    initializeUiTooltips();
    const palette = document.querySelector('.tool-palette');
    if (!palette) return;

    const panels = [...document.querySelectorAll('[data-tool-panel]')];
    const buttons = [...palette.querySelectorAll('[data-tool]')];

    const activate = (tool, toggle = false) => {
        const targets = panels.filter(panel => panel.dataset.toolPanel === tool);
        const alreadyOpen = targets.length > 0 && targets.every(panel => panel.classList.contains('is-open'));
        panels.forEach(panel => panel.classList.remove('is-open'));

        if (toggle && alreadyOpen) {
            buttons.forEach(button => {
                button.classList.remove('active');
                button.setAttribute('aria-pressed', 'false');
            });
            return;
        }

        targets.forEach(panel => panel.classList.add('is-open'));
        buttons.forEach(button => {
            const selected = button.dataset.tool === tool;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });

        if (tool === 'setup' && !isAdminMode) {
            document.getElementById('btnToggleAdminMode')?.click();
        }
    };

    palette.addEventListener('click', event => {
        const button = event.target.closest('.tool-icon');
        if (!button) return;

        if (button.dataset.tool) {
            activate(button.dataset.tool, true);
            return;
        }

        const actions = {
            floor: () => switchViewMode('floor'),
            wall: () => switchViewMode('wall'),
            rotate: rotateActiveObject,
            undo,
            redo
        };
        actions[button.dataset.action]?.();
    });

    activate('walls');
    updateViewModeToolState(currentViewMode);
}

function updateViewModeToolState(mode = currentViewMode) {
    document.querySelectorAll('[data-action="floor"], [data-action="wall"]').forEach(button => {
        const active = button.dataset.action === mode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
}

document.addEventListener('DOMContentLoaded', initializeToolPalette);

function initializeUiTooltips() {
    const tooltip = document.createElement('div');
    tooltip.className = 'ui-help-tooltip';
    tooltip.id = 'uiHelpTooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    document.body.appendChild(tooltip);

    let pendingShow = null;
    let activeTarget = null;

    const hide = () => {
        clearTimeout(pendingShow);
        pendingShow = null;
        if (activeTarget) activeTarget.removeAttribute('aria-describedby');
        activeTarget = null;
        tooltip.hidden = true;
    };

    const place = target => {
        tooltip.textContent = target.dataset.tooltip;
        tooltip.hidden = false;
        const rect = target.getBoundingClientRect();
        const tipRect = tooltip.getBoundingClientRect();
        const left = Math.max(8, Math.min(
            rect.left + (rect.width - tipRect.width) / 2,
            window.innerWidth - tipRect.width - 8
        ));
        const below = rect.bottom + 7;
        const top = below + tipRect.height <= window.innerHeight - 8
            ? below
            : Math.max(8, rect.top - tipRect.height - 7);
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        target.setAttribute('aria-describedby', tooltip.id);
        activeTarget = target;
    };

    const schedule = target => {
        if (!target?.dataset.tooltip) return hide();
        if (target === activeTarget) return;
        hide();
        pendingShow = setTimeout(() => place(target), 550);
    };

    document.addEventListener('pointerover', event => {
        if (event.pointerType && event.pointerType !== 'mouse') return;
        const target = event.target.closest?.('[data-tooltip]');
        if (target?.contains(event.relatedTarget)) return;
        schedule(target);
    });
    document.addEventListener('pointerout', event => {
        const target = event.target.closest?.('[data-tooltip]');
        if (!target || target.contains(event.relatedTarget)) return;
        if (target === activeTarget) hide();
        else if (pendingShow) {
            clearTimeout(pendingShow);
            pendingShow = null;
        }
    });
    document.addEventListener('focusin', event => schedule(event.target.closest?.('[data-tooltip]')));
    document.addEventListener('focusout', event => {
        const target = event.target.closest?.('[data-tooltip]');
        if (target === activeTarget && !target.contains(event.relatedTarget)) hide();
        else if (pendingShow) {
            clearTimeout(pendingShow);
            pendingShow = null;
        }
    });
}
