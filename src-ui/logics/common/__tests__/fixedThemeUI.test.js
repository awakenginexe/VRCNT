import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../../..");
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("the app and desktop overlay use one fixed visual system", () => {
    const app = readSource("src-ui/views/app/App.jsx");
    const overlay = readSource("src-ui/views/app/desktop_overlay/DesktopOverlayApp.jsx");
    const appearance = readSource("src-ui/views/app/config_page/setting_section/setting_box/appearance/Appearance.jsx");
    const variables = readSource("src-ui/views/app/_index_css/variables.css");
    const overlayStyles = readSource("src-ui/views/app/desktop_overlay/DesktopOverlayApp.module.scss");

    assert.doesNotMatch(app, /THEME_ACCENT_CLASSES|theme_accent/);
    assert.doesNotMatch(overlay, /THEME_ACCENT_CLASSES|theme_accent/);
    assert.doesNotMatch(appearance, /ThemeAccentContainer|THEME_ACCENTS/);
    assert.doesNotMatch(variables, /\.theme-midnight-purple|\.theme-emerald-green|\.theme-sakura-pink/);
    assert.match(variables, /--accent_color:\s*#9B6DFF/i);
    assert.match(variables, /--bg_gradient_start:\s*#08070B/i);
    assert.match(overlayStyles, /&\.sent\s*\{[\s\S]*?margin-left:\s*auto/);
    assert.match(overlayStyles, /&\.received\s*\{[\s\S]*?margin-right:\s*auto/);
    assert.match(overlayStyles, /var\(--surface_2_color\)/);
    assert.match(overlayStyles, /var\(--accent_color_rgb\)/);
});
