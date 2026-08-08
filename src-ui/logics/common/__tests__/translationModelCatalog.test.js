import test from "node:test";
import assert from "node:assert/strict";
import {
    getAllTranslationModels,
    getPresetTranslationModels,
} from "../translationModelCatalog.js";

test("preset catalog preserves backend records and falls back for missing presets", () => {
    const fastModel = { id: "m2m100_418M-ct2-int8", is_preset: true, status: "ready" };
    const goodModel = { id: "nllb-200-distilled-1.3B-ct2-int8", size: 1300 };
    const entries = getPresetTranslationModels([fastModel, goodModel]);

    assert.deepEqual(entries.map(({ preset, weightType }) => ({ preset, weightType })), [
        { preset: "fast", weightType: "m2m100_418M-ct2-int8" },
        { preset: "balanced", weightType: "nllb-200-distilled-600M-ct2-int8" },
        { preset: "good", weightType: "nllb-200-distilled-1.3B-ct2-int8" },
        { preset: "precise", weightType: "madlad400-3b-mt-ct2-int8" },
    ]);
    assert.equal(entries.length, 4);
    assert.strictEqual(entries[0].model, fastModel);
    assert.strictEqual(entries[2].model, goodModel);
    assert.deepEqual(entries[1].model, { id: "nllb-200-distilled-600M-ct2-int8" });
    assert.deepEqual(entries[3].model, { id: "madlad400-3b-mt-ct2-int8" });
});

test("full catalog preserves preset and manual models", () => {
    const models = [
        { id: "preset", is_preset: true },
        { id: "manual", is_preset: false },
    ];
    assert.deepEqual(getAllTranslationModels(models), models);
});
