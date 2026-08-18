import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../../");
const utilsUrl = pathToFileURL(
    path.join(root, "src-ui", "views", "app", "main_page", "engines", "transcriptionProfileUi.js"),
).href;

test("profile cards expose only controls supported by their provider", async () => {
    const { getProfileControlVisibility } = await import(utilsUrl);

    assert.deepEqual(getProfileControlVisibility("Google"), {
        model: false,
        device: false,
        computeType: false,
        whisperDecoding: false,
    });
    assert.deepEqual(getProfileControlVisibility("Whisper"), {
        model: true,
        device: true,
        computeType: true,
        whisperDecoding: true,
    });
    assert.deepEqual(getProfileControlVisibility("Parakeet"), {
        model: true,
        device: true,
        computeType: false,
        whisperDecoding: false,
    });
    assert.deepEqual(getProfileControlVisibility("Whisper Cloud"), {
        model: true,
        device: false,
        computeType: false,
        whisperDecoding: false,
    });
    for (const engine of ["Vosk", "SenseVoice"]) {
        assert.deepEqual(getProfileControlVisibility(engine), {
            model: true,
            device: false,
            computeType: false,
            whisperDecoding: false,
        });
    }
});

test("availability is resolved from the active provider model only", async () => {
    const { getActiveModelAvailability } = await import(utilsUrl);
    const statuses = {
        Whisper: [
            { id: "tiny", is_downloaded: true },
            { id: "small", is_downloaded: false, downloadable: true },
        ],
    };

    assert.equal(getActiveModelAvailability({
        engine: "Whisper",
        models: { Whisper: "tiny" },
    }, statuses), "installed");
    assert.equal(getActiveModelAvailability({
        engine: "Whisper",
        models: { Whisper: "small" },
    }, statuses), "download_required");
    assert.equal(getActiveModelAvailability({ engine: "Google", models: {} }, statuses), "cloud");
    assert.equal(getActiveModelAvailability({
        engine: "Whisper Cloud",
        models: { "Whisper Cloud": "whisper-large-v3-turbo" },
    }, statuses), "cloud");
});

test("legacy overwrite warning is required only when complete profiles differ", async () => {
    const {
        requestLegacyApplyToBoth,
        transcriptionProfilesMatch,
        shouldWarnLegacyOverwrite,
    } = await import(utilsUrl);
    const outgoing = {
        engine: "Whisper",
        models: { Whisper: "tiny" },
        device: { device: "cpu", device_index: 0 },
        compute_type: "int8",
        whisper_decoding_profile: "balanced",
    };

    assert.equal(transcriptionProfilesMatch(outgoing, structuredClone(outgoing)), true);
    assert.equal(shouldWarnLegacyOverwrite(outgoing, structuredClone(outgoing)), false);
    assert.equal(shouldWarnLegacyOverwrite(outgoing, { ...outgoing, engine: "Google" }), true);

    const calls = [];
    const action = () => calls.push("apply");
    requestLegacyApplyToBoth({
        outgoing,
        incoming: structuredClone(outgoing),
        action,
        requestConfirmation: () => calls.push("confirm"),
    });
    requestLegacyApplyToBoth({
        outgoing,
        incoming: { ...outgoing, engine: "Google" },
        action,
        requestConfirmation: (pendingAction) => {
            calls.push("confirm");
            pendingAction();
        },
    });
    assert.deepEqual(calls, ["apply", "confirm", "apply"]);
});

test("legacy controls retain hydrated values until a profile field arrives", async () => {
    const profileUi = await import(utilsUrl);

    assert.equal(typeof profileUi.resolveProfileBackedState, "function");
    const legacyDevice = { device: "cpu", device_index: 0, device_name: "CPU" };
    const legacyState = { state: "ok", data: legacyDevice };

    assert.deepEqual(
        profileUi.resolveProfileBackedState(legacyState, undefined),
        legacyState,
    );
    assert.deepEqual(
        profileUi.resolveProfileBackedState(legacyState, { device: "cuda", device_index: 1 }),
        { state: "ok", data: { device: "cuda", device_index: 1 } },
    );
    assert.deepEqual(
        profileUi.resolveProfileBackedState(undefined, undefined),
        { data: {} },
    );
});

test("live engine summaries prefer the active profile over the stale legacy engine", async () => {
    const { resolveLiveTranscriptionEngine } = await import(utilsUrl);

    assert.equal(typeof resolveLiveTranscriptionEngine, "function");
    assert.equal(
        resolveLiveTranscriptionEngine({
            legacyEngine: "Google",
            sendProfile: { engine: "Whisper" },
            receiveProfile: { engine: "Whisper" },
        }),
        "Whisper",
    );
    assert.equal(
        resolveLiveTranscriptionEngine({
            legacyEngine: "Google",
            sendProfile: {},
            receiveProfile: { engine: "Whisper Thai" },
        }),
        "Whisper Thai",
    );
    assert.equal(
        resolveLiveTranscriptionEngine({ legacyEngine: "Google" }),
        "Google",
    );
});

test("live model summaries prefer the active profile over the stale legacy model", async () => {
    const { resolveLiveTranscriptionModel } = await import(utilsUrl);

    assert.equal(typeof resolveLiveTranscriptionModel, "function");
    assert.equal(
        resolveLiveTranscriptionModel({
            legacyEngine: "Whisper",
            legacyModel: "tiny",
            sendProfile: {
                engine: "Whisper",
                models: { Whisper: "large-v3-turbo" },
            },
            receiveProfile: {
                engine: "Whisper",
                models: { Whisper: "large-v3-turbo" },
            },
        }),
        "large-v3-turbo",
    );
});

test("quick transcription picker keeps Speaking and Listening profiles independent", async () => {
    const quickPickUrl = pathToFileURL(path.join(
        root,
        "src-ui", "views", "app", "main_page", "sidebar_section",
        "language_settings", "transcription_engine_label", "transcriptionEngineQuickPick.js",
    )).href;
    const { TRANSCRIPTION_ENGINE_QUICK_PICK_ROLES, getQuickPickerProfile } = await import(quickPickUrl);

    assert.deepEqual(
        TRANSCRIPTION_ENGINE_QUICK_PICK_ROLES.map(({ id }) => id),
        ["speaking", "listening"],
    );
    assert.equal(
        getQuickPickerProfile("speaking", {
            engine: "Whisper Thai",
        }, {
            engine: "Whisper",
        }).engine,
        "Whisper Thai",
    );
    assert.equal(
        getQuickPickerProfile("listening", {
            engine: "Whisper Thai",
        }, {
            engine: "Whisper",
        }).engine,
        "Whisper",
    );

    const selectorSource = await readFile(path.join(
        root,
        "src-ui", "views", "app", "main_page", "sidebar_section",
        "language_settings", "transcription_engine_label", "transcription_engine_selector",
        "TranscriptionEngineSelector.jsx",
    ), "utf8");
    assert.match(selectorSource, /setSelectedTranscriptionEngineSend/);
    assert.match(selectorSource, /setSelectedTranscriptionEngineReceive/);
});

test("legacy Model and Provider controls use the styled apply-to-both confirmation", async () => {
    const source = await readFile(path.join(
        root,
        "src-ui", "views", "app", "config_page", "setting_section", "setting_box",
        "transcription", "Transcription.jsx",
    ), "utf8");

    assert.doesNotMatch(source, /window\.confirm/);
    assert.match(source, /LegacyApplyToBothConfirmation/);
    assert.match(source, /getProfileControlVisibility\(engine\)/);
    assert.match(source, /visibility\.device && \([\s\S]*?<TranscriptionComputeDevice_Box/);
    assert.match(source, /showComputeType=\{visibility\.computeType\}/);
    assert.match(source, /applyToBoth\(setSelectedTranscriptionEngine/);
    assert.match(source, /applyToBoth\(setSelectedWhisperWeightType/);
    assert.match(source, /applyToBoth\(setSelectedTranscriptionComputeDevice/);
});
