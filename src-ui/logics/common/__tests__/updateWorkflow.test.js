import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));

test("Windows release names are explicit and the backend sidecar is VRCNT-branded", () => {
    const capability = read("src-tauri/capabilities/vrct_capability.json");
    const startPython = read("src-ui/views/app/_app_controllers/StartPythonController.jsx");
    const releaseScript = read("utils/release.py");
    const navigation = read("src-ui/views/app/main_page/main_section/live_weave_navigation/LiveWeaveNavigation.jsx");
    const navigationStyles = read("src-ui/views/app/main_page/main_section/live_weave_navigation/LiveWeaveNavigation.module.scss");

    assert.equal(tauriConfig.mainBinaryName, "VRCNT");
    assert.deepEqual(tauriConfig.bundle.externalBin, ["bin/VRCNT-backend"]);
    assert.match(capability, /bin\/VRCNT-backend/);
    assert.match(startPython, /Command\.sidecar\("bin\/VRCNT-backend"\)/);
    assert.match(releaseScript, /REQUIRED_PAYLOAD_FILES = \("VRCNT\.exe", "VRCNT-backend\.exe", "VRCNT\.runtime\.json"\)/);
    assert.match(navigation, /updateOpenedQuickSetting\("update_software"\)/);
    assert.match(navigation, /className=\{styles\.update_button\}/);
    assert.match(navigation, /main_page\.quick_setting_latest/);
    assert.match(navigationStyles, /\.update_button/);

    for (const locale of ["en", "ja", "ko", "th", "zh-Hans", "zh-Hant"]) {
        assert.match(read(`locales/${locale}.yml`), /quick_setting_latest:/);
    }
});

test("main window starts at a valid default and enforces the supported minimum", () => {
    const mainWindow = tauriConfig.app.windows.find((window) => window.label === "main");

    assert.ok(mainWindow, "the main window must be configured");
    assert.equal(mainWindow.width, 1498);
    assert.equal(mainWindow.height, 900);
    assert.equal(mainWindow.minWidth, 1498);
    assert.equal(mainWindow.minHeight, 711);
    assert.ok(mainWindow.width >= mainWindow.minWidth);
    assert.ok(mainWindow.height >= mainWindow.minHeight);
});

test("the update action uses the signed Tauri updater and relaunches after installation", () => {
    const hook = read("src-ui/logics/common/useUpdateSoftware.js");
    const modal = read("src-ui/views/app/others/modal_controller/update_modal/UpdateModal.jsx");

    assert.match(hook, /from "@tauri-apps\/plugin-updater"/);
    assert.match(hook, /await check\(\)/);
    assert.match(hook, /downloadAndInstall/);
    assert.match(hook, /await relaunch\(\)/);
    assert.match(hook, /isTauriRuntime\(\)/);
    assert.match(hook, /openReleaseFallback/);
    assert.match(modal, /role="progressbar"/);
    assert.match(modal, /update_modal\.download_latest_button/);
    assert.match(modal, /update_modal\.open_releases/);
});

test("normal updater launches repair mode without selecting a runtime, while switches retain their explicit target contract", () => {
    const hook = read("src-ui/logics/common/useUpdateSoftware.js");
    const tauri = read("src-tauri/tauri.conf.json");
    const commandLine = read("installer-helper/VRCNT.Setup/CommandLine/SetupCommandLine.cs");
    const operations = read("installer-helper/VRCNT.Setup/SetupCommandOperations.cs");

    assert.match(tauri, /"installerArgs": \[\s*"--tauri-update-contract-v1",\s*"\/passive",\s*"--repair-manager"\s*\]/);
    assert.doesNotMatch(tauri, /"installerArgs"[\s\S]*--variant/);
    assert.doesNotMatch(hook, /downloadAndInstall\([^)]*--variant/);
    assert.match(commandLine, /argument\.Equals\("\/UPDATE"/);
    assert.match(commandLine, /argument\.Equals\("\/ARGS"/);
    assert.match(commandLine, /--tauri-update-contract-v1/);
    assert.match(commandLine, /argument\.Equals\("\/passive"/);
    assert.match(commandLine, /argument\.Equals\("--current-app"/);
    assert.match(commandLine, /argument\.Equals\("--current-app-arg"/);
    assert.match(commandLine, /if \(isSwitch && variant is null\)/);
    assert.match(operations, /options\.IsSwitch[\s\S]*options\.TargetVariant/);
    assert.match(operations, /options\.TargetVariant \?\? RuntimeVariant\.Cpu/);
    assert.match(operations, /foreach \(var argument in options\.CurrentAppArguments\)/);
});
