// ① Fabric.js キャンバスの初期化
const canvas = new fabric.Canvas('canvas');

// ② 会場図面画像を背景に設定
fabric.Image.fromURL('images/tobikan.png', function(img) {
    if (img) {
        canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas), {
            scaleX: canvas.width / img.width,
            scaleY: canvas.height / img.height,
            originX: 'left',
            originY: 'top'
        });
    } else {
        console.warn("背景画像 'images/tobikan.png' の読み込みに失敗しました。");
    }
}, { crossOrigin: 'anonymous' });

let artworkCount = 0;

// 実測人数に応じた色の連続変化（緑 ➔ 黄 ➔ 赤）を計算する関数（最大15人基準）
function getCrowdColor(count) {
    const MAX_PEOPLE = 15;
    const ratio = Math.min(Math.max(count / MAX_PEOPLE, 0), 1);
    
    let r, g, b;
    if (ratio < 0.5) {
        // 0% 〜 50% (0〜7.5人): 緑(46, 204, 113) ➔ 黄(241, 196, 15)
        const factor = ratio * 2;
        r = Math.round(46 + (241 - 46) * factor);
        g = Math.round(204 + (196 - 204) * factor);
        b = Math.round(113 + (15 - 113) * factor);
    } else {
        // 50% 〜 100% (7.5〜15人): 黄(241, 196, 15) ➔ 赤(231, 76, 60)
        const factor = (ratio - 0.5) * 2;
        r = Math.round(241 + (231 - 241) * factor);
        g = Math.round(196 + (76 - 196) * factor);
        b = Math.round(15 + (60 - 15) * factor);
    }

    return {
        fill: `rgba(${r}, ${g}, ${b}, 0.35)`,
        stroke: `rgba(${r}, ${g}, ${b}, 0.8)`
    };
}

// DOM読み込み完了後にイベント処理を登録
document.addEventListener("DOMContentLoaded", function() {

    const addButton = document.getElementById("addArtwork");
    const addGuardButton = document.getElementById("addGuard");
    const updateCrowdButton = document.getElementById("updateCrowd");
    const pdfButton = document.getElementById("generatePdf");

    // ③ 展示品（作品オブジェクト）の追加
    if (addButton) {
        addButton.addEventListener("click", function() {
            artworkCount++;

            const nameEl = document.getElementById("artworkName");
            const widthEl = document.getElementById("artworkWidth");
            const heightEl = document.getElementById("artworkHeight");
            const scaleEl = document.getElementById("scale");

            const nameText = (nameEl && nameEl.value) ? nameEl.value : `作品 ${artworkCount}`;
            const cmW = (widthEl && widthEl.value) ? parseFloat(widthEl.value) : 150;
            const cmH = (heightEl && heightEl.value) ? parseFloat(heightEl.value) : 100;
            const currentScale = (scaleEl && scaleEl.value) ? parseFloat(scaleEl.value) : 0.5;

            const pxW = cmW * currentScale;
            const pxH = cmH * currentScale;

            // 1. 作品本体（四角形）
            const rect = new fabric.Rect({
                width: pxW,
                height: pxH,
                fill: 'rgba(52, 152, 219, 0.8)',
                stroke: '#2980b9',
                strokeWidth: 2,
                originX: 'center',
                originY: 'center'
            });

            // 2. 作品名テキスト
            const text = new fabric.Text(nameText, {
                fontSize: 14,
                fill: '#ffffff',
                fontFamily: 'sans-serif',
                originX: 'center',
                originY: 'center'
            });

            // 作品グループを作成
            const artworkGroup = new fabric.Group([rect, text], {
                left: 150 + ((artworkCount % 8) * 20),
                top: 150 + ((artworkCount % 8) * 20),
                originX: 'center',
                originY: 'center',
                hasRotatingPoint: false,
                isArtwork: true,
                pxWidth: pxW,
                pxHeight: pxH
            });

            canvas.add(artworkGroup);
            canvas.setActiveObject(artworkGroup);
            canvas.renderAll();
        });
    }

    // ④ 滞留人数による混雑色の更新（15人基準・一回り大きいサイズ固定）
    if (updateCrowdButton) {
        updateCrowdButton.addEventListener("click", function() {
            const activeObj = canvas.getActiveObject();
            const crowdInput = document.getElementById("crowdCount");

            if (!activeObj || !activeObj.isArtwork) {
                alert("混雑度を更新したい作品をキャンバス上で選択してください。");
                return;
            }

            const count = crowdInput ? (parseInt(crowdInput.value) || 0) : 0;

            // 既存の混雑円を削除
            if (activeObj.crowdCircle) {
                canvas.remove(activeObj.crowdCircle);
                activeObj.crowdCircle = null;
            }

            if (count > 0) {
                // 対角線サイズに基づき一回り大きい固定半径を計算
                const diagonal = Math.sqrt(Math.pow(activeObj.pxWidth, 2) + Math.pow(activeObj.pxHeight, 2));
                const radius = (diagonal / 2) + 15;

                const colorObj = getCrowdColor(count);

                const circle = new fabric.Circle({
                    radius: radius,
                    fill: colorObj.fill,
                    stroke: colorObj.stroke,
                    strokeWidth: 2,
                    left: activeObj.left,
                    top: activeObj.top,
                    originX: 'center',
                    originY: 'center',
                    selectable: false,
                    evented: false
                });

                canvas.add(circle);
                circle.sendToBack();

                if (canvas.backgroundImage) {
                    circle.bringForward();
                }

                activeObj.crowdCircle = circle;
                activeObj.crowdCountValue = count;
            }

            canvas.renderAll();
        });
    }

    // ⑤ 作品移動時に混雑円をぴったり追従させる処理
    canvas.on('object:moving', function(e) {
        const obj = e.target;
        if (obj && obj.isArtwork && obj.crowdCircle) {
            obj.crowdCircle.set({
                left: obj.left,
                top: obj.top
            });
            obj.crowdCircle.setCoords();
        }
    });

    // ⑥ 警備員ピン（👤）の配置
    if (addGuardButton) {
        addGuardButton.addEventListener("click", function() {
            const guardText = new fabric.Text('👤', {
                fontSize: 32,
                originX: 'center',
                originY: 'center',
                left: 200,
                top: 200,
                hasRotatingPoint: false,
                transparentCorners: false
            });

            canvas.add(guardText);
            canvas.setActiveObject(guardText);
            canvas.renderAll();
        });
    }

    // ⑦ PDF指示書作成機能
    if (pdfButton) {
        pdfButton.addEventListener("click", function() {
            // キャンバス画像を生成
            const canvasDataUrl = canvas.toDataURL({
                format: 'png',
                quality: 1.0
            });

            // 作品情報リストを抽出
            const objects = canvas.getObjects();
            const artworkList = [];

            objects.forEach((obj, index) => {
                if (obj.isArtwork) {
                    const textObj = obj.item(1);
                    const name = textObj ? textObj.text : `作品 ${index + 1}`;
                    
                    const scaleEl = document.getElementById("scale");
                    const currentScale = scaleEl ? parseFloat(scaleEl.value) || 0.5 : 0.5;
                    const cmW = Math.round(obj.pxWidth / currentScale);
                    const cmH = Math.round(obj.pxHeight / currentScale);

                    let crowdStatus = "未設定 / 0人";
                    if (obj.crowdCountValue) {
                        crowdStatus = `警戒人数: ${obj.crowdCountValue}人`;
                    }

                    artworkList.push({
                        id: artworkList.length + 1,
                        name: name,
                        width: cmW,
                        height: cmH,
                        crowd: crowdStatus
                    });
                }
            });

            const memoEl = document.getElementById("pdfMemo");
            const memoText = memoEl ? memoEl.value : "特記事項なし";

            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                alert("ポップアップがブロックされました。ブラウザのポップアップブロックを解除してください。");
                return;
            }

            const today = new Date().toLocaleDateString('ja-JP', {
                year: 'numeric', month: 'long', day: 'numeric'
            });

            // 印刷・PDF用HTMLを出力
            printWindow.document.write(`
                <!DOCTYPE html>
                <html lang="ja">
                <head>
                    <meta charset="UTF-8">
                    <title>展示配置指示書 - curator-canvas</title>
                    <style>
                        @page { size: A4 portrait; margin: 15mm; }
                        body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; margin: 0; padding: 0; }
                        .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #2c3e50; padding-bottom: 10px; margin-bottom: 20px; }
                        .title { font-size: 22px; font-weight: bold; color: #2c3e50; }
                        .date { font-size: 12px; color: #666; }
                        .section-title { font-size: 14px; font-weight: bold; background: #f2f4f7; padding: 6px 10px; border-left: 4px solid #3498db; margin: 20px 0 10px 0; }
                        .canvas-img { width: 100%; max-height: 400px; object-fit: contain; border: 1px solid #ddd; border-radius: 4px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
                        th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }
                        th { background-color: #f8fafc; font-weight: bold; }
                        .memo-box { font-size: 12px; line-height: 1.6; white-space: pre-wrap; background: #fafafa; border: 1px solid #eee; padding: 10px; border-radius: 4px; min-height: 60px; }
                        .footer { margin-top: 30px; text-align: right; font-size: 10px; color: #888; }
                        @media print { .no-print { display: none; } }
                    </style>
                </head>
                <body>
                    <div class="no-print" style="background: #e0f2fe; padding: 10px; text-align: center; margin-bottom: 15px; border-radius: 4px;">
                        <button onclick="window.print()" style="padding: 8px 24px; background: #0284c7; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">🖨️ PDF保存・印刷する</button>
                    </div>

                    <div class="header">
                        <div class="title">展示配置指示書 (curator-canvas)</div>
                        <div class="date">発行日: ${today}</div>
                    </div>

                    <div class="section-title">1. 配置図面</div>
                    <div style="text-align: center;">
                        <img src="${canvasDataUrl}" class="canvas-img" />
                    </div>

                    <div class="section-title">2. 展示作品一覧</div>
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 8%;">No.</th>
                                <th style="width: 42%;">作品名 / 展示物</th>
                                <th style="width: 25%;">サイズ (幅 × 高さ cm)</th>
                                <th style="width: 25%;">混雑警戒状態</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${artworkList.length > 0 ? artworkList.map(item => `
                                <tr>
                                    <td>${item.id}</td>
                                    <td><strong>${item.name}</strong></td>
                                    <td>${item.width} cm × ${item.height} cm</td>
                                    <td>${item.crowd}</td>
                                </tr>
                            `).join('') : '<tr><td colspan="4" style="text-align:center;">配置されている作品はありません。</td></tr>'}
                        </tbody>
                    </table>

                    <div class="section-title">3. 特記事項・注意事項</div>
                    <div class="memo-box">${memoText}</div>

                    <div class="footer">curator-canvas - 展示配置シミュレーター</div>

                    <script>
                        window.onload = function() {
                            setTimeout(function() {
                                window.print();
                            }, 500);
                        };
                    <\/script>
                </body>
                </html>
            `);

            printWindow.document.close();
        });
    }
});