import assert from "node:assert/strict";
import test from "node:test";
import {
    configurableControlCount,
    settingsControlCount,
    settingsSections,
} from "../../prototypes/settingsPrototypeData.js";

test("settings prototypes cover every current settings destination", () => {
    assert.deepEqual(
        settingsSections.map((section) => section.id),
        [
            "device",
            "appearance",
            "translation",
            "transcription",
            "vr",
            "others",
            "hotkeys",
            "advanced",
            "about",
        ],
    );
    assert.equal(configurableControlCount, 97);
    assert.equal(settingsControlCount, 100);
});

test("settings prototypes include the specialist controls that are easy to omit", () => {
    const labels = settingsSections.flatMap((section) => section.groups)
        .flatMap((group) => group.controls)
        .map((control) => control.label);

    for (const requiredLabel of [
        "Speaker no-speech probability",
        "NVIDIA Parakeet model",
        "SenseVoice-Small model",
        "Send received messages to VRChat",
        "Convert messages to Hiragana",
        "Sync VRChat mic mute",
        "Sample text preview",
        "WebSocket host",
    ]) {
        assert.ok(labels.includes(requiredLabel), `${requiredLabel} is missing`);
    }
});
