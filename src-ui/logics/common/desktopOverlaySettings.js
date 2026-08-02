import {
    DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY,
    DESKTOP_OVERLAY_WINDOW_LABEL,
    LEGACY_DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY,
    readMigratedStorageValue,
} from "./desktopOverlayWindow.js";
import { isTauriRuntime } from "./tauriRuntime.js";

export const DESKTOP_OVERLAY_SETTINGS_CHANNEL = "vrcnt-desktop-overlay-settings";
export const DESKTOP_OVERLAY_CONTROL_CHANNEL = "vrcnt-desktop-overlay-control";

export const DESKTOP_OVERLAY_WINDOW_CONSTRAINTS = {
    minWidth: 360,
    maxWidth: 960,
    minHeight: 160,
    maxHeight: 720,
    minContentHeight: 200,
};

export const DESKTOP_OVERLAY_ACCENTS = [
    { id: "theme-neon-cyan", label: "Neon cyan", color: "#00e5ff", rgb: "0, 229, 255" },
    { id: "theme-midnight-purple", label: "Midnight purple", color: "#a78bfa", rgb: "167, 139, 250" },
    { id: "theme-emerald-green", label: "Emerald green", color: "#10b981", rgb: "16, 185, 129" },
    { id: "theme-sakura-pink", label: "Sakura pink", color: "#f472b6", rgb: "244, 114, 182" },
];

export const DESKTOP_OVERLAY_DEFAULT_SETTINGS = {
    pinned: true,
    opacity: 92,
    scale: 100,
    translationsOnly: false,
    expanded: true,
    accentColor: "theme-neon-cyan",
    geometry: {
        width: 520,
        height: 240,
        maxHeight: 440,
        autoHeight: false,
    },
};

const numberOr = (value, fallback) => (
    Number.isFinite(Number(value)) ? Number(value) : fallback
);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const knownAccent = (accent) => DESKTOP_OVERLAY_ACCENTS.some((item) => item.id === accent);

export const getDesktopOverlayAccent = (accentId) => (
    DESKTOP_OVERLAY_ACCENTS.find((item) => item.id === accentId)
    ?? DESKTOP_OVERLAY_ACCENTS[0]
);

export const normalizeDesktopOverlaySettings = (candidate = {}) => {
    const base = DESKTOP_OVERLAY_DEFAULT_SETTINGS;
    const requestedGeometry = candidate?.geometry ?? {};
    const maxHeight = clamp(
        numberOr(requestedGeometry.maxHeight, base.geometry.maxHeight),
        DESKTOP_OVERLAY_WINDOW_CONSTRAINTS.minContentHeight,
        DESKTOP_OVERLAY_WINDOW_CONSTRAINTS.maxHeight,
    );
    const height = Math.min(
        clamp(
            numberOr(requestedGeometry.height, base.geometry.height),
            DESKTOP_OVERLAY_WINDOW_CONSTRAINTS.minHeight,
            DESKTOP_OVERLAY_WINDOW_CONSTRAINTS.maxHeight,
        ),
        maxHeight,
    );

    return {
        pinned: candidate?.pinned !== false,
        opacity: clamp(numberOr(candidate?.opacity, base.opacity), 45, 100),
        scale: clamp(numberOr(candidate?.scale, base.scale), 80, 130),
        translationsOnly: candidate?.translationsOnly === true,
        expanded: candidate?.expanded !== false,
        accentColor: knownAccent(candidate?.accentColor)
            ? candidate.accentColor
            : base.accentColor,
        geometry: {
            width: clamp(
                numberOr(requestedGeometry.width, base.geometry.width),
                DESKTOP_OVERLAY_WINDOW_CONSTRAINTS.minWidth,
                DESKTOP_OVERLAY_WINDOW_CONSTRAINTS.maxWidth,
            ),
            height,
            maxHeight,
            autoHeight: requestedGeometry.autoHeight === true,
        },
    };
};

export const readDesktopOverlaySettings = (storage = globalThis.localStorage) => {
    try {
        const rawSettings = readMigratedStorageValue(
            storage,
            DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY,
            LEGACY_DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY,
        );
        return normalizeDesktopOverlaySettings(rawSettings ? JSON.parse(rawSettings) : {});
    } catch (error) {
        console.warn("Unable to read desktop overlay settings.", error);
        return normalizeDesktopOverlaySettings();
    }
};

const publishDesktopOverlaySettings = (settings) => {
    try {
        const channel = new BroadcastChannel(DESKTOP_OVERLAY_SETTINGS_CHANNEL);
        channel.postMessage(settings);
        channel.close();
    } catch {
        // Storage remains the compatibility transport for runtimes without BroadcastChannel.
    }
};

export const writeDesktopOverlaySettings = (
    candidate,
    storage = globalThis.localStorage,
) => {
    const settings = normalizeDesktopOverlaySettings(candidate);
    try {
        storage?.setItem?.(DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
        publishDesktopOverlaySettings(settings);
    } catch (error) {
        console.warn("Unable to update desktop overlay settings.", error);
    }
    return settings;
};

export const estimateDesktopOverlayFitHeight = ({ visibleLogCount = 0 } = {}) => (
    clamp(
        DESKTOP_OVERLAY_WINDOW_CONSTRAINTS.minHeight + (Math.max(0, Number(visibleLogCount) || 0) * 40),
        DESKTOP_OVERLAY_WINDOW_CONSTRAINTS.minHeight,
        DESKTOP_OVERLAY_WINDOW_CONSTRAINTS.maxHeight,
    )
);

export const applyDesktopOverlayGeometry = async ({
    settings,
    isTauri = isTauriRuntime(),
    Window,
    WebviewWindow,
    PhysicalSize,
} = {}) => {
    if (!isTauri) return null;

    const normalizedSettings = normalizeDesktopOverlaySettings(settings);
    const windowModule = (Window || WebviewWindow) && PhysicalSize
        ? null
        : await import("@tauri-apps/api/window");
    const WindowApi = Window ?? WebviewWindow ?? windowModule.Window;
    const PhysicalSizeApi = PhysicalSize ?? windowModule.PhysicalSize;
    const overlayWindow = await WindowApi.getByLabel(DESKTOP_OVERLAY_WINDOW_LABEL);
    if (!overlayWindow) return null;

    await overlayWindow.setSize(new PhysicalSizeApi(
        normalizedSettings.geometry.width,
        normalizedSettings.geometry.height,
    ));
    return overlayWindow;
};

export const sendDesktopOverlayControl = (command) => {
    try {
        const channel = new BroadcastChannel(DESKTOP_OVERLAY_CONTROL_CHANNEL);
        channel.postMessage(command);
        channel.close();
        return true;
    } catch {
        return false;
    }
};
