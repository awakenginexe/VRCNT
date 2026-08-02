import assert from "node:assert/strict";
import test from "node:test";
import {
    getSessionActionState,
    getSessionEndpoint,
    getSessionTransitionPlan,
} from "../../main/sessionControlUtils.js";

const readyStatuses = (values = {}) => ({
    translation: { data: values.translation ?? false, state: values.translationState ?? "ok" },
    speaking: { data: values.speaking ?? false, state: values.speakingState ?? "ok" },
    listening: { data: values.listening ?? false, state: values.listeningState ?? "ok" },
});

test("the primary session action starts every real pipeline only when the backend is ready", () => {
    const state = getSessionActionState({ backendReady: true, statuses: readyStatuses() });

    assert.deepEqual(state, { action: "start", isBusy: false, isDisabled: false });
    assert.deepEqual(getSessionTransitionPlan(state.action), [
        ["translation", true],
        ["speaking", true],
        ["listening", true],
    ]);
    assert.equal(getSessionEndpoint(state.action), "/set/enable/live_session");
});

test("the primary session action stops all pipelines when any live pipeline is active", () => {
    const state = getSessionActionState({
        backendReady: true,
        statuses: readyStatuses({ speaking: true }),
    });

    assert.deepEqual(state, { action: "stop", isBusy: false, isDisabled: false });
    assert.deepEqual(getSessionTransitionPlan(state.action), [
        ["translation", false],
        ["speaking", false],
        ["listening", false],
    ]);
    assert.equal(getSessionEndpoint(state.action), "/set/disable/live_session");
});

test("the primary session action never fabricates readiness while the backend or a toggle is pending", () => {
    assert.deepEqual(
        getSessionActionState({ backendReady: false, statuses: readyStatuses() }),
        { action: "start", isBusy: false, isDisabled: true },
    );
    assert.deepEqual(
        getSessionActionState({
            backendReady: true,
            statuses: readyStatuses({ listeningState: "pending" }),
        }),
        { action: "start", isBusy: true, isDisabled: true },
    );
});
