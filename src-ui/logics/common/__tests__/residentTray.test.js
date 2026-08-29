import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const readSource = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("resident lifecycle keeps the native and frontend event names aligned", async () => {
    const { RESIDENT_ACTIVATE_EVENT, RESIDENT_CLOSE_REQUESTED_EVENT } = await import(
        "../residentTray.js"
    );
    const nativeSource = readSource("src-tauri/src/lib.rs");
    const controllerSource = readSource(
        "src-ui/views/app/_app_controllers/StartPythonController.jsx",
    );

    assert.match(nativeSource, new RegExp(`"${RESIDENT_ACTIVATE_EVENT}"`));
    assert.match(nativeSource, new RegExp(`"${RESIDENT_CLOSE_REQUESTED_EVENT}"`));
    assert.match(controllerSource, /RESIDENT_ACTIVATE_EVENT/);
    assert.match(controllerSource, /RESIDENT_CLOSE_REQUESTED_EVENT/);
});

test("resident startup defers the backend until activation and close preserves it before hiding", () => {
    const source = readSource("src-ui/views/app/_app_controllers/StartPythonController.jsx");
    const closeStart = source.indexOf("const handleResidentClose = async () => {");
    const switchStart = source.indexOf("const handleRuntimeSwitch = async");
    const residentClose = source.slice(closeStart, switchStart);

    assert.match(source, /invoke\("is_background_startup"\)/);
    assert.match(source, /invoke\("consume_resident_activation"\)/);
    assert.doesNotMatch(residentClose, /await stopPythonRef\.current\(\)/);
    assert.match(source, /await invoke\("enter_background_mode"\)/);
    assert.match(source, /spawnBackendWithTimeout/);
});

test("resident startup falls back to backend startup when the native mode check stalls", async () => {
    const { resolveResidentStartup } = await import("../residentTray.js");

    assert.equal(typeof resolveResidentStartup, "function");
    const shouldStartBackend = await resolveResidentStartup({
        isBackgroundStartup: () => new Promise(() => {}),
        consumeResidentActivation: () => Promise.resolve(false),
        timeoutMs: 1,
    });

    assert.equal(shouldStartBackend, true);
});

test("resident background startup waits for a pending VRChat activation", async () => {
    const { resolveResidentStartup } = await import("../residentTray.js");

    const shouldStartBackend = await resolveResidentStartup({
        isBackgroundStartup: () => Promise.resolve(true),
        consumeResidentActivation: () => Promise.resolve(false),
        timeoutMs: 1,
    });

    assert.equal(shouldStartBackend, false);
});

test("resident close keeps the backend available for the next activation", () => {
    const source = readSource("src-ui/views/app/_app_controllers/StartPythonController.jsx");
    const closeHandlerStart = source.indexOf("const handleResidentClose = async () => {");
    const closeHandlerEnd = source.indexOf("const setup = async () => {", closeHandlerStart);
    const closeHandlerSource = source.slice(closeHandlerStart, closeHandlerEnd);

    assert.doesNotMatch(closeHandlerSource, /updateIsBackendReady\(false\)/);
});

test("runtime switch closes the backend before acknowledging the native handoff", () => {
    const source = readSource("src-ui/views/app/_app_controllers/StartPythonController.jsx");
    const switchHandlerStart = source.indexOf("const handleRuntimeSwitch = async (event) => {");
    const switchHandlerEnd = source.indexOf("const setup = async () => {", switchHandlerStart);
    const switchHandler = source.slice(switchHandlerStart, switchHandlerEnd);

    assert.ok(switchHandlerStart >= 0);
    assert.ok(switchHandlerEnd > switchHandlerStart);
    assert.match(switchHandler, /await stopPythonRef\.current\(\)/);
    assert.match(switchHandler, /complete_runtime_switch_shutdown/);
    assert.ok(
        switchHandler.indexOf("await stopPythonRef.current()") <
            switchHandler.indexOf('invoke("complete_runtime_switch_shutdown"'),
    );
});

test("the title-bar close path lets native resident mode intercept enabled startup", () => {
    const source = readSource("src-ui/logics/common/useWindow.js");

    assert.match(source, /getStartWithVrchatStatus/);
    assert.match(source, /if \(!startWithVrchat\)/);
    assert.match(source, /asyncStdoutToPython\("\/run\/shutdown"\)/);
    assert.match(source, /await appWindow\.close\(\)/);
});
