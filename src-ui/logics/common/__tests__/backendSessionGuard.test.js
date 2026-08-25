import assert from "node:assert/strict";
import test from "node:test";

import { createBackendSessionGuard } from "../backendSessionGuard.js";

test("a replacement begin makes the previous backend session stale", () => {
    const guard = createBackendSessionGuard();
    const firstSession = guard.begin();
    const replacementSession = guard.begin();

    assert.equal(guard.isCurrent(firstSession), false);
    assert.equal(guard.isCurrent(replacementSession), true);
    assert.equal(guard.current(), replacementSession);
});

test("invalidating the current backend session rejects it", () => {
    const guard = createBackendSessionGuard();
    const session = guard.begin();

    guard.invalidate(session);

    assert.equal(guard.isCurrent(session), false);
    assert.equal(guard.current(), 0);
});

test("a replacement after invalidation does not reuse the stale session ID", () => {
    const guard = createBackendSessionGuard();
    const staleSession = guard.begin();

    guard.invalidate(staleSession);
    const replacementSession = guard.begin();

    assert.notEqual(replacementSession, staleSession);
    assert.equal(guard.isCurrent(staleSession), false);
    assert.equal(guard.isCurrent(replacementSession), true);
});

test("a callback captured by an old session cannot be accepted after replacement", () => {
    const guard = createBackendSessionGuard();
    const acceptedEvents = [];
    const firstSession = guard.begin();
    const acceptFromSession = (session, event) => {
        if (guard.isCurrent(session)) acceptedEvents.push(event);
    };
    const oldCallback = () => acceptFromSession(firstSession, "old stdout");

    const replacementSession = guard.begin();
    oldCallback();
    acceptFromSession(replacementSession, "replacement stdout");

    assert.deepEqual(acceptedEvents, ["replacement stdout"]);
});
