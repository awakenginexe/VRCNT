import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../../");
const routingUrl = pathToFileURL(path.join(
    root,
    "src-ui",
    "views",
    "app",
    "main_page",
    "sidebar_section",
    "language_settings",
    "languageRoutingUtils.js",
)).href;

test("speaking uses send while target uses receive", async () => {
    const { getRecognitionEngineForGroup, getRecognitionProfileForSelector } = await import(routingUrl);
    const sendProfile = {
        engine: "Whisper Thai",
        models: { "Whisper Thai": "thai-thonburian-small" },
    };
    const receiveProfile = {
        engine: "Whisper",
        models: { Whisper: "large-v3-turbo" },
    };

    assert.equal(
        getRecognitionEngineForGroup({ group: "speaking", sendProfile, receiveProfile }),
        "Whisper Thai",
    );
    assert.equal(
        getRecognitionEngineForGroup({ group: "target", sendProfile, receiveProfile }),
        "Whisper",
    );
    assert.equal(
        getRecognitionProfileForSelector({ selectorType: "your_language", sendProfile, receiveProfile }),
        sendProfile,
    );
    assert.equal(
        getRecognitionProfileForSelector({ selectorType: "target_language", sendProfile, receiveProfile }),
        receiveProfile,
    );
});

test("translation-language selection has no recognition profile", async () => {
    const { getRecognitionProfileForSelector } = await import(routingUrl);

    assert.equal(
        getRecognitionProfileForSelector({
            selectorType: "your_translation_language",
            sendProfile: { engine: "Whisper Thai" },
            receiveProfile: { engine: "Whisper" },
        }),
        null,
    );
});
