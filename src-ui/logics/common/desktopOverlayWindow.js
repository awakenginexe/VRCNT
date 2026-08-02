import { isTauriRuntime } from "./tauriRuntime.js";

export const DESKTOP_OVERLAY_WINDOW_LABEL = "desktop-overlay";
export const DESKTOP_OVERLAY_CHANNEL = "vrcnt-desktop-overlay";
export const DESKTOP_OVERLAY_STORAGE_KEY = "vrcnt-desktop-overlay-payload";
export const DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY = "vrcnt-desktop-overlay-settings";
export const LEGACY_DESKTOP_OVERLAY_STORAGE_KEY = "vrcnt-next-desktop-overlay-payload";
export const LEGACY_DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY = "vrcnt-next-desktop-overlay-settings";

const desktopOverlayWindows = new WeakMap();

export const buildDesktopOverlayRoute = () => `index.html?window=${DESKTOP_OVERLAY_WINDOW_LABEL}`;

export const isDesktopOverlayRoute = (search = globalThis.window?.location?.search ?? "") => {
    const params = new URLSearchParams(search);
    return params.get("window") === DESKTOP_OVERLAY_WINDOW_LABEL;
};

export const buildDesktopOverlayWindowOptions = (settings = {}) => {
    const geometry = settings?.geometry ?? {};
    const width = Number.isFinite(Number(geometry.width)) ? Number(geometry.width) : 520;
    const height = Number.isFinite(Number(geometry.height)) ? Number(geometry.height) : 240;

    return {
        url: buildDesktopOverlayRoute(),
        title: "VRCNT Desktop Overlay",
        width,
        height,
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
    };
};

const focusExistingOverlayWindow = async (overlayWindow) => {
    if (!overlayWindow) return null;

    // The overlay is already usable when the platform rejects a redundant
    // unminimize or focus request. Keep reusing it instead of attempting a
    // second window with the same label.
    if (typeof overlayWindow.unminimize === "function") {
        try {
            await overlayWindow.unminimize();
        } catch {}
    }
    if (typeof overlayWindow.setFocus === "function") {
        try {
            await overlayWindow.setFocus();
        } catch {}
    }
    return overlayWindow;
};

const isOverlayWindowAvailable = async (overlayWindow) => {
    if (!overlayWindow) return false;
    if (typeof overlayWindow.isVisible !== "function") return true;

    try {
        await overlayWindow.isVisible();
        return true;
    } catch {
        return false;
    }
};

const findExistingOverlayWindow = async ({ WebviewWindowApi, WindowApi }) => {
    const cachedWindow = desktopOverlayWindows.get(WebviewWindowApi);
    if (await isOverlayWindowAvailable(cachedWindow)) return cachedWindow;
    if (cachedWindow) desktopOverlayWindows.delete(WebviewWindowApi);

    try {
        const webviewWindow = await WebviewWindowApi.getByLabel(DESKTOP_OVERLAY_WINDOW_LABEL);
        if (webviewWindow) return webviewWindow;
    } catch {
        // The Window API fallback below can still find the utility window on
        // runtimes that do not permit a webview list lookup from this context.
    }

    if (!WindowApi) return null;
    try {
        return await WindowApi.getByLabel(DESKTOP_OVERLAY_WINDOW_LABEL);
    } catch {
        return null;
    }
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
    Window,
} = {}) => {
    if (!isTauri) {
        globalThis.window?.open?.(buildDesktopOverlayRoute(), DESKTOP_OVERLAY_WINDOW_LABEL, "popup,width=520,height=240");
        return null;
    }

    const WebviewWindowApi = WebviewWindow ?? (await import("@tauri-apps/api/webviewWindow")).WebviewWindow;
    const WindowApi = Window ?? (WebviewWindow
        ? null
        : (await import("@tauri-apps/api/window")).Window);
    const existingWindow = await findExistingOverlayWindow({ WebviewWindowApi, WindowApi });
    const focusedExistingWindow = await focusExistingOverlayWindow(existingWindow);
    if (focusedExistingWindow) {
        desktopOverlayWindows.set(WebviewWindowApi, focusedExistingWindow);
        return focusedExistingWindow;
    }

    const { readDesktopOverlaySettings } = await import("./desktopOverlaySettings.js");
    const overlayWindow = new WebviewWindowApi(
        DESKTOP_OVERLAY_WINDOW_LABEL,
        buildDesktopOverlayWindowOptions(readDesktopOverlaySettings()),
    );
    const createdWindow = await waitForOverlayWindowCreation(overlayWindow);
    desktopOverlayWindows.set(WebviewWindowApi, createdWindow);
    return createdWindow;
};

export const createDesktopOverlayPayload = ({
    messageLogs = [],
    translationEnabled = false,
    speakingEnabled = false,
    listeningEnabled = false,
    uiLanguage = "en",
    fontFamily = "VRCNT Noto",
} = {}) => ({
    messageLogs,
    statuses: {
        translationEnabled,
        speakingEnabled,
        listeningEnabled,
    },
    uiLanguage,
    fontFamily,
    updatedAt: Date.now(),
});

export const getDesktopOverlayLanguageProfiles = (payload = {}) => [
    payload?.uiLanguage,
    ...(payload?.messageLogs ?? []).flatMap((log) => [
        log?.source_language,
        ...(log?.messages?.translations ?? []).map((translation) => translation?.language),
    ]),
].filter(Boolean);

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
