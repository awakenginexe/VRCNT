import assert from "node:assert/strict";
import test from "node:test";

import {
    ONBOARDING_TOUR_STEPS,
    canNavigateDuringOnboarding,
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
