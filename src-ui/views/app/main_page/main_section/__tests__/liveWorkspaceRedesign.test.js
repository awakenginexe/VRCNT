import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the live workspace composes real route, message, and session controls", () => {
    const source = readSource("../MainSection.jsx");

    assert.match(source, /<LiveLanguageBar\s*\/>/);
    assert.match(source, /<MessageContainer[\s\S]*sessionControls=/);
    assert.match(source, /<MainFunctionSwitch\s+layout="session_dock"/);
});

test("slow pipeline state and notifications use the approved warning placement", () => {
    const pipeline = readSource("../pipeline_status/PipelineStatus.jsx");
    const snackbar = readSource("../../../others/snackbar_controller/SnackbarController.jsx");

    assert.match(pipeline, /data-health=\{summary\.health\}/);
    assert.match(snackbar, /position="top-right"/);
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

test("the session dock keeps pipeline status above three primary controls", () => {
    const mainSection = readSource("../MainSection.jsx");
    const messageContainer = readSource("../message_container/MessageContainer.jsx");
    const switches = readSource("../../sidebar_section/main_function_switch/MainFunctionSwitch.jsx");

    assert.match(mainSection, /pipelineStatus=\{<PipelineStatus\s*\/>\}/);
    assert.match(messageContainer, /pipelineStatus/);
    assert.match(mainSection, /includeForeground=\{false\}/);
    assert.match(switches, /switch_items\.filter\(\(item\) => item\.switch_id !== "foreground"/);
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
