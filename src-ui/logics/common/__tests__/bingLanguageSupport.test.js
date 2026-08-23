import assert from "node:assert/strict";
import test from "node:test";

import {
    getUnsupportedBingLanguageSlots,
    shouldBlockBingDirection,
} from "../bingLanguageSupport.js";

const catalog = [
    { language: "Thai", country: "Thailand", bing_supported: true },
    { language: "Chinese Simplified", country: "Hong Kong", bing_supported: false },
    { language: "Chinese Traditional", country: "Hong Kong", bing_supported: true },
];

test("Bing direction guard checks the active first slot without deleting saved extras", () => {
    const slots = {
        1: { language: "Chinese Simplified", country: "Hong Kong", enable: true },
        2: { language: "Thai", country: "Thailand", enable: true },
        3: { language: "Thai", country: "Thailand", enable: false },
    };

    assert.equal(shouldBlockBingDirection({ engine: "Bing", slots, languageCatalog: catalog }), true);
    assert.deepEqual(slots["2"], { language: "Thai", country: "Thailand", enable: true });
    assert.deepEqual(
        getUnsupportedBingLanguageSlots({ engine: "Bing", slots, languageCatalog: catalog }),
        [{ slot: "1", language: "Chinese Simplified", country: "Hong Kong" }],
    );
});

test("supported Chinese Traditional Hong Kong remains available to Bing", () => {
    assert.equal(shouldBlockBingDirection({
        engine: "Bing",
        slots: {
            1: { language: "Chinese Traditional", country: "Hong Kong", enable: true },
        },
        languageCatalog: catalog,
    }), false);
});

test("non-Bing engines and an unhydrated catalog do not create a false block", () => {
    const slots = {
        1: { language: "Sundanese", country: "Indonesia", enable: true },
    };
    assert.equal(shouldBlockBingDirection({ engine: "Whisper", slots, languageCatalog: catalog }), false);
    assert.equal(shouldBlockBingDirection({ engine: "Bing", slots, languageCatalog: [] }), false);
});
