import assert from "node:assert/strict";
import test from "node:test";

import {
    FONT_DOWNLOAD_POLICY,
    getFontPackDownloadState,
    requestOptionalFontPack,
} from "../fontPackDownloads.js";

test("Ask asks Rust to distinguish a missing pack from a verified cached pack", async () => {
    const state = getFontPackDownloadState(FONT_DOWNLOAD_POLICY.ASK, false, false);
    assert.deepEqual(state, { action: "ask", usesSystemFallback: true });

    let command;
    const result = await requestOptionalFontPack(async (name) => {
        command = name;
        return { action: "ask", result: null };
    }, "ethiopic", FONT_DOWNLOAD_POLICY.ASK, false);

    assert.equal(command, "download_optional_font_pack");
    assert.deepEqual(result, state);
});

test("Automatic sends only the manifest pack ID while fallback remains active during download", async () => {
    const state = getFontPackDownloadState(FONT_DOWNLOAD_POLICY.AUTOMATIC, false, false);
    assert.deepEqual(state, { action: "download", usesSystemFallback: true });

    let command;
    let payload;
    const result = await requestOptionalFontPack(async (name, args) => {
        command = name;
        payload = args;
        return { action: "download", result: { packId: "ethiopic", installed: true, totalBytes: 42 } };
    }, "ethiopic", FONT_DOWNLOAD_POLICY.AUTOMATIC, false);

    assert.equal(command, "download_optional_font_pack");
    assert.deepEqual(payload, {
        request: { packId: "ethiopic", policy: "automatic", confirmed: false },
    });
    assert.deepEqual(result, { action: "download", usesSystemFallback: false });
});

test("Never does not download a missing pack and preserves immediate system fallback", async () => {
    const state = getFontPackDownloadState(FONT_DOWNLOAD_POLICY.NEVER, false, false);
    assert.deepEqual(state, { action: "fallback", usesSystemFallback: true });

    const result = await requestOptionalFontPack(async (name) => {
        assert.equal(name, "download_optional_font_pack");
        return { action: "fallback", result: null };
    }, "ethiopic", FONT_DOWNLOAD_POLICY.NEVER, false);

    assert.deepEqual(result, state);
});

test("a verified cache entry is available after restart regardless of policy", async () => {
    const result = await requestOptionalFontPack(async () => (
        { action: "available", result: null }
    ), "ethiopic", FONT_DOWNLOAD_POLICY.NEVER, false);

    assert.deepEqual(result, { action: "available", usesSystemFallback: false });
});
