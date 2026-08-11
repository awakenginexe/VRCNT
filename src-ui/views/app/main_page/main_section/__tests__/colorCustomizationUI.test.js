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
