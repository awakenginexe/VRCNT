import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { hexToHsv, hsvToHex, normalizeHue } from "../../../views/common_components/color_picker/colorMath.js";

const root = path.resolve(import.meta.dirname, "../../../..");
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("HSV conversion round-trips a custom hex color", () => {
    const hsv = hexToHsv("#1A2B3C");
    assert.equal(hsvToHex(hsv), "#1A2B3C");
    assert.equal(normalizeHue(-30), 330);
});

test("color-role editor exposes an explicit hex field and reset action", () => {
    const source = [
        readSource("src-ui/views/common_components/color_picker/ColorRoleEditor.jsx"),
        readSource("src-ui/views/common_components/color_picker/ColorPicker.jsx"),
    ].join("\n");
    assert.match(source, /type="text"/);
    assert.match(source, /Reset/);
});

test("color picker exposes keyboard-accessible hue and saturation/value controls", () => {
    const source = readSource("src-ui/views/common_components/color_picker/ColorPicker.jsx");
    assert.match(source, /aria-label=.*Hue/);
    assert.match(source, /aria-label=.*Saturation/);
    assert.match(source, /aria-label=.*Brightness|Value/);
});
