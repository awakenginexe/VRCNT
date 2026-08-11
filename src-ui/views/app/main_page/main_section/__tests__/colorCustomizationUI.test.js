import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../../../../../");
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("Customize is a first-class main navigation route", () => {
    const navigation = readSource("src-ui/views/app/main_page/main_section/live_weave_navigation/LiveWeaveNavigation.jsx");
    const mainPage = readSource("src-ui/views/app/main_page/MainPage.jsx");

    assert.match(navigation, /id:\s*"customize"/);
    assert.match(navigation, /item\.id\s*===\s*"customize"/);
    assert.match(mainPage, /ColorCustomization/);
    assert.match(mainPage, /currentExperienceRoute\.data\s*===\s*"customize"/);
});

test("Customize workspace owns grouped editable roles, preview, and reset actions", () => {
    const workspace = readSource("src-ui/views/app/main_page/color_customization/ColorCustomization.jsx");
    const preview = readSource("src-ui/views/app/main_page/color_customization/ColorThemePreview.jsx");

    assert.match(workspace, /useAppearance/);
    assert.match(workspace, /ColorRoleEditor/);
    assert.match(workspace, /onResetAll/);
    assert.match(workspace, /APP_COLOR_ROLE_GROUPS/);
    assert.match(preview, /palette/);
    assert.match(preview, /primary|accent_color/);
});

test("Customize exposes independent readability controls below the live preview", () => {
    const workspace = readSource("src-ui/views/app/main_page/color_customization/ColorCustomization.jsx");

    assert.match(workspace, /currentUiScaling/);
    assert.match(workspace, /currentMessageLogUiScaling/);
    assert.match(workspace, /setUiScaling/);
    assert.match(workspace, /setMessageLogUiScaling/);
    assert.match(workspace, /asyncUpdateBreakPoint/);
    assert.match(workspace, /useSliderLogic/);
    assert.match(workspace, /setter_timing:\s*"on_change"/);
    assert.match(workspace, /scale_controls/);
    assert.match(workspace, /type="range"/);
});

test("100% UI size uses the larger root baseline without changing the stored scale", () => {
    const controller = readSource("src-ui/views/app/_app_controllers/UiSizeController.jsx");
    const rootCss = readSource("src-ui/views/app/_index_css/root.css");

    assert.match(controller, /UI_BASE_FONT_SIZE_PERCENT\s*=\s*70/);
    assert.match(controller, /UI_BASE_FONT_SIZE_PERCENT\s*\*\s*currentUiScaling\.data\s*\/\s*100/);
    assert.match(rootCss, /font-size:\s*70%/);
});
