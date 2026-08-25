import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { createBackendProcessLifecycle } from "../backendLifecycle.js";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const controllerPath = path.join(
    repoRoot,
    "src-ui/views/app/_app_controllers/StartPythonController.jsx",
);

test("an intentional stop stays attached to the stopped backend process", () => {
    const stoppedProcess = createBackendProcessLifecycle();
    const replacementProcess = createBackendProcessLifecycle();

    stoppedProcess.requestStop();

    assert.equal(stoppedProcess.wasIntentionallyStopped(), true);
    assert.equal(replacementProcess.wasIntentionallyStopped(), false);
});

test("backend close handling uses per-process lifecycle state", () => {
    const source = fs.readFileSync(controllerPath, "utf8");

    assert.match(source, /createBackendProcessLifecycle/);
    assert.doesNotMatch(source, /intentionalStopRef/);
});

test("each new backend generation starts with a fresh guarded startup snapshot", () => {
    const source = fs.readFileSync(controllerPath, "utf8");

    assert.match(source, /createBackendSessionGuard/);
    assert.match(source, /const sessionId = sessionGuardRef\.current\.begin\(\)/);
    assert.match(source, /updateIsBackendReady\(false\)/);
    assert.match(source, /updateInitProgress\(0\)/);
    assert.match(source, /message_key: "blocking_operation\.startup_operation"/);
});

const extractControllerBlock = (source, startMarker, endMarker) => {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(start, -1, `missing controller marker: ${startMarker}`);
    assert.notEqual(end, -1, `missing controller marker: ${endMarker}`);
    return source.slice(start, end);
};

const assertCurrentSessionGuard = (callbackSource) => {
    assert.match(
        callbackSource,
        /if \(!sessionGuardRef\.current\.isCurrent\(sessionId\)\) return;/,
    );
};

test("resident close transitions to background without stopping the backend", () => {
    const source = fs.readFileSync(controllerPath, "utf8");
    const closeHandler = extractControllerBlock(
        source,
        "const handleResidentClose = async () => {",
        "const setup = async () => {",
    );

    assert.doesNotMatch(closeHandler, /stopPythonRef\.current\(\)/);
    assert.doesNotMatch(closeHandler, /updateIsBackendReady\(false\)/);
    assert.match(closeHandler, /await invoke\("enter_background_mode"\)/);
});

test("activation reuses a live backend and new generations preserve truthful startup state", () => {
    const source = fs.readFileSync(controllerPath, "utf8");
    const liveBackendCheck = source.indexOf(
        "if (store.backend_subprocess) return store.backend_subprocess;",
    );
    const sessionBegin = source.indexOf(
        "const sessionId = sessionGuardRef.current.begin();",
    );
    const firstCallback = source.indexOf('command.on("error"', sessionBegin);
    const readinessReset = source.indexOf("updateIsBackendReady(false)", sessionBegin);
    const progressReset = source.indexOf("updateInitProgress(0)", sessionBegin);
    const startBackend = extractControllerBlock(
        source,
        "const startBackend = async () => {",
        "const handleResidentActivation = () => startBackend();",
    );
    const outerLiveBackendCheck = startBackend.indexOf(
        "const hasLiveBackend = Boolean(store.backend_subprocess);",
    );
    const outerStartupStatus = startBackend.indexOf("updateInitStatus({");
    const guardedOuterStartup = startBackend.indexOf("if (!hasLiveBackend)");

    assert.ok(liveBackendCheck >= 0);
    assert.ok(sessionBegin > liveBackendCheck);
    assert.ok(firstCallback > sessionBegin);
    assert.ok(readinessReset > sessionBegin);
    assert.ok(progressReset > sessionBegin);
    assert.ok(outerLiveBackendCheck >= 0);
    assert.ok(guardedOuterStartup > outerLiveBackendCheck);
    assert.ok(outerStartupStatus > guardedOuterStartup);
});

test("stdout callback rejects stale sessions independently", () => {
    const source = fs.readFileSync(controllerPath, "utf8");
    const stdoutCallback = extractControllerBlock(
        source,
        'command.stdout.on("data", (line) => {',
        'command.stderr.on("data", line => {',
    );

    assertCurrentSessionGuard(stdoutCallback);
});

test("close callback rejects stale sessions independently", () => {
    const source = fs.readFileSync(controllerPath, "utf8");
    const closeCallback = extractControllerBlock(
        source,
        'command.on("close", (termination) => {',
        'command.stdout.on("data", (line) => {',
    );

    assertCurrentSessionGuard(closeCallback);
});

test("error callback rejects stale sessions independently", () => {
    const source = fs.readFileSync(controllerPath, "utf8");
    const errorCallback = extractControllerBlock(
        source,
        'command.on("error", (error) => {',
        'let backend_subprocess_ref = null;',
    );

    assertCurrentSessionGuard(errorCallback);
});

test("stderr callback rejects stale sessions independently", () => {
    const source = fs.readFileSync(controllerPath, "utf8");
    const stderrCallback = extractControllerBlock(
        source,
        'command.stderr.on("data", line => {',
        "            try {",
    );

    assertCurrentSessionGuard(stderrCallback);
});

test("backend spawn fails fast when the shell bridge never resolves", async () => {
    const { spawnBackendWithTimeout } = await import("../backendLifecycle.js");

    await assert.rejects(
        spawnBackendWithTimeout(() => new Promise(() => {}), 1),
        /Backend sidecar did not respond within 1ms/,
    );
});
