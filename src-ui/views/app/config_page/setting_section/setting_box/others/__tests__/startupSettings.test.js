import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "../../../../../../../../");
const readSource = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const stateModulePath = path.join(
    repoRoot,
    "src-ui/views/app/config_page/setting_section/setting_box/others/startWithVrchatSettingsState.js",
);
const startupSettingsState = await import(pathToFileURL(stateModulePath).href)
    .catch((error) => {
        if (error.code === "ERR_MODULE_NOT_FOUND") return {};
        throw error;
    });
const checkboxStateModulePath = path.join(
    repoRoot,
    "src-ui/views/common_components/checkbox/checkboxState.js",
);
const checkboxState = await import(pathToFileURL(checkboxStateModulePath).href)
    .catch((error) => {
        if (error.code === "ERR_MODULE_NOT_FOUND") return {};
        throw error;
    });

test("Others exposes startup controls and routes Start with VRChat confirmation through the shared modal", () => {
    const others = readSource("src-ui/views/app/config_page/setting_section/setting_box/others/Others.jsx");
    const modalController = readSource("src-ui/views/app/others/modal_controller/ModalController.jsx");

    assert.match(others, /QuickWakeUpContainer/);
    assert.match(others, /StartWithVrchatContainer/);
    assert.match(modalController, /case "start_with_vrchat"/);
});

test("opening then backdrop-dismissal of Start with VRChat confirmation closes without enabling registration", async () => {
    assert.equal(typeof startupSettingsState.requestStartWithVrchatChange, "function");
    assert.equal(typeof startupSettingsState.dismissStartWithVrchatConfirmation, "function");

    let confirmationRequests = 0;
    let modalCloseCalls = 0;
    let enableCalls = 0;
    const requested = await startupSettingsState.requestStartWithVrchatChange({
        registration: false,
        isInteractive: true,
        onRequestConfirmation: () => {
            confirmationRequests += 1;
        },
        disableRegistration: async () => {
            throw new Error("disable must not run for an unchecked setting");
        },
    });

    const dismissed = startupSettingsState.dismissStartWithVrchatConfirmation({
        closeModal: () => {
            modalCloseCalls += 1;
        },
        enableRegistration: async () => {
            enableCalls += 1;
            return true;
        },
    });

    assert.deepEqual(requested, { type: "confirmation" });
    assert.deepEqual(dismissed, { type: "dismissed" });
    assert.equal(confirmationRequests, 1);
    assert.equal(modalCloseCalls, 1);
    assert.equal(enableCalls, 0);
});

test("Start with VRChat registration is enabled only by the confirmed modal action", async () => {
    assert.equal(typeof startupSettingsState.confirmStartWithVrchatRegistration, "function");

    let enableCalls = 0;
    const result = await startupSettingsState.confirmStartWithVrchatRegistration({
        enableRegistration: async () => {
            enableCalls += 1;
            return true;
        },
        getRegistrationStatus: async () => true,
    });

    assert.deepEqual(result, {
        state: startupSettingsState.createConfirmedStartWithVrchatState(true),
        hasError: false,
    });
    assert.equal(enableCalls, 1);
});

test("a failed initial Start with VRChat status read remains unknown and non-interactive", () => {
    assert.equal(typeof startupSettingsState.createUnknownStartWithVrchatState, "function");

    assert.deepEqual(startupSettingsState.createUnknownStartWithVrchatState(), {
        registration: null,
        state: "pending",
        isInteractive: false,
    });
});

test("browser preview produces a natively disabled Start with VRChat control and rejects its handler", async () => {
    assert.equal(typeof startupSettingsState.createInitialStartWithVrchatState, "function");
    assert.equal(typeof startupSettingsState.createStartWithVrchatCheckboxProps, "function");
    assert.equal(typeof checkboxState.isCheckboxInputDisabled, "function");

    const control = startupSettingsState.createStartWithVrchatCheckboxProps({
        isTauri: false,
        startWithVrchatState: startupSettingsState.createInitialStartWithVrchatState(false),
    });
    let confirmationRequests = 0;
    const result = await startupSettingsState.requestStartWithVrchatChange({
        registration: control.variable.data,
        isInteractive: control.is_available,
        onRequestConfirmation: () => {
            confirmationRequests += 1;
        },
    });

    assert.equal(control.is_available, false);
    assert.equal(checkboxState.isCheckboxInputDisabled(control), true);
    assert.deepEqual(result, { type: "unavailable" });
    assert.equal(confirmationRequests, 0);
});

test("a rejected adapter status read keeps the actual control unknown and natively disabled", async () => {
    assert.equal(typeof startupSettingsState.readStartWithVrchatStatus, "function");
    assert.equal(typeof startupSettingsState.createStartWithVrchatCheckboxProps, "function");

    const state = await startupSettingsState.readStartWithVrchatStatus({
        isTauri: true,
        getRegistrationStatus: async () => {
            throw new Error("native status unavailable");
        },
    });
    const control = startupSettingsState.createStartWithVrchatCheckboxProps({
        isTauri: true,
        startWithVrchatState: state,
    });

    assert.deepEqual(state, startupSettingsState.createUnknownStartWithVrchatState());
    assert.equal(control.is_available, false);
    assert.equal(checkboxState.isCheckboxInputDisabled(control), true);
});

test("adapter enable and disable failures reconcile to their confirmed registration states", async () => {
    assert.equal(typeof startupSettingsState.reconcileStartWithVrchatMutation, "function");

    const afterEnableFailure = await startupSettingsState.reconcileStartWithVrchatMutation({
        changeRegistration: async () => {
            throw new Error("enable failed");
        },
        getRegistrationStatus: async () => true,
    });
    const afterDisableFailure = await startupSettingsState.reconcileStartWithVrchatMutation({
        changeRegistration: async () => {
            throw new Error("disable failed");
        },
        getRegistrationStatus: async () => false,
    });

    assert.deepEqual(afterEnableFailure, {
        state: startupSettingsState.createConfirmedStartWithVrchatState(true),
        hasError: true,
    });
    assert.deepEqual(afterDisableFailure, {
        state: startupSettingsState.createConfirmedStartWithVrchatState(false),
        hasError: true,
    });
});

test("Start with VRChat confirmation cannot be dismissed while registration is saving", () => {
    let modalCloseCalls = 0;

    const blocked = startupSettingsState.dismissStartWithVrchatConfirmation({
        isSaving: true,
        closeModal: () => {
            modalCloseCalls += 1;
        },
    });
    const dismissed = startupSettingsState.dismissStartWithVrchatConfirmation({
        isSaving: false,
        closeModal: () => {
            modalCloseCalls += 1;
        },
    });

    assert.deepEqual(blocked, { type: "blocked" });
    assert.deepEqual(dismissed, { type: "dismissed" });
    assert.equal(modalCloseCalls, 1);
});
