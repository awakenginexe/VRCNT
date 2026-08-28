import assert from "node:assert/strict";
import test from "node:test";

import {
    RUNTIME_ACTIVATION_READINESS_ENDPOINT,
    createRuntimeActivationHandshake,
} from "../backendLifecycle.js";

const validResponse = (overrides = {}) => ({
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
        ...overrides,
    },
});

test("runtime activation awaits one matching correlated backend response", async () => {
    const handshake = createRuntimeActivationHandshake({
        activationToken: "activation-token", generation: 4, backendPid: 4242,
    });
    const waiting = handshake.waitForResponse();

    assert.equal(handshake.accept(validResponse()), true);
    assert.equal(handshake.accept(validResponse()), false);
    assert.equal((await waiting).backend_pid, 4242);
});

test("runtime activation rejects backend failures and leaves stale or malformed proofs unable to complete", async () => {
    const stale = createRuntimeActivationHandshake({
        activationToken: "activation-token", generation: 4, backendPid: 4242, timeoutMs: 5,
    });
    const waiting = stale.waitForResponse();

    assert.equal(stale.accept(validResponse({ generation: 3 })), false);
    assert.equal(stale.accept(validResponse({ backend_pid: 9999 })), false);
    assert.equal(stale.accept(validResponse({ app_version: "" })), false);
    assert.equal(stale.isPending(), true);
    await assert.rejects(waiting, /timed out/);

    const failed = createRuntimeActivationHandshake({
        activationToken: "activation-token", generation: 4, backendPid: 4242,
    });
    const failedWaiting = failed.waitForResponse();
    assert.equal(failed.accept({ endpoint: RUNTIME_ACTIVATION_READINESS_ENDPOINT, status: 500, result: {} }), false);
    await assert.rejects(failedWaiting, /failed/);
});

test("runtime activation fails closed for incomplete manager context", async () => {
    const missing = createRuntimeActivationHandshake({
        activationToken: null, generation: 4, backendPid: 4242,
    });
    await assert.rejects(missing.waitForResponse(), /incomplete/);
    assert.equal(missing.accept(validResponse()), false);
});
