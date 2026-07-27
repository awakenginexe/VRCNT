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
    const mainSection = readSource("src-ui/views/app/main_page/main_section/MainSection.module.scss");
    const configPage = readSource("src-ui/views/app/config_page/ConfigPage.module.scss");
    const languageSelector = readSource("src-ui/views/app/main_page/main_section/language_selector/LanguageSelector.module.scss");
    const messageContainer = readSource("src-ui/views/app/main_page/main_section/message_container/MessageContainer.module.scss");
    const overlayStyles = readSource("src-ui/views/app/desktop_overlay/DesktopOverlayApp.module.scss");

    assert.doesNotMatch(app, /THEME_ACCENT_CLASSES|theme_accent/);
    assert.doesNotMatch(overlay, /THEME_ACCENT_CLASSES|theme_accent/);
    assert.doesNotMatch(appearance, /ThemeAccentContainer|THEME_ACCENTS/);
    assert.doesNotMatch(variables, /\.theme-midnight-purple|\.theme-emerald-green|\.theme-sakura-pink/);
    assert.match(variables, /--accent_color:\s*#9B6DFF/i);
    assert.match(variables, /--bg_gradient_start:\s*#08070B/i);
    assert.match(variables, /--success_bc_color:\s*#5BE2B5/i);
    assert.match(variables, /--canvas_color:\s*#08070B/i);
    assert.match(variables, /--surface_overlay_color:/);
    assert.doesNotMatch(mainSection, /91,\s*226,\s*181/);
    assert.match(configPage, /var\(--canvas_color\)/);
    assert.match(languageSelector, /var\(--surface_overlay_color\)/);
    assert.match(messageContainer, /var\(--surface_2_color\)/);
    assert.match(overlayStyles, /&\.sent\s*\{[\s\S]*?margin-left:\s*auto/);
    assert.match(overlayStyles, /&\.received\s*\{[\s\S]*?margin-right:\s*auto/);
    assert.match(overlayStyles, /var\(--surface_2_color\)/);
    assert.match(overlayStyles, /var\(--accent_color_rgb\)/);
});
