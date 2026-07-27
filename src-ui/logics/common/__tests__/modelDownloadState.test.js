import assert from "node:assert/strict";
import test from "node:test";
import {
    getModelRowState,
    resolvePendingModelSelection,
} from "../../../views/app/config_page/setting_section/setting_box/_components/download_models/modelDownloadState.js";

test("a downloadable uninstalled model opens confirmation instead of acting disabled", () => {
    assert.equal(getModelRowState({
        id: "small",
        is_downloaded: false,
        is_pending: false,
        progress: null,
        downloadable: true,
    }, false), "download_required");
});

test("a truly unavailable model remains unavailable", () => {
    assert.equal(getModelRowState({
        id: "parakeet",
        is_downloaded: false,
        is_pending: false,
        progress: null,
        downloadable: false,
    }, false), "unavailable");
});

test("a completed requested download selects exactly that model", () => {
    assert.deepEqual(resolvePendingModelSelection("small", [
        { id: "small", is_downloaded: true, is_pending: false, progress: null },
    ]), { action: "select", modelId: "small" });
});

test("a failed requested download clears intent without selecting", () => {
    assert.deepEqual(resolvePendingModelSelection("small", [
        { id: "small", is_downloaded: false, is_pending: false, progress: null },
    ]), { action: "clear", modelId: null });
});
