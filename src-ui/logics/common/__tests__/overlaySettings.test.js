import assert from "node:assert/strict";
import test from "node:test";

import {
    normalizeOverlaySettings,
    OVERLAY_SETTINGS_DEFAULTS,
} from "../overlaySettings.js";

test("transparent_black migrates to 71 percent background opacity", () => {
    const settings = normalizeOverlaySettings({
        background_mode: "transparent_black",
    }, "small");
    assert.equal(settings.background_opacity, 71);
});

test("solid_black migrates to fully solid background opacity", () => {
    const settings = normalizeOverlaySettings({
        background_mode: "solid_black",
    }, "large");
    assert.equal(settings.background_opacity, 100);
});

test("overlay style values are clamped and booleans preserve defaults", () => {
    const settings = normalizeOverlaySettings({
        background_opacity: -10,
        text_outline_width: 99,
        canvas_width: 1,
        canvas_height: 99999,
        border_enabled: false,
        text_outline_enabled: true,
    }, "small");

    assert.equal(settings.background_opacity, 0);
    assert.equal(settings.text_outline_width, 12);
    assert.equal(settings.canvas_width, 640);
    assert.equal(settings.canvas_height, 2048);
    assert.equal(settings.border_enabled, false);
    assert.equal(settings.text_outline_enabled, true);
});

test("both modes keep zero height as automatic sizing", () => {
    const small = normalizeOverlaySettings({ canvas_height: 0 }, "small");
    const settings = normalizeOverlaySettings({ canvas_height: 0 }, "large");
    assert.equal(small.canvas_height, 0);
    assert.equal(settings.canvas_height, 0);
    assert.equal(OVERLAY_SETTINGS_DEFAULTS.large.canvas_width, 1312);
});
