import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../../");
const read = (...segments) => readFile(path.join(root, ...segments), "utf8");

test("Whisper Thai reuses normal Whisper hardware controls without recommendations", async () => {
    const utilsUrl = pathToFileURL(
        path.join(root, "src-ui", "views", "app", "main_page", "engines", "transcriptionProfileUi.js"),
    ).href;
    const { getProfileControlVisibility } = await import(utilsUrl);

    assert.deepEqual(getProfileControlVisibility("Whisper Thai"), {
        model: true,
        device: true,
        computeType: true,
        whisperDecoding: true,
    });

    const engineUtilsUrl = pathToFileURL(
        path.join(root, "src-ui", "views", "app", "main_page", "engines", "engineModelUtils.js"),
    ).href;
    const { TRANSCRIPTION_ENGINE_OPTIONS, WHISPER_PRESETS } = await import(engineUtilsUrl);
    assert.ok(TRANSCRIPTION_ENGINE_OPTIONS.includes("Whisper Thai"));
    assert.equal(WHISPER_PRESETS.some((preset) => preset.candidates.includes("thai-thonburian-small")), false);
});

test("Whisper Thai exposes six advanced models and locks recognition-language editing", async () => {
    const [models, selector, openButton, profileGroup, engineSelector, locales] = await Promise.all([
        read("src-ui", "views", "app", "main_page", "models", "ModelsHub.jsx"),
        read("src-ui", "views", "app", "main_page", "main_section", "language_selector", "LanguageSelector.jsx"),
        read("src-ui", "views", "app", "main_page", "sidebar_section", "language_settings", "language_selector_open_button", "LanguageSelectorOpenButton.jsx"),
        read("src-ui", "views", "app", "main_page", "sidebar_section", "language_settings", "language_profile_group", "LanguageProfileGroup.jsx"),
        read("src-ui", "views", "app", "main_page", "sidebar_section", "language_settings", "transcription_engine_label", "transcription_engine_selector", "TranscriptionEngineSelector.jsx"),
        read("locales", "en.yml"),
    ]);

    assert.match(models, /Whisper Thai/);
    assert.match(models, /downloadWhisperThaiWeightTypeStatus/);
    assert.match(models, /advanced_models/);
    assert.match(selector, /engine === "Whisper Thai"/);
    assert.match(openButton, /Whisper Thai/);
    assert.match(openButton, /disabled=/);
    assert.match(profileGroup, /Whisper Thai/);
    assert.match(engineSelector, /Whisper Thai/);
    assert.match(locales, /whisper_thai/);
});

test("Whisper Thai uses the shared CPU/GPU runtime policy and is never auto-only", async () => {
    const utilsUrl = pathToFileURL(
        path.join(root, "src-ui", "views", "app", "main_page", "sidebar_section", "language_settings", "transcriptionRuntimeUtils.js"),
    ).href;
    const {
        getAllowedTranscriptionDeviceModes,
        getAllowedTranscriptionComputeTypes,
        isAutoOnlyTranscriptionEngine,
    } = await import(utilsUrl);

    assert.deepEqual(getAllowedTranscriptionDeviceModes("Whisper Thai"), ["cpu", "cuda"]);
    assert.equal(isAutoOnlyTranscriptionEngine("Whisper Thai"), false);
    assert.deepEqual(
        getAllowedTranscriptionComputeTypes({
            engine: "Whisper Thai",
            device: { compute_types: ["auto", "float16"] },
        }),
        ["auto", "float16"],
    );
});
