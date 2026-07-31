import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import Babel from "@babel/standalone";
import yaml from "js-yaml";


const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const localeFiles = ["en.yml", "ja.yml", "ko.yml", "th.yml", "zh-Hans.yml", "zh-Hant.yml"];

const requiredLanguagePanelKeys = [
    "speaking_title",
    "speaking_desc",
    "preferred_title",
    "preferred_desc",
    "targets_title",
    "targets_desc",
    "language_count",
    "add_language",
    "edit_language",
    "remove_language",
    "minimum_one_language",
    "duplicate_language",
    "recognition_active",
    "recognition_paused",
    "outgoing_only",
    "whisper_profile_hint",
    "google_single_hint",
    "google_parallel_hint",
        "sensevoice_profile_hint",
        "single_engine_speaking_hint",
        "single_engine_target_hint",
        "target_profile_hint",
        "swap_complete_profiles",
];

test("every locale provides the complete multilingual profile copy contract", () => {
    const localePanels = localeFiles.map((localeFile) => ({
        localeFile,
        panel: yaml.load(read(`locales/${localeFile}`))?.main_page?.language_panels,
    }));

    for (const { localeFile, panel } of localePanels) {
        for (const key of requiredLanguagePanelKeys) {
            assert.equal(typeof panel?.[key], "string", `${localeFile}: ${key}`);
            assert.notEqual(panel[key].trim(), "", `${localeFile}: ${key}`);
        }
        assert.match(panel.language_count, /\{\{count\}\}/, localeFile);
        assert.match(panel.edit_language, /\{\{language\}\}/, localeFile);
        assert.match(panel.remove_language, /\{\{language\}\}/, localeFile);
        assert.match(panel.google_parallel_hint, /\{\{count\}\}/, localeFile);
        assert.match(panel.single_engine_speaking_hint, /\{\{engine\}\}/, localeFile);
        assert.match(panel.single_engine_target_hint, /\{\{engine\}\}/, localeFile);
    }
});

test("multilingual profile JSX parses and uses semantic localized controls", () => {
    const componentPaths = [
        "src-ui/views/app/main_page/sidebar_section/language_settings/LanguageSettings.jsx",
        "src-ui/views/app/main_page/sidebar_section/language_settings/language_profile_group/LanguageProfileGroup.jsx",
        "src-ui/views/app/main_page/sidebar_section/language_settings/language_selector_open_button/LanguageSelectorOpenButton.jsx",
        "src-ui/views/app/main_page/sidebar_section/language_settings/language_swap_button/LanguageSwapButton.jsx",
        "src-ui/views/app/main_page/main_section/language_selector/LanguageSelector.jsx",
    ];
    const sources = componentPaths.map((componentPath) => {
        const source = read(componentPath);
        Babel.transform(source, { presets: ["react"], sourceType: "module" });
        return source;
    });
    const profileSource = sources[1];
    const swapSource = sources[3];

    assert.match(profileSource, /<section/);
    assert.match(profileSource, /type="button"/);
    assert.match(profileSource, /aria-label=/);
    assert.match(profileSource, /aria-live="polite"/);
    assert.match(swapSource, /<button/);
    assert.match(swapSource, /type="button"/);
    assert.doesNotMatch(swapSource, /onClick=.*<div/);
});

test("language settings replaces hidden numbered rows with the three role groups", () => {
    const source = read(
        "src-ui/views/app/main_page/sidebar_section/language_settings/LanguageSettings.jsx",
    );

    assert.match(source, /group="speaking"/);
    assert.match(source, /group="target"/);
    assert.match(source, /preferred_title/);
    assert.doesNotMatch(source, /AddRemoveYourLanguageButtons/);
    assert.doesNotMatch(source, /AddRemoveTargetLanguageButtons/);
});

test("complete profile swap does not leave the unchanged preferred language pending", () => {
    const source = read("src-ui/logics/main/useLanguageSettings.js");
    const swapBody = source.match(
        /const swapSelectedLanguages = \(\) => \{([\s\S]*?)\n    \};/,
    )?.[1];

    assert.equal(typeof swapBody, "string");
    assert.match(swapBody, /pendingSelectedYourLanguages/);
    assert.match(swapBody, /pendingSelectedTargetLanguages/);
    assert.doesNotMatch(swapBody, /pendingSelectedYourTranslationLanguages/);
});
