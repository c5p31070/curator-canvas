const addButton = document.getElementById("addArtwork");
const canvas = document.getElementById("canvas");

const artworkName = document.getElementById("artworkName");
const artworkWidth = document.getElementById("artworkWidth");
const artworkHeight = document.getElementById("artworkHeight");

let artworkNumber = 1;

addButton.addEventListener("click", function() {

  artworkNumber++;

  const artwork = document.createElement("div");

  artwork.className = "artwork";
  artwork.textContent = artworkName.value;

// 展示品のサイズを入力値に合わせる
artwork.style.width = artworkWidth.value + "px";
artwork.style.height = artworkHeight.value + "px";

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