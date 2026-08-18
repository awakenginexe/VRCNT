import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const hasModeConditionalWrapper = (source) =>
    /\{[^{}]*(?:!?\s*\bisPresetMode\b|\bmode\s*(?:===|!==)\s*["'](?:legacy|presets)["'])\s*(?:&&|\|\||\?)[^{}]*<CTranslate2ComputeDevice\s*\/>/.test(source);

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

test("active translation model changes show a pending switch instead of being blocked", () => {
    const source = readSource("../TranslationModels.jsx");

    assert.match(source, /currentSelectedCTranslate2WeightType\?\.state === ["']pending["']/);
    assert.match(source, /model_switching/);
    assert.match(source, /aria-live=["']polite["']/);
    assert.doesNotMatch(source, /if \(translationActive\)/);
});

test("preset cards collapse from two columns in a narrow model workspace container", () => {
    const styles = readSource("../TranslationModels.module.scss");

    assert.match(
        styles,
        /@container model-provider-workspace \(max-width: 72rem\) \{[\s\S]*?\.preset_grid \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}\s*\}/,
    );
});

test("preset placement detects wrapper-scoped mode conditions without rejecting completed intro or notice expressions", () => {
    for (const [description, source] of [
        ["a direct mode conjunction", "{isPresetMode && <CTranslate2ComputeDevice />}"],
        ["a direct mode ternary", '{mode === "legacy" ? <CTranslate2ComputeDevice /> : null}'],
        ["a negated mode conjunction", "{!isPresetMode && <CTranslate2ComputeDevice />}"],
        ["a parenthesized mode ternary", "{(isPresetMode ? <CTranslate2ComputeDevice /> : null)}"],
    ]) {
        assert.equal(
            hasModeConditionalWrapper(source),
            true,
            `the shared wrapper must be rejected inside ${description}`,
        );
    }

    for (const [description, source] of [
        [
            "a completed preset intro expression",
            '{isPresetMode && <TranslationModelsIntro detail={t("preset")} />}\n<CTranslate2ComputeDevice />',
        ],
        [
            "a completed legacy notice expression",
            '{mode === "legacy" ? <TranslationModelsNotice /> : null}\n<CTranslate2ComputeDevice />',
        ],
    ]) {
        assert.equal(
            hasModeConditionalWrapper(source),
            false,
            `${description} must not be treated as a conditional wrapper`,
        );
    }
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

    const renderBeforePresetGrid = models.match(
        /return\s*\(\s*<div\s+className=\{styles\.container\}>[\s\S]*?(?=<div\s+className=\{styles\.preset_grid\}>)/,
    )?.[0] ?? "";
    assert.match(renderBeforePresetGrid, /<CTranslate2ComputeDevice\s*\/>/);
    assert.equal(
        hasModeConditionalWrapper(renderBeforePresetGrid),
        false,
        "the shared wrapper must not be nested in a mode-conditional JSX expression",
    );
    assert.match(
        models,
        /return\s*\(\s*<div\s+className=\{styles\.container\}>[\s\S]*?<CTranslate2ComputeDevice\s*\/>[\s\S]*?<div\s+className=\{styles\.preset_grid\}>\s*\{presetEntries\.map\(\(\{\s*model,\s*preset\s*\}\)\s*=>\s*renderModel\(model,\s*preset\)\)\}\s*<\/div>/,
    );
});

test("legacy Translation reuses the shared CTranslate2 compute-device wrapper", () => {
    const source = readSource("../../translation/Translation.jsx");
    const translationStart = source.search(/\b(?:const|function)\s+Translation\b/);
    const translationSource = translationStart >= 0 ? source.slice(translationStart) : "";

    assert.match(
        source,
        /import\s+\{\s*CTranslate2ComputeDevice\s*\}\s+from\s+["']\.\.\/translation_models\/CTranslate2ComputeDevice["'];/,
    );
    assert.doesNotMatch(source, /import\s+\{\s*ComputeDevice\s*\}\s+from/);
    assert.ok(translationStart >= 0, "Translation component declaration must remain present");
    assert.match(
        translationSource,
        /<CTranslate2WeightType_Box\s*\/>[\s\S]*?<CTranslate2ComputeDevice\s*\/>[\s\S]*?<CloudTranslationProviders\s*\/>/,
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
