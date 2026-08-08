import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import yaml from "js-yaml";

const localeFiles = ["en", "ja", "ko", "th", "zh-Hans", "zh-Hant"];
const localePath = (locale) => path.resolve(process.cwd(), "locales", `${locale}.yml`);

test("all supported locales provide cloud translation provider copy", () => {
  for (const locale of localeFiles) {
    const parsed = yaml.load(fs.readFileSync(localePath(locale), "utf8"));
    const copy = parsed?.config_page?.model_and_provider?.cloud_translation_providers;

    assert.equal(typeof copy?.title, "string", `${locale} title should be a string`);
    assert.ok(copy.title.trim(), `${locale} title should be non-empty`);
    assert.equal(typeof copy?.description, "string", `${locale} description should be a string`);
    assert.ok(copy.description.trim(), `${locale} description should be non-empty`);
  }
});
