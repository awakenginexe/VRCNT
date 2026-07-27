import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
    assert.match(
        downloadModels,
        /triggeringRowRef\.current = rowRefs\.current\.get\(option\.id\)/,
    );
    assert.doesNotMatch(downloadButton, /model_download_button_label/);
    assert.doesNotMatch(downloadButton, /case !option\.is_downloaded/);
    assert.match(downloadButton, /case option\.update_button/);
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
    assert.match(confirmation, /event\.key === "Escape"/);
});
