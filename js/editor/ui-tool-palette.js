function initializeToolPalette() {
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
            rotate: rotateActiveObject,
            undo,
            redo,
            pdf: () => document.getElementById('tabPdfExport')?.click()
        };
        actions[button.dataset.action]?.();
    });

    activate('walls');
}

document.addEventListener('DOMContentLoaded', initializeToolPalette);
