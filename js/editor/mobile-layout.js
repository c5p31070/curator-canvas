// スマホ・タブレットで操作欄を開閉し、縦横の画面レイアウトに合わせて表示を切り替えます。
// Panel visibility is a screen preference, independent of saved exhibition data.
document.addEventListener('DOMContentLoaded', () => {
    const responsive = matchMedia('(max-width: 760px), (max-width: 1400px) and (any-pointer: coarse)');
    const drawer = matchMedia('(max-width: 600px) and (orientation: portrait)');
    const panel = document.getElementById('operationPanel');
    const toggle = document.getElementById('btnToggleOperationPanel');
    const close = document.getElementById('btnCloseOperationPanel');
    const backdrop = document.getElementById('operationPanelBackdrop');
    const workspace = document.querySelector('.canvas-container-wrapper');
    let expanded = !drawer.matches;
    let returnFocus = null;

    const render = () => {
        const open = !responsive.matches || expanded;
        document.body.classList.toggle('operation-panel-collapsed', !open);
        toggle.setAttribute('aria-expanded', String(open));
        backdrop.hidden = !drawer.matches || !open;
        workspace.inert = drawer.matches && open;
        if (!open && panel.contains(document.activeElement)) toggle.focus({ preventScroll: true });
    };
    const dismiss = () => {
        expanded = false;
        render();
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
    toggle.addEventListener('click', () => {
        returnFocus = toggle;
        expanded = !expanded;
        render();
        if (drawer.matches && expanded) close.focus({ preventScroll: true });
    });
    close.addEventListener('click', dismiss);
    backdrop.addEventListener('click', dismiss);
    document.querySelector('.tool-palette').addEventListener('click', event => {
        const tool = event.target.closest('[data-tool]');
        if (!responsive.matches || !tool || tool.disabled) return;
        returnFocus = tool;
        expanded = Boolean(document.querySelector('[data-tool-panel].is-open:not([hidden])'));
        render();
        if (drawer.matches && expanded) close.focus({ preventScroll: true });
    });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !drawer.matches || !expanded || document.querySelector('dialog[open]')) return;
        event.preventDefault();
        event.stopPropagation();
        dismiss();
    }, true);
    const changeLayout = () => {
        expanded = !drawer.matches;
        render();
    };
    responsive.addEventListener('change', changeLayout);
    drawer.addEventListener('change', changeLayout);
    render();
});
