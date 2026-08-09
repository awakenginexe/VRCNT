import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../../");
const displayUrl = pathToFileURL(path.join(
    root,
    "src-ui",
    "views",
    "app",
    "main_page",
    "models",
    "modelDownloadDisplay.js",
)).href;
const { getDownloadProgress, getModelDownloadState } = await import(displayUrl);

test("pending without progress is preparing, not zero percent", () => {
    assert.equal(getDownloadProgress({ is_pending: true, progress: null }), null);
    assert.equal(getModelDownloadState({ is_pending: true, progress: null }), "preparing");
});

test("numeric progress preserves zero and clamps bounds", () => {
    assert.equal(getDownloadProgress({ is_pending: true, progress: 0 }), 0);
    assert.equal(getDownloadProgress({ is_pending: true, progress: 42 }), 42);
    assert.equal(getDownloadProgress({ is_pending: true, progress: 140 }), 100);
    assert.equal(getDownloadProgress({ is_pending: true, progress: -5 }), 0);
});

test("failure and installed states are explicit", () => {
    assert.equal(getModelDownloadState({ download_failed: true }), "failed");
    assert.equal(getModelDownloadState({ is_downloaded: true }), "installed");
    assert.equal(getModelDownloadState({ downloadable: false }), "unavailable");
    assert.equal(getModelDownloadState({}), "download_required");
    assert.equal(getModelDownloadState(null), "download_required");
});
