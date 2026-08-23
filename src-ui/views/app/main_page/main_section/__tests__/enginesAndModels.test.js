import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../../");
const read = (...segments) => readFile(path.join(root, ...segments), "utf8");

test("Speech Recognition owns runtime settings while the legacy Engines route is hidden", async () => {
    const [mainPage, navigation, engines, models, speechCards, configSetter, progressComponent] = await Promise.all([
        read("src-ui", "views", "app", "main_page", "MainPage.jsx"),
        read("src-ui", "views", "app", "main_page", "main_section", "live_weave_navigation", "LiveWeaveNavigation.jsx"),
        read("src-ui", "views", "app", "main_page", "engines", "EnginesWorkspace.jsx"),
        read("src-ui", "views", "app", "main_page", "models", "ModelsHub.jsx"),
        read("src-ui", "views", "app", "main_page", "engines", "SpeechRecognitionCards.jsx"),
        read("src-ui", "logics", "configs", "config_page_setter", "ui_config_setter.js"),
        read("src-ui", "views", "app", "main_page", "models", "ModelDownloadProgress.jsx"),
    ]);

    assert.match(mainPage, /currentExperienceRoute\.data === "engines" \|\| currentExperienceRoute\.data === "models"/);
    assert.doesNotMatch(mainPage, /<EnginesWorkspace\s*\/>/);
    assert.match(mainPage, /currentExperienceRoute\.data === "models"/);
    assert.match(mainPage, /<ModelsHub\s*\/>/);
    assert.doesNotMatch(navigation, /\{ id: "engines"/);
    assert.match(navigation, /\{ id: "models"/);
    assert.match(engines, /currentTranscriptionProfileSend/);
    assert.match(engines, /currentTranscriptionProfileReceive/);
    assert.match(engines, /setTranscriptionProfileSend/);
    assert.match(engines, /setTranscriptionProfileReceive/);
    assert.match(engines, /currentCTranslate2AutoFallback/);
    assert.match(models, /currentWhisperWeightTypeStatus/);
    assert.match(models, /downloadWhisperWeightTypeStatus/);
    assert.match(models, /downloadVoskWeightTypeStatus/);
    assert.match(models, /downloadParakeetWeightTypeStatus/);
    assert.match(models, /downloadSenseVoiceWeightTypeStatus/);
    assert.match(models, /ModelDownloadProgress/);
    assert.match(models, /group\.statuses\.map/);
    assert.match(models, /group\.statuses\.map[\s\S]*ModelDownloadProgress/);
    assert.match(models, /download_failed/);
    assert.match(models, /<SpeechRecognitionCards\s*\/>/);
    assert.match(speechCards, /currentTranscriptionProfileSend/);
    assert.match(speechCards, /currentTranscriptionProfileReceive/);
    assert.match(speechCards, /<SourceRuntimeCard/);
    assert.match(progressComponent, /download_progress/);
    assert.doesNotMatch(models, /setSelectedWhisperWeightType/);
    assert.doesNotMatch(models, /updateExperienceRoute\("engines"\)/);
    assert.match(configSetter, /Base_Name: "SelectedTranscriptionEngineSend"/);
    assert.match(configSetter, /Base_Name: "SelectedTranscriptionEngineReceive"/);
    assert.match(configSetter, /Base_Name: "TranscriptionProfileSend"/);
    assert.match(configSetter, /Base_Name: "TranscriptionProfileReceive"/);
    assert.doesNotMatch(`${engines}\n${models}`, /RTX 5090|mock telemetry|fake latency/i);
});

test("model recommendation only selects an installed candidate appropriate to the real compute device", async () => {
    const utilsUrl = pathToFileURL(
        path.join(root, "src-ui", "views", "app", "main_page", "engines", "engineModelUtils.js"),
    ).href;
    const { resolveWhisperRecommendation } = await import(utilsUrl);

    const statuses = [
        { id: "tiny", is_downloaded: true },
        { id: "small", is_downloaded: true },
        { id: "large-v3", is_downloaded: true },
        { id: "large-v3-turbo-int8", is_downloaded: true },
        { id: "large-v3-turbo", is_downloaded: true },
    ];

    assert.deepEqual(
        resolveWhisperRecommendation({
            statuses,
            selectedDevice: { device: "cuda", device_name: "Actual GPU" },
        }),
        { presetId: "best_accuracy", modelId: "large-v3", reason: "cuda" },
    );
    assert.deepEqual(
        resolveWhisperRecommendation({
            statuses,
            selectedDevice: { device: "cpu", device_name: "CPU" },
        }),
        { presetId: "balanced", modelId: "small", reason: "cpu" },
    );
    assert.deepEqual(
        resolveWhisperRecommendation({
            statuses: [{ id: "tiny", is_downloaded: true }],
            selectedDevice: { device: "cpu", device_name: "CPU" },
        }),
        { presetId: "fast", modelId: "tiny", reason: "cpu" },
    );
    assert.deepEqual(
        resolveWhisperRecommendation({
            statuses: [{ id: "large-v3", is_downloaded: true }],
            selectedDevice: { device: "cpu", device_name: "CPU" },
        }),
        { presetId: null, modelId: null, reason: "no_installed_model" },
    );
    assert.deepEqual(
        resolveWhisperRecommendation({
            statuses: [{ id: "small", is_downloaded: false }],
            selectedDevice: { device: "cuda", device_name: "Actual GPU" },
        }),
        { presetId: null, modelId: null, reason: "no_installed_model" },
    );
});

test("model recommendation catalog assigns every requested local, Thai, cloud, and CPU choice", async () => {
    const utilsUrl = pathToFileURL(
        path.join(root, "src-ui", "views", "app", "main_page", "engines", "engineModelUtils.js"),
    ).href;
    const {
        WHISPER_PRESETS,
        WHISPER_THAI_PRESETS,
        CLOUD_RECOMMENDATIONS,
        CPU_RECOMMENDATIONS,
        getModelSuitability,
        getModelsHubCopyKey,
    } = await import(utilsUrl);

    assert.deepEqual(
        WHISPER_PRESETS.map(({ id, candidates }) => [id, candidates[0]]),
        [
            ["fast", "tiny"],
            ["balanced", "small"],
            ["better", "large-v3-turbo-int8"],
            ["accurate", "large-v3-turbo"],
            ["best_accuracy", "large-v3"],
        ],
    );
    assert.deepEqual(
        WHISPER_THAI_PRESETS.map(({ id, candidates }) => [id, candidates[0]]),
        [
            ["fast", "thai-thonburian-small"],
            ["balanced", "thai-thonburian-large-v3-int8"],
            ["best_accuracy", "thai-mort666-large-v3-fp16"],
        ],
    );
    assert.deepEqual(
        CLOUD_RECOMMENDATIONS.map(({ engine }) => engine),
        ["Google", "Bing", "Whisper Cloud"],
    );
    assert.deepEqual(
        CPU_RECOMMENDATIONS.map(({ engine }) => engine),
        ["Vosk", "SenseVoice"],
    );
    assert.equal(CPU_RECOMMENDATIONS.find(({ engine }) => engine === "SenseVoice").modelId, "sensevoice-small-int8");
    assert.equal(CPU_RECOMMENDATIONS.find(({ engine }) => engine === "Vosk").languageSpecific, true);
    assert.equal(getModelSuitability("Vosk", "large-en").tier, "cpu");
    assert.equal(getModelSuitability("SenseVoice", "sensevoice-small-fp32").tier, "cpu");
    assert.equal(getModelsHubCopyKey("vosk_title"), "main_page.models_hub.vosk_title");
    assert.equal(
        getModelsHubCopyKey("main_page.models_hub.thai_fast_title"),
        "main_page.models_hub.thai_fast_title",
    );
});

test("model hub keeps recommendations on preset cards without the automatic model panel", async () => {
    const models = await read("src-ui", "views", "app", "main_page", "models", "ModelsHub.jsx");

    assert.doesNotMatch(models, /<section className=\{styles\.recommendation\}>/);
    assert.doesNotMatch(models, /primary-speech-model-select/);
    assert.doesNotMatch(models, /main_page\.models_hub\.automatic_label/);
    assert.match(models, /isRecommended=\{recommendation\.presetId === preset\.id\}/);
    assert.match(models, /data-recommended=\{isRecommended\}/);
    assert.match(models, /WHISPER_THAI_PRESETS/);
    assert.match(models, /CLOUD_RECOMMENDATIONS/);
    assert.match(models, /CPU_RECOMMENDATIONS/);
});
