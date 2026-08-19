import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../../");
const read = (...segments) => readFile(path.join(root, ...segments), "utf8");

test("generated model downloads expose immediate pending and cooperative cancellation routes", async () => {
    const [settingsLogic, categoryApi, routes] = await Promise.all([
        read("src-ui", "logics", "configs", "config_page_setter", "useSettingsLogics.js"),
        read("src-ui", "logics", "configs", "config_page_setter", "ui_config_setter.js"),
        read("src-ui", "logics", "useReceiveRoutes.js"),
    ]);

    assert.match(
        settingsLogic,
        /result\[`download\$\{base\}`\] = \(weight_type\) => \{[\s\S]*?result\[`pending\$\{base\}`\]\(weight_type\);[\s\S]*?asyncStdoutToPython\(`\/run\/download_\$\{s\.base_endpoint_name\}`, weight_type\);/,
    );
    assert.match(settingsLogic, /result\[`cancelDownload\$\{base\}`\] = \(weight_type\) => \{/);
    assert.match(settingsLogic, /is_cancelling: true/);
    assert.match(settingsLogic, /result\[`downloadCancelled\$\{base\}`\] = \(id\) => \{/);
    assert.match(settingsLogic, /is_pending: false,[\s\S]*?is_cancelling: false,[\s\S]*?progress: null,[\s\S]*?download_failed: false/);
    assert.match(categoryApi, /const cancelDownloadKey = `cancelDownload\$\{base\}`/);
    assert.match(categoryApi, /const downloadCancelledKey = `downloadCancelled\$\{base\}`/);
    assert.match(routes, /endpoint: `\/run\/download_cancelled_\$\{ep\}`[\s\S]*?method_name: `downloadCancelled\$\{base\}`/);
});
