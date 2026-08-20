import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Translation Models is a top-level route between Speech Models and Overlay Studio", () => {
    const navigation = read("../live_weave_navigation/LiveWeaveNavigation.jsx");
    const speech = navigation.indexOf('id: "models"');
    const translation = navigation.indexOf('id: "translation_models"');
    const overlay = navigation.indexOf('id: "overlay"');
    const translationItem = navigation.match(/\{ id: "translation_models"[^}]+\}/)?.[0] ?? "";

    assert.ok(speech >= 0 && speech < translation && translation < overlay);
    assert.match(
        translationItem,
        /labelKey: "main_page\.live_weave\.navigation\.translation_models"/,
    );
    assert.doesNotMatch(translationItem, /configTab/);
    assert.match(
        navigation,
        /if \(item\.id === "models" \|\| item\.id === "translation_models" \|\| item\.id === "overlay" \|\| item\.id === "customize"\) \{\s*setIsOpenedConfigPage\(false\);\s*return;/,
    );
});

test("Translation Models source contract delegates preset rendering and the advanced handoff", () => {
    const mainPage = read("../../MainPage.jsx");
    const hub = read("../../translation_models/TranslationModelsHub.jsx");
    const sharedModels = read("../../../config_page/setting_section/setting_box/translation_models/TranslationModels.jsx");
    assert.match(mainPage, /currentExperienceRoute\.data === "translation_models"/);
    assert.match(mainPage, /<TranslationModelsHub\s*\/>/);
    assert.match(
        hub,
        /<TranslationModels\s+mode="presets"\s+showDescription=\{false\}\s+onOpenAdvanced=\{openAdvanced\}/,
    );
    assert.match(hub, /updateSelectedConfigTabId\("model_and_provider"\)/);
    assert.match(hub, /setIsOpenedConfigPage\(true\)/);
    assert.match(sharedModels, /const presetEntries = getPresetTranslationModels\(allModels\);/);
    assert.match(sharedModels, /presetEntries\.map\(\(\{ model, preset \}\) => renderModel\(model, preset\)\)/);
});

test("Translation Models hub consumes its route-specific localized copy", () => {
    const hub = read("../../translation_models/TranslationModelsHub.jsx");

    for (const key of ["eyebrow", "title", "detail", "back_to_live"]) {
        assert.match(hub, new RegExp(`main_page\\.translation_models\\.${key}`));
    }
    assert.doesNotMatch(hub, /config_page\.translation_models\.description/);
});

test("Translation Models navigation labels exist in every supported locale", () => {
    for (const locale of ["en", "ja", "ko", "th", "zh-Hans", "zh-Hant"]) {
        const source = read(`../../../../../../locales/${locale}.yml`);
        const navigationItems = source.match(
            /    live_weave:\r?\n        navigation:\r?\n((?:            [^\r\n]+\r?\n)+)/,
        )?.[1] ?? "";

        assert.match(navigationItems, /^            translation_models:/m);
    }
});

test("narrow navigation retains a flexing horizontal overflow strip", () => {
    const styles = read("../live_weave_navigation/LiveWeaveNavigation.module.scss");

    assert.match(
        styles,
        /\.navigation \{[\s\S]*?flex: 1 1 auto;[\s\S]*?overflow-x: auto;/,
    );
});
