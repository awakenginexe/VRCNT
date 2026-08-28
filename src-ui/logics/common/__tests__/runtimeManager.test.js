import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import * as runtimeManager from "../runtimeManager.js";
import {
    createRuntimeSwitchState,
    getRuntimePresentation,
    getSwitchTarget,
    normalizeRuntimeState,
    confirmRuntimeSwitch,
    consumePersistedRuntimeSwitch,
    reconcilePersistedRuntimeSwitch,
    requestRuntimeSwitch,
} from "../runtimeManager.js";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const localeFiles = ["en.yml", "ja.yml", "ko.yml", "th.yml", "zh-Hans.yml", "zh-Hant.yml"];
const activeCpu = {
    schema: 1,
    status: "active",
    product: "VRCNT",
    version: "5.15.0",
    variant: "cpu",
    architecture: "x64",
    installPath: "C:/Users/Example/AppData/Local/VRCNT",
    updatedAtUtc: "2026-08-28T00:00:00Z",
};

test("runtime presentation shows the validated CPU or CUDA runtime", () => {
    assert.deepEqual(getRuntimePresentation(normalizeRuntimeState(activeCpu)), {
        status: "active",
        currentVariant: "cpu",
        targetVariant: "cuda",
        canSwitch: true,
    });

    assert.equal(
        getRuntimePresentation(normalizeRuntimeState({ ...activeCpu, variant: "cuda" })).currentVariant,
        "cuda",
    );
});

test("invalid runtime state enters recovery instead of being displayed as active", () => {
    const invalid = normalizeRuntimeState({ ...activeCpu, status: "active", installPath: "" });

    assert.deepEqual(getRuntimePresentation(invalid), {
        status: "recovery",
        currentVariant: null,
        targetVariant: null,
        canSwitch: false,
    });
});

test("switch targets are fixed and must differ from the active runtime", () => {
    assert.equal(getSwitchTarget("cpu"), "cuda");
    assert.equal(getSwitchTarget("cuda"), "cpu");
    assert.throws(() => getSwitchTarget("C:/Windows/System32/cmd.exe"), /runtime variant/i);
    assert.throws(
        () => requestRuntimeSwitch({ runtime: normalizeRuntimeState(activeCpu), targetVariant: "cpu" }),
        /already active/i,
    );
});

test("runtime switch launches only after an explicit confirmation", async () => {
    const launched = [];
    const runtime = normalizeRuntimeState(activeCpu);
    const request = requestRuntimeSwitch({ runtime, targetVariant: "cuda" });

    assert.deepEqual(request, { targetVariant: "cuda", requiresConfirmation: true });
    assert.deepEqual(launched, []);

    const result = await confirmRuntimeSwitch({
        runtime,
        targetVariant: request.targetVariant,
        launch: async (variant) => launched.push(variant),
    });

    assert.deepEqual(result, { accepted: true, targetVariant: "cuda" });
    assert.deepEqual(launched, ["cuda"]);
});

test("runtime controls remain disabled while a switch transaction is active", () => {
    assert.deepEqual(createRuntimeSwitchState({ isBusy: true, pendingTarget: "cuda" }), {
        isBusy: true,
        pendingTarget: "cuda",
        controlsDisabled: true,
    });
});

test("switch acknowledgement is required before the UI reports an active transaction", async () => {
    const statuses = [
        { status: "pending", targetVariant: "cuda", nonce: "n1" },
        { status: "accepted", targetVariant: "cuda", nonce: "n1" },
    ];
    const result = await confirmRuntimeSwitch({
        runtime: normalizeRuntimeState(activeCpu),
        targetVariant: "cuda",
        launch: async () => {},
        getStatus: async () => statuses.shift(),
        waitOptions: { intervalMs: 0, timeoutMs: 50 },
    });

    assert.deepEqual(result, { accepted: true, targetVariant: "cuda" });
});

test("terminal switch outcomes refresh runtime state and clear the pending transaction", async () => {
    let refreshed = 0;
    const outcome = await runtimeManager.waitForRuntimeSwitchOutcome({
        getStatus: async () => ({ status: "failed", targetVariant: "cuda", errorCode: "preflight_failed" }),
        refreshRuntime: async () => { refreshed += 1; return normalizeRuntimeState(activeCpu); },
        timeoutMs: 50,
        intervalMs: 0,
    });

    assert.equal(outcome.status, "failed");
    assert.equal(outcome.runtime.variant, "cpu");
    assert.equal(refreshed, 1);
});

test("a relaunched VRCNT consumes the persisted rollback outcome before enabling another switch", async () => {
    const result = await reconcilePersistedRuntimeSwitch({
        getStatus: async () => ({
            status: "failed",
            targetVariant: "cuda",
            nonce: "nonce",
            errorCode: "activation_unhealthy",
            message: "The CUDA runtime was rolled back.",
        }),
        refreshRuntime: async () => normalizeRuntimeState(activeCpu),
    });

    assert.equal(result.status.status, "failed");
    assert.equal(result.runtime.variant, "cpu");
    assert.deepEqual(result.switchState, {
        isBusy: false,
        pendingTarget: null,
        controlsDisabled: false,
    });
});

test("startup recovery consumes the native receipt once and clears switch controls before a retry", async () => {
    let calls = 0;
    const result = await consumePersistedRuntimeSwitch({
        consumeReceipt: async () => {
            calls += 1;
            return calls === 1
                ? { status: "failed", targetVariant: "cuda", nonce: "nonce", errorCode: "activation_unhealthy" }
                : null;
        },
        refreshRuntime: async () => normalizeRuntimeState(activeCpu),
    });

    assert.equal(result.status.status, "failed");
    assert.equal(result.runtime.variant, "cpu");
    assert.deepEqual(result.switchState, {
        isBusy: false,
        pendingTarget: null,
        controlsDisabled: false,
    });
    assert.equal((await consumePersistedRuntimeSwitch({
        consumeReceipt: async () => null,
        refreshRuntime: async () => normalizeRuntimeState(activeCpu),
    })).status.status, "idle");
});

test("cancelled and stale switch outcomes are terminal and refresh the runtime", async () => {
    for (const terminal of [
        { status: "cancelled", errorCode: "cancelled" },
        { status: "stale", errorCode: "switch_timeout" },
    ]) {
        let refreshed = 0;
        const outcome = await runtimeManager.waitForRuntimeSwitchOutcome({
            getStatus: async () => terminal,
            refreshRuntime: async () => { refreshed += 1; return normalizeRuntimeState(activeCpu); },
            timeoutMs: 50,
            intervalMs: 0,
        });
        assert.equal(outcome.status, terminal.status);
        assert.equal(outcome.runtime.variant, "cpu");
        assert.equal(refreshed, 1);
    }
});

test("runtime switch bridge source includes authenticated manager status and resident handoff", () => {
    const source = fs.readFileSync(path.join(repoRoot, "src-tauri", "src", "runtime_manager.rs"), "utf8");
    assert.match(source, /manager-state\.json/);
    assert.match(source, /VRCNT\.Setup\.exe\.sig/);
    assert.match(source, /MINISIGN_SHA256/);
    assert.match(source, /validate_manager_signature/);
    assert.match(source, /proof_sha256/);
    assert.match(source, /current_exe/);
    assert.match(source, /switch-status/);
    assert.match(source, /runtime-switch-requested/);
    assert.match(source, /--switch/);
    assert.match(source, /--variant/);
    assert.match(source, /--current-app/);
    assert.match(source, /--switch-token/);
    assert.match(source, /is_shutdown_authorized/);
});

test("resident runtime switch handoff stops the backend before authenticated close", () => {
    const source = fs.readFileSync(path.join(repoRoot, "src-ui", "views", "app", "_app_controllers", "StartPythonController.jsx"), "utf8");
    assert.match(source, /RUNTIME_SWITCH_REQUESTED_EVENT/);
    assert.match(source, /await stopPythonRef\.current\(\)/);
    assert.match(source, /complete_runtime_switch_shutdown/);
});

test("all six locales provide matching runtime-switching copy", () => {
    const english = yaml.load(fs.readFileSync(path.join(repoRoot, "locales", "en.yml"), "utf8"));
    const expectedKeys = Object.keys(english?.config_page?.others?.runtime ?? {}).sort();

    assert.ok(expectedKeys.length > 0, "English runtime locale copy must exist");
    for (const localeFile of localeFiles) {
        const locale = yaml.load(fs.readFileSync(path.join(repoRoot, "locales", localeFile), "utf8"));
        const runtime = locale?.config_page?.others?.runtime ?? {};
        assert.deepEqual(Object.keys(runtime).sort(), expectedKeys, `${localeFile} runtime keys`);
        for (const key of expectedKeys) {
            assert.equal(typeof runtime[key], "string", `${localeFile}:${key} type`);
            assert.notEqual(runtime[key].trim(), "", `${localeFile}:${key} empty`);
        }
    }
});
