import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import yaml from "js-yaml";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const localeFiles = [
    "en.yml",
    "th.yml",
    "ja.yml",
    "ko.yml",
    "zh-Hans.yml",
    "zh-Hant.yml",
];
const modelDownloadKeys = [
    "title",
    "detail",
    "yes",
    "no",
    "required",
    "unavailable",
    "finalizing",
];
const readSource = (relativePath) => (
    fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
);
const readOptionalSource = (relativePath) => {
    const sourcePath = path.join(repoRoot, relativePath);
    return fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "";
};
const interpolationTokens = (value) => (
    [...String(value).matchAll(/{{\s*([^}\s]+)\s*}}/g)]
        .map((match) => match[1])
        .sort()
);
const accessibilityModulePath = path.join(
    repoRoot,
    "src-ui/views/app/config_page/setting_section/setting_box/_components/download_models/modelDownloadDialogAccessibility.js",
);
const accessibility = await import(pathToFileURL(accessibilityModulePath).href)
    .catch((error) => {
        if (error.code === "ERR_MODULE_NOT_FOUND") return {};
        throw error;
    });

test("model download copy keeps schema and interpolation parity across all six locales", () => {
    const english = yaml.load(readSource("locales/en.yml"))
        ?.config_page?.common?.model_download ?? {};

    assert.deepEqual(Object.keys(english).sort(), [...modelDownloadKeys].sort());

    for (const localeFile of localeFiles) {
        const namespace = yaml.load(readSource(`locales/${localeFile}`))
            ?.config_page?.common?.model_download ?? {};

        assert.deepEqual(
            Object.keys(namespace).sort(),
            [...modelDownloadKeys].sort(),
            `${localeFile} keys`,
        );
        for (const key of modelDownloadKeys) {
            assert.equal(typeof namespace[key], "string", `${localeFile}:${key} type`);
            assert.notEqual(namespace[key].trim(), "", `${localeFile}:${key} empty`);
            assert.deepEqual(
                interpolationTokens(namespace[key]),
                interpolationTokens(english[key]),
                `${localeFile}:${key} interpolation`,
            );
        }
    }
});

test("model rows own download confirmation while retaining installed update actions", () => {
    const downloadModels = readSource(
        "src-ui/views/app/config_page/setting_section/setting_box/_components/download_models/DownloadModels.jsx",
    );
    const downloadButton = readSource(
        "src-ui/views/app/config_page/setting_section/setting_box/_components/_atoms/_download_button/_DownloadButton.jsx",
    );

    assert.match(downloadModels, /getModelRowState/);
    assert.match(downloadModels, /resolvePendingModelSelection/);
    assert.match(downloadModels, /<ModelDownloadConfirmation/);
    assert.match(downloadModels, /onKeyDown=\{handleRowKeyDown/);
    assert.match(downloadModels, /aria-label=\{props\.label\}/);
    assert.match(
        downloadModels,
        /triggeringRowRef\.current = rowRefs\.current\.get\(option\.id\)/,
    );
    assert.doesNotMatch(downloadButton, /model_download_button_label/);
    assert.doesNotMatch(downloadButton, /case !option\.is_downloaded/);
    assert.match(downloadButton, /case option\.update_button/);
    assert.match(downloadButton, /option\.progress >= 100/);
    assert.match(downloadButton, /model_download\.finalizing/);
});

test("model download confirmation exposes an accessible modal contract", () => {
    const confirmation = readOptionalSource(
        "src-ui/views/app/config_page/setting_section/setting_box/_components/download_models/ModelDownloadConfirmation.jsx",
    );

    assert.match(confirmation, /role="dialog"/);
    assert.match(confirmation, /aria-modal="true"/);
    assert.match(confirmation, /aria-labelledby=/);
    assert.match(confirmation, /aria-describedby=/);
    assert.match(confirmation, /autoFocus/);
    assert.match(confirmation, /handleModelDownloadDialogKeyDown/);
    assert.match(confirmation, /createPortal/);
    assert.match(confirmation, /document\.body/);
    assert.match(confirmation, /setModelDownloadBackgroundInert/);
});

test("model download controls retain readable full-width layout and centered dialog actions", () => {
    const templates = readSource(
        "src-ui/views/app/config_page/setting_section/setting_box/_templates/Templates.jsx",
    );
    const modelListStyles = readSource(
        "src-ui/views/app/config_page/setting_section/setting_box/_components/download_models/DownloadModels.module.scss",
    );
    const confirmationStyles = readSource(
        "src-ui/views/app/config_page/setting_section/setting_box/_components/download_models/ModelDownloadConfirmation.module.scss",
    );

    assert.match(
        templates,
        /<CommonContainer Component=\{DownloadModels\} \{\.\.\.props\} flex_column \/>/,
    );
    assert.match(modelListStyles, /\.container\s*\{[^}]*width:\s*100%/s);
    assert.match(
        confirmationStyles,
        /\.(?:cancel_button|confirm_button)[\s\S]*display:\s*inline-flex/,
    );
    assert.match(confirmationStyles, /align-items:\s*center/);
    assert.match(confirmationStyles, /justify-content:\s*center/);
});

test("Escape stops propagation before cancelling and restores the triggering row", () => {
    assert.equal(
        typeof accessibility.handleModelDownloadDialogKeyDown,
        "function",
    );
    const calls = [];
    const event = {
        key: "Escape",
        shiftKey: false,
        preventDefault: () => calls.push("preventDefault"),
        stopPropagation: () => calls.push("stopPropagation"),
    };

    accessibility.handleModelDownloadDialogKeyDown(event, {
        activeElement: null,
        focusableElements: [],
        onCancel: () => calls.push("cancel"),
    });

    assert.deepEqual(calls, ["preventDefault", "stopPropagation", "cancel"]);
    const downloadModels = readSource(
        "src-ui/views/app/config_page/setting_section/setting_box/_components/download_models/DownloadModels.jsx",
    );
    assert.match(downloadModels, /triggeringRowRef\.current\.focus\(\)/);
});

test("Tab and Shift+Tab wrap focus between the dialog controls", () => {
    assert.equal(
        typeof accessibility.handleModelDownloadDialogKeyDown,
        "function",
    );
    const calls = [];
    const first = { focus: () => calls.push("first") };
    const last = { focus: () => calls.push("last") };
    const focusableElements = [first, last];

    accessibility.handleModelDownloadDialogKeyDown({
        key: "Tab",
        shiftKey: false,
        preventDefault: () => calls.push("prevent-forward"),
        stopPropagation: () => calls.push("stop-forward"),
    }, {
        activeElement: last,
        focusableElements,
        onCancel: () => calls.push("cancel-forward"),
    });
    accessibility.handleModelDownloadDialogKeyDown({
        key: "Tab",
        shiftKey: true,
        preventDefault: () => calls.push("prevent-reverse"),
        stopPropagation: () => calls.push("stop-reverse"),
    }, {
        activeElement: first,
        focusableElements,
        onCancel: () => calls.push("cancel-reverse"),
    });

    assert.deepEqual(calls, [
        "prevent-forward",
        "first",
        "prevent-reverse",
        "last",
    ]);
});

test("dialog background inert state is applied and restored without clobbering prior state", () => {
    assert.equal(
        typeof accessibility.setModelDownloadBackgroundInert,
        "function",
    );
    const attributes = new Set();
    const background = {
        hasAttribute: (name) => attributes.has(name),
        setAttribute: (name) => attributes.add(name),
        removeAttribute: (name) => attributes.delete(name),
    };

    const restore = accessibility.setModelDownloadBackgroundInert(background);
    assert.equal(attributes.has("inert"), true);
    restore();
    assert.equal(attributes.has("inert"), false);

    attributes.add("inert");
    accessibility.setModelDownloadBackgroundInert(background)();
    assert.equal(attributes.has("inert"), true);
});
