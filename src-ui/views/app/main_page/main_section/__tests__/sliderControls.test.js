import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../../../../");
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("Overlay Studio range controls render a visible progress track", () => {
    const styles = readSource("src-ui/views/app/main_page/overlay_studio/OverlayStudio.module.scss");
    const workspace = readSource("src-ui/views/app/main_page/overlay_studio/OverlayStudio.jsx");

    assert.match(workspace, /--range-progress/);
    assert.match(styles, /::-(?:webkit-slider-runnable-track|moz-range-track)/);
    assert.match(styles, /::-(?:webkit-slider-thumb|moz-range-thumb)/);
    assert.match(styles, /var\(--range-progress\)/);
});

test("Customize readability range controls render a visible progress track", () => {
    const styles = readSource("src-ui/views/app/main_page/color_customization/ColorCustomization.module.scss");
    const workspace = readSource("src-ui/views/app/main_page/color_customization/ColorCustomization.jsx");

    assert.match(workspace, /--range-progress/);
    assert.match(styles, /::-(?:webkit-slider-runnable-track|moz-range-track)/);
    assert.match(styles, /::-(?:webkit-slider-thumb|moz-range-thumb)/);
    assert.match(styles, /var\(--range-progress\)/);
});

test("custom slider ends a drag when the pointer is canceled or the window loses focus", () => {
    const slider = readSource("src-ui/views/app/config_page/setting_section/setting_box/_components/slider/Slider.jsx");

    assert.match(slider, /pointercancel/);
    assert.match(slider, /addEventListener\("blur"/);
    assert.match(slider, /removeEventListener\("blur"/);
    assert.match(slider, /setPointerCapture/);
});
