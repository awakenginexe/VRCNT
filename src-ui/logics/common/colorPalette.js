const HEX_COLOR_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export const APP_COLOR_PALETTE_DEFAULTS = Object.freeze({
    primary: "#9B6DFF",
    secondary: "#A87CFF",
    gradientStart: "#8B5CF6",
    gradientEnd: "#A87CFF",
    canvas: "#08070B",
    backgroundStart: "#08070B",
    backgroundEnd: "#08070B",
    surface1: "#100D15",
    surface2: "#15111C",
    surface3: "#1B1526",
    surfaceOverlay: "#0E0B14",
    surfaceControl: "#0B0910",
    textStrong: "#F8F5FB",
    text: "#E7E1EF",
    textMuted: "#958AA3",
    textSubtle: "#746A80",
    border: "#463C51",
    focus: "#9B6DFF",
    success: "#5BE2B5",
    warning: "#F2B84B",
    error: "#FF7180",
    info: "#38BDF8",
    sent: "#5BE2B5",
    received: "#CBB8FF",
    translation: "#CBB8FF",
});

export const DEFAULT_OVERLAY_COLOR_PALETTE = Object.freeze({
    primary: "#00E5FF",
    secondary: "#67F3FF",
    background: "#000000",
    panel: "#0A1016",
    border: "#00E5FF",
    text: "#F4F7FA",
    textMuted: "#B0BAC6",
    sent: "#00E5FF",
    received: "#E680DC",
    translation: "#E680DC",
    success: "#5BE2B5",
    warning: "#F2B84B",
    error: "#FF7180",
    info: "#67E8F9",
});

export const APP_COLOR_ROLE_GROUPS = Object.freeze([
    Object.freeze({ id: "brand", roles: Object.freeze(["primary", "secondary", "gradientStart", "gradientEnd"]) }),
    Object.freeze({ id: "surfaces", roles: Object.freeze(["canvas", "backgroundStart", "backgroundEnd", "surface1", "surface2", "surface3", "surfaceOverlay", "surfaceControl"]) }),
    Object.freeze({ id: "content", roles: Object.freeze(["textStrong", "text", "textMuted", "textSubtle", "border", "focus"]) }),
    Object.freeze({ id: "status", roles: Object.freeze(["success", "warning", "error", "info", "sent", "received", "translation"]) }),
]);

export const OVERLAY_COLOR_ROLE_GROUPS = Object.freeze([
    Object.freeze({ id: "brand", roles: Object.freeze(["primary", "secondary", "border"]) }),
    Object.freeze({ id: "surfaces", roles: Object.freeze(["background", "panel"]) }),
    Object.freeze({ id: "content", roles: Object.freeze(["text", "textMuted"]) }),
    Object.freeze({ id: "messages", roles: Object.freeze(["sent", "received", "translation"]) }),
    Object.freeze({ id: "status", roles: Object.freeze(["success", "warning", "error", "info"]) }),
]);

const legacyOverlayPalette = (primary, secondary = primary) => ({
    ...DEFAULT_OVERLAY_COLOR_PALETTE,
    primary,
    secondary,
    border: primary,
    sent: primary,
});

export const LEGACY_OVERLAY_COLOR_PALETTES = Object.freeze({
    "theme-neon-cyan": Object.freeze(legacyOverlayPalette("#00E5FF", "#67F3FF")),
    "theme-midnight-purple": Object.freeze(legacyOverlayPalette("#A78BFA", "#C4B5FD")),
    "theme-emerald-green": Object.freeze(legacyOverlayPalette("#10B981", "#6EE7B7")),
    "theme-sakura-pink": Object.freeze(legacyOverlayPalette("#F472B6", "#F9A8D4")),
});

export const normalizeHexColor = (value) => {
    if (typeof value !== "string") return null;
    const match = value.trim().match(HEX_COLOR_PATTERN);
    if (!match) return null;
    const hex = match[1].length === 3
        ? match[1].split("").map((part) => `${part}${part}`).join("")
        : match[1];
    return `#${hex.toUpperCase()}`;
};

export const hexToRgb = (value) => {
    const normalized = normalizeHexColor(value);
    if (!normalized) return null;
    return {
        r: Number.parseInt(normalized.slice(1, 3), 16),
        g: Number.parseInt(normalized.slice(3, 5), 16),
        b: Number.parseInt(normalized.slice(5, 7), 16),
    };
};

export const hexToRgbString = (value) => {
    const rgb = hexToRgb(value);
    return rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : "0, 0, 0";
};

export const normalizeColorPalette = (candidate = {}, defaults = APP_COLOR_PALETTE_DEFAULTS) => {
    const source = candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? candidate
        : {};
    return Object.fromEntries(Object.entries(defaults).map(([role, fallback]) => [
        role,
        normalizeHexColor(source[role]) ?? normalizeHexColor(fallback) ?? "#000000",
    ]));
};

const relativeLuminance = (value) => {
    const rgb = hexToRgb(value) ?? { r: 0, g: 0, b: 0 };
    const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
};

export const getContrastRatio = (foreground, background) => {
    const foregroundLuminance = relativeLuminance(foreground);
    const backgroundLuminance = relativeLuminance(background);
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
};

const appCss = (palette) => ({
    "--palette_primary_color": palette.primary,
    "--palette_secondary_color": palette.secondary,
    "--palette_gradient_start_color": palette.gradientStart,
    "--palette_gradient_end_color": palette.gradientEnd,
    "--palette_canvas_color": palette.canvas,
    "--palette_background_start_color": palette.backgroundStart,
    "--palette_background_end_color": palette.backgroundEnd,
    "--palette_surface_1_color": palette.surface1,
    "--palette_surface_2_color": palette.surface2,
    "--palette_surface_3_color": palette.surface3,
    "--palette_surface_overlay_color": palette.surfaceOverlay,
    "--palette_surface_control_color": palette.surfaceControl,
    "--palette_text_strong_color": palette.textStrong,
    "--palette_text_color": palette.text,
    "--palette_text_muted_color": palette.textMuted,
    "--palette_text_subtle_color": palette.textSubtle,
    "--palette_border_color": palette.border,
    "--palette_focus_color": palette.focus,
    "--palette_success_color": palette.success,
    "--palette_warning_color": palette.warning,
    "--palette_error_color": palette.error,
    "--palette_info_color": palette.info,
    "--palette_sent_color": palette.sent,
    "--palette_received_color": palette.received,
    "--palette_translation_color": palette.translation,
    "--accent_color": palette.primary,
    "--accent_color_rgb": hexToRgbString(palette.primary),
    "--accent_secondary_color": palette.secondary,
    "--accent_secondary_color_rgb": hexToRgbString(palette.secondary),
    "--accent_gradient_start_color": palette.gradientStart,
    "--accent_gradient_end_color": palette.gradientEnd,
    "--accent_gradient_start_rgb": hexToRgbString(palette.gradientStart),
    "--accent_gradient_end_rgb": hexToRgbString(palette.gradientEnd),
    "--bg_gradient_start": palette.backgroundStart,
    "--bg_gradient_end": palette.backgroundEnd,
    "--canvas_color": palette.canvas,
    "--surface_overlay_base_color": palette.surfaceOverlay,
    "--surface_control_base_color": palette.surfaceControl,
    "--border_color": palette.border,
    "--focus_color": palette.focus,
    "--success_color": palette.success,
    "--warning_color": palette.warning,
    "--warning_color_rgb": hexToRgbString(palette.warning),
    "--error_color": palette.error,
    "--info_color": palette.info,
    "--sent_color": palette.sent,
    "--received_color": palette.received,
    "--translation_color": palette.translation,
});

export const getAppCssVariables = (candidate = {}) => appCss(
    normalizeColorPalette(candidate, APP_COLOR_PALETTE_DEFAULTS),
);

export const getOverlayCssVariables = (candidate = {}) => {
    const palette = normalizeColorPalette(candidate, DEFAULT_OVERLAY_COLOR_PALETTE);
    return {
        "--overlay_primary_color": palette.primary,
        "--overlay_primary_color_rgb": hexToRgbString(palette.primary),
        "--overlay_secondary_color": palette.secondary,
        "--overlay_secondary_color_rgb": hexToRgbString(palette.secondary),
        "--overlay_background_color": palette.background,
        "--overlay_panel_color": palette.panel,
        "--overlay_border_color": palette.border,
        "--overlay_border_color_rgb": hexToRgbString(palette.border),
        "--overlay_text_color": palette.text,
        "--overlay_text_muted_color": palette.textMuted,
        "--overlay_sent_color": palette.sent,
        "--overlay_received_color": palette.received,
        "--overlay_translation_color": palette.translation,
        "--overlay_success_color": palette.success,
        "--overlay_warning_color": palette.warning,
        "--overlay_error_color": palette.error,
        "--overlay_info_color": palette.info,
    };
};

export const getLegacyOverlayColorPalette = (accentId) => normalizeColorPalette(
    LEGACY_OVERLAY_COLOR_PALETTES[accentId] ?? LEGACY_OVERLAY_COLOR_PALETTES["theme-neon-cyan"],
    DEFAULT_OVERLAY_COLOR_PALETTE,
);
