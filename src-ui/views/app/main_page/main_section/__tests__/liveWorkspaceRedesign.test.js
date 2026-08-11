import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the live workspace uses the approved real-data control rail and compact composer", () => {
    const source = readSource("../MainSection.jsx");
    const rail = readSource("../live_control_rail/LiveControlRail.jsx");

    assert.match(source, /<LiveControlRail\s*\/>/);
    assert.match(source, /<MessageContainer[\s\S]*compactComposer/);
    assert.doesNotMatch(source, /<LiveLanguageBar\s*\/>/);
    assert.doesNotMatch(rail, /SessionPrimaryAction/);
    assert.match(
        rail,
        /<MainFunctionSwitch\s+layout="control_rail"\s+includeForeground=\{false\}\s*\/>/,
    );
    assert.match(rail, /<LanguageProfileGroup[\s\S]*group="speaking"/);
    assert.match(rail, /<LanguageProfileGroup[\s\S]*group="target"/);
    assert.match(rail, /<LanguageSelectorOpenButton/);
    assert.match(rail, /<TranscriptionEngineLabel\s+variant="live_compact"/);
    assert.match(rail, /<TranslatorSelectorOpenButton\s+variant="live_compact"/);
    assert.match(rail, /useIsOscAvailable/);
    assert.match(rail, /currentEnableSendMessageToVrc/);
});

test("the real control rail exposes complete speaking and target profiles", () => {
    const source = readSource("../live_control_rail/LiveControlRail.jsx");

    assert.match(source, /<LanguageProfileGroup[\s\S]*group="speaking"/);
    assert.match(source, /<LanguageProfileGroup[\s\S]*group="target"/);
    assert.match(source, /languages=\{getCurrentYourLanguages\(\)\}/);
    assert.match(source, /languages=\{getCurrentTargetLanguages\(\)\}/);
    assert.match(source, /onRemove=\{removeYourLanguage\}/);
    assert.match(source, /onRemove=\{removeTargetLanguage\}/);
    assert.match(source, /variant="live_rail"/);

    const singleSelectors = source.match(/<LanguageSelectorOpenButton/g) ?? [];
    assert.equal(singleSelectors.length, 1, "only the preferred language stays single-select");
});

test("slow pipeline state and notifications use the approved warning placement", () => {
    const pipeline = readSource("../pipeline_status/PipelineStatus.jsx");
    const snackbar = readSource("../../../others/snackbar_controller/SnackbarController.jsx");

    assert.match(pipeline, /data-health=\{summary\.health\}/);
    assert.match(snackbar, /position="bottom-left"/);
});

test("the session health pill has centered text without a leading dot", () => {
    const navigation = readSource("../live_weave_navigation/LiveWeaveNavigation.jsx");
    const styles = readSource("../live_weave_navigation/LiveWeaveNavigation.module.scss");

    assert.doesNotMatch(navigation, /session_dot/);
    assert.doesNotMatch(styles, /\.session_dot|session_status_breathe/);
    assert.match(styles, /\.session_health[\s\S]*display:\s*inline-flex/);
    assert.match(styles, /\.session_health[\s\S]*justify-content:\s*center/);
    assert.match(styles, /\.session_health[\s\S]*text-align:\s*center/);
});

test("localized navigation items keep their width inside the scroll rail", () => {
    const styles = readSource("../live_weave_navigation/LiveWeaveNavigation.module.scss");

    assert.match(styles, /\.navigation\s*\{[^}]*?overflow-x:\s*auto/);
    assert.match(styles, /\.navigation_item\s*\{[^}]*?flex:\s*0\s+0\s+auto/);
    assert.match(styles, /\.utility_area\s*\{[^}]*?flex:\s*0\s+0\s+auto/);
    assert.match(styles, /@media\s*\(max-width:\s*100rem\)[\s\S]*?\.navigation\s*\{[^}]*?gap:\s*0\.1rem/);
    assert.match(
        styles,
        /@media\s*\(max-width:\s*100rem\)[\s\S]*?\.navigation_item\s*\{[^}]*?padding-inline:\s*0\.36rem;[^}]*?font-size:\s*0\.84rem/,
    );
    assert.match(
        styles,
        /@media\s*\(max-width:\s*80rem\)[\s\S]*?\.navigation_item\s*\{[^}]*?padding-inline:\s*0\.42rem/,
    );
});

test("the top-right desktop overlay tooltip opens below and inward from the window edge", () => {
    const button = readSource(
        "../../sidebar_section/desktop_overlay_button/DesktopOverlayButton.jsx"
    );
    const tooltip = readSource("../../../../common_components/tooltip/Tooltip.jsx");

    assert.match(button, /forceCompact \? "bottom-end" : "right"/);
    assert.match(tooltip, /placement === "bottom-end"/);
    assert.match(tooltip, /Math\.min\(rect\.right, window\.innerWidth - offset\)/);
    assert.match(tooltip, /translate\(-100%, 0\)/);
});

test("Live Weave uses top navigation and excludes unsupported VRChat world copy", () => {
    const mainPage = readSource("../../MainPage.jsx");
    const topBar = readSource("../top_bar/TopBar.jsx");
    const navigation = readSource("../live_weave_navigation/LiveWeaveNavigation.jsx");

    assert.doesNotMatch(mainPage, /<SidebarSection\s*\/>/);
    assert.match(topBar, /<LiveWeaveNavigation\s*\/>/);
    for (const key of ["live", "history", "models", "overlay", "settings"]) {
        assert.match(navigation, new RegExp(`main_page\\.live_weave\\.navigation\\.${key}`));
    }
    assert.match(navigation, /configTab:\s*"model_and_provider"/);
    assert.doesNotMatch(navigation, /Garden world|speakers connected/i);
});

test("advanced diagnostics stay collapsed while the rail keeps the real controls visible", () => {
    const mainSection = readSource("../MainSection.jsx");
    const controlRail = readSource("../live_control_rail/LiveControlRail.jsx");
    const switches = readSource("../../sidebar_section/main_function_switch/MainFunctionSwitch.jsx");
    const switchStyles = readSource("../../sidebar_section/main_function_switch/MainFunctionSwitch.module.scss");

    assert.match(mainSection, /<LiveControlRail\s*\/>/);
    assert.match(controlRail, /<details/);
    assert.doesNotMatch(controlRail, /<details[^>]*\bopen\b/);
    assert.match(controlRail, /<PipelineStatus\s*\/>/);
    assert.doesNotMatch(controlRail, /SessionPrimaryAction/);
    assert.match(
        controlRail,
        /<MainFunctionSwitch\s+layout="control_rail"\s+includeForeground=\{false\}\s*\/>/,
    );
    assert.match(switches, /styles\[`layout_\$\{layout\}`\]/);
    assert.match(switchStyles, /\.container\.layout_control_rail/);
    assert.match(switches, /switch_items\.filter\(\(item\) => item\.switch_id !== "foreground"/);
});

test("the live control rail uses the persisted individual main-function toggles", () => {
    const switches = readSource("../../sidebar_section/main_function_switch/MainFunctionSwitch.jsx");
    const mainFunction = readSource("../../../../../logics/main/useMainFunction.js");

    assert.match(switches, /toggleTranslation/);
    assert.match(switches, /toggleTranscriptionSend/);
    assert.match(switches, /toggleTranscriptionReceive/);
    assert.match(mainFunction, /const createTogglePair/);
    assert.match(mainFunction, /`\/set\/\$\{action\}\/\$\{endpointName\}`/);
});

test("message rows put completed translations ahead of the original source text", () => {
    const row = readSource("../message_container/log_box/message_container/MessageContainer.jsx");
    const rowStyles = readSource("../message_container/log_box/message_container/MessageContainer.module.scss");

    assert.ok(
        row.indexOf("messages.translations.map") < row.indexOf("original_message"),
        "translation entries must render before original text",
    );
    assert.match(row, /className=\{styles\.translation_list\}/);
    assert.match(rowStyles, /\.translation_list/);
    assert.match(rowStyles, /\.original_message[\s\S]*?&\.with_translations[\s\S]*border-top/);
});

test("quick engine menus open below their triggers without clipping their option grids", () => {
    const transcriptionMenu = readSource(
        "../../sidebar_section/language_settings/transcription_engine_label/"
        + "transcription_engine_selector/TranscriptionEngineSelector.module.scss"
    );
    const translatorMenu = readSource(
        "../../sidebar_section/language_settings/translator_selector_open_button/"
        + "translator_selector/TranslatorSelector.module.scss"
    );
    const liveBar = readSource("../live_language_bar/LiveLanguageBar.module.scss");

    for (const menu of [transcriptionMenu, translatorMenu]) {
        assert.match(menu, /top:\s*calc\(100% \+ 0\.6rem\)/);
        assert.match(menu, /bottom:\s*auto/);
        assert.doesNotMatch(menu, /bottom:\s*100%/);
    }
    assert.match(liveBar, /z-index:\s*20/);
});

test("language selection defaults to a searchable dialog and retains the legacy VR layout", () => {
    const selector = readSource("../language_selector/LanguageSelector.jsx");
    const openButton = readSource(
        "../../sidebar_section/language_settings/language_selector_open_button/"
        + "LanguageSelectorOpenButton.jsx"
    );

    assert.match(selector, /type="search"/);
    assert.match(selector, /open_legacy_layout/);
    assert.match(selector, /isLegacyLayout/);
    assert.match(selector, /role="dialog"/);
    assert.match(openButton, /aria-haspopup="dialog"/);
});

test("the conversation log has one scroll owner and no trailing gap after the last message", () => {
    const messageContainer = readSource("../message_container/MessageContainer.module.scss");
    const logBox = readSource("../message_container/log_box/LogBox.module.scss");
    const messageRow = readSource(
        "../message_container/log_box/message_container/MessageContainer.module.scss"
    );

    assert.match(messageContainer, /\.log_box_resize_wrapper[\s\S]*overflow:\s*hidden/);
    assert.match(logBox, /overflow-y:\s*auto/);
    assert.match(logBox, /overscroll-behavior-y:\s*contain/);
    assert.match(messageRow, /&:last-child[\s\S]*padding-bottom:\s*0/);
});
