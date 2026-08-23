import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath) => readFileSync(relativePath, "utf8");

const railPath = "src-ui/views/app/main_page/main_section/live_control_rail/LiveControlRail.jsx";
const settingsPath = "src-ui/logics/configs/config_page_setter/ui_config_setter.js";
const settingsLogicPath = "src-ui/logics/configs/config_page_setter/useSettingsLogics.js";
const routesPath = "src-ui/logics/useReceiveRoutes.js";

test("the original-first control is an accessible live toggle with clear state labels", () => {
    const rail = read(railPath);

    assert.match(rail, /currentEnableSendOriginalWhileTranslating/);
    assert.match(rail, /toggleEnableSendOriginalWhileTranslating/);
    assert.match(rail, /aria-pressed=\{originalFallbackIsOn\}/);
    assert.match(rail, /aria-label=\{t\("main_page\.live_workspace\.original_fallback_toggle"\)\}/);
    assert.match(rail, /original_first/);
    assert.match(rail, /translation_first/);
});

test("the original-first toggle is registered and has both backend state routes", () => {
    const settings = read(settingsPath);
    const settingsLogic = read(settingsLogicPath);
    const routes = read(routesPath);

    assert.match(settings, /Base_Name: "EnableSendOriginalWhileTranslating"/);
    assert.match(settings, /base_endpoint_name: "send_original_while_translating"/);
    assert.match(settings, /optimistic_toggle: true/);
    assert.match(settingsLogic, /`\/set\/\$\{nextValue \? "enable" : "disable"\}\/\$\{s\.base_endpoint_name\}`/);
    assert.match(routes, /for \(const s of SETTINGS_ARRAY\)/);
    assert.match(routes, /`\/get\/data\/\$\{ep\}`/);
    assert.match(routes, /`\/set\/enable\/\$\{ep\}`/);
    assert.match(routes, /`\/set\/disable\/\$\{ep\}`/);
});
