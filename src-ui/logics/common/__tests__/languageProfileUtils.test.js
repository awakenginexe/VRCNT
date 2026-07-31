import assert from "node:assert/strict";
import test from "node:test";

import {
    LANGUAGE_SLOT_KEYS,
    canAddLanguage,
    canRemoveLanguage,
    enabledSlotCount,
    enabledSlotKeys,
    findDuplicateSlot,
    nextDisabledSlotKey,
    recognitionState,
    removeLanguageSlot,
    setLanguageSlot,
} from "../languageProfileUtils.js";


const languages = {
    1: { language: "English", country: "Singapore", enable: true },
    2: { language: "Thai", country: "Thailand", enable: true },
    3: { language: "Chinese Traditional", country: "Taiwan", enable: false },
};

test("enabled language slots remain ordered and bounded to three", () => {
    assert.deepEqual(LANGUAGE_SLOT_KEYS, ["1", "2", "3"]);
    assert.deepEqual(enabledSlotKeys(languages), ["1", "2"]);
    assert.equal(enabledSlotCount(languages), 2);
    assert.equal(canAddLanguage(languages), true);
    assert.equal(nextDisabledSlotKey(languages), "3");
    assert.equal(canAddLanguage({
        ...languages,
        3: { ...languages[3], enable: true },
    }), false);
});

test("duplicate detection excludes the slot currently being edited", () => {
    assert.equal(
        findDuplicateSlot(
            languages,
            { language: "Thai", country: "Thailand" },
            "3",
        ),
        "2",
    );
    assert.equal(
        findDuplicateSlot(
            languages,
            { language: "Thai", country: "Thailand" },
            "2",
        ),
        null,
    );
});

test("setting a language is immutable and enables the requested slot", () => {
    const updated = setLanguageSlot(
        languages,
        "3",
        { language: "Japanese", country: "Japan" },
    );

    assert.notEqual(updated, languages);
    assert.deepEqual(languages[3], {
        language: "Chinese Traditional",
        country: "Taiwan",
        enable: false,
    });
    assert.deepEqual(updated[3], {
        language: "Japanese",
        country: "Japan",
        enable: true,
    });
});

test("removing the primary language promotes the next language and retains its value", () => {
    const updated = removeLanguageSlot(languages, "1");

    assert.deepEqual(updated[1], {
        language: "Thai",
        country: "Thailand",
        enable: true,
    });
    assert.deepEqual(updated[2], {
        language: "English",
        country: "Singapore",
        enable: false,
    });
    assert.deepEqual(languages[1], {
        language: "English",
        country: "Singapore",
        enable: true,
    });
});

test("the final enabled language cannot be removed", () => {
    const oneLanguage = {
        ...languages,
        2: { ...languages[2], enable: false },
    };

    assert.equal(canRemoveLanguage(oneLanguage, "1"), false);
    assert.equal(removeLanguageSlot(oneLanguage, "1"), oneLanguage);
});

test("single-language engine capability pauses only recognition work", () => {
    const capability = {
        microphone_max: 1,
        received_max: 1,
        parallel_candidates: false,
    };

    assert.equal(recognitionState(capability, "1", "speaking"), "active");
    assert.equal(recognitionState(capability, "3", "speaking"), "paused");
    assert.equal(recognitionState(capability, "3", "target"), "outgoing-only");
});

test("Google capability keeps all slots active", () => {
    const capability = {
        microphone_max: 3,
        received_max: 3,
        parallel_candidates: true,
    };

    assert.equal(recognitionState(capability, "3", "speaking"), "active");
    assert.equal(recognitionState(capability, "3", "target"), "active");
});
