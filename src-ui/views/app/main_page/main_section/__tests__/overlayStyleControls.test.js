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

test("Overlay Studio exposes VR transform, tracker, and diagnostic sample controls", () => {
    const studio = readSource("../../overlay_studio/OverlayStudio.jsx");
    const styles = readSource("../../overlay_studio/OverlayStudio.module.scss");

    for (const setting of [
        "x_pos",
        "y_pos",
        "z_pos",
        "x_rotation",
        "y_rotation",
        "z_rotation",
        "tracker",
    ]) {
        assert.match(studio, new RegExp(setting));
    }
    assert.match(studio, /sendTextToOverlay/);
    assert.match(studio, /sample_text_active_warning/);
    assert.match(styles, /\.vr_transform_controls\s*\{/);
    assert.match(styles, /\.sample_text_panel\s*\{/);
    assert.match(styles, /\.sample_text_panel\[data-active="true"\]/);

    for (const locale of ["en", "ja", "ko", "th", "zh-Hans", "zh-Hant"]) {
        const source = readSource(`../../../../../../locales/${locale}.yml`);
        assert.match(source, /sample_text_title:/, `${locale} is missing the sample-text title`);
        assert.match(source, /sample_text_active_warning:/, `${locale} is missing the sample-text warning`);
    }
});

test("active diagnostic styling uses a valid red error token", () => {
    const styles = readSource("../../overlay_studio/OverlayStudio.module.scss");
    const activePanelStart = styles.indexOf('.sample_text_panel[data-active="true"] {');
    const activeButtonStart = styles.indexOf('.sample_text_panel[data-active="true"] .sample_text_button {');
    const descriptionStart = styles.indexOf(".sample_text_description", activeButtonStart);

    assert.notEqual(activePanelStart, -1);
    assert.notEqual(activeButtonStart, -1);
    assert.notEqual(descriptionStart, -1);

    const activePanelStyles = styles.slice(activePanelStart, activeButtonStart);
    const activeButtonStyles = styles.slice(activeButtonStart, descriptionStart);
    assert.match(activePanelStyles, /var\(--error_color\)/);
    assert.match(activeButtonStyles, /var\(--error_color\)/);
    assert.doesNotMatch(activePanelStyles, /--error_color_rgb/);
    assert.doesNotMatch(activeButtonStyles, /--error_color_rgb/);
});

test("Thai terminology uses transcription instead of recognition wording", () => {
    const thai = readSource("../../../../../../locales/th.yml");

    assert.doesNotMatch(thai, /การรู้จำเสียง/);
    assert.match(thai, /การถอดเสียง/);
});
