import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";


const here = path.dirname(fileURLToPath(import.meta.url));
const commonRoot = path.resolve(here, "..");

test("Quick Wake Up restores only after backend readiness and one confirmed state", async () => {
    const moduleUrl = pathToFileURL(path.join(commonRoot, "quickWakeUpState.js")).href;
    const { shouldRestoreQuickWakeUp } = await import(moduleUrl);

    assert.equal(shouldRestoreQuickWakeUp({
        isBackendReady: false,
        enabled: true,
        restoreState: "confirmed",
    }), false);
    assert.equal(shouldRestoreQuickWakeUp({
        isBackendReady: true,
        enabled: false,
        restoreState: "confirmed",
    }), false);
    assert.equal(shouldRestoreQuickWakeUp({
        isBackendReady: true,
        enabled: true,
        restoreState: "unconfirmed",
    }), false);
    assert.equal(shouldRestoreQuickWakeUp({
        isBackendReady: true,
        enabled: true,
        restoreState: "confirmed",
    }), true);
    assert.equal(shouldRestoreQuickWakeUp({
        isBackendReady: true,
        enabled: true,
        restoreState: "requested",
    }), false);
});
