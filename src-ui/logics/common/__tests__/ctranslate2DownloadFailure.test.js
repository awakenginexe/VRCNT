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
    assert.match(errorHandler, /downloadFailedCTranslate2WeightTypeStatus\(data\?\.weight_type\)/);
    assert.match(settingsLogic, /downloadFailed\$\{base\}/);
    assert.match(settingsLogic, /is_pending: false, progress: null/);
    assert.match(categoryApi, /downloadFailedKey/);
});
