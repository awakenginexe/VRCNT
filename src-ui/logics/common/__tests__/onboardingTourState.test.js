import assert from "node:assert/strict";
import test from "node:test";

import {
    ONBOARDING_TOUR_ROUTE_AUTHORITY,
    ONBOARDING_TOUR_STEPS,
    acknowledgeOnboardingCompletion,
    beginOnboarding,
    beginOnboardingCompletion,
    beginProductTour,
    canNavigateDuringOnboarding,
    getOnboardingTourSnapshot,
    requestOnboardingTourTransition,
} from "../onboardingTourState.js";

test("manual navigation stays locked until onboarding is durably complete and inactive", () => {
    assert.equal(canNavigateDuringOnboarding({ setupCompleted: false, onboardingActive: false }), false);
    assert.equal(canNavigateDuringOnboarding({ setupCompleted: false, onboardingActive: true }), false);
    assert.equal(canNavigateDuringOnboarding({ setupCompleted: true, onboardingActive: true }), false);
    assert.equal(canNavigateDuringOnboarding({ setupCompleted: true, onboardingActive: false }), true);
});

test("the product tour visits the six real application routes in the approved order", () => {
    assert.deepEqual(
        ONBOARDING_TOUR_STEPS.map(({ route }) => route),
        ["live", "live", "models", "translation_models", "overlay", "customize"],
    );
});

test("the product tour identifies the real page zone explained by every step", () => {
    assert.deepEqual(
        ONBOARDING_TOUR_STEPS.map(({ target }) => target),
        [
            "live-controls",
            "live-services",
            "speech-recognition",
            "translation-routing",
            "overlay-studio",
            "customize-workspace",
        ],
    );
});

test("a pending completion is exclusive, blocks tour handoff, and unlocks only after acknowledgement", () => {
    beginOnboarding();
    try {
        let persistenceCalls = 0;
        const requestPersistence = () => {
            if (!beginOnboardingCompletion()) return false;
            persistenceCalls += 1;
            return true;
        };

        assert.equal(requestPersistence(), true);
        assert.equal(requestPersistence(), false);
        assert.equal(persistenceCalls, 1);
        assert.equal(beginProductTour(), null);
        assert.deepEqual(getOnboardingTourSnapshot(), {
            active: true,
            phase: "setup",
            stepIndex: 0,
            completionPending: true,
            completionNotification: false,
            windowGeometry: null,
        });
        assert.equal(
            canNavigateDuringOnboarding({ setupCompleted: true, onboardingActive: true }),
            false,
        );

        assert.equal(acknowledgeOnboardingCompletion(), "live");
        assert.deepEqual(getOnboardingTourSnapshot(), {
            active: false,
            phase: "idle",
            stepIndex: 0,
            completionPending: false,
            completionNotification: false,
            windowGeometry: null,
        });
        assert.equal(
            canNavigateDuringOnboarding({ setupCompleted: true, onboardingActive: false }),
            true,
        );
    } finally {
        acknowledgeOnboardingCompletion();
    }
});

test("the product tour carries the pre-tour window geometry until completion", () => {
    const windowGeometry = {
        x_pos: 445,
        y_pos: 45,
        width: 1474,
        height: 701,
        maximized: false,
    };

    beginOnboarding();
    assert.equal(beginProductTour({ windowGeometry }), "live");
    assert.deepEqual(getOnboardingTourSnapshot().windowGeometry, windowGeometry);

    assert.equal(beginOnboardingCompletion(), true);
    assert.equal(acknowledgeOnboardingCompletion(), "live");
    assert.equal(getOnboardingTourSnapshot().windowGeometry, null);
});

test("a delayed second setup click cannot replace the window geometry after the tour starts", () => {
    const firstWindowGeometry = {
        x_pos: 445,
        y_pos: 45,
        width: 1474,
        height: 701,
        maximized: false,
    };
    const delayedWindowGeometry = {
        x_pos: 0,
        y_pos: 0,
        width: 1920,
        height: 1020,
        maximized: true,
    };

    beginOnboarding();
    assert.equal(beginProductTour({ windowGeometry: firstWindowGeometry }), "live");
    assert.equal(beginProductTour({ windowGeometry: delayedWindowGeometry }), null);
    assert.deepEqual(getOnboardingTourSnapshot().windowGeometry, firstWindowGeometry);

    assert.equal(beginOnboardingCompletion(), true);
    assert.equal(acknowledgeOnboardingCompletion(), "live");
});

test("only the tour-overlay authority can transition real routes while the tour is active", () => {
    beginOnboarding();
    assert.equal(beginProductTour(), "live");

    assert.equal(requestOnboardingTourTransition({
        authority: Symbol("manual-navigation"),
        stepIndex: 1,
    }), null);
    assert.equal(getOnboardingTourSnapshot().stepIndex, 0);

    assert.equal(requestOnboardingTourTransition({
        authority: ONBOARDING_TOUR_ROUTE_AUTHORITY,
        stepIndex: 1,
    }), "live");
    assert.equal(requestOnboardingTourTransition({
        authority: ONBOARDING_TOUR_ROUTE_AUTHORITY,
        stepIndex: 2,
    }), "models");

    assert.equal(beginOnboardingCompletion(), true);
    assert.equal(requestOnboardingTourTransition({
        authority: ONBOARDING_TOUR_ROUTE_AUTHORITY,
        stepIndex: 3,
    }), null);
    assert.equal(getOnboardingTourSnapshot().stepIndex, 2);
    assert.equal(acknowledgeOnboardingCompletion(), "live");
});
