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
    createRuntimeManagerAdapter,
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

test("an in-process pre-quiesce retry clear returns idle and permits a second native launch", async () => {
    let launches = 0;
    const statuses = [{ status: "idle" }, { status: "accepted", targetVariant: "cuda", nonce: "retry" }];
    const adapter = createRuntimeManagerAdapter({
        isTauri: () => true,
        loadTauriInvoke: async () => async (command, args) => {
            if (command === "launch_runtime_switch") {
                launches += 1;
                assert.equal(args.variant, "cuda");
                return;
            }
            if (command === "get_runtime_switch_status") return statuses.shift() ?? { status: "idle" };
            throw new Error(`unexpected native command: ${command}`);
        },
    });

    const cleared = await reconcilePersistedRuntimeSwitch({
        getStatus: adapter.getRuntimeSwitchStatus,
        refreshRuntime: async () => normalizeRuntimeState(activeCpu),
    });
    assert.equal(cleared.status.status, "idle");
    assert.equal(cleared.switchState.controlsDisabled, false);

    await confirmRuntimeSwitch({
        runtime: normalizeRuntimeState(activeCpu),
        targetVariant: "cuda",
        launch: adapter.launchRuntimeSwitch,
        getStatus: adapter.getRuntimeSwitchStatus,
        waitOptions: { intervalMs: 0, timeoutMs: 50 },
    });
    assert.equal(launches, 1);
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

test("installer completion uses an immediate launch action while its checkbox explains the delayed launch", () => {
    for (const localeFile of localeFiles) {
        const locale = yaml.load(fs.readFileSync(path.join(repoRoot, "locales", localeFile), "utf8"));
        const installer = locale?.installer ?? {};
        assert.equal(typeof installer.launch_after_setup, "string", `${localeFile}: launch_after_setup`);
        assert.notEqual(installer.launch_after_setup.trim(), "", `${localeFile}: launch_after_setup empty`);
        assert.equal(typeof installer.launch_vrcnt, "string", `${localeFile}: launch_vrcnt`);
        assert.notEqual(installer.launch_vrcnt.trim(), "", `${localeFile}: launch_vrcnt empty`);
    }
    const english = yaml.load(fs.readFileSync(path.join(repoRoot, "locales", "en.yml"), "utf8"));
    assert.equal(english.installer.launch_vrcnt, "Launch VRCNT");
    assert.equal(english.installer.launch_after_setup, "Launch VRCNT when setup finishes");
});

test("runtime switch confirmation is opaque and blurred only outside Performance Mode", () => {
    const styles = fs.readFileSync(path.join(repoRoot, "src-ui", "views", "app", "config_page", "setting_section", "setting_box", "others", "RuntimeSettings.module.scss"), "utf8");

    assert.match(styles, /:global\(html:not\(\.performance_mode\)\) \.confirmation\s*\{[\s\S]*background:\s*color-mix\(in srgb,\s*var\(--canvas_color\) 94%,\s*var\(--palette_surface_2_color\)\);[\s\S]*backdrop-filter:\s*blur\(1\.2rem\)/);
});
