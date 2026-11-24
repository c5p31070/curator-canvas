// Creation and editing use the same component dimensions and total-height calculation.
function initializeSculpturePedestalControls(prefix, { widthInput, depthInput, heightInput, centerHeightInput, onChange }) {
    const element = suffix => document.getElementById(prefix + suffix);
    const enabled = element('OnPedestal');
    const inputs = {
        columnHeightCm: element('ColumnHeight'), workWidthCm: element('WorkWidth'),
        workDepthCm: element('WorkDepth'), workHeightCm: element('WorkHeight')
    };
    let previousHeight = null;
    let wasEnabled = false;
    const read = () => enabled.checked ? {
        baseHeightCm: mmToCm(heightInput.value),
        ...Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, mmToCm(input.value)]))
    } : null;
    const refresh = () => {
        element('PedestalFields').hidden = !enabled.checked;
        const data = normalizeSculpturePedestal(read());
        element('TotalHeight').textContent = data ? `全高 ${cmToMm(sculpturePedestalTotalHeight(data))} mm` : '';
        const total = data ? sculpturePedestalTotalHeight(data) : enabled.checked ? null : mmToCm(heightInput.value);
        if (total !== null && Number.isFinite(total) && total > 0) {
            const centerText = centerHeightInput?.value.trim() || '';
            if ((enabled.checked || wasEnabled) && previousHeight !== null && centerText &&
                Math.abs(mmToCm(centerText) - previousHeight/2) < .001) centerHeightInput.value = cmToMm(total/2);
            previousHeight = total;
        }
        wasEnabled = enabled.checked;
    };
    const deactivate = () => {
        const data = normalizeSculpturePedestal(read());
        if (data) heightInput.value = cmToMm(sculpturePedestalTotalHeight(data));
        enabled.checked = false;
        refresh();
    };
    enabled.addEventListener('change', () => {
        if (enabled.checked) {
            const total = Number(heightInput.value) || 1000;
            inputs.columnHeightCm.value ||= Math.max(1, Math.round(total * .44));
            inputs.workHeightCm.value ||= Math.max(1, Math.round(total * .4));
            inputs.workWidthCm.value ||= Math.max(1, Math.round(Number(widthInput.value) * .45));
            inputs.workDepthCm.value ||= Math.max(1, Math.round(Number(depthInput.value) * .45));
            const remainder = total - Number(inputs.columnHeightCm.value) - Number(inputs.workHeightCm.value);
            heightInput.value = remainder > 0 ? remainder : Math.max(1, Math.round(total * .16));
        } else {
            const data = normalizeSculpturePedestal({
                baseHeightCm: mmToCm(heightInput.value),
                ...Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, mmToCm(input.value)]))
            });
            if (data) heightInput.value = cmToMm(sculpturePedestalTotalHeight(data));
        }
        refresh();
        onChange();
    });
    Object.values(inputs).forEach(input => input.addEventListener('input', () => { refresh(); onChange(); }));
    const load = artwork => {
        previousHeight = null;
        wasEnabled = false;
        const data = normalizeSculpturePedestal(artwork.sculpturePedestal);
        enabled.checked = Boolean(data && artwork.displayType === 'sculpture');
        for (const [key, input] of Object.entries(inputs)) input.value = data ? cmToMm(data[key]) : '';
        heightInput.value = cmToMm(enabled.checked ? data.baseHeightCm : artwork.cmHeight);
        refresh();
    };
    refresh();
    return { read, refresh, load, deactivate, enabled };
}
