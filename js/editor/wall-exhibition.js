const wallExhibitionKinds = { profile: '人物紹介', timeline: '年表', other: 'その他' };

function currentExhibitionWall() {
    return currentViewMode === 'wall' ? wallPlanJsonData[selectedWallInfo.id] : null;
}

function renderWallExhibition() {
    const exhibition = currentExhibitionWall()?.wallExhibition;
    const objects = canvas.getObjects();
    const previous = objects.filter(object => object.isWallExhibitionPreview);
    const outline = objects.find(object => object.isWallOutline);
    if (!previous.length && !(exhibition && outline)) return;

    window.beginVenueWallRender();
    try {
        if (previous.length) canvas.remove(...previous);
        if (!exhibition || !outline) return;
        const width = outline.width * Math.abs(outline.scaleX);
        const height = outline.height * Math.abs(outline.scaleY);
        if (!(width > 0 && height > 0)) return;
        const left = outline.left;
        const top = outline.top;
        const padding = Math.min(width, height) * .075;
        const textWidth = width - padding * 2;
        const titleY = top + height * .20;
        const bodyY = top + height * .42;
        const common = {
            originX: 'left', originY: 'top', selectable: false, evented: false,
            excludeFromExport: true, isWallExhibitionPreview: true
        };
        // The preview is derived from the wall and is never saved as a movable object.
        const elements = [new fabric.Rect({ ...common, left, top, width, height, fill: '#e5dfd2', strokeWidth: 0 })];
        const addText = (text, y, limit, fontSize, fontWeight) => {
            if (!text) return;
            elements.push(new fabric.Textbox(text, {
                ...common, left: left + padding, top: y, width: textWidth, fontSize, fontWeight,
                fontFamily: 'sans-serif', fill: '#293135', splitByGrapheme: true,
                clipPath: new fabric.Rect({ left: left + padding, top: y, width: textWidth,
                    height: limit - y, absolutePositioned: true, strokeWidth: 0 })
            }));
        };
        addText(wallExhibitionKinds[exhibition.kind] || '壁面全体', top + padding, titleY, Math.min(width * .038, height * .055), 'normal');
        addText(exhibition.title, titleY, bodyY, Math.min(width * .07, height * .095), '600');
        addText(exhibition.description?.slice(0, 800), bodyY, top + height - padding,
            Math.min(width * .034, height * .052), 'normal');
        const index = canvas.getObjects().indexOf(outline) + 1;
        elements.forEach((object, i) => canvas.insertAt(object, index + i, false));
    } finally {
        window.endVenueWallRender();
        canvas.requestRenderAll();
    }
}

function clearWallExhibition() {
    const wall = currentExhibitionWall();
    if (!wall?.wallExhibition) return;
    delete wall.wallExhibition;
    renderWallExhibition();
    window.refreshWallExhibitionUi?.();
}

function initializeWallExhibitionUi() {
    const $ = id => document.getElementById(id);
    const mode = $('displayType');
    const kind = $('wallExhibitionKind');
    const title = $('wallExhibitionTitle');
    const description = $('wallExhibitionDescription');
    const remove = $('btnRemoveWallExhibition');
    const add = $('addArtwork');
    let displayedWallId = null;
    let displayedExhibition = null;

    function refresh() {
        const enabled = mode.value === 'wall-exhibition';
        $('artworkObjectFields').hidden = enabled;
        $('wallExhibitionFields').hidden = !enabled;
        if (!enabled) {
            displayedWallId = null;
            add.textContent = '展示物を追加';
            return;
        }
        const wall = currentExhibitionWall();
        const wallId = wall ? selectedWallInfo.id : '';
        const exhibition = wall?.wallExhibition;
        if (displayedWallId !== wallId || displayedExhibition !== exhibition) {
            kind.value = Object.hasOwn(wallExhibitionKinds, exhibition?.kind) ? exhibition.kind : 'profile';
            title.value = exhibition?.title || '';
            description.value = exhibition?.description || '';
            displayedWallId = wallId;
            displayedExhibition = exhibition;
        }
        $('wallExhibitionTarget').textContent = wall ? wall.title : '壁面図に切り替え、展示に使う壁を選んでください。';
        remove.hidden = !exhibition;
        add.textContent = exhibition ? '壁面展示を更新' : '壁面展示を登録';
    }

    window.refreshWallExhibitionUi = refresh;
    mode.addEventListener('change', refresh);
    remove.addEventListener('click', () => {
        if (window.CURATOR_ROLE === 'viewer' || isTransitioning || isUndoRedoOperation || window.isCombinedPdfBusy ||
            !currentExhibitionWall()?.wallExhibition || !confirm('この壁面全体の展示を解除しますか？')) return;
        clearWallExhibition();
        saveState();
    });
    refresh();
    return () => {
        if (isUndoRedoOperation || window.isCombinedPdfBusy || !window.isDiagramReady?.()) return;
        const wall = currentExhibitionWall();
        if (!wall) {
            alert('壁面図に切り替え、展示に使う壁を選んでください。');
            return;
        }
        const heading = title.value.trim();
        if (!heading) {
            title.focus();
            return alert('壁面展示の見出しを入力してください。');
        }
        wall.wallExhibition = { kind: kind.value, title: heading, description: description.value.trim() };
        renderWallExhibition();
        refresh();
        saveState();
    };
}
