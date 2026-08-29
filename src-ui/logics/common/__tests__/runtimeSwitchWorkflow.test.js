import test from "node:test";
import assert from "node:assert/strict";

import {
    confirmRuntimeSwitch,
    createRuntimeManagerAdapter,
    normalizeRuntimeState,
} from "../runtimeManager.js";

const activeCpu = normalizeRuntimeState({
    schema: 1,
    status: "active",
    product: "VRCNT",
    version: "5.15.0",
    variant: "cpu",
    architecture: "x64",
    installPath: "C:/Users/Example/AppData/Local/VRCNT",
    updatedAtUtc: "2026-08-28T00:00:00Z",
});

test("the installed adapter forwards only an explicit alternate variant and waits for native acceptance", async () => {
    const calls = [];
    const statuses = [{ status: "accepted", targetVariant: "cuda", nonce: "switch-1" }];
    const adapter = createRuntimeManagerAdapter({
        isTauri: () => true,
        loadTauriInvoke: async () => async (command, args) => {
            calls.push({ command, args });
            if (command === "get_runtime_state") return { ...activeCpu };
            if (command === "launch_runtime_switch") return undefined;
            if (command === "get_runtime_switch_status") return statuses.shift() ?? { status: "idle" };
            throw new Error("unexpected native command: " + command);
        },
    });

    const runtime = await adapter.getRuntimeState();
    const result = await confirmRuntimeSwitch({
        runtime,
        targetVariant: "cuda",
        launch: adapter.launchRuntimeSwitch,
        getStatus: adapter.getRuntimeSwitchStatus,
        waitOptions: { intervalMs: 0, timeoutMs: 50 },
    });

    assert.deepEqual(result, { accepted: true, targetVariant: "cuda" });
    assert.deepEqual(
        calls.map(({ command }) => command),
        ["get_runtime_state", "launch_runtime_switch", "get_runtime_switch_status"],
    );
    assert.deepEqual(calls[1], {
        command: "launch_runtime_switch",
        args: { variant: "cuda" },
    });
});

test("a non-installed runtime cannot launch a switch and arbitrary paths are never accepted as variants", async () => {
    const adapter = createRuntimeManagerAdapter({ isTauri: () => false });

    assert.equal((await adapter.getRuntimeState()).status, "recovery");
    await assert.rejects(
        adapter.launchRuntimeSwitch("cuda"),
        /installed VRCNT application/i,
    );
    await assert.rejects(
        adapter.launchRuntimeSwitch("C:/Windows/System32/cmd.exe"),
        /runtime variant/i,
    );
});
