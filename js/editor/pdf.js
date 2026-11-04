// ----------------------------------------------------
// 📄 平面＋全壁面をまとめたマルチページPDF生成機能
// ----------------------------------------------------

function pdfImageDimensions(widthPx, heightPx, maxWidthMm = 165, maxHeightMm = 210) {
    if (![widthPx, heightPx, maxWidthMm, maxHeightMm].every(value => Number.isFinite(value) && value > 0)) {
        throw new Error('図面の出力寸法を計算できません。');
    }
    const mmPerPixel = Math.min(maxWidthMm / widthPx, maxHeightMm / heightPx);
    return { imageWidthMm: widthPx * mmPerPixel, imageHeightMm: heightPx * mmPerPixel };
}

function pdfWallCaptureBounds() {
    const objects = canvas.getObjects().filter(object => object.visible !== false && !object.excludeFromExport);
    const bounds = objects.map(object => object.getBoundingRect(true, true));
    if (!bounds.length) throw new Error('壁面図が空のため出力できません。');
    const padding = 8;
    const left = Math.max(0, Math.floor(Math.min(...bounds.map(rect => rect.left)) - padding));
    const top = Math.max(0, Math.floor(Math.min(...bounds.map(rect => rect.top)) - padding));
    const right = Math.min(canvas.getWidth(), Math.ceil(Math.max(...bounds.map(rect => rect.left + rect.width)) + padding));
    const bottom = Math.min(canvas.getHeight(), Math.ceil(Math.max(...bounds.map(rect => rect.top + rect.height)) + padding));
    return { left, top, width: right - left, height: bottom - top };
}

function createPdfScaleMarkup(scalePxPerCm, imageWidthMm, sourceWidthPx) {

    const appScale = Number(scalePxPerCm);
    if (![appScale, imageWidthMm, sourceWidthPx].every(value => Number.isFinite(value) && value > 0)) {
        throw new Error('縮尺の根拠となる実寸・画像寸法を確認してください。');
    }

    const canvasWidth = sourceWidthPx;
    const targetWidthMm = 18;
    const rawLengthCm =
        (targetWidthMm * canvasWidth) /
        (appScale * imageWidthMm);

    const exponent = Math.floor(Math.log10(rawLengthCm));
    const candidates = [];

    for (let power = exponent - 1; power <= exponent + 1; power++) {
        [1, 2, 5].forEach(multiplier => {
            candidates.push(multiplier * (10 ** power));
        });
    }

    const lengthCm = candidates
        .filter(value => value * appScale * imageWidthMm / canvasWidth <= 22)
        .sort((a, b) => {
            const widthA = a * appScale * imageWidthMm / canvasWidth;
            const widthB = b * appScale * imageWidthMm / canvasWidth;
            return Math.abs(widthA - targetWidthMm) - Math.abs(widthB - targetWidthMm);
        })[0] || rawLengthCm;

    const barWidthMm = lengthCm * appScale * imageWidthMm / canvasWidth;
    const denominator = 10 * canvasWidth / (appScale * imageWidthMm);
    const ratio = Number(denominator.toPrecision(5));
    const approximate = Math.abs(ratio - denominator) > denominator * 1e-9;
    const label = `${cmToMm(lengthCm)} mm`;

    return `
        <div class="pdf-scale" aria-label="縮尺 ${label}">
            <span class="pdf-scale-caption">縮尺</span>
            <span class="pdf-scale-label" title="印刷倍率100%時">${approximate ? '約 ' : ''}1:${ratio}</span>
            <div class="pdf-scale-rule" style="height:${barWidthMm.toFixed(6)}mm">
                <i></i><i></i>
            </div>
            <span class="pdf-scale-label">${label}</span>
        </div>
    `;
}

async function generateCombinedPdf() {
    if (window.isCombinedPdfBusy) return;
    // Confirm the common scale before taking any drawing captures.
    if (window.refreshTeamFloorScale && !await window.refreshTeamFloorScale()) return;
    if (!(Number(configuredScale) > 0)) {
        alert('正確な縮尺で出力するため、管理者モードで平面図の縮尺を設定してください。');
        return;
    }
    if (isTransitioning || !window.isDiagramReady?.()) return;
    const initial = { floor: selectedFloorId, mode: currentViewMode, wall: { ...selectedWallInfo } };
    window.isCombinedPdfBusy = true;
    try { return await renderCombinedPdf(); }
    catch (error) {
        console.error('PDF出力に失敗しました。', error);
        alert(`PDF出力を中止しました。${error.message}`);
    } finally {
        try {
            if (selectedFloorId !== initial.floor || currentViewMode !== initial.mode || (initial.mode === 'wall' && selectedWallInfo.id !== initial.wall.id)) {
                await handleFloorSelectChange(initial.floor, true);
                selectedWallInfo = initial.wall;
                await switchViewMode(initial.mode, true, null, true);
            }
        } finally { window.isCombinedPdfBusy = false; }
    }
}

async function renderCombinedPdf() {

    const titleInput =
        document.getElementById("exhibitionTitle");

    const currentTitle =
        (
            titleInput &&
            titleInput.value.trim()
        )
            ? titleInput.value.trim()
            : "展示配置指示書";


    const memoEl =
        document.getElementById("pdfMemo");

    const memoText =
        memoEl
            ? memoEl.value
            : "特記事項なし";


    const initialMode =
        currentViewMode;
    const initialFloor = selectedFloorId;

    const initialWall =
        { ...selectedWallInfo };

    const drawingScale = Number(configuredScale);


    // ====================================================
    // 1. 平面図の画像を取得
    // ====================================================

    await switchViewMode(
        'floor',
        true
    );

    await new Promise(
        r => setTimeout(r, 200)
    );


    const floorCaptureList = [];
    const floorObjects = [];
    for (const [id, floor] of Object.entries(FLOOR_PLANS)) {
        await handleFloorSelectChange(id, true);
        if (!window.isDiagramReady?.() || selectedFloorId !== id || currentViewMode !== 'floor') throw new Error(`${floor.title}を読み込めませんでした。`);
        floorCaptureList.push({
            floorId: id,
            title: floor.title,
            imgUrl: canvas.toDataURL({ format: 'png', quality: 1.0, enableRetinaScaling: false }),
            sourceWidthPx: canvas.getWidth(),
            sourceHeightPx: canvas.getHeight(),
            scale: drawingScale
        });
        floorObjects.push(...canvas.getObjects().map(obj => ({ obj, floorTitle: floor.title })));
    }


    const artworkList = [];

    const pinList = [];


    // ====================================================
    // 平面図上のオブジェクトを分類
    // ====================================================

    floorObjects.forEach(
        ({ obj, floorTitle }, index) => {


            // ------------------------------------------------
            // 展示作品
            // ------------------------------------------------

            if (obj.isArtwork) {

                const textObj =
                    obj.item
                        ? obj.item(1)
                        : null;


                const name =
                    textObj
                        ? `${obj.isFixture ? '' : `No.${obj.artworkNumber} `}${obj.artworkName || textObj.text} (${floorTitle})`
                        : `作品 ${index + 1}`;


                const cmW =
                    obj.cmWidth || 150;

                const cmH =
                    obj.cmHeight || 100;

                const cmD =
                    obj.cmDepth || 5;


                const typeLabel =
                    (
                        obj.displayType === 'wall'
                    )
                        ? '壁面展示'
                        : '床置展示';


                const dimText =
                    (
                        obj.displayType === 'wall'
                    )
                        ? `幅:${cmToMm(cmW)}×高:${cmToMm(cmH)} (厚:${cmToMm(cmD)}) mm`
                        : `幅:${cmToMm(cmW)}×奥:${cmToMm(cmD)} mm`;


                let crowdStatus =
                    "未設定 / 0人";


                if (obj.crowdCountValue) {

                    crowdStatus =
                        `${obj.crowdCountValue}人`;

                }


                artworkList.push({

                    id:
                        artworkList.length + 1,

                    name:
                        name,

                    type:
                        typeLabel,

                    dimensions:
                        dimText,

                    crowd:
                        crowdStatus

                });

            }


            // ------------------------------------------------
            // ピン・警備員
            // ------------------------------------------------
            // 新しい統合ピンは isPin を持つ。
            // 旧データの isFreePin / isGuard も認識する。
            // ------------------------------------------------

            else if (
                obj.isPin ||
                obj.isFreePin ||
                obj.isGuard
            ) {

                const isGuard =
                    obj.pinType === "guard" ||
                    obj.isGuard;


                pinList.push({

                    id:
                        pinList.length + 1,

                    type:
                        isGuard
                            ? "警備員"
                            : "ピン・注記",
                    floorTitle,

                    label:
                        obj.pinLabel ||
                        (
                            isGuard
                                ? "👤 警備員"
                                : "📍 ピン"
                        )

                });

            }

        }
    );


    // ====================================================
    // 2. 登録されている全壁面の画像を取得
    // ====================================================

    const wallCaptureList = [];

    const wallKeys =
        Object.keys(
            wallPlanJsonData
        );


    for (
        let key of wallKeys
    ) {

        const wallData =
            wallPlanJsonData[key];
        if (![Number(wallData.widthCm), Number(wallData.heightCm)].every(value => Number.isFinite(value) && value > 0)) {
            throw new Error(`${wallData.title || '壁面'}の幅・高さを確認してください。`);
        }
        captureCurrentCanvasState();
        selectedFloorId = getWallFloorId(wallData);
        floorPlanJsonData = floorPlanData[selectedFloorId].json;
        cachedBackgroundImage = floorBackgroundImages.get(selectedFloorId) || null;


        selectedWallInfo = {

            id:
                key,

            title:
                wallData.title || "壁面",

            widthCm: Number(wallData.widthCm),
            heightCm: Number(wallData.heightCm)

        };


        await switchViewMode(
            'wall',
            true,
            null,
            true
        );


        await new Promise(
            r => setTimeout(r, 200)
        );


        const wallOutline = canvas.getObjects().find(obj => obj.isWallOutline);
        // The vertical scale bar must match the captured wall, including older
        // saved walls whose pixel dimensions predate the current scale setting.
        if (!window.isDiagramReady?.() || currentViewMode !== 'wall' || selectedWallInfo.id !== key || !wallOutline) throw new Error(`${wallData.title}を読み込めませんでした。`);
        const wallScale = Number(wallOutline.height) * Math.abs(Number(wallOutline.scaleY) || 1) / Number(wallData.heightCm);
        const horizontalScale = Number(wallOutline.width) * Math.abs(Number(wallOutline.scaleX) || 1) / Number(wallData.widthCm);
        if (!(Number.isFinite(wallScale) && wallScale > 0 && Number.isFinite(horizontalScale) && horizontalScale > 0)
            || Math.abs(wallScale - horizontalScale) > wallScale * 1e-6) {
            throw new Error(`${wallData.title}の縦横の縮尺が一致しません。壁の寸法設定を確認してください。`);
        }
        const crop = pdfWallCaptureBounds();
        const wallImgUrl = canvas.toDataURL({ format: 'png', quality: 1.0, ...crop, enableRetinaScaling: false });


        wallCaptureList.push({
            floorId: getWallFloorId(wallData),

            title: wallData.title || '壁面図',

            widthCm:
                wallData.widthCm,

            heightCm:
                wallData.heightCm,

            imgUrl:
                wallImgUrl,
            scale: wallScale,
            sourceWidthPx: crop.width,
            sourceHeightPx: crop.height

        });

    }


    // 元の表示状態に戻す
    await handleFloorSelectChange(initialFloor, true);

    selectedWallInfo =
        initialWall;


    await switchViewMode(
        initialMode,
        true
    );


    // ====================================================
    // 印刷ウィンドウ
    // ====================================================

    const printWindow =
        window.open(
            '',
            '_blank'
        );


    if (!printWindow) {

        alert(
            "ポップアップがブロックされました。ブラウザのポップアップブロックを解除してください。"
        );

        return;

    }


    const today =
        new Date().toLocaleDateString(
            'ja-JP',
            {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            }
        );


    // ====================================================
    // PDFページHTML
    // ====================================================

    const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    const drawing = (capture, label, maxWidth, maxHeight) => {
        const size = pdfImageDimensions(capture.sourceWidthPx, capture.sourceHeightPx, maxWidth, maxHeight);
        return `
            <figure class="drawing-card">
                <figcaption>${label}</figcaption>
                <div class="drawing-scale-row">
                    <img src="${capture.imgUrl}" alt="" style="width:${size.imageWidthMm}mm;height:${size.imageHeightMm}mm">
                    ${createPdfScaleMarkup(capture.scale, size.imageWidthMm, capture.sourceWidthPx)}
                </div>
            </figure>`;
    };
    const drawings = floorCaptureList.map(floor => {
        const walls = wallCaptureList.filter(wall => wall.floorId === floor.floorId);
        const rows = [];
        for (let i = 0; i < walls.length; i += 2) {
            rows.push(`<div class="drawing-row">${walls.slice(i, i + 2).map(wall => drawing(wall,
                `${escape(wall.title)} <span class="drawing-size">${cmToMm(wall.widthCm)} × ${cmToMm(wall.heightCm)} mm</span>`,
                78, 64)).join('')}</div>`);
        }
        return `
            <h2 class="section-title">${escape(floor.title)}</h2>
            ${drawing(floor, '平面配置図', 165, 76)}
            ${rows.join('')}`;
    }).join('');

    const table = (headers, rows) => `
        <table>
            <thead><tr>${headers.map(header => `<th scope="col">${header}</th>`).join('')}</tr></thead>
            <tbody>${rows.map(row => `<tr>${row.map(value => `<td>${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>`;
    const artworkCell = item => item ? `<td>
        <div class="artwork-entry-name"><span class="artwork-entry-index">${escape(item.id)}.</span> ${escape(item.name)}</div>
        <div class="artwork-entry-details">${escape(item.type)} · ${escape(item.dimensions)} · 混雑予想: ${escape(item.crowd)}</div>
    </td>` : '<td></td>';
    const artworkRows = [];
    for (let i = 0; i < artworkList.length; i += 2) {
        artworkRows.push(`<tr>${artworkCell(artworkList[i])}${artworkCell(artworkList[i + 1])}</tr>`);
    }
    const pinCell = pin => pin ? `<td>
        <div class="artwork-entry-name"><span class="artwork-entry-index">${escape(pin.id)}.</span> ${escape(pin.label)}</div>
        <div class="artwork-entry-details">${escape(pin.floorTitle)} · ${escape(pin.type)}</div>
    </td>` : '<td></td>';
    const pinRows = [];
    if (pinList.length >= 6) {
        for (let i = 0; i < pinList.length; i += 2) {
            pinRows.push(`<tr>${pinCell(pinList[i])}${pinCell(pinList[i + 1])}</tr>`);
        }
    }
    const pagesHtml = `
        <main>
        <section class="page" aria-label="配置図">
            <div class="header">
                <h1 class="title">${escape(currentTitle)}</h1>
                <div class="date">発行日: ${escape(today)}</div>
            </div>
            ${memoText.trim() ? `<h2 class="section-title">特記事項・注意事項</h2><div class="memo-box">${escape(memoText)}</div>` : ''}
            ${drawings}
        </section>
        ${artworkRows.length || pinList.length ? `<section class="page reference-page" aria-label="照合用一覧">
            <div class="header">
                <h2 class="title">${escape(currentTitle)} — 照合用一覧</h2>
            </div>
            ${artworkRows.length ? `<h3 class="section-title">展示作品・設置物一覧</h3>
                <table class="artwork-list"><tbody>${artworkRows.join('')}</tbody></table>` : ''}
            ${pinList.length ? `<h3 class="section-title">設置済みピン・警備員</h3>
                ${pinRows.length ? `<table class="artwork-list"><tbody>${pinRows.join('')}</tbody></table>`
                    : table(['No.', '階', '種類', '名称・内容'], pinList.map(pin => [pin.id, pin.floorTitle, pin.type, pin.label]))}` : ''}
        </section>` : ''}
        </main>`;

    // ====================================================
    // 印刷画面生成
    // ====================================================

    printWindow.document.write(`

        <!DOCTYPE html>

        <html lang="ja">

        <head>

            <meta charset="UTF-8">

            <title>
                ${escape(currentTitle)}
                - Curator-Canvas 統合指示書
            </title>


            <style>

                /* Preview chrome only: printed pages retain their existing styles. */
                @media screen {
                    body { background: #1b1f21 !important; scrollbar-color: #4c555b #1b1f21; }
                    .page { margin: 16px auto; box-shadow: none !important; outline: 1px solid #3c4347; }
                    .export-toolbar {
                        position: fixed; inset: 0 0 auto; z-index: 9999;
                        display: flex; align-items: center; gap: 14px;
                        min-height: 48px; padding: 0 14px 0 0; box-sizing: border-box;
                        background: #242b30; color: #c9d0d4; border-bottom: 1px solid #454e54;
                        font-family: Arial, 'Yu Gothic', sans-serif; font-size: 11px; font-weight: 400;
                    }
                    .export-brand {
                        display: flex; align-items: center; align-self: stretch;
                        padding: 0 16px; background: #391e23; border-right: 1px solid #58343b;
                        color: #e1d7d9; font-size: 13px; white-space: nowrap;
                    }
                    .export-toolbar-title { color: #aab5bc; white-space: nowrap; }
                    .export-actions { display: flex; gap: 6px; margin-left: auto; }
                    .export-action {
                        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
                        min-height: 28px; padding: 4px 10px; border: 1px solid #525d65; border-radius: 0;
                        background: #303940; color: #dce2e6; font: inherit; cursor: pointer; white-space: nowrap;
                    }
                    .export-action:hover { background: #3c474f; border-color: #74818a; }
                    .export-action:focus-visible { outline: 1px solid #afbec7; outline-offset: 2px; }
                    .export-action-secondary { background: transparent; color: #adb8bf; }
                    .export-action svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.4; }
                    .export-toolbar-spacer { height: 60px; }
                    @media (max-width: 480px) {
                        .export-toolbar { gap: 8px; padding-right: 8px; }
                        .export-brand { padding: 0 10px; font-size: 11px; }
                        .export-toolbar-title { display: none; }
                        .export-action { padding: 4px 7px; }
                    }
                }

                @page {
                    size: A4 portrait;
                    margin: 8mm;
                }


                body {
                    font-family:
                        'Helvetica Neue',
                        Arial,
                        sans-serif;

                    color: #333;

                    margin: 0;
                    padding: 0;

                    background: #e2e8f0;
                }


                .page {
                    box-sizing: border-box;
                    width: 210mm;
                    padding: 8mm;
                    margin: 16px auto;
                    background: #fff;
                    font-size: 10px;
                    line-height: 1.35;
                    overflow-wrap: anywhere;
                }
                .header {
                    display: flex;
                    justify-content: space-between;
                    align-items: baseline;
                    gap: 3mm;
                    padding-bottom: 2mm;
                    border-bottom: 1px solid #555;
                    break-inside: avoid;
                    break-after: avoid;
                }
                .title { font-size: 17px; margin: 0; }
                .date { color: #555; flex: 0 0 auto; }
                .section-title {
                    font-size: 12px;
                    margin: 3mm 0 1mm;
                    padding-bottom: .7mm;
                    border-bottom: 1px solid #b2b2b2;
                    break-after: avoid;
                }
                .drawing-card {
                    margin: 0 0 2mm;
                    min-width: 0;
                    break-inside: avoid;
                }
                .drawing-card figcaption { margin: 0 0 1mm; font-weight: 600; }
                .drawing-size { color: #555; font-weight: normal; white-space: nowrap; }
                .drawing-row { display: flex; gap: 4mm; break-inside: avoid; }
                .drawing-row .drawing-card { flex: 0 0 calc((100% - 4mm) / 2); }
                .drawing-scale-row { display: flex; justify-content: center; align-items: flex-start; gap: 2mm; }
                .drawing-scale-row img {
                    display: block;
                    flex: 0 0 auto;
                    border: 0;
                    outline: .25mm solid #a3a9ad;
                    background: #eef1f3;
                }
                .pdf-scale {
                    flex: 0 0 12mm;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: .7mm;
                    color: #555;
                    font-size: 8px;
                    line-height: 1.2;
                }
                .pdf-scale-rule { position: relative; width: 0; border-left: 1px solid #555; }
                .pdf-scale-rule i { position: absolute; left: -1mm; width: 2mm; border-top: 1px solid #555; }
                .pdf-scale-rule i:first-child { top: 0; }
                .pdf-scale-rule i:last-child { bottom: 0; }
                table { width: 100%; border-collapse: collapse; font-size: 10px; }
                th, td { padding: 1mm 1.5mm; text-align: left; border-bottom: 1px solid #ccc; vertical-align: top; }
                th { border-bottom-color: #777; }
                thead { display: table-header-group; }
                tr { break-inside: avoid; }
                .artwork-list { table-layout: fixed; }
                .artwork-list td { width: 50%; padding: 1mm 1.5mm; }
                .artwork-list td + td { border-left: 1px solid #d2d2d2; }
                .artwork-entry-name { font-weight: 600; }
                .artwork-entry-index, .artwork-entry-details { color: #50565b; font-weight: normal; }
                .artwork-entry-details { font-size: 9px; }
                .memo-box { white-space: pre-wrap; padding: 1mm 0; orphans: 2; widows: 2; }

                @media print {
                    body { background: none; }
                    .page { width: 100%; padding: 0; margin: 0; }
                    .reference-page { page-break-before: always; break-before: page; }
                    .no-print { display: none !important; }
                }

            </style>

        </head>


        <body>


            <header class="export-toolbar no-print" aria-label="PDF出力の操作">
                <span class="export-brand">Curator-Canvas</span>
                <span class="export-toolbar-title">PDF出力</span>
                <div class="export-actions">
                    <button type="button" class="export-action" onclick="window.print()">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6zM17 11h1"/></svg>
                        PDF保存・印刷
                    </button>
                    <button type="button" class="export-action export-action-secondary" onclick="window.close()">閉じる</button>
                </div>
            </header>
            <div class="export-toolbar-spacer no-print"></div>


            ${pagesHtml}


            <script>

                window.onload = function() {

                    setTimeout(
                        function() {
                            window.print();
                        },
                        600
                    );

                };

            <\/script>


        </body>

        </html>

    `);


    printWindow.document.close();

}
