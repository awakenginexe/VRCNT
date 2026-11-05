import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
    APP_COLOR_PALETTE_DEFAULTS,
    DEFAULT_OVERLAY_COLOR_PALETTE,
    getAppCssVariables,
    getContrastRatio,
    normalizeColorPalette,
    normalizeHexColor,
} from "../colorPalette.js";

test("normalizes shorthand hex values and fills every app role", () => {
    const palette = normalizeColorPalette(
        { primary: "#abc" },
        APP_COLOR_PALETTE_DEFAULTS,
    );

    assert.equal(palette.primary, "#AABBCC");
    assert.equal(palette.canvas, APP_COLOR_PALETTE_DEFAULTS.canvas);
    assert.equal(Object.keys(palette).length, Object.keys(APP_COLOR_PALETTE_DEFAULTS).length);
});

test("invalid or unknown role values fall back to safe defaults", () => {
    const palette = normalizeColorPalette(
        { primary: "not-a-color", unknown: "#123456" },
        APP_COLOR_PALETTE_DEFAULTS,
    );

    assert.equal(palette.primary, APP_COLOR_PALETTE_DEFAULTS.primary);
    assert.equal(Object.hasOwn(palette, "unknown"), false);
    assert.equal(normalizeHexColor("#12"), null);
});

test("CSS variables expose the editable semantic app roles", () => {
    const variables = getAppCssVariables({
        ...APP_COLOR_PALETTE_DEFAULTS,
        primary: "#123456",
    });

    assert.equal(variables["--accent_color"], "#123456");
    assert.equal(variables["--accent_color_rgb"], "18, 52, 86");
    assert.equal(variables["--palette_text_color"], APP_COLOR_PALETTE_DEFAULTS.text);
});

test("contrast ratio remains useful for editor warnings", () => {
    assert.equal(getContrastRatio("#FFFFFF", "#000000"), 21);
    assert.equal(getContrastRatio(
        DEFAULT_OVERLAY_COLOR_PALETTE.text,
        DEFAULT_OVERLAY_COLOR_PALETTE.background,
    ) > 4.5, true);
});

test("default muted and subtle text meet 4.5:1 on every default surface", () => {
    for (const role of ["textMuted", "textSubtle"]) {
        for (const surface of ["surface1", "surface2", "surface3"]) {
            const ratio = getContrastRatio(
                APP_COLOR_PALETTE_DEFAULTS[role],
                APP_COLOR_PALETTE_DEFAULTS[surface],
            );
            assert.ok(ratio >= 4.5, `${role} on ${surface}: ${ratio}`);
        }
    }
});

test("variables.css defaults match the JS palette defaults", () => {
    const css = readFileSync(
        new URL("../../../views/app/_index_css/variables.css", import.meta.url),
        "utf8",
    );
    for (const [role, value] of Object.entries(APP_COLOR_PALETTE_DEFAULTS)) {
        const snake = role.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
            .replace(/(\D)(\d)/g, "$1_$2");
        const re = new RegExp(`--palette_${snake}_color:\\s*${value}\\b`, "i");
        assert.match(css, re, role);
    }
});
