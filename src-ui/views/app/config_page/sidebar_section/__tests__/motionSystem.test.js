import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "../../..");
const repoRoot = path.resolve(appRoot, "../../..");
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), "utf8");

test("motion tokens and the global performance cutoff stay centralized", () => {
    const variables = read("src-ui", "views", "app", "_index_css", "variables.css");
    const root = read("src-ui", "views", "app", "_index_css", "root.css");

    assert.match(variables, /--motion_standard:\s*220ms/);
    assert.match(variables, /\.performance_mode\s*\{[\s\S]*?--motion_standard:\s*0ms/);
    assert.match(root, /\.performance_mode \*,[\s\S]*?animation:\s*none !important/);
    assert.match(root, /\.performance_mode \*,[\s\S]*?transition:\s*none !important/);
    assert.match(root, /\.performance_mode \*,[\s\S]*?backdrop-filter:\s*none !important/);
    assert.match(root, /@media \(prefers-reduced-motion:\s*reduce\)/);
});

test("saved Performance Mode is applied before React paints", () => {
    const html = read("index.html");
    const controller = read(
        "src-ui",
        "views",
        "app",
        "_app_controllers",
        "PerformanceModeController.jsx",
    );

    assert.match(html, /localStorage\.getItem\("enable_performance_mode"\)/);
    assert.ok(
        html.indexOf("enable_performance_mode") < html.indexOf('<div id="root">'),
        "the pre-paint preference script must run before the app root mounts",
    );
    assert.match(controller, /useLayoutEffect/);
    assert.match(controller, /dataset\.performanceMode/);
});

test("premium motion is attached to the app's key interactive surfaces", () => {
    const settings = read(
        "src-ui",
        "views",
        "app",
        "config_page",
        "setting_section",
        "SettingSection.module.scss",
    );
    const languageSelector = read(
        "src-ui",
        "views",
        "app",
        "main_page",
        "main_section",
        "language_selector",
        "LanguageSelector.module.scss",
    );
    const messages = read(
        "src-ui",
        "views",
        "app",
        "main_page",
        "main_section",
        "message_container",
        "log_box",
        "message_container",
        "MessageContainer.module.scss",
    );
    const translatorMenu = read(
        "src-ui",
        "views",
        "app",
        "main_page", "sidebar_section", "language_settings",
        "translator_selector_open_button", "translator_selector",
        "TranslatorSelector.module.scss",
    );

    assert.match(settings, /settings_content_in/);
    assert.match(languageSelector, /language_dialog_in/);
    assert.match(messages, /message_received_in/);
    assert.match(messages, /message_sent_in/);
    assert.match(translatorMenu, /translator_menu_in/);
});
