import assert from "node:assert/strict";
import test from "node:test";

import {
    FONT_PACK_DELIVERY,
    FONT_PACKS,
    getManagedFontVariables,
    normalizeFontLanguageTag,
    resolveFontScriptProfile,
} from "../fontScriptRegistry.js";

test("normalizes language tags without changing their script or region meaning", () => {
    assert.equal(normalizeFontLanguageTag(" cmn_hans_hk "), "cmn-Hans-HK");
    assert.equal(normalizeFontLanguageTag("ZH-hant-tw"), "zh-Hant-TW");
    assert.equal(normalizeFontLanguageTag(""), null);
    assert.equal(normalizeFontLanguageTag(null), null);
});

test("resolves every approved bundled script from current language profiles", () => {
    const cases = [
        [{ language: "English", country: "United States", code: "en-US" }, ["latin-greek-cyrillic"]],
        [{ language: "Vietnamese", country: "Vietnam", code: "vi-VN" }, ["latin-greek-cyrillic"]],
        [{ language: "Thai", country: "Thailand", code: "th-TH" }, ["thai"]],
        [{ language: "Japanese", country: "Japan", code: "ja-JP" }, ["japanese"]],
        [{ language: "Chinese Simplified", country: "China", code: "cmn-Hans-CN" }, ["cjk-simplified"]],
        [{ language: "Chinese Traditional", country: "Taiwan", code: "cmn-Hant-TW" }, ["cjk-traditional"]],
        [{ language: "Korean", country: "South Korea", code: "ko-KR" }, ["korean"]],
        [{ language: "Lao", country: "Laos", code: "lo-LA" }, ["lao"]],
        [{ language: "Khmer", country: "Cambodia", code: "km-KH" }, ["khmer"]],
        [{ language: "Burmese", country: "Myanmar", code: "my-MM" }, ["myanmar"]],
        [{ language: "Hindi", country: "India", code: "hi-IN" }, ["devanagari"]],
        [{ language: "Arabic", country: "Saudi Arabia", code: "ar-SA" }, ["arabic"]],
    ];

    for (const [input, expectedPacks] of cases) {
        assert.deepEqual(resolveFontScriptProfile(input).packIds, expectedPacks, input.language);
    }
});

test("resolves script packs from code-only language profiles and known aliases", () => {
    const cases = [
        ["ja-JP", ["japanese"]],
        [{ code: "th-TH" }, ["thai"]],
        [{ languageCode: "zh-Hans-CN" }, ["cjk-simplified"]],
        [{ locale: "zh-Hant-TW" }, ["cjk-traditional"]],
        [{ code: "tl-PH" }, ["latin-greek-cyrillic"]],
        [{ code: "nb-NO" }, ["latin-greek-cyrillic"]],
    ];

    for (const [input, expectedPacks] of cases) {
        assert.deepEqual(resolveFontScriptProfile(input).packIds, expectedPacks);
    }
});

test("prefers explicit script subtags and preserves Hong Kong CJK fallback order", () => {
    assert.deepEqual(
        resolveFontScriptProfile({
            language: "Chinese Simplified",
            country: "Hong Kong",
            code: "cmn-Hans-HK",
        }).packIds,
        ["cjk-simplified"],
    );
    assert.deepEqual(
        resolveFontScriptProfile({
            language: "Chinese Traditional",
            country: "Hong Kong",
            code: "yue_Hant_HK",
        }).packIds,
        ["cjk-hong-kong", "cjk-traditional"],
    );
    assert.equal(
        resolveFontScriptProfile({ language: "Persian", country: "Iran", code: "fa-IR" }).direction,
        "rtl",
    );
});

test("returns neutral system fallback for automatic and unknown languages", () => {
    assert.deepEqual(resolveFontScriptProfile({ language: "auto" }), {
        languageTag: null,
        direction: "ltr",
        packIds: [],
        usesSystemFallback: true,
    });
    assert.deepEqual(resolveFontScriptProfile("auto").packIds, []);
    assert.deepEqual(resolveFontScriptProfile({ code: "unknown" }).packIds, []);
    assert.deepEqual(resolveFontScriptProfile({ language: "Klingon", code: "tlh" }).packIds, []);
});

test("marks approved packs as bundled and future packs as optional", () => {
    assert.equal(FONT_PACKS.thai.delivery, FONT_PACK_DELIVERY.BUNDLED);
    assert.equal(FONT_PACKS.arabic.delivery, FONT_PACK_DELIVERY.BUNDLED);
    assert.equal(FONT_PACKS["cjk-hong-kong"].delivery, FONT_PACK_DELIVERY.OPTIONAL);
    assert.equal(FONT_PACKS.emoji.delivery, FONT_PACK_DELIVERY.OPTIONAL);
});

test("keeps VRCNT Noto first while preserving the saved system font and final fallback", () => {
    assert.deepEqual(getManagedFontVariables("Itim"), {
        "--vrcnt-user-font": "Itim",
        "--vrcnt-script-stack": '"VRCNT Noto Core"',
        "--vrcnt-system-fallback": '"Inter", "Segoe UI Variable Text", "Yu Gothic UI", system-ui, sans-serif',
        "--font_family": "var(--vrcnt-script-stack), var(--vrcnt-user-font), var(--vrcnt-system-fallback)",
    });
    assert.equal(getManagedFontVariables("")["--vrcnt-user-font"], '"VRCNT Noto"');
});
