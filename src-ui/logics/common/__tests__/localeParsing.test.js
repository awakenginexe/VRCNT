import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const localeFiles = [
    "en.yml",
    "ja.yml",
    "ko.yml",
    "th.yml",
    "zh-Hant.yml",
    "zh-Hans.yml",
];

test("all supported locales parse without duplicate YAML keys", () => {
    for (const localeFile of localeFiles) {
        assert.doesNotThrow(
            () => yaml.load(fs.readFileSync(path.join(repoRoot, "locales", localeFile), "utf8")),
            localeFile,
        );
    }
});

test("installer locale source of truth matches every application locale", () => {
    const languageCatalog = JSON.parse(
        fs.readFileSync(path.join(repoRoot, "locales", "languages.json"), "utf8"),
    );
    const expectedIds = languageCatalog.map((language) => language.id);
    assert.deepEqual(
        expectedIds,
        localeFiles.map((localeFile) => localeFile.slice(0, -4)),
    );

    const english = yaml.load(
        fs.readFileSync(path.join(repoRoot, "locales", "en.yml"), "utf8"),
    );
    const expectedInstallerKeys = Object.keys(english.installer ?? {}).sort();
    assert.ok(expectedInstallerKeys.length > 0);
    for (const localeFile of localeFiles) {
        const locale = yaml.load(
            fs.readFileSync(path.join(repoRoot, "locales", localeFile), "utf8"),
        );
        assert.deepEqual(
            Object.keys(locale.installer ?? {}).sort(),
            expectedInstallerKeys,
            localeFile + " installer keys",
        );
    }
});
