import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const commonRoot = path.resolve(here, "..");
const repoRoot = path.resolve(commonRoot, "../../..");
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), "utf8");

test("shouldOpenFirstRunSetup only opens setup after backend readiness and before the first decision", async () => {
    const moduleUrl = pathToFileURL(path.join(commonRoot, "firstRunSetupState.js")).href;
    const { shouldOpenFirstRunSetup } = await import(moduleUrl);

    assert.equal(shouldOpenFirstRunSetup({ isBackendReady: false, setupCompleted: false, alreadyDecided: false }), false);
    assert.equal(shouldOpenFirstRunSetup({ isBackendReady: true, setupCompleted: true, alreadyDecided: false }), false);
    assert.equal(shouldOpenFirstRunSetup({ isBackendReady: true, setupCompleted: false, alreadyDecided: false }), true);
    assert.equal(shouldOpenFirstRunSetup({ isBackendReady: true, setupCompleted: false, alreadyDecided: true }), false);
});

test("setup-completion wiring stays on the generated config-route path", () => {
    const uiConfigSetter = read("src-ui", "logics", "configs", "config_page_setter", "ui_config_setter.js");
    const configIndex = read("src-ui", "logics", "configs", "index.js");
    const controllerIndex = read("src-ui", "views", "app", "_app_controllers", "index.js");
    const app = read("src-ui", "views", "app", "App.jsx");
    const controller = read("src-ui", "views", "app", "_app_controllers", "FirstRunSetupController.jsx");

    assert.match(
        uiConfigSetter,
        /Category:\s*"Onboarding"[\s\S]*?Base_Name:\s*"SetupCompleted"[\s\S]*?base_endpoint_name:\s*"setup_completed"/,
    );
    assert.match(configIndex, /export const useOnboarding = createCategoryHook\("Onboarding"\);/);
    assert.match(controller, /updateExperienceRoute\("setup"\)/);
    assert.match(controllerIndex, /export \{ FirstRunSetupController \} from "\.\/FirstRunSetupController";/);
    assert.match(app, /FirstRunSetupController/);
    assert.match(app, /<FirstRunSetupController \/>/);
});
