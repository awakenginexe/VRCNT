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
