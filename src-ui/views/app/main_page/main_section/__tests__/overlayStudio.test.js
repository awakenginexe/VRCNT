import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Overlay Studio is a production route wired to desktop and VR overlay state", () => {
    const mainPage = readSource("../../MainPage.jsx");
    const navigation = readSource("../live_weave_navigation/LiveWeaveNavigation.jsx");
    const studio = readSource("../../overlay_studio/OverlayStudio.jsx");
    const preview = readSource("../../../desktop_overlay/DesktopOverlayPreview.jsx");
    const overlayApp = readSource("../../../desktop_overlay/DesktopOverlayApp.jsx");

    assert.match(mainPage, /currentExperienceRoute\.data === "overlay"/);
    assert.match(mainPage, /<OverlayStudio\s*\/>/);
    assert.match(navigation, /\{ id: "overlay"/);
    assert.match(studio, /useVr/);
    assert.match(studio, /openDesktopOverlayWindow/);
    assert.match(studio, /applyDesktopOverlayGeometry/);
    assert.match(studio, /setOverlaySmallLogSettings/);
    assert.match(studio, /setOverlayLargeLogSettings/);
    assert.match(studio, /<DesktopOverlayPreview/);
    assert.match(preview, /messageLogs/);
    assert.match(preview, /translationsOnly/);
    assert.match(overlayApp, /fit-to-content/);

    const resetGeometryHandler = studio.match(
        /const resetGeometry = async \(\) => \{[\s\S]*?\n    \};\n\n    const persistOverlayPalette/,
    )?.[0];
    assert.ok(resetGeometryHandler);
    assert.match(resetGeometryHandler, /const nextSettings = await updateDesktopSettings/);
    assert.match(resetGeometryHandler, /applyDesktopOverlayGeometry\(\{ settings: nextSettings \}\)/);
    assert.doesNotMatch(`${studio}\n${preview}`, /RTX\s*5090|fake preview|mock data/i);
});

test("Overlay Studio stays localized and usable in the minimum desktop workspace", () => {
    const styles = readSource("../../overlay_studio/OverlayStudio.module.scss");
    const english = readSource("../../../../../../locales/en.yml");

    assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(19rem, 24rem\)/);
    assert.match(styles, /@media \(max-width: 80rem\)/);
    assert.match(styles, /:focus-visible/);
    assert.match(english, /overlay_studio:/);
    for (const key of ["fit_to_content", "reset_size", "desktop_preview", "vr_preview", "accent_color"]) {
        assert.match(english, new RegExp(`\\s${key}:`));
    }
});

test("overlay message text size is localized and independent from overall overlay scale", () => {
    const studio = readSource("../../overlay_studio/OverlayStudio.jsx");
    const vrSettings = readSource("../../../config_page/setting_section/setting_box/vr/Vr.jsx");
    const uiConfigs = readSource("../../../../../logics/ui_configs.js");
    const desktopApp = readSource("../../../desktop_overlay/DesktopOverlayApp.jsx");
    const desktopStyles = readSource("../../../desktop_overlay/DesktopOverlayApp.module.scss");
    const previewStyles = readSource("../../../desktop_overlay/DesktopOverlayPreview.module.scss");

    assert.match(studio, /messageTextScale|message_text_scale/);
    assert.match(vrSettings, /message_text_scale/);
    assert.match(uiConfigs, /message_text_scale:\s*1\.0/);
    assert.match(desktopApp, /messageTextScale/);
    assert.match(desktopApp, /readDesktopOverlayPayloadRaw/);
    assert.match(desktopApp, /parseDesktopOverlayPayload/);
    assert.match(desktopApp, /readDesktopOverlayPayloadSnapshot/);
    assert.match(desktopApp, /languageProfilesSignature/);
    assert.doesNotMatch(desktopApp, /\}, \[payload\]\);/);
    assert.match(desktopStyles, /var\(--desktop-overlay-message-text-scale\)/);
    assert.match(previewStyles, /var\(--desktop-overlay-message-text-scale\)/);
    const messageMetaStyles = desktopStyles.match(/\.message_meta\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    assert.doesNotMatch(messageMetaStyles, /desktop-overlay-message-text-scale/);

    for (const locale of ["en", "ja", "ko", "th", "zh-Hans", "zh-Hant"]) {
        const source = readSource(`../../../../../../locales/${locale}.yml`);
        assert.match(source, /message_text_size:/, `${locale} is missing Message Text Size`);
    }
});
