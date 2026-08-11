import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../..");
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("palette settings are registered for Appearance and Vr", () => {
    const source = readSource("src-ui/logics/configs/config_page_setter/ui_config_setter.js");

    assert.match(source, /Category:\s*"Appearance"[\s\S]*?Base_Name:\s*"AppColorPalette"[\s\S]*?logics_template_id:\s*"get_set"[\s\S]*?base_endpoint_name:\s*"app_color_palette"/);
    assert.match(source, /Category:\s*"Vr"[\s\S]*?Base_Name:\s*"OverlayColorPalette"[\s\S]*?logics_template_id:\s*"get_set"[\s\S]*?base_endpoint_name:\s*"overlay_color_palette"/);
});

test("the app mounts the color controller before visible pages", () => {
    const app = readSource("src-ui/views/app/App.jsx");
    const controller = readSource("src-ui/views/app/_app_controllers/ColorThemeController.jsx");

    assert.match(app, /ColorThemeController/);
    assert.match(app, /<ColorThemeController\s*\/>[\s\S]*?<Contents/);
    assert.match(controller, /useLayoutEffect/);
    assert.match(controller, /getAppCssVariables/);
    assert.match(controller, /style\.setProperty/);
});
