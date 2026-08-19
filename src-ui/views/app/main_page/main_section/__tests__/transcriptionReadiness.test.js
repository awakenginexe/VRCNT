import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../../");
const utilsUrl = pathToFileURL(
    path.join(root, "src-ui", "views", "app", "main_page", "sidebar_section", "language_settings", "transcriptionRuntimeUtils.js"),
).href;

test("local Whisper readiness is not ready when the selected model is missing", async () => {
    const { getTranscriptionModelReadiness } = await import(utilsUrl);

    assert.deepEqual(getTranscriptionModelReadiness({
        profile: { engine: "Whisper", models: { Whisper: "tiny" } },
        modelStatusesByEngine: { Whisper: [{ id: "tiny", is_downloaded: false }] },
    }), {
        state: "not_ready",
        engine: "Whisper",
        model: "tiny",
        reason: "The selected Whisper model must be downloaded before transcription can be enabled.",
    });
});

test("downloaded Whisper Thai readiness is ready", async () => {
    const { getTranscriptionModelReadiness } = await import(utilsUrl);

    assert.deepEqual(getTranscriptionModelReadiness({
        profile: { engine: "Whisper Thai", models: { "Whisper Thai": "thai-thonburian-small" } },
        modelStatusesByEngine: {
            "Whisper Thai": [{ id: "thai-thonburian-small", is_downloaded: true }],
        },
    }), {
        state: "ready",
        engine: "Whisper Thai",
        model: "thai-thonburian-small",
        reason: "",
    });
});

test("aggregate readiness reports the missing Listening model", async () => {
    const { getAggregateTranscriptionReadiness } = await import(utilsUrl);

    assert.deepEqual(getAggregateTranscriptionReadiness({
        sendProfile: { engine: "Google" },
        receiveProfile: { engine: "Whisper", models: { Whisper: "tiny" } },
        modelStatusesByEngine: { Whisper: [{ id: "tiny", is_downloaded: false }] },
    }), {
        state: "not_ready",
        missing: [{
            source: "Listening",
            engine: "Whisper",
            model: "tiny",
            reason: "The selected Whisper model must be downloaded before transcription can be enabled.",
        }],
    });
});

test("missing local status arrays remain loading", async () => {
    const { getTranscriptionModelReadiness } = await import(utilsUrl);

    assert.equal(getTranscriptionModelReadiness({
        profile: { engine: "Whisper", models: { Whisper: "tiny" } },
        modelStatusesByEngine: {},
    }).state, "loading");
    assert.equal(getTranscriptionModelReadiness({
        profile: { engine: "Whisper", models: { Whisper: "tiny" } },
        modelStatusesByEngine: { Whisper: [] },
    }).state, "loading");
});

test("Google is ready without a model status", async () => {
    const { getTranscriptionModelReadiness } = await import(utilsUrl);

    assert.deepEqual(getTranscriptionModelReadiness({
        profile: { engine: "Google" },
    }), {
        state: "ready",
        engine: "Google",
        model: "",
        reason: "",
    });
});

test("Whisper Cloud follows the configured Groq credential", async () => {
    const { getTranscriptionModelReadiness } = await import(utilsUrl);
    const profile = { engine: "Whisper Cloud", models: { "Whisper Cloud": "whisper-large-v3-turbo" } };

    assert.equal(getTranscriptionModelReadiness({ profile, cloudConfigured: false }).state, "not_ready");
    assert.equal(getTranscriptionModelReadiness({ profile, cloudConfigured: true }).state, "ready");
});
