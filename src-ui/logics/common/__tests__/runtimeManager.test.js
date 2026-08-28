import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
    createRuntimeSwitchState,
    getRuntimePresentation,
    getSwitchTarget,
    normalizeRuntimeState,
    confirmRuntimeSwitch,
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

    assert.deepEqual(result, { started: true });
    assert.deepEqual(launched, ["cuda"]);
});

test("runtime controls remain disabled while a switch transaction is active", () => {
    assert.deepEqual(createRuntimeSwitchState({ isBusy: true, pendingTarget: "cuda" }), {
        isBusy: true,
        pendingTarget: "cuda",
        controlsDisabled: true,
    });
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
