import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import { createServer } from "vite";
import { getTranscriptionSwitchReadiness } from "../../sidebar_section/main_function_switch/mainFunctionReadinessUi.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../../");
const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

let viteServer;
let LiveTranscriptionReadinessBadge;
let SwitchContainer;
let i18n;

globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
};

const resources = {
    "main_page.live_workspace.transcription_ready": "Ready (live localized)",
    "main_page.live_workspace.transcription_not_ready": "Not Ready (live localized)",
    "main_page.live_workspace.transcription_loading": "Loading (live localized)",
    "main_page.live_workspace.transcription_detail": "Detail: {{source}} / {{engine}} / {{model}}",
    "main_page.live_workspace.session_ready": "Ready (fallback)",
    "config_page.translation_models.model_not_ready": "Not Ready (fallback)",
    "main_page.language_panels.loading": "Loading (localized)",
    "main_page.transcription_send": "Speaking (localized)",
    "main_page.transcription_receive": "Listening (localized)",
    "config_page.common.model_download.detail": "Download required: {{model}}",
    "config_page.common.correct_auth_key_required": "Credential required",
    "main_page.main_function_tooltips.transcription_send_title": "Speaking",
    "main_page.main_function_tooltips.transcription_send_detail": "Transcribe your microphone for chat.",
    "main_page.state_text_enabled": "Enabled",
    "main_page.state_text_disabled": "Disabled",
};

const TestIcon = ({ className }) => createElement("svg", { className, "aria-hidden": true });

const renderWithI18n = (element) => renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, element),
);

test("Live places the readiness badge before its feature controls", () => {
    const rail = readSource("../live_control_rail/LiveControlRail.jsx");
    const badgeIndex = rail.indexOf("<LiveTranscriptionReadinessBadge");
    const controlsIndex = rail.indexOf("<MainFunctionSwitch");

    assert.ok(badgeIndex >= 0);
    assert.ok(controlsIndex >= 0);
    assert.ok(badgeIndex < controlsIndex);
    assert.match(rail, /<LiveTranscriptionReadinessBadge\s+readiness=\{readiness\}\s*\/>/);
});

test("Live controls consume the shared readiness helper and all model status atoms", () => {
    const rail = readSource("../live_control_rail/LiveControlRail.jsx");
    const switches = readSource("../../sidebar_section/main_function_switch/MainFunctionSwitch.jsx");

    assert.match(rail, /getAggregateTranscriptionReadiness/);
    assert.match(switches, /getTranscriptionModelReadiness/);
    for (const name of [
        "currentWhisperWeightTypeStatus",
        "currentWhisperThaiWeightTypeStatus",
        "currentVoskWeightTypeStatus",
        "currentParakeetWeightTypeStatus",
        "currentSenseVoiceWeightTypeStatus",
    ]) {
        assert.match(switches, new RegExp(name));
    }
});

test("Translation keeps its existing tooltip detail while the backend is unavailable", () => {
    const switches = readSource("../../sidebar_section/main_function_switch/MainFunctionSwitch.jsx");
    const translationItem = switches.match(
        /\{\s*switch_id:\s*"translation"([\s\S]*?)\n        \},/,
    )?.[1] ?? "";

    assert.match(translationItem, /isDisabled:\s*currentIsBackendReady\.data\s*!==\s*true/);
    assert.doesNotMatch(translationItem, /disabledReason|disabledDetail/);
});

test("the readiness badge consumes localized loading and detail copy", () => {
    const badge = readSource("../live_control_rail/LiveTranscriptionReadinessBadge.jsx");

    assert.match(badge, /t\("main_page\.live_workspace\.transcription_loading"/);
    assert.match(badge, /t\("main_page\.live_workspace\.transcription_detail",\s*\{[\s\S]*source:\s*sourceLabel[\s\S]*engine:\s*item\.engine[\s\S]*model:\s*item\.model/);
});

test.before(async () => {
    viteServer = await createServer({
        root,
        configFile: path.join(root, "vite.config.js"),
        server: { middlewareMode: true },
        appType: "custom",
    });
    const badgeModule = await viteServer.ssrLoadModule(
        "/src-ui/views/app/main_page/main_section/live_control_rail/LiveTranscriptionReadinessBadge.jsx",
    );
    const switchModule = await viteServer.ssrLoadModule(
        "/src-ui/views/app/main_page/sidebar_section/main_function_switch/MainFunctionSwitch.jsx",
    );
    LiveTranscriptionReadinessBadge = badgeModule.LiveTranscriptionReadinessBadge;
    SwitchContainer = switchModule.SwitchContainer;

    i18n = i18next.createInstance();
    await i18n.init({
        lng: "test",
        fallbackLng: false,
        resources: { test: { translation: resources } },
        interpolation: { escapeValue: false },
    });
});

test.after(async () => {
    await viteServer?.close();
});

test("the rendered badge shows Ready and Loading states", () => {
    const readyMarkup = renderWithI18n(createElement(LiveTranscriptionReadinessBadge, {
        readiness: { state: "ready", missing: [] },
    }));
    const loadingMarkup = renderWithI18n(createElement(LiveTranscriptionReadinessBadge, {
        readiness: { state: "loading", missing: [] },
    }));

    assert.match(readyMarkup, /role="status"/);
    assert.match(readyMarkup, /data-state="ready"/);
    assert.match(readyMarkup, /Ready \(live localized\)/);
    assert.match(loadingMarkup, /data-state="loading"/);
    assert.match(loadingMarkup, /Loading \(live localized\)/);
});

test("the rendered badge shows localized sources and cloud credential detail", () => {
    const markup = renderWithI18n(createElement(LiveTranscriptionReadinessBadge, {
        readiness: {
            state: "not_ready",
            missing: [
                { source: "send", engine: "Whisper", model: "tiny" },
                { source: "receive", engine: "Whisper Cloud", model: "whisper-large-v3-turbo" },
            ],
        },
    }));

    assert.match(markup, /data-state="not_ready"/);
    assert.match(markup, /Not Ready \(live localized\)/);
    assert.match(markup, /Detail: Speaking \(localized\) \/ Whisper \/ tiny/);
    assert.match(markup, /Detail: Listening \(localized\) \/ Whisper Cloud \/ whisper-large-v3-turbo: Credential required/);
    assert.doesNotMatch(markup, /Whisper Cloud[^<]*Download required/);
});

test("the rendered switch is disabled with the shared readiness explanation", () => {
    const readinessProps = getTranscriptionSwitchReadiness({
        readiness: { state: "not_ready", engine: "Whisper", model: "tiny" },
        isBackendReady: true,
        backendWaitingCopy: "Backend waiting",
        localModelCopy: "Local model missing",
        cloudCredentialCopy: "Cloud credential missing",
    });
    const markup = renderWithI18n(createElement(SwitchContainer, {
        switchLabel: "Speaking (localized)",
        switch_id: "transcription_send",
        currentState: { state: "ok", data: false },
        toggleFunction: () => {},
        SvgComponent: TestIcon,
        ...readinessProps,
    }));

    assert.match(markup, /<button[^>]*disabled=""/);
    assert.match(markup, /Local model missing/);
    assert.match(markup, /data-function="transcription_send"/);
});

test("the rendered switch stays enabled while readiness is loading", () => {
    const readinessProps = getTranscriptionSwitchReadiness({
        readiness: { state: "loading", engine: "Whisper", model: "tiny" },
        isBackendReady: true,
        backendWaitingCopy: "Backend waiting",
        localModelCopy: "Local model missing",
        cloudCredentialCopy: "Cloud credential missing",
    });
    const markup = renderWithI18n(createElement(SwitchContainer, {
        switchLabel: "Speaking (localized)",
        switch_id: "transcription_send",
        currentState: { state: "ok", data: false },
        toggleFunction: () => {},
        SvgComponent: TestIcon,
        ...readinessProps,
    }));
    const buttonOpeningTag = markup.match(/<button[^>]*>/)?.[0] ?? "";

    assert.doesNotMatch(buttonOpeningTag, /\sdisabled(?:=|>)/);
    assert.match(markup, /data-function="transcription_send"/);
});
