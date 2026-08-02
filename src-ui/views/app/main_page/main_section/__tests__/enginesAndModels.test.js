import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../../");
const read = (...segments) => readFile(path.join(root, ...segments), "utf8");

test("Engines and Models are first-class production routes wired to persisted source settings", async () => {
    const [mainPage, navigation, engines, models, configSetter] = await Promise.all([
        read("src-ui", "views", "app", "main_page", "MainPage.jsx"),
        read("src-ui", "views", "app", "main_page", "main_section", "live_weave_navigation", "LiveWeaveNavigation.jsx"),
        read("src-ui", "views", "app", "main_page", "engines", "EnginesWorkspace.jsx"),
        read("src-ui", "views", "app", "main_page", "models", "ModelsHub.jsx"),
        read("src-ui", "logics", "configs", "config_page_setter", "ui_config_setter.js"),
    ]);

    assert.match(mainPage, /currentExperienceRoute\.data === "engines"/);
    assert.match(mainPage, /<EnginesWorkspace\s*\/>/);
    assert.match(mainPage, /currentExperienceRoute\.data === "models"/);
    assert.match(mainPage, /<ModelsHub\s*\/>/);
    assert.match(navigation, /\{ id: "engines"/);
    assert.match(navigation, /\{ id: "models"/);
    assert.match(engines, /currentSelectedTranscriptionEngineSend/);
    assert.match(engines, /currentSelectedTranscriptionEngineReceive/);
    assert.match(engines, /setSelectedTranscriptionComputeDeviceSend/);
    assert.match(engines, /setSelectedTranscriptionComputeDeviceReceive/);
    assert.match(engines, /currentCTranslate2AutoFallback/);
    assert.match(models, /currentWhisperWeightTypeStatus/);
    assert.match(models, /downloadWhisperWeightTypeStatus/);
    assert.match(models, /setSelectedWhisperWeightType/);
    assert.match(configSetter, /Base_Name: "SelectedTranscriptionEngineSend"/);
    assert.match(configSetter, /Base_Name: "SelectedTranscriptionEngineReceive"/);
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
