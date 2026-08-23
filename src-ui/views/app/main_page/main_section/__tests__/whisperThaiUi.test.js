import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../../");
const read = (...segments) => readFile(path.join(root, ...segments), "utf8");

test("Whisper Thai reuses normal Whisper hardware controls with dedicated recommendations", async () => {
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
    const { TRANSCRIPTION_ENGINE_OPTIONS, WHISPER_THAI_PRESETS } = await import(engineUtilsUrl);
    assert.ok(TRANSCRIPTION_ENGINE_OPTIONS.includes("Whisper Thai"));
    assert.deepEqual(
        WHISPER_THAI_PRESETS.map(({ id, candidates }) => [id, candidates[0]]),
        [
            ["fast", "thai-thonburian-small"],
            ["balanced", "thai-thonburian-large-v3-int8"],
            ["best_accuracy", "thai-mort666-large-v3-fp16"],
        ],
    );
});

test("quick engine tiles keep all engines and clarify Whisper Thai", async () => {
    const optionsUrl = pathToFileURL(
        path.join(
            root,
            "src-ui",
            "views",
            "app",
            "main_page",
            "sidebar_section",
            "language_settings",
            "transcription_engine_label",
            "transcription_engine_selector",
            "transcriptionEngineOptions.js",
        ),
    ).href;
    const { QUICK_TRANSCRIPTION_ENGINE_OPTIONS } = await import(optionsUrl);

    assert.deepEqual(
        QUICK_TRANSCRIPTION_ENGINE_OPTIONS
            .filter(({ id }) => id === "Whisper" || id === "Whisper Thai")
            .map(({ id, label }) => [id, label]),
        [
            ["Whisper", "Whisper\n(CPU/GPU)"],
            ["Whisper Thai", "Whisper Thai\n(CPU/GPU)"],
        ],
    );
});

test("Whisper Thai exposes six advanced models and locks recognition-language editing", async () => {
    const optionsUrl = pathToFileURL(
        path.join(
            root,
            "src-ui",
            "views",
            "app",
            "main_page",
            "sidebar_section",
            "language_settings",
            "transcription_engine_label",
            "transcription_engine_selector",
            "transcriptionEngineOptions.js",
        ),
    ).href;
    const [{ QUICK_TRANSCRIPTION_ENGINE_OPTIONS }, models, selector, openButton, profileGroup, locales, languageSettings, liveBar, controlRail] = await Promise.all([
        import(optionsUrl),
        read("src-ui", "views", "app", "main_page", "models", "ModelsHub.jsx"),
        read("src-ui", "views", "app", "main_page", "main_section", "language_selector", "LanguageSelector.jsx"),
        read("src-ui", "views", "app", "main_page", "sidebar_section", "language_settings", "language_selector_open_button", "LanguageSelectorOpenButton.jsx"),
        read("src-ui", "views", "app", "main_page", "sidebar_section", "language_settings", "language_profile_group", "LanguageProfileGroup.jsx"),
        read("locales", "en.yml"),
        read("src-ui", "views", "app", "main_page", "sidebar_section", "language_settings", "LanguageSettings.jsx"),
        read("src-ui", "views", "app", "main_page", "main_section", "live_language_bar", "LiveLanguageBar.jsx"),
        read("src-ui", "views", "app", "main_page", "main_section", "live_control_rail", "LiveControlRail.jsx"),
    ]);

    assert.match(models, /Whisper Thai/);
    assert.match(models, /downloadWhisperThaiWeightTypeStatus/);
    assert.match(models, /advanced_models/);
    assert.match(selector, /engine === "Whisper Thai"/);
    assert.match(openButton, /Whisper Thai/);
    assert.match(openButton, /disabled=/);
    assert.doesNotMatch(openButton, /currentSelectedTranscriptionEngine/);
    assert.match(profileGroup, /Whisper Thai/);
    assert.equal(
        QUICK_TRANSCRIPTION_ENGINE_OPTIONS.some(({ id }) => id === "Whisper Thai"),
        true,
    );
    assert.match(locales, /whisper_thai/);
    for (const source of [languageSettings, liveBar, controlRail]) {
        assert.match(source, /currentTranscriptionProfileSend/);
        assert.match(source, /currentTranscriptionProfileReceive/);
        assert.match(source, /getRecognitionEngineForGroup/);
    }
    assert.match(selector, /getRecognitionProfileForSelector/);
});

test("Whisper Thai backend broadcasts have registered UI routes", async () => {
    const [settings, routes] = await Promise.all([
        read("src-ui", "logics", "configs", "config_page_setter", "ui_config_setter.js"),
        read("src-ui", "logics", "useReceiveRoutes.js"),
    ]);

    assert.match(
        settings,
        /Base_Name: "WhisperThaiModelCatalog"[\s\S]*?base_endpoint_name: "whisper_thai_model_catalog"/,
    );
    assert.match(
        settings,
        /Base_Name: "SelectedTranscriptionEngineSend"[\s\S]*?add_endpoint_run_array: \["from_backend"\]/,
    );
    assert.match(
        settings,
        /Base_Name: "SelectedTranscriptionEngineReceive"[\s\S]*?add_endpoint_run_array: \["from_backend"\]/,
    );
    assert.match(
        routes,
        /endpoint: `\/run\/\$\{ep\}`[\s\S]*?method_name: updateFromBackendMethodName/,
    );
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
