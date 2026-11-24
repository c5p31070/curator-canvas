// Camera navigation changes only the preview, leaving exhibition data untouched.
(() => {
    const actions = {
        KeyW: 'forward', ArrowUp: 'forward', KeyS: 'backward', ArrowDown: 'backward',
        KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
        'pad-forward': 'forward', 'pad-backward': 'backward', 'pad-left': 'left', 'pad-right': 'right'
    };
    const pressed = new Set();
    let scene = null;
    let position = null;
    let yaw = 0;
    let pitch = 0;
    let frame = null;
    let lastTime = 0;
    let drag = null;

    function requestFrame() {
        if (frame !== null || !scene) return;
        lastTime = performance.now();
        frame = requestAnimationFrame(animate);
    }

    function animate(time) {
        frame = null;
        if (!scene || !document.getElementById('perspectiveDialog').open) return;
        const elapsed = Math.min(.05, Math.max(0, (time - lastTime) / 1000));
        lastTime = time;
        const active = new Set([...pressed].map(key => actions[key]));
        const forward = Number(active.has('forward')) - Number(active.has('backward'));
        const sideways = Number(active.has('right')) - Number(active.has('left'));
        const length = Math.hypot(forward, sideways);
        if (length > 0) {
            const distance = 270 * elapsed / length;
            position.x = Math.max(0, Math.min(scene.bounds.width,
                position.x + (Math.cos(yaw) * forward - Math.sin(yaw) * sideways) * distance));
            position.z = Math.max(0, Math.min(scene.bounds.depth,
                position.z + (Math.sin(yaw) * forward + Math.cos(yaw) * sideways) * distance));
        }
        scene.render(position, { x: Math.cos(yaw), z: Math.sin(yaw) }, pitch);
        if (pressed.size) frame = requestAnimationFrame(animate);
    }

    function stopInput() {
        pressed.clear();
        drag = null;
        document.getElementById('perspectiveCanvas')?.classList.remove('is-looking');
        document.querySelectorAll('[data-perspective-move]').forEach(button => button.classList.remove('is-moving'));
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
    }

    window.startPerspectiveNavigation = next => {
        stopInput();
        scene = next;
        position = { ...next.start };
        yaw = Math.atan2(next.direction.z, next.direction.x);
        pitch = 0;
        document.getElementById('perspectiveCanvas').focus({ preventScroll: true });
    };

    document.addEventListener('DOMContentLoaded', () => {
        const dialog = document.getElementById('perspectiveDialog');
        const surface = document.getElementById('perspectiveCanvas');
        dialog.addEventListener('keydown', event => {
            // Keep editor shortcuts from modifying the underlying plan.
            event.stopPropagation();
            if (!scene || event.ctrlKey || event.metaKey || event.altKey ||
                event.target.closest('input, textarea, select, [contenteditable="true"]') || !actions[event.code]) return;
            event.preventDefault();
            pressed.add(event.code);
            requestFrame();
        });
        dialog.addEventListener('keyup', event => {
            event.stopPropagation();
            if (!actions[event.code]) return;
            event.preventDefault();
            pressed.delete(event.code);
        });
        surface.addEventListener('pointerdown', event => {
            if (!scene || drag || (event.button !== undefined && event.button !== 0)) return;
            event.preventDefault();
            surface.focus({ preventScroll: true });
            surface.setPointerCapture(event.pointerId);
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
            surface.classList.add('is-looking');
        });
        surface.addEventListener('pointermove', event => {
            if (!scene || drag?.id !== event.pointerId) return;
            const bounds = surface.getBoundingClientRect();
            yaw += (event.clientX - drag.x) / Math.max(1, bounds.width) * Math.PI;
            pitch = Math.max(-Math.PI / 2 + .1, Math.min(Math.PI / 2 - .1,
                pitch - (event.clientY - drag.y) / Math.max(1, bounds.height) * Math.PI));
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
            requestFrame();
        });
        const endLook = event => {
            if (drag?.id !== event.pointerId) return;
            drag = null;
            surface.classList.remove('is-looking');
        };
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => surface.addEventListener(type, endLook));
        document.querySelectorAll('[data-perspective-move]').forEach(button => {
            const key = `pad-${button.dataset.perspectiveMove}`;
            button.addEventListener('pointerdown', event => {
                if (!scene || (event.button !== undefined && event.button !== 0)) return;
                event.preventDefault();
                button.setPointerCapture(event.pointerId);
                pressed.add(key);
                button.classList.add('is-moving');
                requestFrame();
            });
            const release = () => {
                pressed.delete(key);
                button.classList.remove('is-moving');
            };
            ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => button.addEventListener(type, release));
        });
        document.getElementById('btnResetPerspectiveView').addEventListener('click', () => {
            if (!scene) return;
            window.startPerspectiveNavigation(scene);
            requestFrame();
        });
        dialog.addEventListener('close', () => { stopInput(); scene = null; });
        window.addEventListener('blur', stopInput);
        document.addEventListener('visibilitychange', () => { if (document.hidden) stopInput(); });
    });
})();
