import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../../");
const read = (...segments) => readFile(path.join(root, ...segments), "utf8");

test("Whisper Cloud is wired through the modern and legacy transcription surfaces", async () => {
    const [profileUi, engineUtils, engines, models, legacy, configSetter, mainloop] = await Promise.all([
        read("src-ui", "views", "app", "main_page", "engines", "transcriptionProfileUi.js"),
        read("src-ui", "views", "app", "main_page", "engines", "engineModelUtils.js"),
        read("src-ui", "views", "app", "main_page", "engines", "EnginesWorkspace.jsx"),
        read("src-ui", "views", "app", "main_page", "models", "ModelsHub.jsx"),
        read("src-ui", "views", "app", "config_page", "setting_section", "setting_box", "transcription", "Transcription.jsx"),
        read("src-ui", "logics", "configs", "config_page_setter", "ui_config_setter.js"),
        read("src-python", "mainloop.py"),
    ]);

    assert.match(profileUi, /Whisper Cloud/);
    assert.match(engineUtils, /whisper-large-v3/);
    assert.match(engines, /currentGroqAuthKey/);
    assert.match(engines, /modelStatuses/);
    assert.match(models, /Whisper Cloud/);
    assert.match(models, /model_and_provider/);
    assert.match(legacy, /Whisper Cloud/);
    assert.match(legacy, /UseSplitGroqApiKey|use_split_groq_api_key|SplitGroq/);
    assert.match(configSetter, /Base_Name: "UseSplitGroqApiKey"/);
    assert.match(configSetter, /Base_Name: "GroqWhisperAuthKey"/);
    assert.match(mainloop, /groq_whisper_auth_key/);
});

test("quick selector keeps Google and Whisper Cloud together in the first row", async () => {
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
        QUICK_TRANSCRIPTION_ENGINE_OPTIONS.slice(0, 4).map(({ id }) => id),
        ["Google", "Whisper Cloud", "Whisper", "Whisper Thai"],
    );
});
