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
    const label = lengthCm >= 100 && lengthCm % 100 === 0
        ? `${lengthCm / 100} m`
        : `${lengthCm} cm`;

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
            title: floor.title,
            imgUrl: canvas.toDataURL({ format: 'png', quality: 1.0, enableRetinaScaling: false }),
            sourceWidthPx: canvas.getWidth(),
            ...pdfImageDimensions(canvas.getWidth(), canvas.getHeight(), 165, 120),
            scale: drawingScale
        });
        floorObjects.push(...canvas.getObjects().map(obj => ({ obj, floorTitle: floor.title })));
    }
    const floorCanvasUrl = floorCaptureList[0].imgUrl;


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
                        ? `幅:${cmW}×高:${cmH} (厚:${cmD}) cm`
                        : `幅:${cmW}×奥:${cmH} cm`;


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
        const scaleInput = document.getElementById('scale');
        if (scaleInput) scaleInput.value = drawingScale;


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
        const imageSize = pdfImageDimensions(crop.width, crop.height);
        const wallImgUrl = canvas.toDataURL({ format: 'png', quality: 1.0, ...crop, enableRetinaScaling: false });


        wallCaptureList.push({

            title:
                `${FLOOR_PLANS[getWallFloorId(wallData)].title} / ${wallData.title}`,

            widthCm:
                wallData.widthCm,

            heightCm:
                wallData.heightCm,

            imgUrl:
                wallImgUrl,
            scale: wallScale,
            sourceWidthPx: crop.width,
            ...imageSize

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

    let pagesHtml = `

        <div class="page">

            <div class="header">

                <div class="title">
                    ${currentTitle} (平面配置図: ${floorCaptureList[0].title})
                </div>

                <div class="date">
                    発行日: ${today}
                </div>

            </div>


            <div class="section-title">
                1. 平面配置図: ${floorCaptureList[0].title}
            </div>


            <div class="drawing-scale-row floor-scale-row">

                <img
                    src="${floorCanvasUrl}"
                    class="canvas-img canvas-img-floor"
                    style="width:${floorCaptureList[0].imageWidthMm}mm;height:${floorCaptureList[0].imageHeightMm}mm"
                />

                ${createPdfScaleMarkup(floorCaptureList[0].scale, floorCaptureList[0].imageWidthMm, floorCaptureList[0].sourceWidthPx)}

            </div>


            <div class="section-title">
                2. 展示作品・設置物一覧
            </div>


            <table>

                <thead>

                    <tr>

                        <th style="width: 6%;">
                            No.
                        </th>

                        <th style="width: 34%;">
                            作品名 / 展示物
                        </th>

                        <th style="width: 15%;">
                            展示種別
                        </th>

                        <th style="width: 25%;">
                            実寸サイズ
                        </th>

                        <th style="width: 20%;">
                            混雑予想人数
                        </th>

                    </tr>

                </thead>


                <tbody>

                    ${
                        artworkList.length > 0

                            ? artworkList
                                .map(
                                    item => `

                                        <tr>

                                            <td>
                                                ${item.id}
                                            </td>

                                            <td>
                                                <strong>
                                                    ${item.name}
                                                </strong>
                                            </td>

                                            <td>
                                                ${item.type}
                                            </td>

                                            <td>
                                                ${item.dimensions}
                                            </td>

                                            <td>
                                                ${item.crowd}
                                            </td>

                                        </tr>

                                    `
                                )
                                .join('')

                            : `
                                <tr>

                                    <td
                                        colspan="5"
                                        style="text-align:center;"
                                    >
                                        配置されている作品はありません。
                                    </td>

                                </tr>
                            `
                    }

                </tbody>

            </table>


            ${
                pinList.length > 0

                    ? `

                        <div class="section-title">
                            3. 設置済みピン・警備員
                        </div>


                        <table>

                            <thead>

                                <tr>

                                    <th style="width: 10%;">
                                        No.
                                    </th>

                                    <th style="width: 20%;">
                                        種類
                                    </th>

                                    <th style="width: 70%;">
                                        名称・内容
                                    </th>

                                </tr>

                            </thead>


                            <tbody>

                                ${
                                    pinList
                                        .map(
                                            pin => `

                                                <tr>

                                                    <td>
                                                        ${pin.id}
                                                    </td>

                                                    <td>
                                                        ${pin.type}
                                                    </td>

                                                    <td>
                                                        ${pin.label}
                                                    </td>

                                                </tr>

                                            `
                                        )
                                        .join('')
                                }

                            </tbody>

                        </table>

                    `

                    : ''
            }


            <div class="section-title">
                ${
                    pinList.length > 0
                        ? '4'
                        : '3'
                }.
                特記事項・注意事項
            </div>


            <div class="memo-box">
                ${memoText}
            </div>


            <div class="footer">
                Curator-Canvas - 統合展示指示書 Page 1
            </div>

        </div>

    `;


    // ====================================================
    // 壁面ページ
    // ====================================================

    floorCaptureList.slice(1).forEach((floor, index) => {
        pagesHtml += `
            <div class="page page-break">
                <div class="header">
                    <div class="title">${currentTitle} (平面配置図: ${floor.title})</div>
                    <div class="date">発行日: ${today}</div>
                </div>
                <div class="section-title">平面配置図: ${floor.title}</div>
                <div class="drawing-scale-row floor-scale-row">
                    <img src="${floor.imgUrl}" class="canvas-img canvas-img-floor" style="width:${floor.imageWidthMm}mm;height:${floor.imageHeightMm}mm" />
                    ${createPdfScaleMarkup(floor.scale, floor.imageWidthMm, floor.sourceWidthPx)}
                </div>
                <div class="footer">Curator-Canvas - 統合展示指示書 Page ${index + 2}</div>
            </div>
        `;
    });

    wallCaptureList.forEach(
        (wall, idx) => {

            pagesHtml += `

                <div class="page page-break">

                    <div class="header">

                        <div class="title">
                            ${currentTitle}
                            (壁面立面図: ${wall.title})
                        </div>

                        <div class="date">
                            発行日: ${today}
                        </div>

                    </div>


                    <div class="section-title">

                        壁面仕様:
                        ${wall.title}

                        (
                        幅:
                        ${wall.widthCm}
                        cm ×

                        高さ:
                        ${wall.heightCm}
                        cm
                        )

                    </div>


                    <div class="drawing-scale-row wall-scale-row">

                        <img
                            src="${wall.imgUrl}"
                            class="canvas-img-large wall-canvas-img"
                            style="width:${wall.imageWidthMm}mm;height:${wall.imageHeightMm}mm"
                        />

                        ${createPdfScaleMarkup(wall.scale, wall.imageWidthMm, wall.sourceWidthPx)}

                    </div>


                    <div class="footer">
                        Curator-Canvas - 統合展示指示書
                        Page ${idx + floorCaptureList.length + 1}
                    </div>

                </div>

            `;

        }
    );


    // ====================================================
    // 印刷画面生成
    // ====================================================

    printWindow.document.write(`

        <!DOCTYPE html>

        <html lang="ja">

        <head>

            <meta charset="UTF-8">

            <title>
                ${currentTitle}
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

                    background: #ffffff;

                    width: 210mm;

                    min-height: 297mm;

                    padding: 10mm 12mm;

                    margin: 10px auto;

                    box-shadow:
                        0 4px 6px
                        rgba(0,0,0,0.1);

                    box-sizing: border-box;

                    position: relative;

                }


                @media print {

                    body {
                        background: none;
                    }

                    .page {
                        width: 100%;
                        min-height: 0;
                        height: auto;
                        margin: 0;
                        padding: 0;
                        box-shadow: none;
                        break-inside: avoid;
                        page-break-inside: avoid;
                    }

                    .page-break {
                        page-break-before: always;
                    }

                    .no-print {
                        display: none !important;
                    }

                }


                .header {

                    display: flex;

                    justify-content:
                        space-between;

                    align-items:
                        flex-end;

                    border-bottom:
                        2px solid #2c3e50;

                    padding-bottom: 5px;

                    margin-bottom: 10px;

                }


                .title {

                    font-size: 20px;

                    font-weight: bold;

                    color: #2c3e50;

                }


                .date {

                    font-size: 11px;

                    color: #666;

                }


                .section-title {

                    font-size: 13px;

                    font-weight: bold;

                    background: #f2f4f7;

                    padding: 4px 8px;

                    border-left:
                        4px solid #2563eb;

                    margin:
                        9px 0 5px 0;

                }


                .canvas-img {

                    width: 100%;

                    max-height: 350px;

                    object-fit: contain;

                    border:
                        1px solid #cbd5e1;

                    border-radius: 4px;

                }


                .canvas-img-large {

                    width: 100%;

                    max-height: 550px;

                    object-fit: contain;

                    border:
                        1px solid #cbd5e1;

                    border-radius: 4px;

                }


                .drawing-scale-row {
                    display: flex;
                    justify-content: center;
                    align-items: flex-start;
                    gap: 3mm;
                    margin: 4px 0 7px;
                }


                .canvas-img-floor {
                    flex: 0 0 auto;
                    box-sizing: content-box;
                    border: 0;
                    max-height: none;
                    object-fit: fill;
                }


                .wall-canvas-img {
                    flex: 0 0 auto;
                    box-sizing: content-box;
                    border: 0;
                    max-height: none;
                    object-fit: fill;
                }


                .pdf-scale {
                    flex: 0 0 12mm;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 1mm;
                    color: #737a80;
                    font-size: 8px;
                    line-height: 1.2;
                    padding-top: 1mm;
                }


                .pdf-scale-rule {
                    position: relative;
                    box-sizing: content-box;
                    width: 0;
                    border-left: 1px solid #737a80;
                }


                .pdf-scale-rule i {
                    position: absolute;
                    left: -1mm;
                    width: 2mm;
                    height: 1px;
                    background: #737a80;
                }


                .pdf-scale-rule i:first-child {
                    top: 0;
                }


                .pdf-scale-rule i:last-child {
                    bottom: 0;
                }


                .pdf-scale-label {
                    color: #626a70;
                    font-size: 8px;
                }


                table {

                    width: 100%;

                    border-collapse: collapse;

                    margin-top: 8px;

                    font-size: 11px;

                }


                th,
                td {

                    border:
                        1px solid #cbd5e1;

                    padding: 6px 8px;

                    text-align: left;

                }


                th {

                    background-color: #f8fafc;

                    font-weight: bold;

                }


                .memo-box {

                    font-size: 11px;

                    line-height: 1.5;

                    white-space: pre-wrap;

                    background: #fafafa;

                    border:
                        1px solid #eee;

                    padding: 10px;

                    border-radius: 4px;

                    min-height: 40px;

                }


                .footer {

                    position: absolute;

                    bottom: 12mm;

                    right: 15mm;

                    font-size: 10px;

                    color: #888;

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
