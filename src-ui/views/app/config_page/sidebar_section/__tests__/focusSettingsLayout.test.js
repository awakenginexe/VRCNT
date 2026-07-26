import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildSettingsSearchResults } from "../../setting_section/settingsSearch.js";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Focus settings uses top navigation while preserving the existing SettingBox", () => {
    const page = readSource("../../ConfigPage.jsx");
    const navigation = readSource("../SidebarSection.jsx");
    const settingSection = readSource("../../setting_section/SettingSection.jsx");

    assert.match(page, /<Topbar[\s\S]*<SidebarSection[\s\S]*<SectionContext[\s\S]*<SettingSection/);
    assert.match(navigation, /sidebarTabOrder\.map/);
    assert.match(navigation, /aria-current=\{isSelected \? "page"/);
    assert.match(settingSection, /<SettingBox\s*\/>/);
});

test("translation and transcription share one Model & Provider destination", () => {
    const navigationMeta = readSource("../sidebarTabMeta.js");
    const settingBox = readSource("../../setting_section/setting_box/SettingBox.jsx");
    const workspace = readSource(
        "../../setting_section/setting_box/model_and_provider/ModelAndProvider.jsx",
    );
    const workspaceStyles = readSource(
        "../../setting_section/setting_box/model_and_provider/ModelAndProvider.module.scss",
    );

    assert.match(navigationMeta, /"model_and_provider"/);
    assert.doesNotMatch(
        navigationMeta.match(/sidebarTabOrder\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "",
        /"translation"|"transcription"/,
    );
    assert.match(settingBox, /case "model_and_provider":\s*return <ModelAndProvider\s*\/>/);
    assert.match(workspace, /data-settings-pane="translation"[\s\S]*<Translation\s*\/>/);
    assert.match(workspace, /data-settings-pane="transcription"[\s\S]*<Transcription\s*\/>/);
    assert.match(
        workspaceStyles,
        /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+0\.1rem\s+minmax\(0,\s*1fr\)/,
    );
    assert.match(workspaceStyles, /@container model-provider-workspace/);
    assert.match(
        workspaceStyles,
        /@container model-provider-workspace[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );

    const translationPosition = workspace.indexOf('data-settings-pane="translation"');
    const transcriptionPosition = workspace.indexOf('data-settings-pane="transcription"');
    assert.ok(
        translationPosition < transcriptionPosition,
        "stacked layout must keep Translation above Transcription",
    );
});

test("About replaces Credit and keeps both project repositories visible", () => {
    const navigationMeta = readSource("../sidebarTabMeta.js");
    const settingBox = readSource("../../setting_section/setting_box/SettingBox.jsx");
    const aboutPage = readSource(
        "../../setting_section/setting_box/about_vrct/AboutVrct.jsx",
    );

    assert.doesNotMatch(
        navigationMeta.match(/sidebarTabOrder\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "",
        /"supporters"/,
    );
    assert.match(settingBox, /case "about":\s*return <AboutVrct\s*\/>/);
    assert.match(aboutPage, /currentSoftwareVersion/);
    assert.match(aboutPage, /github\.com\/awakenginexe\/VRCNT-Next/);
    assert.match(aboutPage, /github\.com\/misyaguziya\/VRCT/);
    assert.match(aboutPage, /about_page\.lineage_description/);
});

test("localized settings search returns matching controls and their categories", () => {
    const results = buildSettingsSearchResults({
        query: "api key",
        resourceBundle: {
            config_page: {
                translation: {
                    deepl: { auth_key: { label: "DeepL API Key" } },
                    openai: { auth_key: { label: "OpenAI API Key" } },
                    auth_key_success: "API key update completed",
                },
                device: {
                    mic: { label: "Microphone" },
                },
            },
        },
        tabMeta: {
            model_and_provider: {
                label: "Model & Provider",
                tooltipDetail: "Translation providers and speech models",
            },
            device: { label: "Device", tooltipDetail: "Audio devices" },
        },
    });

    assert.deepEqual(results.map((result) => result.label), [
        "DeepL API Key",
        "OpenAI API Key",
    ]);
    assert.ok(results.every((result) => result.tabId === "model_and_provider"));
});

test("all locales contain the Focus settings shell copy", () => {
    for (const locale of ["en", "ja", "ko", "th", "zh-Hans", "zh-Hant"]) {
        const source = readFileSync(
            new URL(`../../../../../../locales/${locale}.yml`, import.meta.url),
            "utf8",
        );
        assert.match(source, /\n    focus_settings:\n/);
        assert.match(source, /\n        search_placeholder:/);
        assert.match(source, /\n        section_descriptions:/);
        assert.match(source, /\n            model_and_provider:/);
        assert.match(source, /\n            about:/);
    }
});
