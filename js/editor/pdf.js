// ----------------------------------------------------
// 📄 平面＋全壁面をまとめたマルチページPDF生成機能
// ----------------------------------------------------

async function generateCombinedPdf() {

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

    const initialWall =
        { ...selectedWallInfo };


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


    const floorCanvasUrl =
        canvas.toDataURL({
            format: 'png',
            quality: 1.0
        });


    const floorObjects =
        canvas.getObjects();


    const artworkList = [];

    const pinList = [];


    // ====================================================
    // 平面図上のオブジェクトを分類
    // ====================================================

    floorObjects.forEach(
        (obj, index) => {


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
                        ? textObj.text
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
                        `警戒人数: ${obj.crowdCountValue}人`;

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


        selectedWallInfo = {

            id:
                key,

            title:
                wallData.title || "壁面",

            widthCm:
                wallData.widthCm || 600,

            heightCm:
                wallData.heightCm || 300

        };


        await switchViewMode(
            'wall',
            true
        );


        await new Promise(
            r => setTimeout(r, 200)
        );


        const wallImgUrl =
            canvas.toDataURL({
                format: 'png',
                quality: 1.0
            });


        wallCaptureList.push({

            title:
                wallData.title,

            widthCm:
                wallData.widthCm,

            heightCm:
                wallData.heightCm,

            imgUrl:
                wallImgUrl

        });

    }


    // 元の表示状態に戻す

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
                    ${currentTitle} (平面配置図)
                </div>

                <div class="date">
                    発行日: ${today}
                </div>

            </div>


            <div class="section-title">
                1. 全体平面配置図
            </div>


            <div style="text-align: center;">

                <img
                    src="${floorCanvasUrl}"
                    class="canvas-img"
                />

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
                            混雑警戒状態
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
                curator-canvas - 統合展示指示書 Page 1
            </div>

        </div>

    `;


    // ====================================================
    // 壁面ページ
    // ====================================================

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


                    <div
                        style="
                            text-align: center;
                            margin-top: 20px;
                        "
                    >

                        <img
                            src="${wall.imgUrl}"
                            class="canvas-img-large"
                        />

                    </div>


                    <div class="footer">
                        curator-canvas - 統合展示指示書
                        Page ${idx + 2}
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
                - curator-canvas 統合指示書
            </title>


            <style>

                @page {
                    size: A4 portrait;
                    margin: 12mm;
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

                    padding: 15mm;

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

                    padding-bottom: 8px;

                    margin-bottom: 16px;

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

                    padding: 6px 10px;

                    border-left:
                        4px solid #2563eb;

                    margin:
                        16px 0 8px 0;

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


            <div
                class="no-print"
                style="
                    background: #e0f2fe;
                    padding: 12px;
                    text-align: center;
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    z-index: 9999;
                    box-shadow:
                        0 2px 4px
                        rgba(0,0,0,0.1);
                "
            >

                <button
                    onclick="window.print()"
                    style="
                        padding: 10px 28px;
                        background: #0284c7;
                        color: white;
                        border: none;
                        border-radius: 6px;
                        cursor: pointer;
                        font-weight: bold;
                        font-size: 14px;
                    "
                >
                    PDFを保存・印刷
                </button>

            </div>


            <div
                style="height: 50px;"
                class="no-print"
            ></div>


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
