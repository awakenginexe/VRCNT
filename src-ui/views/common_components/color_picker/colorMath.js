import { normalizeHexColor } from "../../../logics/common/colorPalette.js";

export const normalizeHue = (hue) => {
    const value = Number(hue);
    if (!Number.isFinite(value)) return 0;
    return ((value % 360) + 360) % 360;
};

export const hexToHsv = (hex) => {
    const normalized = normalizeHexColor(hex) ?? "#000000";
    const red = Number.parseInt(normalized.slice(1, 3), 16) / 255;
    const green = Number.parseInt(normalized.slice(3, 5), 16) / 255;
    const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    let hue = 0;

    if (delta !== 0) {
        if (max === red) hue = 60 * (((green - blue) / delta) % 6);
        else if (max === green) hue = 60 * (((blue - red) / delta) + 2);
        else hue = 60 * (((red - green) / delta) + 4);
    }

    return {
        h: normalizeHue(hue),
        s: max === 0 ? 0 : delta / max,
        v: max,
    };
};

export const hsvToHex = ({ h = 0, s = 0, v = 0 } = {}) => {
    const hue = normalizeHue(h) / 60;
    const saturation = Math.min(1, Math.max(0, Number(s) || 0));
    const value = Math.min(1, Math.max(0, Number(v) || 0));
    const chroma = value * saturation;
    const x = chroma * (1 - Math.abs((hue % 2) - 1));
    const match = value - chroma;
    let rgb;

    if (hue < 1) rgb = [chroma, x, 0];
    else if (hue < 2) rgb = [x, chroma, 0];
    else if (hue < 3) rgb = [0, chroma, x];
    else if (hue < 4) rgb = [0, x, chroma];
    else if (hue < 5) rgb = [x, 0, chroma];
    else rgb = [chroma, 0, x];

    return `#${rgb.map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
};

export const pointToSaturationValue = ({ clientX, clientY }, rect) => ({
    s: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    v: Math.min(1, Math.max(0, 1 - ((clientY - rect.top) / rect.height))),
});

export const pointToHue = ({ clientX, clientY }, rect) => {
    const x = clientX - (rect.left + rect.width / 2);
    const y = clientY - (rect.top + rect.height / 2);
    return normalizeHue((Math.atan2(y, x) * 180 / Math.PI) + 90);
};
