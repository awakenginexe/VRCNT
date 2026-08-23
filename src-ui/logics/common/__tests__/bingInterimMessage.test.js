import test from "node:test";
import assert from "node:assert/strict";

import {
    BING_INTERIM_MESSAGE_IDS,
    updateBingInterimMessageLogs,
} from "../bingInterimMessage.js";

test("updates one temporary interim row per transcription direction", () => {
    const first = updateBingInterimMessageLogs([], {
        source: "mic",
        language: "Thai",
        text: "สวัส",
    }, 1_000);
    const second = updateBingInterimMessageLogs(first, {
        source: "mic",
        language: "Thai",
        text: "สวัสดี",
    }, 2_000);
    const listening = updateBingInterimMessageLogs(second, {
        source: "speaker",
        language: "Japanese",
        text: "こんにちは",
    }, 3_000);

    assert.equal(listening.length, 2);
    assert.equal(
        listening.find((entry) => entry.id === BING_INTERIM_MESSAGE_IDS.mic)
            .messages.original.message,
        "สวัสดี",
    );
    assert.equal(
        listening.find((entry) => entry.id === BING_INTERIM_MESSAGE_IDS.speaker)
            .messages.original.message,
        "こんにちは",
    );
    assert.equal(listening.find((entry) => entry.id === BING_INTERIM_MESSAGE_IDS.mic).status, "interim");
});

test("clearing an interim row does not remove final message logs", () => {
    const logs = [
        {
            id: "final",
            category: "sent",
            status: "ok",
            messages: { original: { message: "final" }, translations: [] },
        },
        ...updateBingInterimMessageLogs([], {
            source: "mic",
            text: "draft",
        }, 1_000),
    ];

    const cleared = updateBingInterimMessageLogs(logs, {
        source: "mic",
        text: "",
        clear: true,
    }, 2_000);

    assert.deepEqual(cleared.map((entry) => entry.id), ["final"]);
});
