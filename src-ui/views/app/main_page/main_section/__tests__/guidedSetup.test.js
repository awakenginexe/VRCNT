import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Guided Setup owns the approved six-step route instead of opening legacy settings", () => {
    const mainPage = readSource("../../MainPage.jsx");
    const navigation = readSource("../live_weave_navigation/LiveWeaveNavigation.jsx");
    const setup = readSource("../../guided_setup/GuidedSetup.jsx");

    assert.match(mainPage, /import\s+\{\s*GuidedSetup\s*\}/);
    assert.match(mainPage, /currentExperienceRoute\.data === "setup"/);
    assert.match(mainPage, /<GuidedSetup\s*\/>/);
    assert.doesNotMatch(navigation, /if \(item\.id === "setup"\)/);
    assert.match(setup, /const SETUP_STEPS = \[/);
    for (const key of [
        "step_app_language",
        "step_language",
        "step_translation",
        "step_audio",
        "step_transcription_translation",
        "step_vrchat",
    ]) assert.match(setup, new RegExp(key));
    assert.match(setup, /step === 6/);
    assert.match(setup, /<TopBar\s*\/>/);
});

test("Guided Setup changes real persisted language, device, and VRChat settings", () => {
    const setup = readSource("../../guided_setup/GuidedSetup.jsx");

    for (const hook of [
        "useAppearance",
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
    assert.match(setup, /currentUiLanguage/);
    assert.match(setup, /currentMicDeviceList/);
    assert.match(setup, /currentSpeakerDeviceList/);
    assert.match(setup, /setUiLanguage/);
    assert.match(setup, /understanding_language/);
    assert.match(setup, /setSelectedYourTranslationLanguages/);
    assert.match(setup, /aria-live="polite"/);
    assert.doesNotMatch(setup, /RTX\s*5090|RTX\s*3070|Realtek|CABLE-A|mock|fake/i);
});

test("Guided Setup keeps audio and VRChat controls in their final steps and persists completion for finish or skip", () => {
    const setup = readSource("../../guided_setup/GuidedSetup.jsx");

    assert.match(setup, /step === 4/);
    assert.match(setup, /step === 6/);
    assert.match(setup, /"\/set\/data\/setup_completed"/);
    assert.match(setup, /const skipSetup = \(\) =>/);
    assert.match(setup, /main_page\.guided_setup\.skip/);

    for (const setter of [
        "setSelectedMicHost",
        "setSelectedMicDevice",
        "setSelectedSpeakerDevice",
        "toggleEnableSendMessageToVrc",
        "toggleEnableSendReceivedMessageToVrc",
    ]) {
        assert.match(setup, new RegExp(setter));
    }
});

test("Guided Setup waits for durable setup completion acknowledgement before leaving setup", () => {
    const setup = readSource("../../guided_setup/GuidedSetup.jsx");

    assert.match(setup, /useStdoutToPython/);
    assert.match(setup, /asyncStdoutToPython\(\s*"\/set\/data\/setup_completed"\s*,\s*true\s*\)/);
    assert.match(setup, /completionIntent/);
    assert.match(setup, /currentSetupCompleted\.data\s*===\s*true/);
    assert.match(setup, /main_page\.guided_setup\.setup_completion_error/);
    assert.doesNotMatch(
        setup,
        /setSetupCompleted\(true\);[\s\S]{0,300}updateExperienceRoute\("live"\)/,
        "setup must not route Live immediately after the generated setter call",
    );
});

test("Guided Setup stays usable in the minimum desktop workspace and remains localized", () => {
    const styles = readSource("../../guided_setup/GuidedSetup.module.scss");
    const english = readSource("../../../../../../locales/en.yml");

    assert.match(styles, /@media \(max-width: 80rem\)/);
    assert.match(styles, /@media \(max-height: 46rem\)/);
    assert.match(styles, /:focus-visible/);
    assert.match(english, /guided_setup:/);
    for (const key of [
        "step_app_language",
        "step_language",
        "step_translation",
        "step_audio",
        "step_transcription_translation",
        "step_vrchat",
    ]) {
        assert.match(english, new RegExp(`\\s${key}:`));
    }
});
