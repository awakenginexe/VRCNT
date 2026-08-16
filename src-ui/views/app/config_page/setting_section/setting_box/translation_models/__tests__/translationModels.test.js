import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("translation catalog supports preset-only and full legacy modes", () => {
    const source = readSource("../TranslationModels.jsx");
    assert.match(source, /mode = "legacy"/);
    assert.match(source, /mode === "presets"/);
    assert.match(source, /getPresetTranslationModels/);
    assert.match(source, /getAllTranslationModels/);
    assert.doesNotMatch(source, /filter\(\(model\) => !model\.is_preset\)/);
});

test("preset handoff uses route copy while the legacy advanced copy remains unchanged", () => {
    const source = readSource("../TranslationModels.jsx");

    assert.match(source, /showDescription = true/);
    assert.match(source, /main_page\.translation_models\.advanced_models/);
    assert.match(source, /main_page\.translation_models\.advanced_models_detail/);
    assert.match(source, /main_page\.offline_translation\.advanced_models/);
    assert.match(source, /config_page\.translation_models\.advanced_description/);
});

test("translation cards expose determinate and indeterminate progress bars", () => {
    const source = readSource("../TranslationModels.jsx");
    const styles = readSource("../TranslationModels.module.scss");
    assert.match(source, /role="progressbar"/);
    assert.match(source, /aria-valuemin/);
    assert.match(source, /aria-valuemax/);
    assert.match(source, /aria-valuenow/);
    assert.match(styles, /progress_track/);
    assert.match(styles, /prefers-reduced-motion/);
});

test("preset cards collapse from two columns in a narrow model workspace container", () => {
    const styles = readSource("../TranslationModels.module.scss");

    assert.match(
        styles,
        /@container model-provider-workspace \(max-width: 72rem\) \{[\s\S]*?\.preset_grid \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}\s*\}/,
    );
});

test("legacy and preset translation-model consumers share the CTranslate2 compute-device wrapper", () => {
    const models = readSource("../TranslationModels.jsx");
    const legacyConsumer = readSource("../../model_and_provider/ModelAndProvider.jsx");
    const presetConsumer = readSource("../../../../../main_page/translation_models/TranslationModelsHub.jsx");

    assert.match(
        models,
        /import\s+\{\s*CTranslate2ComputeDevice\s*\}\s+from\s+["']\.\/CTranslate2ComputeDevice["'];/,
    );
    assert.match(models, /<CTranslate2ComputeDevice\s*\/>/);
    assert.match(legacyConsumer, /<TranslationModels\s*\/>/);
    assert.match(
        presetConsumer,
        /<TranslationModels\s+mode=["']presets["']\s+showDescription=\{false\}\s+onOpenAdvanced=\{openAdvanced\}\s*\/>/,
    );
    assert.match(models, /mode\s*=\s*["']legacy["']/);
    assert.match(models, /const\s+isPresetMode\s*=\s*mode\s*===\s*["']presets["']/);
    assert.match(
        models,
        /return\s*\(\s*<div\s+className=\{styles\.container\}>\s*<CTranslate2ComputeDevice\s*\/>[\s\S]*?<div\s+className=\{styles\.preset_grid\}>\s*\{presetEntries\.map\(\(\{\s*model,\s*preset\s*\}\)\s*=>\s*renderModel\(model,\s*preset\)\)\}\s*<\/div>/,
    );
});

test("legacy Translation reuses the shared CTranslate2 compute-device wrapper", () => {
    const source = readSource("../../translation/Translation.jsx");

    assert.match(
        source,
        /import\s+\{\s*CTranslate2ComputeDevice\s*\}\s+from\s+["']\.\.\/translation_models\/CTranslate2ComputeDevice["'];/,
    );
    assert.doesNotMatch(source, /import\s+\{\s*ComputeDevice\s*\}\s+from/);
    assert.match(
        source,
        /export const Translation\s*=\s*\(\)\s*=>\s*\{\s*return\s*\(\s*<>\s*<CTranslate2WeightType_Box\s*\/>\s*<CTranslate2ComputeDevice\s*\/>\s*<CloudTranslationProviders\s*\/>\s*<\/>\s*\);\s*\};/,
    );

    for (const setting of [
        "currentSelectableTranslationComputeDeviceList",
        "currentSelectedTranslationComputeDevice",
        "setSelectedTranslationComputeDevice",
        "currentSelectedTranslationComputeType",
        "setSelectedTranslationComputeType",
    ]) {
        assert.doesNotMatch(
            source,
            new RegExp(`\\b${setting}\\b`),
            `legacy Translation must not map ${setting} directly`,
        );
    }
});
