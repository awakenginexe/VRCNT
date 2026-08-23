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
    assert.match(setup, /beginProductTour\(\);[\s\S]*?updateExperienceRoute\("live"\)/);
    assert.match(setup, /step === 6/);
    assert.match(mainPage, /<OnboardingTour\s*\/>/);
});

test("the tour owns route changes and persists completion only after Finish or confirmed Skip", () => {
    const tour = readSource("../OnboardingTour.jsx");

    assert.match(tour, /ONBOARDING_TOUR_STEPS\[stepIndex\]/);
    assert.match(tour, /updateExperienceRoute\(nextStep\.route\)/);
    assert.match(tour, /updateExperienceRoute\(previousStep\.route\)/);
    assert.match(tour, /asyncStdoutToPython\(\s*"\/set\/data\/setup_completed"\s*,\s*true\s*\)/);
    assert.match(tour, /if \(completionRequestRef\.current\) return;[\s\S]*?completionRequestRef\.current = true;/);
    assert.match(tour, /currentSetupCompleted\.data === true/);
    assert.match(tour, /endOnboarding\(\);[\s\S]*?updateExperienceRoute\("live"\)/);
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
