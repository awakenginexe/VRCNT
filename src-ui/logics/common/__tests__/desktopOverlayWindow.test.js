import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
    DESKTOP_OVERLAY_CHANNEL,
    DESKTOP_OVERLAY_STORAGE_KEY,
    DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY,
    LEGACY_DESKTOP_OVERLAY_STORAGE_KEY,
    LEGACY_DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY,
    DESKTOP_OVERLAY_WINDOW_LABEL,
    buildDesktopOverlayRoute,
    buildDesktopOverlayWindowOptions,
    openDesktopOverlayWindow,
    readDesktopOverlayPayload,
    readMigratedStorageValue,
} from "../desktopOverlayWindow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");

class MemoryStorage {
    constructor(entries = {}, { failWrites = false } = {}) {
        this.values = new Map(Object.entries(entries));
        this.failWrites = failWrites;
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    setItem(key, value) {
        if (this.failWrites) throw new Error("storage write failed");
        this.values.set(key, String(value));
    }

    removeItem(key) {
        this.values.delete(key);
    }
}

test("desktop overlay identifiers use canonical VRCNT names", () => {
    assert.equal(DESKTOP_OVERLAY_CHANNEL, "vrcnt-desktop-overlay");
    assert.equal(
        DESKTOP_OVERLAY_STORAGE_KEY,
        "vrcnt-desktop-overlay-payload",
    );
    assert.equal(
        DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY,
        "vrcnt-desktop-overlay-settings",
    );
});

test("desktop overlay payload migrates its legacy storage value", () => {
    const rawPayload = JSON.stringify({ messageLogs: [{ id: "legacy" }] });
    const storage = new MemoryStorage({
        [LEGACY_DESKTOP_OVERLAY_STORAGE_KEY]: rawPayload,
    });

    assert.deepEqual(
        readDesktopOverlayPayload(storage),
        { messageLogs: [{ id: "legacy" }] },
    );
    assert.equal(storage.getItem(DESKTOP_OVERLAY_STORAGE_KEY), rawPayload);
    assert.equal(storage.getItem(LEGACY_DESKTOP_OVERLAY_STORAGE_KEY), null);
});

test("current overlay storage wins without deleting a legacy value", () => {
    const currentRaw = JSON.stringify({ source: "current" });
    const legacyRaw = JSON.stringify({ source: "legacy" });
    const storage = new MemoryStorage({
        [DESKTOP_OVERLAY_STORAGE_KEY]: currentRaw,
        [LEGACY_DESKTOP_OVERLAY_STORAGE_KEY]: legacyRaw,
    });

    assert.deepEqual(
        readDesktopOverlayPayload(storage),
        { source: "current" },
    );
    assert.equal(
        storage.getItem(LEGACY_DESKTOP_OVERLAY_STORAGE_KEY),
        legacyRaw,
    );
});

test("failed overlay migration write preserves the legacy value", () => {
    const legacyRaw = JSON.stringify({ source: "legacy" });
    const storage = new MemoryStorage(
        { [LEGACY_DESKTOP_OVERLAY_STORAGE_KEY]: legacyRaw },
        { failWrites: true },
    );

    assert.equal(readDesktopOverlayPayload(storage), null);
    assert.equal(
        storage.getItem(LEGACY_DESKTOP_OVERLAY_STORAGE_KEY),
        legacyRaw,
    );
});

test("overlay settings use the same safe storage migration", () => {
    const legacyRaw = JSON.stringify({ opacity: 80 });
    const storage = new MemoryStorage({
        [LEGACY_DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY]: legacyRaw,
    });

    assert.equal(
        readMigratedStorageValue(
            storage,
            DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY,
            LEGACY_DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY,
        ),
        legacyRaw,
    );
    assert.equal(
        storage.getItem(DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY),
        legacyRaw,
    );
    assert.equal(
        storage.getItem(LEGACY_DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY),
        null,
    );
});

test("desktop overlay window options create a separate frosted utility window", () => {
    assert.equal(DESKTOP_OVERLAY_WINDOW_LABEL, "desktop-overlay");
    assert.equal(buildDesktopOverlayRoute(), "index.html?window=desktop-overlay");

    assert.deepEqual(buildDesktopOverlayWindowOptions(), {
        url: "index.html?window=desktop-overlay",
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
});

test("opening desktop overlay focuses an existing overlay before creating a new one", async () => {
    const calls = [];
    const existingWindow = {
        async unminimize() {
            calls.push("unminimize");
        },
        async setFocus() {
            calls.push("setFocus");
        },
    };

    const result = await openDesktopOverlayWindow({
        isTauri: true,
        WebviewWindow: {
            async getByLabel(label) {
                calls.push(["getByLabel", label]);
                return existingWindow;
            },
        },
    });

    assert.equal(result, existingWindow);
    assert.deepEqual(calls, [
        ["getByLabel", "desktop-overlay"],
        "unminimize",
        "setFocus",
    ]);
});

test("opening desktop overlay creates the utility window when no overlay exists", async () => {
    const calls = [];

    class FakeWebviewWindow {
        constructor(label, options) {
            calls.push(["create", label, options]);
            this.label = label;
            this.options = options;
        }

        static async getByLabel(label) {
            calls.push(["getByLabel", label]);
            return null;
        }
    }

    const result = await openDesktopOverlayWindow({
        isTauri: true,
        WebviewWindow: FakeWebviewWindow,
    });

    assert.equal(result.label, "desktop-overlay");
    assert.equal(result.options.url, "index.html?window=desktop-overlay");
    assert.equal(result.options.alwaysOnTop, true);
    assert.deepEqual(calls[0], ["getByLabel", "desktop-overlay"]);
    assert.equal(calls[1][0], "create");
});

test("opening desktop overlay rejects when Tauri reports a creation error", async () => {
    class FailingWebviewWindow {
        constructor(label, options) {
            this.label = label;
            this.options = options;
            this.listeners = new Map();
            queueMicrotask(() => {
                const listener = this.listeners.get("tauri://error");
                listener?.({ payload: "permission denied" });
            });
        }

        static async getByLabel() {
            return null;
        }

        async once(eventName, listener) {
            this.listeners.set(eventName, listener);
            return async () => this.listeners.delete(eventName);
        }
    }

    await assert.rejects(
        openDesktopOverlayWindow({
            isTauri: true,
            WebviewWindow: FailingWebviewWindow,
        }),
        /permission denied/,
    );
});

test("tauri capabilities allow the main window to create the desktop overlay window", async () => {
    const capabilityPath = resolve(repoRoot, "src-tauri/capabilities/vrct_capability.json");
    const capability = JSON.parse(await readFile(capabilityPath, "utf8"));

    assert.ok(capability.windows.includes("main"));
    assert.ok(capability.windows.includes("desktop-overlay"));
    assert.ok(capability.permissions.includes("core:webview:allow-create-webview-window"));
});
