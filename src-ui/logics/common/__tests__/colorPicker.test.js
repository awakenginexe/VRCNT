import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
    getContainedPlaneMarkerPosition,
    hexToHsv,
    hsvToHex,
    normalizeHue,
} from "../../../views/common_components/color_picker/colorMath.js";

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

test("keeps the saturation/value marker fully inside its circle", () => {
    const picker = readSource("src-ui/views/common_components/color_picker/ColorPicker.jsx");
    const styles = readSource("src-ui/views/common_components/color_picker/ColorPicker.module.scss");

    assert.match(picker, /--plane-marker-x/);
    assert.match(picker, /--plane-marker-y/);
    assert.match(styles, /left:\s*clamp\([^;]*var\(--plane-marker-x\)/);
    assert.match(styles, /top:\s*clamp\([^;]*var\(--plane-marker-y\)/);
});

test("projects diagonal saturation/value corners onto the usable circle radius", () => {
    const position = getContainedPlaneMarkerPosition({ s: 0, v: 1 });
    const distanceFromCenter = Math.hypot(position.x - 0.5, position.y - 0.5);
    const usableRadius = 0.5 - (0.4 / 7.7);

    assert.ok(distanceFromCenter <= usableRadius + 0.000001);
    assert.ok(position.x > 0.1);
    assert.ok(position.y > 0.1);
});
