import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getTranscriptionComputeTypeChoices } from "../../sidebar_section/language_settings/transcriptionRuntimeUtils.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");

test("compute types the device cannot run stay listed but unsupported, after the usable ones", () => {
    const choices = getTranscriptionComputeTypeChoices(["float32", "auto", "int8", "int8_float32", "int16"]);

    assert.deepEqual(
        choices.filter((choice) => choice.supported).map((choice) => choice.id),
        ["auto", "int8", "int8_float32", "int16", "float32"],
    );
    assert.deepEqual(
        choices.filter((choice) => !choice.supported).map((choice) => choice.id),
        ["int8_bfloat16", "int8_float16", "bfloat16", "float16"],
    );
    assert.equal(choices.findIndex((choice) => !choice.supported), 5);
});

test("every compute type hint is translated in every locale", () => {
    const memoryLevels = new Set(getTranscriptionComputeTypeChoices().map((choice) => choice.memory));
    assert.equal(memoryLevels.has(undefined), false);
    const keys = [
        ...[...memoryLevels].map((level) => `compute_type_${level}_detail`),
        "compute_type_unsupported",
        "model_gpu_memory",
    ];
    for (const locale of ["en", "ja", "ko", "th", "zh-Hans", "zh-Hant"]) {
        const text = fs.readFileSync(path.join(root, "locales", `${locale}.yml`), "utf8");
        for (const key of keys) {
            assert.match(text, new RegExp(`^        ${key}: ".+"`, "m"), `${locale}: ${key}`);
        }
    }
});
