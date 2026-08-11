import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import { ui_configs } from "../../ui_configs.js";
import {
    THAI_UI_LANGUAGE_ID,
} from "../fontScriptRegistry.js";

const rootDir = path.resolve(import.meta.dirname, "../../../..");

const flattenKeys = (value, prefix = "") => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.entries(value).flatMap(([key, childValue]) => (
            flattenKeys(childValue, prefix ? `${prefix}.${key}` : key)
        ));
    }
    return [prefix];
};

test("Thai locale has the same translation keys as English", () => {
    const englishLocale = yaml.load(fs.readFileSync(path.join(rootDir, "locales/en.yml"), "utf8"));
    const thaiLocale = yaml.load(fs.readFileSync(path.join(rootDir, "locales/th.yml"), "utf8"));

    assert.deepEqual(
        flattenKeys(thaiLocale).sort(),
        flattenKeys(englishLocale).sort(),
    );
});

test("Thai is selectable as a UI language", () => {
    assert.deepEqual(
        ui_configs.selectable_ui_languages.find((language) => language.id === THAI_UI_LANGUAGE_ID),
        { id: THAI_UI_LANGUAGE_ID, label: "ไทย", flag: "th" },
    );
});

test("Thai UI language remains a locale choice rather than a system-font mutation", () => {
    assert.equal(THAI_UI_LANGUAGE_ID, "th");
});
