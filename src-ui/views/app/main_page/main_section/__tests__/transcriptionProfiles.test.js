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
});

test("legacy overwrite warning is required only when complete profiles differ", async () => {
    const { transcriptionProfilesMatch, shouldWarnLegacyOverwrite } = await import(utilsUrl);
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

test("legacy Model and Provider controls guard every apply-to-both setter", async () => {
    const source = await readFile(path.join(
        root,
        "src-ui", "views", "app", "config_page", "setting_section", "setting_box",
        "transcription", "Transcription.jsx",
    ), "utf8");

    assert.match(source, /shouldWarnLegacyOverwrite/);
    assert.match(source, /window\.confirm/);
    assert.match(source, /apply_to_both_warning/);
    assert.match(source, /applyToBoth\(setSelectedTranscriptionEngine/);
    assert.match(source, /applyToBoth\(setSelectedWhisperWeightType/);
    assert.match(source, /applyToBoth\(setSelectedTranscriptionComputeDevice/);
});
