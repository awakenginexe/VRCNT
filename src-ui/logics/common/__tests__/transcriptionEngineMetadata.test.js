import assert from "node:assert/strict";
import test from "node:test";

import {
    getTranscriptionEngineMetadata,
    isCloudTranscriptionEngine,
} from "../transcriptionEngineMetadata.js";
import { shouldNotifyCloudLanguageLimit } from "../cloudTranscriptionLimit.js";

test("central engine metadata identifies Bing and Groq-backed Whisper Cloud", () => {
    assert.deepEqual(getTranscriptionEngineMetadata("Bing"), {
        displayName: "Bing",
        type: "cloud",
        provider: "microsoft-bing",
        maxLanguages: 1,
        icon: "bing",
    });
    assert.equal(isCloudTranscriptionEngine("Bing"), true);
    assert.equal(getTranscriptionEngineMetadata("Whisper Cloud").icon, "groq");
    assert.equal(getTranscriptionEngineMetadata("Whisper").icon, "openai");
    assert.equal(getTranscriptionEngineMetadata("Whisper Thai").icon, "openai");
    assert.equal(getTranscriptionEngineMetadata("Parakeet").icon, "nvidia");
    assert.equal(getTranscriptionEngineMetadata("SenseVoice").icon, "qwen");
    assert.equal(getTranscriptionEngineMetadata("Vosk").icon, "vosk");
    assert.equal(getTranscriptionEngineMetadata("Parakeet").maxLanguages, 3);
});

test("cloud-limit warning triggers once per engine transition with saved extras", () => {
    assert.equal(shouldNotifyCloudLanguageLimit({
        previousEngine: "Whisper",
        nextEngine: "Bing",
        configuredLanguageCount: 3,
    }), true);
    assert.equal(shouldNotifyCloudLanguageLimit({
        previousEngine: "Whisper",
        nextEngine: "Bing",
        configuredLanguageCount: 1,
    }), false);
    assert.equal(shouldNotifyCloudLanguageLimit({
        previousEngine: "Bing",
        nextEngine: "Whisper",
        configuredLanguageCount: 3,
    }), false);
});
