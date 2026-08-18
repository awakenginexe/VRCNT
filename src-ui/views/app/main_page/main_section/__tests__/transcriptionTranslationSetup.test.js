import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as setupUtils from "../../guided_setup/transcriptionTranslationSetupUtils.js";

const {
    applyDefaultTranscriptionEngine,
    getOfflinePresetOptions,
    getSelectedSetupOfflineModel,
    getSetupEngineOptions,
    getSetupTranslationProviderOptions,
} = setupUtils;

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

    const applied = applyDefaultTranscriptionEngine(
        "Whisper",
        (patch) => send.push(patch),
        (patch) => receive.push(patch),
    );

    assert.equal(applied, true);
    assert.deepEqual(send, [{ engine: "Whisper" }]);
    assert.deepEqual(receive, [{ engine: "Whisper" }]);
});

test("default transcription engine helper blocks unauthenticated Whisper Cloud mutations", () => {
    const send = [];
    const receive = [];
    const authPrompts = [];

    const applied = applyDefaultTranscriptionEngine(
        "Whisper Cloud",
        (patch) => send.push(patch),
        (patch) => receive.push(patch),
        {
            cloudConfigured: false,
            onAuthRequired: () => authPrompts.push("auth-required"),
        },
    );

    assert.equal(applied, false);
    assert.deepEqual(send, []);
    assert.deepEqual(receive, []);
    assert.deepEqual(authPrompts, ["auth-required"]);
});

test("default transcription engine helper applies authenticated Whisper Cloud normally", () => {
    const send = [];
    const receive = [];

    const applied = applyDefaultTranscriptionEngine(
        "Whisper Cloud",
        (patch) => send.push(patch),
        (patch) => receive.push(patch),
        { cloudConfigured: true },
    );

    assert.equal(applied, true);
    assert.deepEqual(send, [{ engine: "Whisper Cloud" }]);
    assert.deepEqual(receive, [{ engine: "Whisper Cloud" }]);
});

test("selected offline model helper keeps detailed non-preset CTranslate2 selections", () => {
    assert.equal(typeof getSelectedSetupOfflineModel, "function");

    const models = [
        { id: "m2m100_418M-ct2-int8", display_name: "Fast preset" },
        { id: "nllb-200-distilled-600M-ct2-int8", display_name: "Balanced preset" },
        {
            id: "opus-mt-ja-en-ct2-int8",
            display_name: "OPUS Japanese English",
            is_downloaded: false,
            downloadable: true,
        },
    ];
    const selected = getSelectedSetupOfflineModel({
        selectedWeightType: "opus-mt-ja-en-ct2-int8",
        models,
    });

    assert.equal(selected?.model?.id, "opus-mt-ja-en-ct2-int8");
    assert.equal(selected?.preset, "");
    assert.equal(selected?.downloadTargetModelId, "opus-mt-ja-en-ct2-int8");
});

test("advanced warning predicate only flags Whisper tiny profiles", () => {
    const { isWhisperTinyProfile } = setupUtils;
    assert.equal(typeof isWhisperTinyProfile, "function");
    assert.equal(isWhisperTinyProfile({ engine: "Whisper", models: { Whisper: "tiny" } }), true);
    assert.equal(isWhisperTinyProfile({ engine: "Whisper", models: { Whisper: "small" } }), false);
    assert.equal(isWhisperTinyProfile({ engine: "Google", models: { Whisper: "tiny" } }), false);
});

test("advanced model helper keeps the current model and downloaded engine models", () => {
    const { getActiveProfileModelOptions } = setupUtils;
    assert.equal(typeof getActiveProfileModelOptions, "function");
    assert.deepEqual(
        getActiveProfileModelOptions(
            { engine: "Whisper", models: { Whisper: "tiny" } },
            {
                Whisper: [
                    { id: "tiny", label: "Tiny", is_downloaded: false },
                    { id: "base", label: "Base", is_downloaded: true },
                    { id: "large-v3", label: "Large v3", is_downloaded: false },
                ],
                Vosk: [{ id: "vosk-en", label: "Vosk English", is_downloaded: true }],
            },
        ),
        [
            { id: "tiny", title: "Tiny" },
            { id: "base", title: "Base" },
        ],
    );
});

test("advanced model helper inserts the active model when backend statuses omit it", () => {
    const { getActiveProfileModelOptions } = setupUtils;

    assert.deepEqual(
        getActiveProfileModelOptions(
            { engine: "Whisper", models: { Whisper: "tiny" } },
            {
                Whisper: [
                    { id: "base", label: "Base", is_downloaded: true },
                    { id: "small", label: "Small", is_downloaded: false },
                ],
            },
        ),
        [
            { id: "tiny", title: "tiny" },
            { id: "base", title: "Base" },
        ],
    );
});

test("advanced model helper preserves downloadable transcription model choices", () => {
    const { getActiveProfileModelOptions } = setupUtils;

    assert.deepEqual(
        getActiveProfileModelOptions(
            { engine: "Parakeet", models: { Parakeet: "parakeet-installed" } },
            {
                Parakeet: [
                    { id: "parakeet-tdt-0.6b-v2", label: "Parakeet TDT", downloadable: true },
                    { id: "parakeet-rnnt-1.1b", label: "Parakeet RNNT", downloadable: false },
                    { id: "parakeet-installed", label: "Parakeet Installed", is_downloaded: true },
                ],
            },
        ),
        [
            { id: "parakeet-tdt-0.6b-v2", title: "Parakeet TDT" },
            { id: "parakeet-installed", title: "Parakeet Installed" },
        ],
    );
});

test("advanced profile helper blocks unauthenticated Whisper Cloud mutations", () => {
    const { getAdvancedProfilePatch } = setupUtils;
    assert.equal(typeof getAdvancedProfilePatch, "function");

    assert.equal(
        getAdvancedProfilePatch({ patch: { engine: "Whisper Cloud" }, cloudConfigured: false }),
        null,
    );
    assert.equal(
        getAdvancedProfilePatch({
            patch: { models: { "Whisper Cloud": "whisper-large-v3" } },
            cloudConfigured: false,
        }),
        null,
    );
    assert.deepEqual(
        getAdvancedProfilePatch({ patch: { engine: "Whisper Cloud" }, cloudConfigured: true }),
        { engine: "Whisper Cloud" },
    );
});

test("advanced provider helper caps parallel providers at two unique IDs", () => {
    const { getSetupTranslationSelection } = setupUtils;
    assert.equal(typeof getSetupTranslationSelection, "function");
    assert.equal(getSetupTranslationSelection([], 0, "DeepL"), "DeepL");
    assert.deepEqual(getSetupTranslationSelection(["DeepL"], 1, "CTranslate2"), ["DeepL", "CTranslate2"]);
    assert.deepEqual(getSetupTranslationSelection(["DeepL", "CTranslate2"], 1, "DeepL"), ["DeepL"]);
    assert.deepEqual(getSetupTranslationSelection(["DeepL", "CTranslate2"], 2, "Google"), ["DeepL", "CTranslate2"]);
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
        "currentUseSplitGroqApiKey",
        "currentGroqWhisperAuthKey",
        "currentGroqAuthKey",
        "defaultAuthRequired",
        "getPresetTranslationModels",
        "getTranslationModelStatus",
        "getSelectedSetupOfflineModel",
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

    assert.match(step, /modelSwitching/);
    assert.match(step, /model_switching/);
    assert.match(step, /downloadCTranslate2WeightTypeStatus/);
    assert.match(step, /downloadTargetModelId/);
    assert.match(step, /setSelectedCTranslate2WeightType/);
    assert.match(step, /setShowAdvanced/);
    assert.match(step, /showAdvanced\s*&&/);
    assert.match(step, /id=\{engineId\}/);
    assert.match(step, /engineId="guided-setup-advanced-outgoing-engine"/);
    assert.match(step, /engineId="guided-setup-advanced-incoming-engine"/);
    assert.match(step, /onProfileChange=\{setTranscriptionProfileSend\}/);
    assert.match(step, /onProfileChange=\{setTranscriptionProfileReceive\}/);
    assert.match(step, /getAdvancedProfilePatch/);
    assert.match(step, /cloudConfigured/);
    assert.match(step, /setAuthRequiredProfile/);
    assert.match(step, /availability_auth_required/);
    assert.doesNotMatch(step, /isDownloaded:/);
    assert.match(step, /isWhisperTinyProfile\(profile\)/);
    assert.match(step, /setCTranslate2AutoFallback\(event\.target\.checked\)/);
    assert.match(step, /id="guided-setup-advanced-secondary-provider"/);
    assert.match(step, /id="guided-setup-advanced-offline-model"/);
    assert.match(step, /subtitle:\s*model\.id/);
    assert.doesNotMatch(step, /setIsOpenedConfigPage|updateSelectedConfigTabId|updateExperienceRoute/);
    assert.match(guidedSetup, /import\s+\{\s*TranscriptionTranslationStep\s*\}/);
    assert.match(guidedSetup, /step === 5[\s\S]*<TranscriptionTranslationStep\s*\/>/);
});
