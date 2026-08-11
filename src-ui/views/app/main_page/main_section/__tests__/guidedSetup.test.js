import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Guided Setup owns the approved four-step route instead of opening legacy settings", () => {
    const mainPage = readSource("../../MainPage.jsx");
    const navigation = readSource("../live_weave_navigation/LiveWeaveNavigation.jsx");
    const setup = readSource("../../guided_setup/GuidedSetup.jsx");

    assert.match(mainPage, /import\s+\{\s*GuidedSetup\s*\}/);
    assert.match(mainPage, /currentExperienceRoute\.data === "setup"/);
    assert.match(mainPage, /<GuidedSetup\s*\/>/);
    assert.doesNotMatch(navigation, /if \(item\.id === "setup"\)/);
    assert.match(setup, /const SETUP_STEPS = \[/);
    assert.match(setup, /step === 4/);
    assert.match(setup, /<TopBar\s*\/>/);
});

test("Guided Setup changes real persisted language, device, and VRChat settings", () => {
    const setup = readSource("../../guided_setup/GuidedSetup.jsx");

    for (const hook of [
        "useLanguageSettings",
        "useDevice",
        "useOthers",
        "useIsOscAvailable",
    ]) {
        assert.match(setup, new RegExp(hook));
    }
    for (const setter of [
        "setSelectedYourLanguages",
        "setSelectedYourTranslationLanguages",
        "setSelectedTargetLanguages",
        "setSelectedMicHost",
        "setSelectedMicDevice",
        "setSelectedSpeakerDevice",
        "toggleEnableAutoMicSelect",
        "toggleEnableAutoSpeakerSelect",
        "toggleEnableSendMessageToVrc",
        "toggleEnableSendReceivedMessageToVrc",
    ]) {
        assert.match(setup, new RegExp(setter));
    }
    assert.match(setup, /currentSelectableLanguageList/);
    assert.match(setup, /currentMicDeviceList/);
    assert.match(setup, /currentSpeakerDeviceList/);
    assert.match(setup, /aria-live="polite"/);
    assert.doesNotMatch(setup, /RTX\s*5090|RTX\s*3070|Realtek|CABLE-A|mock|fake/i);
});

test("Guided Setup stays usable in the minimum desktop workspace and remains localized", () => {
    const styles = readSource("../../guided_setup/GuidedSetup.module.scss");
    const english = readSource("../../../../../../locales/en.yml");

    assert.match(styles, /@media \(max-width: 80rem\)/);
    assert.match(styles, /@media \(max-height: 46rem\)/);
    assert.match(styles, /:focus-visible/);
    assert.match(english, /guided_setup:/);
    for (const key of ["step_languages", "step_routing", "step_audio", "step_finish"]) {
        assert.match(english, new RegExp(`\\s${key}:`));
    }
});
