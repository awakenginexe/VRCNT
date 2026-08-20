export const OVERLAY_SETTINGS_DEFAULTS = {
    small: {
        background_opacity: 71,
        border_enabled: true,
        text_outline_enabled: false,
        text_outline_width: 0,
        canvas_width: 3940,
        canvas_height: 0,
    },
    large: {
        background_opacity: 71,
        border_enabled: true,
        text_outline_enabled: false,
        text_outline_width: 0,
        canvas_width: 1312,
        canvas_height: 0,
    },
};

const clamp = (value, minimum, maximum) => Math.min(
    maximum,
    Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : minimum),
);

const asBoolean = (value, fallback) => (
    typeof value === "boolean" ? value : fallback
);

export const normalizeOverlaySettings = (settings = {}, mode = "small") => {
    const selectedMode = mode === "large" ? "large" : "small";
    const defaults = OVERLAY_SETTINGS_DEFAULTS[selectedMode];
    const source = settings && typeof settings === "object" ? settings : {};
    const legacyOpacity = source.background_mode === "solid_black" ? 100 : 71;
    const height = Number(source.canvas_height) === 0
        ? 0
        : clamp(source.canvas_height ?? defaults.canvas_height, 64, 2048);

    return {
        ...source,
        background_opacity: Math.round(clamp(
            source.background_opacity ?? legacyOpacity,
            0,
            100,
        )),
        border_enabled: asBoolean(source.border_enabled, defaults.border_enabled),
        text_outline_enabled: asBoolean(
            source.text_outline_enabled,
            defaults.text_outline_enabled,
        ),
        text_outline_width: Math.round(clamp(
            source.text_outline_width ?? defaults.text_outline_width,
            0,
            12,
        )),
        canvas_width: Math.round(clamp(
            source.canvas_width ?? defaults.canvas_width,
            640,
            7680,
        )),
        canvas_height: Math.round(height),
    };
};
