import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
);

const readSource = (...parts) => fs.readFileSync(
    path.join(repositoryRoot, ...parts),
    "utf8",
);

test("DeepSeek settings accept only a typed password and hydrate status without a key", () => {
    const entry = readSource(
        "src-ui",
        "views",
        "app",
        "config_page",
        "setting_section",
        "setting_box",
        "_components",
        "_atoms",
        "_entry",
        "_Entry.jsx",
    );
    const component = readSource(
        "src-ui",
        "views",
        "app",
        "config_page",
        "setting_section",
        "setting_box",
        "_components",
        "auth_key",
        "DeepSeekAuthKey.jsx",
    );
    const hook = readSource("src-ui", "logics", "common", "useDeepSeekConfiguration.js");

    assert.match(entry, /type=\{props\.type \?\? "text"\}/);
    assert.match(component, /type="password"/);
    assert.match(component, /ui_variable=\{inputValue\}/);
    assert.match(hook, /\/get\/data\/deepseek_auth_key/);
    assert.match(hook, /configured/);
    assert.match(hook, /health/);
    assert.doesNotMatch(hook, /savedKey|auth_key_value|result\.key/);
    assert.doesNotMatch(component, /entry_edit_cover/);
});

test("DeepSeek settings provide fixed models, connection testing, and normal availability refresh", () => {
    const config = readSource(
        "src-ui",
        "logics",
        "configs",
        "config_page_setter",
        "ui_config_setter.js",
    );
    const settings = readSource(
        "src-ui",
        "views",
        "app",
        "config_page",
        "setting_section",
        "setting_box",
        "translation",
        "Translation.jsx",
    );
    const hook = readSource("src-ui", "logics", "common", "useDeepSeekConfiguration.js");

    assert.match(config, /Base_Name: "SelectableDeepSeekModelList"/);
    assert.match(config, /Base_Name: "SelectedDeepSeekModel"/);
    assert.match(settings, /<DeepSeekAuthKey_Box\s*\/>/);
    assert.match(settings, /<DeepSeekModelContainer\s*\/>/);
    assert.match(settings, /is_disabled=\{!currentDeepSeekAuthStatus\.data\.configured\}/);
    assert.match(hook, /\/run\/deepseek_connection/);
    assert.match(hook, /getTranslationEngines\(\)/);
});

test("DeepSeek labels have locale coverage in every supported interface language", () => {
    for (const locale of ["en", "th", "ja", "ko", "zh-Hans", "zh-Hant"]) {
        const localeSource = readSource("locales", `${locale}.yml`);
        assert.match(localeSource, /^        deepseek_auth_key:/m, locale);
        assert.match(localeSource, /^        select_deepseek_model:/m, locale);
    }
});

test("DeepSeek source never logs an incoming key or puts one in frontend status state", () => {
    const controller = readSource("src-python", "controller.py");
    const mainloop = readSource("src-python", "mainloop.py");
    const hook = readSource("src-ui", "logics", "common", "useDeepSeekConfiguration.js");

    assert.doesNotMatch(controller, /printLog\("Set DeepSeek Auth Key",\s*data\)/);
    assert.match(mainloop, /endpoint == "\/set\/data\/deepseek_auth_key"/);
    assert.match(mainloop, /"receive_data": "\[redacted\]"/);
    assert.doesNotMatch(hook, /result\.key|savedKey|auth_key_value/);
});
