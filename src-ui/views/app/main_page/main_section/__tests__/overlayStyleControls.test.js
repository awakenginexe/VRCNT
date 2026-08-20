import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Overlay Studio exposes the full VR style surface for both modes", () => {
    const studio = readSource("../../overlay_studio/OverlayStudio.jsx");
    const styles = readSource("../../overlay_studio/OverlayStudio.module.scss");

    assert.match(studio, /role="tablist"/);
    assert.match(studio, /role="tab"/);
    assert.doesNotMatch(studio, /<select[^>]+value=\{vrMode\}/);
    for (const setting of [
        "background_opacity",
        "border_enabled",
        "text_outline_enabled",
        "text_outline_width",
        "canvas_width",
        "canvas_height",
    ]) {
        assert.match(studio, new RegExp(setting));
    }
    assert.match(studio, /currentOverlayShowOnlyTranslatedMessages/);
    assert.match(studio, /currentOverlayShowOnlyReceivedMessages/);
    assert.match(studio, /const isVrAutoHeight = activeVrSettings\.canvas_height === 0/);
    assert.doesNotMatch(studio, /<option value="transparent_black"/);
    assert.match(styles, /\.mode_tabs\s*\{/);
});

test("legacy VR background selection keeps the new opacity setting in sync", () => {
    const legacyVr = readSource("../../../config_page/setting_section/setting_box/vr/Vr.jsx");

    assert.match(
        legacyVr,
        /selectFunction\(\{\s*background_mode:\s*selected_data\.selected_id,\s*background_opacity:\s*selected_data\.selected_id === "solid_black" \? 100 : 71,\s*\}\)/,
    );
});

test("Overlay Studio localizes the VR visibility and style controls", () => {
    for (const locale of ["en", "ja", "ko", "th", "zh-Hans", "zh-Hant"]) {
        const source = readSource(`../../../../../../locales/${locale}.yml`);
        for (const key of [
            "background_transparency",
            "border_enabled",
            "text_outline",
            "outline_size",
            "show_only_translated",
            "show_only_received",
            "width",
            "height",
        ]) {
            assert.match(source, new RegExp(`\\s${key}:`), `${locale} is missing ${key}`);
        }
    }
});
