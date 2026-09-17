const floorplan = document.getElementById("floorplan");

const addButton = document.getElementById("addArtwork");
const canvas = document.getElementById("canvas");

const artworkName = document.getElementById("artworkName");
const artworkWidth = document.getElementById("artworkWidth");
const artworkHeight = document.getElementById("artworkHeight");
const scale = document.getElementById("scale");

let artworkNumber = 1;


// 展示品を追加
addButton.addEventListener("click", function() {

  artworkNumber++;

  const artwork = document.createElement("div");

  artwork.className = "artwork";
  artwork.textContent = artworkName.value;

  // 展示品のサイズを入力値に合わせる
  artwork.style.width = (artworkWidth.value * scale.value) + "px";
  artwork.style.height = (artworkHeight.value * scale.value) + "px";

  // 展示品を少しずつ横にずらして配置
  artwork.style.left = (100 + (artworkNumber - 2) * 120) + "px";
  artwork.style.top = "150px";

  canvas.appendChild(artwork);


  // 展示品をドラッグできるようにする
  artwork.addEventListener("mousedown", function(event) {

    const startX = event.clientX;
    const startY = event.clientY;

    const startLeft = artwork.offsetLeft;
    const startTop = artwork.offsetTop;

    function moveArtwork(event) {

      const newLeft = startLeft + (event.clientX - startX);
      const newTop = startTop + (event.clientY - startY);

      artwork.style.left = newLeft + "px";
      artwork.style.top = newTop + "px";
    }

    function stopMoving() {

      document.removeEventListener("mousemove", moveArtwork);
      document.removeEventListener("mouseup", stopMoving);

    }

    document.addEventListener("mousemove", moveArtwork);
    document.addEventListener("mouseup", stopMoving);

  });

});


// 会場図面を読み込む
floorplan.addEventListener("change", function() {

  const file = floorplan.files[0];

  if (!file) {
    return;
  }

  const reader = new FileReader();

  reader.addEventListener("load", function() {

    canvas.style.backgroundImage = "url('" + reader.result + "')";
    canvas.style.backgroundSize = "contain";
    canvas.style.backgroundRepeat = "no-repeat";
    canvas.style.backgroundPosition = "center";

  });

  reader.readAsDataURL(file);

});