import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const root = path.resolve(import.meta.dirname, "../../../..");
const locales = ["en", "ja", "ko", "th", "zh-Hans", "zh-Hant"];

test("all locales contain Translation Models route copy", () => {
    for (const locale of locales) {
        const source = fs.readFileSync(path.join(root, "locales", `${locale}.yml`), "utf8");
        const bundle = yaml.load(source, { json: false });
        const route = bundle.main_page.translation_models;

        assert.ok(bundle.main_page.live_weave.navigation.translation_models, locale);
        for (const key of ["eyebrow", "title", "detail", "back_to_live", "advanced_models", "advanced_models_detail"]) {
            assert.equal(typeof route?.[key], "string", `${locale}.${key}`);
        }
        assert.match(bundle.config_page.translation_models.downloading, /\{\{progress\}\}/, locale);
    }
});
