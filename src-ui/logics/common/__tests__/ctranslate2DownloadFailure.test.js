import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("a failed CTranslate2 download is visible in DevTools and leaves the model retryable", () => {
    const errorHandler = read("src-ui/logics/_useBackendErrorHandling.js");
    const settingsLogic = read("src-ui/logics/configs/config_page_setter/useSettingsLogics.js");
    const categoryApi = read("src-ui/logics/configs/config_page_setter/ui_config_setter.js");

    assert.match(errorHandler, /\[VRCNT\] CTranslate2 model download failed\./);
    assert.match(errorHandler, /getWeightDisplayName/);
    assert.match(errorHandler, /downloadFailedCTranslate2WeightTypeStatus\(data\?\.weight_type\)/);
    assert.match(settingsLogic, /downloadFailed\$\{base\}/);
    assert.match(settingsLogic, /is_pending: false,[\s\S]*progress: null/);
    assert.match(settingsLogic, /download_failed: true/);
    assert.match(settingsLogic, /typeof downloaded_weight_type_status === "string"/);
    assert.match(categoryApi, /downloadFailedKey/);
});

test("model readiness errors are handled before generic translation activation errors", () => {
    const errorHandler = read("src-ui/logics/_useBackendErrorHandling.js");

    assert.match(errorHandler, /TRANSLATION_MODEL_NOT_READY/);
    assert.match(errorHandler, /TRANSLATION_MODEL_CHANGE_ACTIVE/);
});
