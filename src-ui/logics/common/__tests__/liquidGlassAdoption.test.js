import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const base = "../../../views/app/main_page/";
const files = `
color_customization/ColorCustomization
engines/EnginesWorkspace
guided_setup/GuidedSetup
models/ModelsHub
osc_studio/OscStudio
overlay_studio/OverlayStudio
translation_models/TranslationModelsHub
main_section/MainSection
main_section/language_selector/LanguageSelector
main_section/language_selector/language_selector_top_bar/LanguageSelectorTopBar
main_section/live_control_rail/LiveControlRail
main_section/live_language_bar/LiveLanguageBar
main_section/message_container/MessageContainer
main_section/message_container/log_box/LogBox
main_section/message_container/message_input_box/MessageInputBox
main_section/message_container/message_log_settings_container/MessageLogSettingsContainer
main_section/resource_monitor/ResourceMonitor
main_section/top_bar/TopBar
sidebar_section/SidebarSection
sidebar_section/main_function_switch/MainFunctionSwitch
sidebar_section/language_settings/language_profile_group/LanguageProfileGroup
sidebar_section/language_settings/language_selector_open_button/LanguageSelectorOpenButton
sidebar_section/language_settings/transcription_engine_label/TranscriptionEngineLabel
sidebar_section/language_settings/transcription_engine_label/transcription_engine_selector/TranscriptionEngineSelector
sidebar_section/language_settings/translator_selector_open_button/TranslatorSelectorOpenButton
sidebar_section/language_settings/translator_selector_open_button/translator_selector/TranslatorSelector
`.trim().split("\n").map((name) => `${base}${name}.module.scss`);

// Scrims keep their own blur; these class names are scrims without "backdrop"/"scrim" in the name.
const scrimSelector = /backdrop|scrim|dimming|is_selected_same_language_wrapper/;

const selectorOf = (lines, index) => {
    for (let i = index; i >= 0; i--) {
        if (lines[i].includes("{")) {
            let selector = lines[i].slice(0, lines[i].indexOf("{"));
            while (!selector.trim() && i > 0) selector = lines[--i];
            return selector;
        }
    }
    return "";
};

test("main page surfaces use the shared Liquid Glass mixin", () => {
    assert.ok(files.length > 0);
    for (const file of files) {
        const source = readFileSync(new URL(file, import.meta.url), "utf8");
        assert.match(source, /@include liquid_glass\(/, `${file} should include liquid_glass`);

        const lines = source.split("\n");
        lines.forEach((line, index) => {
            if (!/^\s*(-webkit-)?backdrop-filter:/.test(line)) return;
            assert.match(selectorOf(lines, index), scrimSelector, `${file}:${index + 1} has a hand-written backdrop-filter outside a scrim`);
        });
    }
});
