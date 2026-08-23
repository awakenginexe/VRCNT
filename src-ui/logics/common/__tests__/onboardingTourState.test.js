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
        });
        assert.equal(
            canNavigateDuringOnboarding({ setupCompleted: true, onboardingActive: false }),
            true,
        );
    } finally {
        acknowledgeOnboardingCompletion();
    }
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
