// ① Fabric.js キャンバスの初期化
const canvas = new fabric.Canvas('canvas');

// ② 東京都美術館の図面画像を背景に設定
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
    // 0〜15人を基準範囲として 0.0〜1.0 に正規化（15人以上は1.0で打ち止め）
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

// DOMの読み込み完了後にイベント登録
document.addEventListener("DOMContentLoaded", function() {

    const addButton = document.getElementById("addArtwork");
    const addGuardButton = document.getElementById("addGuard");
    const updateCrowdButton = document.getElementById("updateCrowd");

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

            // 作品グループの作成（サイズ情報をプロパティに保持）
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

    // ④ 滞留人数（実測値）による混雑色の更新（最大15人基準）
    if (updateCrowdButton) {
        updateCrowdButton.addEventListener("click", function() {
            const activeObj = canvas.getActiveObject();
            const crowdInput = document.getElementById("crowdCount");

            if (!activeObj || !activeObj.isArtwork) {
                alert("混雑度を更新したい作品をキャンバス上で選択してください。");
                return;
            }

            const count = crowdInput ? (parseInt(crowdInput.value) || 0) : 0;

            // 既に混雑円が存在する場合は一旦削除
            if (activeObj.crowdCircle) {
                canvas.remove(activeObj.crowdCircle);
                activeObj.crowdCircle = null;
            }

            // 1人以上の滞留がある場合に円を生成
            if (count > 0) {
                // 作品の対角線サイズを計算し、一回り大きい半径を設定 (+15pxの余白)
                const diagonal = Math.sqrt(Math.pow(activeObj.pxWidth, 2) + Math.pow(activeObj.pxHeight, 2));
                const radius = (diagonal / 2) + 15;

                // 人数に基づく連続色の取得（15人上限）
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

                // キャンバスへ追加し、作品の背面へ移動
                canvas.add(circle);
                circle.sendToBack();

                if (canvas.backgroundImage) {
                    circle.bringForward();
                }

                activeObj.crowdCircle = circle;
            }

            canvas.renderAll();
        });
    }

    // ⑤ 作品移動時に混雑円も中心にぴったり追従させる処理
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
});