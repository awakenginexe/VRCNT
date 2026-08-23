import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("first-run setup introduces configuration before handing off to the real-page tour", () => {
    const controller = readSource("../../../_app_controllers/FirstRunSetupController.jsx");
    const setup = readSource("../../guided_setup/GuidedSetup.jsx");
    const mainPage = readSource("../../MainPage.jsx");

    assert.match(controller, /beginOnboarding\(\);[\s\S]*?updateExperienceRoute\("setup"\)/);
    assert.match(setup, /const \[screen, setScreen\] = useState\("intro"\)/);
    assert.match(setup, /screen === "intro"/);
    assert.match(setup, /const tourRoute = beginProductTour\(\);[\s\S]*?if \(!tourRoute\) return;[\s\S]*?updateExperienceRoute\(tourRoute\)/);
    assert.match(setup, /step === 6/);
    assert.match(
        setup,
        /\{step === 6 \? \([\s\S]*?<button[\s\S]*?disabled=\{isCompletingSetup\}[\s\S]*?onClick=\{startProductTour\}/,
    );
    assert.match(mainPage, /<OnboardingTour\s*\/>/);
});

test("the tour owns route changes and persists completion only after Finish or confirmed Skip", () => {
    const tour = readSource("../OnboardingTour.jsx");
    const setup = readSource("../../guided_setup/GuidedSetup.jsx");

    assert.match(tour, /ONBOARDING_TOUR_STEPS\[stepIndex\]/);
    assert.match(tour, /requestOnboardingTourTransition\(\{[\s\S]*?authority: ONBOARDING_TOUR_ROUTE_AUTHORITY/);
    assert.match(tour, /updateExperienceRoute\(nextRoute\)/);
    assert.match(tour, /updateExperienceRoute\(previousRoute\)/);
    assert.match(tour, /asyncStdoutToPython\(\s*"\/set\/data\/setup_completed"\s*,\s*true\s*\)/);
    assert.match(tour, /if \(!beginOnboardingCompletion\(\{ showSuccessNotification \}\)\) return;/);
    assert.match(setup, /if \(!beginOnboardingCompletion\(\)\) return;/);
    assert.match(tour, /currentSetupCompleted\.data === true/);
    assert.match(tour, /const acknowledgedRoute = acknowledgeOnboardingCompletion\(\);[\s\S]*?updateExperienceRoute\(acknowledgedRoute\)/);
    assert.doesNotMatch(tour, /completionRequestRef|setOnboardingTourStep|endOnboarding/);
    assert.doesNotMatch(setup, /completionRequestRef|endOnboarding/);
    assert.match(tour, /aria-modal="true"/);
    assert.match(tour, /isSkipConfirmationOpen/);
});

test("manual top navigation is visibly disabled and action-guarded throughout onboarding", () => {
    const navigation = readSource("../live_weave_navigation/LiveWeaveNavigation.jsx");
    const mainPage = readSource("../../MainPage.jsx");
    const tour = readSource("../OnboardingTour.jsx");

    assert.match(navigation, /canNavigateDuringOnboarding/);
    assert.match(navigation, /if \(!canManualNavigate\) return;/);
    assert.match(navigation, /disabled=\{!canManualNavigate\}/);
    assert.match(navigation, /aria-disabled=\{!canManualNavigate\}/);
    assert.match(mainPage, /inert=\{isProductTourActive \? "" : undefined\}/);
    assert.match(tour, /dialogRef\.current\?\.focus\(\)/);
    assert.match(
        tour,
        /if \(isSkipConfirmationOpen\) \{\s*cancelSkipButtonRef\.current\?\.focus\(\);\s*\} else \{\s*dialogRef\.current\?\.focus\(\);\s*\}/,
    );
});

test("all six locales expose the same onboarding-tour copy schema", () => {
    const localePaths = ["en", "ja", "ko", "th", "zh-Hans", "zh-Hant"];
    const tourKeys = localePaths.map((locale) => {
        const source = readSource(`../../../../../../locales/${locale}.yml`);
        return Object.keys(yaml.load(source).main_page.onboarding_tour).sort();
    });

    for (const keys of tourKeys.slice(1)) assert.deepEqual(keys, tourKeys[0]);
    assert.deepEqual(tourKeys[0], [
        "customize_detail",
        "customize_title",
        "eyebrow",
        "live_controls_detail",
        "live_controls_title",
        "live_services_detail",
        "live_services_title",
        "overlay_detail",
        "overlay_title",
        "recognition_detail",
        "recognition_title",
        "step_count",
        "translation_detail",
        "translation_title",
    ]);
});
