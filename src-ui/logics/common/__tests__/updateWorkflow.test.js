import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("Windows release names are explicit and the backend sidecar is VRCNT-branded", () => {
    const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
    const capability = read("src-tauri/capabilities/vrct_capability.json");
    const startPython = read("src-ui/views/app/_app_controllers/StartPythonController.jsx");
    const releaseScript = read("utils/release.py");
    const navigation = read("src-ui/views/app/main_page/main_section/live_weave_navigation/LiveWeaveNavigation.jsx");
    const navigationStyles = read("src-ui/views/app/main_page/main_section/live_weave_navigation/LiveWeaveNavigation.module.scss");

    assert.equal(tauriConfig.mainBinaryName, "VRCNT");
    assert.deepEqual(tauriConfig.bundle.externalBin, ["bin/VRCNT-backend"]);
    assert.match(capability, /bin\/VRCNT-backend/);
    assert.match(startPython, /Command\.sidecar\("bin\/VRCNT-backend"\)/);
    assert.match(releaseScript, /target\/release\/VRCNT\.exe/);
    assert.match(releaseScript, /target\/release\/VRCNT-backend\.exe/);
    assert.match(navigation, /updateOpenedQuickSetting\("update_software"\)/);
    assert.match(navigation, /className=\{styles\.update_button\}/);
    assert.match(navigation, /main_page\.quick_setting_latest/);
    assert.match(navigationStyles, /\.update_button/);

    for (const locale of ["en", "ja", "ko", "th", "zh-Hans", "zh-Hant"]) {
        assert.match(read(`locales/${locale}.yml`), /quick_setting_latest:/);
    }
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
