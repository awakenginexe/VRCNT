import assert from "node:assert/strict";
import test from "node:test";

import {
    RUNTIME_ACTIVATION_READINESS_ENDPOINT,
    createRuntimeActivationHandshake,
} from "../backendLifecycle.js";

test("runtime activation signals Tauri only after a matching ready response", async () => {
    const signals = [];
    const handshake = createRuntimeActivationHandshake({
        activationToken: "activation-token",
        generation: 4,
        backendPid: 4242,
        signalReady: async () => signals.push("ready"),
    });

    const accepted = await handshake.accept({
        endpoint: RUNTIME_ACTIVATION_READINESS_ENDPOINT,
        status: 200,
        result: {
            protocol_version: 1,
            status: "ready",
            backend_pid: 4242,
            app_version: "5.15.0",
            runtime_variant: "cpu",
            activation_token: "activation-token",
            generation: 4,
        },
    });

    assert.equal(accepted, true);
    assert.deepEqual(signals, ["ready"]);
});

test("runtime activation fails closed for backend failure, stale generations, wrong PIDs, or incomplete activation arguments", async () => {
    const signals = [];
    const stale = createRuntimeActivationHandshake({
        activationToken: "activation-token",
        generation: 5,
        backendPid: 4242,
        signalReady: async () => signals.push("ready"),
    });
    const missing = createRuntimeActivationHandshake({
        activationToken: null,
        generation: 5,
        backendPid: 4242,
        signalReady: async () => signals.push("ready"),
    });

    assert.equal(await stale.accept({
        endpoint: RUNTIME_ACTIVATION_READINESS_ENDPOINT,
        status: 500,
        result: {},
    }), false);
    assert.equal(await stale.accept({
        endpoint: RUNTIME_ACTIVATION_READINESS_ENDPOINT,
        status: 200,
        result: {
            protocol_version: 1,
            status: "ready",
            backend_pid: 4242,
            activation_token: "activation-token",
            generation: 4,
        },
    }), false);
    assert.equal(await stale.accept({
        endpoint: RUNTIME_ACTIVATION_READINESS_ENDPOINT,
        status: 200,
        result: {
            protocol_version: 1,
            status: "ready",
            backend_pid: 9999,
            activation_token: "activation-token",
            generation: 5,
            app_version: "5.15.0",
            runtime_variant: "cpu",
        },
    }), false);
    assert.equal(await missing.accept({ endpoint: RUNTIME_ACTIVATION_READINESS_ENDPOINT, status: 200, result: {} }), false);
    assert.deepEqual(signals, []);
});
