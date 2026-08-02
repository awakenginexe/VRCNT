import assert from "node:assert/strict";
import test from "node:test";

import {
    DESKTOP_OVERLAY_DEFAULT_SETTINGS,
    applyDesktopOverlayGeometry,
    estimateDesktopOverlayFitHeight,
    normalizeDesktopOverlaySettings,
    readDesktopOverlaySettings,
    writeDesktopOverlaySettings,
} from "../desktopOverlaySettings.js";
import {
    DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY,
} from "../desktopOverlayWindow.js";

class MemoryStorage {
    constructor(entries = {}) {
        this.values = new Map(Object.entries(entries));
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }

    removeItem(key) {
        this.values.delete(key);
    }
}

test("desktop overlay settings persist geometry within real window constraints", () => {
    const settings = normalizeDesktopOverlaySettings({
        opacity: 27,
        geometry: {
            width: 1200,
            height: 80,
            maxHeight: 960,
            autoHeight: true,
        },
    });

    assert.deepEqual(settings.geometry, {
        width: 960,
        height: 160,
        maxHeight: 720,
        autoHeight: true,
    });
    assert.equal(settings.opacity, 45);

    const storage = new MemoryStorage();
    writeDesktopOverlaySettings(settings, storage);
    assert.equal(storage.getItem(DESKTOP_OVERLAY_SETTINGS_STORAGE_KEY) !== null, true);
    assert.deepEqual(readDesktopOverlaySettings(storage), settings);
    assert.equal(DESKTOP_OVERLAY_DEFAULT_SETTINGS.geometry.width, 520);
});

test("fit-to-content size is derived from the real visible log count and remains bounded", () => {
    assert.equal(estimateDesktopOverlayFitHeight({ visibleLogCount: 0 }), 160);
    assert.equal(estimateDesktopOverlayFitHeight({ visibleLogCount: 2 }), 240);
    assert.equal(estimateDesktopOverlayFitHeight({ visibleLogCount: 99 }), 720);
});

test("geometry updates target the existing production overlay window only", async () => {
    const calls = [];
    class PhysicalSize {
        constructor(width, height) {
            this.width = width;
            this.height = height;
        }
    }
    const overlayWindow = {
        async setSize(size) {
            calls.push(size);
        },
    };

    const result = await applyDesktopOverlayGeometry({
        settings: {
            geometry: { width: 640, height: 320, maxHeight: 480, autoHeight: false },
        },
        isTauri: true,
        PhysicalSize,
        WebviewWindow: {
            async getByLabel(label) {
                assert.equal(label, "desktop-overlay");
                return overlayWindow;
            },
        },
    });

    assert.equal(result, overlayWindow);
    assert.deepEqual(calls, [new PhysicalSize(640, 320)]);
});

test("geometry updates resolve the production Window API handle", async () => {
    const calls = [];
    class PhysicalSize {
        constructor(width, height) {
            this.width = width;
            this.height = height;
        }
    }
    const overlayWindow = {
        async setSize(size) {
            calls.push(size);
        },
    };

    const result = await applyDesktopOverlayGeometry({
        settings: {
            geometry: { width: 520, height: 240, maxHeight: 440, autoHeight: false },
        },
        isTauri: true,
        PhysicalSize,
        Window: {
            async getByLabel(label) {
                assert.equal(label, "desktop-overlay");
                return overlayWindow;
            },
        },
    });

    assert.equal(result, overlayWindow);
    assert.deepEqual(calls, [new PhysicalSize(520, 240)]);
});
