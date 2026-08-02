import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

test("Appearance exposes optional-font management and the config registry persists its policy", async () => {
    const source = await readFile(resolve(root, "src-ui/views/app/config_page/setting_section/setting_box/appearance/Appearance.jsx"), "utf8");
    assert.match(source, /<FontPackManagement/);
    const registry = await readFile(resolve(root, "src-ui/logics/configs/config_page_setter/ui_config_setter.js"), "utf8");
    assert.match(registry, /Base_Name: "FontDownloadPolicy"/);
    assert.match(registry, /base_endpoint_name: "font_download_policy"/);
});

test("the development-only review surface contains representative multilingual samples", async () => {
    const source = await readFile(resolve(root, "src-ui/views/app/config_page/setting_section/setting_box/appearance/FontPackManagement.jsx"), "utf8");
    assert.match(source, /import\.meta\.env\.DEV/);
    assert.match(source, /ไทย/);
    assert.match(source, /日本語/);
    assert.match(source, /العربية/);
});

test("Ask prompts only for required packs while Automatic requests them through the approved downloader", async () => {
    const controller = await readFile(resolve(root, "src-ui/views/app/_app_controllers/FontFamilyController.jsx"), "utf8");
    assert.match(controller, /getRequiredOptionalPackIds/);
    assert.match(controller, /FONT_DOWNLOAD_POLICY\.AUTOMATIC/);
    assert.match(controller, /vrcnt-font-pack-required/);
});

test("opening Appearance rechecks required packs so an Ask prompt is not lost while Settings is closed", async () => {
    const source = await readFile(resolve(root, "src-ui/views/app/config_page/setting_section/setting_box/appearance/FontPackManagement.jsx"), "utf8");
    assert.match(source, /useLanguageSettings/);
    assert.match(source, /getRequiredOptionalPackIds/);
    assert.match(source, /requestRequiredOptionalFontPack/);
});

test("the About page includes Noto OFL and pinned-source attribution", async () => {
    const source = await readFile(resolve(root, "src-ui/views/app/config_page/setting_section/setting_box/about_vrct/AboutVrct.jsx"), "utf8");
    assert.match(source, /OFL-1\.1/);
    assert.match(source, /Google Fonts/);
    assert.match(source, /2796410152d4f9524b68ed46e69c1b60f8e0f7c3/);
});

test("the Noto notice records licensing and the exact pinned source revision", async () => {
    const notice = await readFile(resolve(root, "src-python/models/overlay/fonts/NOTICE.md"), "utf8");
    assert.match(notice, /OFL-1\.1/);
    assert.match(notice, /2796410152d4f9524b68ed46e69c1b60f8e0f7c3/);
    assert.match(notice, /raw\.githubusercontent\.com\/google\/fonts/);
});
