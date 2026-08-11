import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    applyDefaultTranscriptionEngine,
    getOfflinePresetOptions,
    getSetupEngineOptions,
    getSetupTranslationProviderOptions,
} from "../../guided_setup/transcriptionTranslationSetupUtils.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../../");
const read = (...segments) => readFile(path.join(root, ...segments), "utf8");

test("setup option helpers normalize backend arrays and objects without inventing identifiers", () => {
    assert.deepEqual(
        getSetupEngineOptions(["Whisper", "Whisper Thai", 42, null]),
        [
            { id: "Whisper", title: "Whisper" },
            { id: "Whisper Thai", title: "Whisper Thai" },
        ],
    );

    assert.deepEqual(
        getSetupTranslationProviderOptions({
            ctranslate2: { id: "CTranslate2", label: "Offline Translation", is_available: true },
            disabled: { id: "DeepL", label: "DeepL", is_available: false },
            missing: { label: "Broken Provider", is_available: true },
        }),
        [{ id: "CTranslate2", title: "Offline Translation" }],
    );
});

test("setup offline preset options come from the common catalog in beginner-facing order", () => {
    const options = getOfflinePresetOptions([
        { id: "m2m100_418M-ct2-int8" },
        { id: "nllb-200-distilled-600M-ct2-int8" },
        { id: "nllb-200-distilled-1.3B-ct2-int8" },
        { id: "madlad400-3b-mt-ct2-int8" },
    ], (key) => `label:${key}`);

    assert.deepEqual(options, [
        { id: "fast", title: "label:main_page.preset.fast", modelId: "m2m100_418M-ct2-int8" },
        { id: "balanced", title: "label:main_page.preset.balanced", modelId: "nllb-200-distilled-600M-ct2-int8" },
        { id: "good", title: "label:main_page.preset.good", modelId: "nllb-200-distilled-1.3B-ct2-int8" },
        { id: "precise", title: "label:main_page.preset.precise", modelId: "madlad400-3b-mt-ct2-int8" },
    ]);
});

test("default transcription engine helper aligns outgoing and incoming profiles", () => {
    const send = [];
    const receive = [];

    applyDefaultTranscriptionEngine(
        "Whisper",
        (patch) => send.push(patch),
        (patch) => receive.push(patch),
    );

    assert.deepEqual(send, [{ engine: "Whisper" }]);
    assert.deepEqual(receive, [{ engine: "Whisper" }]);
});

test("Transcription and Translation setup step uses the existing runtime contracts", async () => {
    const [step, guidedSetup] = await Promise.all([
        read("src-ui", "views", "app", "main_page", "guided_setup", "TranscriptionTranslationStep.jsx"),
        read("src-ui", "views", "app", "main_page", "guided_setup", "GuidedSetup.jsx"),
    ]);

    for (const symbol of [
        "useTranscription",
        "useTranslation",
        "currentSelectableTranscriptionEngineList",
        "setTranscriptionProfileSend",
        "setTranscriptionProfileReceive",
        "currentTranslationEngines",
        "setSelectedTranslationEngines",
        "getPresetTranslationModels",
        "getTranslationModelStatus",
    ]) {
        assert.match(step, new RegExp(symbol));
    }

    for (const label of [
        "main_page.preset.fast",
        "main_page.preset.balanced",
        "main_page.preset.good",
        "main_page.preset.precise",
    ]) {
        assert.match(step, new RegExp(label));
    }

    assert.match(step, /TRANSLATION_MODEL_CHANGE_ACTIVE/);
    assert.match(step, /downloadCTranslate2WeightTypeStatus/);
    assert.match(step, /setSelectedCTranslate2WeightType/);
    assert.match(step, /setShowAdvanced/);
    assert.match(guidedSetup, /import\s+\{\s*TranscriptionTranslationStep\s*\}/);
    assert.match(guidedSetup, /step === 5[\s\S]*<TranscriptionTranslationStep\s*\/>/);
});
