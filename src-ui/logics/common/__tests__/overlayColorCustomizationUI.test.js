import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
    DEFAULT_OVERLAY_COLOR_PALETTE,
    getOverlayCssVariables,
} from "../colorPalette.js";
import {
    createDesktopOverlayPayload,
    getDesktopOverlayPayloadSignature,
} from "../desktopOverlayWindow.js";

const root = path.resolve(import.meta.dirname, "../../../..");
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("overlay payload carries normalized custom colors and detects palette changes", () => {
    const payload = createDesktopOverlayPayload({
        overlayColorPalette: { primary: "#123456" },
    });
    const changed = {
        ...payload,
        overlayColorPalette: { ...payload.overlayColorPalette, primary: "#654321" },
    };

    assert.equal(payload.overlayColorPalette.primary, "#123456");
    assert.equal(payload.overlayColorPalette.background, DEFAULT_OVERLAY_COLOR_PALETTE.background);
    assert.notEqual(getDesktopOverlayPayloadSignature(payload), getDesktopOverlayPayloadSignature(changed));
    assert.equal(getOverlayCssVariables(payload.overlayColorPalette)["--overlay_primary_color"], "#123456");
});

test("Overlay Studio owns the shared editor instead of a preset-only selector", () => {
    const studio = readSource("src-ui/views/app/main_page/overlay_studio/OverlayStudio.jsx");
    const bridge = readSource("src-ui/views/app/desktop_overlay/DesktopOverlayBridge.jsx");
    const app = readSource("src-ui/views/app/desktop_overlay/DesktopOverlayApp.jsx");
    const preview = readSource("src-ui/views/app/desktop_overlay/DesktopOverlayPreview.jsx");

    assert.match(studio, /ColorRoleEditor/);
    assert.match(studio, /currentOverlayColorPalette/);
    assert.match(studio, /setOverlayColorPalette/);
    assert.doesNotMatch(studio, /DESKTOP_OVERLAY_ACCENTS/);
    assert.doesNotMatch(studio, /<select[\s\S]*activeAccent\.id/);
    assert.match(bridge, /overlayColorPalette/);
    assert.match(app, /getOverlayCssVariables/);
    assert.match(preview, /overlayColorPalette/);
});
