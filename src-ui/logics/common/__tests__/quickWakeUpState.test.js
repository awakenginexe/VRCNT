import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";


const here = path.dirname(fileURLToPath(import.meta.url));
const commonRoot = path.resolve(here, "..");

test("Quick Wake Up restores only after backend readiness and final startup state", async () => {
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
        isInitializationComplete: false,
        enabled: true,
        restoreState: "confirmed",
    }), false);
    assert.equal(shouldRestoreQuickWakeUp({
        isBackendReady: true,
        isInitializationComplete: true,
        enabled: true,
        restoreState: "confirmed",
    }), true);
    assert.equal(shouldRestoreQuickWakeUp({
        isBackendReady: true,
        enabled: true,
        restoreState: "requested",
    }), false);
});

test("Quick Wake Up starts a new restore cycle after the backend restarts", async () => {
    const moduleUrl = pathToFileURL(path.join(commonRoot, "quickWakeUpState.js")).href;
    const { advanceQuickWakeUpRestoreState } = await import(moduleUrl);

    assert.deepEqual(
        advanceQuickWakeUpRestoreState?.({
            isBackendReady: false,
            isInitializationComplete: false,
            enabled: true,
            restoreState: "requested",
        }),
        {
            restoreState: "unconfirmed",
            shouldRequest: false,
        },
    );
    assert.deepEqual(
        advanceQuickWakeUpRestoreState?.({
            isBackendReady: true,
            isInitializationComplete: false,
            enabled: true,
            restoreState: "unconfirmed",
        }),
        {
            restoreState: "confirmed",
            shouldRequest: false,
        },
    );
    assert.deepEqual(
        advanceQuickWakeUpRestoreState?.({
            isBackendReady: true,
            isInitializationComplete: true,
            enabled: true,
            restoreState: "confirmed",
        }),
        {
            restoreState: "requested",
            shouldRequest: true,
        },
    );
});

test("Quick Wake Up keeps each pipeline in a requested/restoring/ready state", async () => {
    const moduleUrl = pathToFileURL(path.join(commonRoot, "quickWakeUpState.js")).href;
    const {
        applyQuickWakeUpRestoreEvent,
        beginQuickWakeUpRestore,
        createQuickWakeUpRestoreState,
    } = await import(moduleUrl);

    const requested = beginQuickWakeUpRestore(createQuickWakeUpRestoreState(), 4);
    assert.equal(requested.phase, "requested");
    assert.deepEqual(requested.requested, {
        translation: true,
        transcription_send: true,
        transcription_receive: true,
    });

    const restoring = applyQuickWakeUpRestoreEvent(requested, {
        generation: 4,
        phase: "restoring",
        requested: {
            translation: true,
            transcription_send: false,
            transcription_receive: true,
        },
        restoring: {
            translation: true,
            transcription_send: false,
            transcription_receive: true,
        },
    });
    assert.equal(restoring.phase, "restoring");
    assert.equal(restoring.restoring.transcription_send, false);

    const ready = applyQuickWakeUpRestoreEvent(restoring, {
        generation: 4,
        phase: "ready",
        requested: restoring.requested,
        restoring: {
            translation: false,
            transcription_send: false,
            transcription_receive: false,
        },
        ready: {
            translation: true,
            transcription_send: false,
            transcription_receive: true,
        },
        failed: {},
    });
    assert.equal(ready.phase, "ready");
    assert.equal(ready.ready.translation, true);
    assert.equal(ready.ready.transcription_receive, true);
    assert.equal(ready.ready.transcription_send, false);
});
