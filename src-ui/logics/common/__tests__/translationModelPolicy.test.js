import test from "node:test";
import assert from "node:assert/strict";
import {
    canSelectTranslationModel,
    getTranslationModelStatus,
} from "../translationModelPolicy.js";

test("pending model without progress is preparing instead of fake zero percent", () => {
    assert.deepEqual(
        getTranslationModelStatus({ is_pending: true, progress: null }),
        { state: "preparing", progress: null, ready: false, failed: false },
    );
});

test("download progress is kept as a real percentage", () => {
    assert.deepEqual(
        getTranslationModelStatus({ is_pending: true, progress: 42 }),
        { state: "downloading", progress: 42, ready: false, failed: false },
    );
});

test("failed downloads expose retry state", () => {
    assert.deepEqual(
        getTranslationModelStatus({ is_downloaded: false, download_failed: true }),
        { state: "failed", progress: null, ready: false, failed: true },
    );
});

test("ready requires a verified weight and tokenizer", () => {
    assert.deepEqual(
        getTranslationModelStatus({ is_downloaded: true, tokenizer_valid: true }),
        { state: "ready", progress: null, ready: true, failed: false },
    );
    assert.equal(
        getTranslationModelStatus({ is_downloaded: true, tokenizer_valid: false }).ready,
        false,
    );
});

test("active translation can pause while a model selection is applied", () => {
    assert.equal(canSelectTranslationModel(true), true);
    assert.equal(canSelectTranslationModel(false), true);
    assert.equal(canSelectTranslationModel(true, true), false);
});
