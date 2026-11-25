// 吊り下げ展示の種類、天井からの距離、配置高さと寸法の共通計算を管理します。
function isHangingArtwork(artwork) {
    const type = typeof artwork === 'string' ? artwork : artwork?.displayType;
    return ['hanging-panel', 'hanging-object'].includes(type);
}

function hangingArtworkDropCm(artwork) {
    return artwork.hangingDropCm == null ? 50 : Number(artwork.hangingDropCm);
}

function hangingArtworkCenterHeightCm(artwork, floorId = selectedFloorId) {
    return venueCeilingHeightCm(floorId) - hangingArtworkDropCm(artwork) - Number(artwork.cmHeight)/2;
}

function hangingArtworkValidation(dropCm, heightCm, floorId = selectedFloorId) {
    if (!Number.isFinite(dropCm) || dropCm < 0) return '天井から展示物の上端までの距離は0以上の数値で入力してください。';
    if (!Number.isFinite(heightCm) || heightCm <= 0) return '展示物の高さは0より大きい数値で入力してください。';
    if (dropCm + heightCm > venueCeilingHeightCm(floorId)) return `展示物が床より下になるため、距離と高さの合計を${cmToMm(venueCeilingHeightCm(floorId))} mm以内にしてください。`;
    return '';
}
