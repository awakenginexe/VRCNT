import { isTauriRuntime } from "./tauriRuntime.js";

export const DESKTOP_OVERLAY_WINDOW_LABEL = "desktop-overlay";
export const DESKTOP_OVERLAY_CHANNEL = "vrcnt-desktop-overlay";
export const DESKTOP_OVERLAY_STORAGE_KEY = "vrcnt-desktop-overlay-payload";
export const DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY = "vrcnt-desktop-overlay-settings";
export const LEGACY_DESKTOP_OVERLAY_STORAGE_KEY = "vrcnt-next-desktop-overlay-payload";
export const LEGACY_DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY = "vrcnt-next-desktop-overlay-settings";

export const buildDesktopOverlayRoute = () => `index.html?window=${DESKTOP_OVERLAY_WINDOW_LABEL}`;

export const isDesktopOverlayRoute = (search = globalThis.window?.location?.search ?? "") => {
    const params = new URLSearchParams(search);
    return params.get("window") === DESKTOP_OVERLAY_WINDOW_LABEL;
};

export const buildDesktopOverlayWindowOptions = () => ({
    url: buildDesktopOverlayRoute(),
    title: "VRCNT Desktop Overlay",
    width: 520,
    height: 240,
    minWidth: 360,
    minHeight: 160,
    decorations: false,
    transparent: true,
    shadow: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    visible: true,
    center: true,
    focus: true,
});

const focusExistingOverlayWindow = async (overlayWindow) => {
    if (!overlayWindow) return null;
    if (typeof overlayWindow.unminimize === "function") await overlayWindow.unminimize();
    if (typeof overlayWindow.setFocus === "function") await overlayWindow.setFocus();
    return overlayWindow;
};

const createDesktopOverlayError = (event) => {
    if (event?.payload instanceof Error) return event.payload;
    const message = typeof event?.payload === "string"
        ? event.payload
        : "Unable to create desktop overlay window.";
    return new Error(message);
};

const waitForOverlayWindowCreation = (overlayWindow) => {
    if (!overlayWindow || typeof overlayWindow.once !== "function") {
        return Promise.resolve(overlayWindow);
    }

    return new Promise((resolve, reject) => {
        let isSettled = false;
        let unlistenCreated = null;
        let unlistenError = null;

        const cleanup = () => {
            unlistenCreated?.();
            unlistenError?.();
        };

        const settle = (callback) => (event) => {
            if (isSettled) return;
            isSettled = true;
            cleanup();
            callback(event);
        };

        overlayWindow.once("tauri://created", settle(() => resolve(overlayWindow)))
            .then((unlisten) => {
                unlistenCreated = unlisten;
            })
            .catch(reject);

        overlayWindow.once("tauri://error", settle((event) => reject(createDesktopOverlayError(event))))
            .then((unlisten) => {
                unlistenError = unlisten;
            })
            .catch(reject);
    });
};

export const openDesktopOverlayWindow = async ({
    isTauri = isTauriRuntime(),
    WebviewWindow,
} = {}) => {
    if (!isTauri) {
        globalThis.window?.open?.(buildDesktopOverlayRoute(), DESKTOP_OVERLAY_WINDOW_LABEL, "popup,width=520,height=240");
        return null;
    }

    const WebviewWindowApi = WebviewWindow ?? (await import("@tauri-apps/api/webviewWindow")).WebviewWindow;
    const existingWindow = await WebviewWindowApi.getByLabel(DESKTOP_OVERLAY_WINDOW_LABEL);
    const focusedExistingWindow = await focusExistingOverlayWindow(existingWindow);
    if (focusedExistingWindow) return focusedExistingWindow;

    const overlayWindow = new WebviewWindowApi(DESKTOP_OVERLAY_WINDOW_LABEL, buildDesktopOverlayWindowOptions());
    return waitForOverlayWindowCreation(overlayWindow);
};

export const createDesktopOverlayPayload = ({
    messageLogs = [],
    translationEnabled = false,
    speakingEnabled = false,
    listeningEnabled = false,
    uiLanguage = "en",
} = {}) => ({
    messageLogs,
    statuses: {
        translationEnabled,
        speakingEnabled,
        listeningEnabled,
    },
    uiLanguage,
    updatedAt: Date.now(),
});

export const readMigratedStorageValue = (
    storage,
    currentKey,
    legacyKey,
) => {
    const currentValue = storage?.getItem?.(currentKey);
    if (currentValue !== null && currentValue !== undefined) {
        return currentValue;
    }
    const legacyValue = storage?.getItem?.(legacyKey);
    if (legacyValue === null || legacyValue === undefined) return null;
    storage.setItem(currentKey, legacyValue);
    storage.removeItem(legacyKey);
    return legacyValue;
};

export const readDesktopOverlayPayload = (
    storage = globalThis.localStorage,
) => {
    try {
        const rawPayload = readMigratedStorageValue(
            storage,
            DESKTOP_OVERLAY_STORAGE_KEY,
            LEGACY_DESKTOP_OVERLAY_STORAGE_KEY,
        );
        return rawPayload ? JSON.parse(rawPayload) : null;
    } catch (error) {
        console.warn("Unable to read desktop overlay payload.", error);
        return null;
    }
};
