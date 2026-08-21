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
        { id: "large-v3-turbo", is_downloaded: true },
    ];

    assert.deepEqual(
        resolveWhisperRecommendation({
            statuses,
            selectedDevice: { device: "cuda", device_name: "Actual GPU" },
        }),
        { presetId: "best_accuracy", modelId: "large-v3-turbo", reason: "cuda" },
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
            statuses: [{ id: "base", is_downloaded: true }],
            selectedDevice: { device: "cpu", device_name: "CPU" },
        }),
        { presetId: "fast", modelId: "base", reason: "cpu" },
    );
    assert.deepEqual(
        resolveWhisperRecommendation({
            statuses: [{ id: "large-v3-turbo", is_downloaded: true }],
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
