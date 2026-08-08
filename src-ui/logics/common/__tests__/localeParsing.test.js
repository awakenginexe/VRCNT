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

test("all supported locales parse without duplicate YAML keys", () => {
    for (const localeFile of localeFiles) {
        assert.doesNotThrow(
            () => yaml.load(fs.readFileSync(path.join(repoRoot, "locales", localeFile), "utf8")),
            localeFile,
        );
    }
});
