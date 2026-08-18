import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");

const readSource = (relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath);
    return fs.existsSync(absolutePath)
        ? fs.readFileSync(absolutePath, "utf8")
        : "";
};

test("5.9.0 color migration persists an exact zero-to-one flag in VRCNTData", () => {
    const config = readSource("src-python/config.py");
    const controller = readSource("src-python/controller.py");
    const mainloop = readSource("src-python/mainloop.py");
    const settings = readSource("src-ui/logics/configs/config_page_setter/ui_config_setter.js");

    assert.match(config, /COLOR_RESET_5_9_0\s*=\s*ManagedProperty/);
    assert.match(config, /@json_serializable\("5_9_0_color_reset"\)/);
    assert.match(config, /self\._COLOR_RESET_5_9_0\s*=\s*0/);
    assert.match(config, /"5_9_0_color_reset"\s*:\s*"COLOR_RESET_5_9_0"/);
    assert.match(controller, /def getColorReset590/);
    assert.match(controller, /def setColorReset590/);
    assert.match(controller, /config\.saveConfigToFile\(\)/);
    assert.match(mainloop, /"\/get\/data\/5_9_0_color_reset"/);
    assert.match(mainloop, /"\/set\/data\/5_9_0_color_reset"/);
    assert.match(settings, /Base_Name:\s*"ColorReset590"/);
    assert.match(settings, /base_endpoint_name:\s*"5_9_0_color_reset"/);
});

test("the migration gate resets application roles and has no escape action", () => {
    const app = readSource("src-ui/views/app/App.jsx");
    const gate = readSource("src-ui/views/app/others/color_reset_migration_gate/ColorResetMigrationGate.jsx");

    assert.match(app, /ColorResetMigrationGate/);
    assert.match(app, /isColorResetMigrationRequired/);
    assert.match(app, /inert=\{isBlocking \|\| isColorResetMigrationRequired/);
    assert.match(gate, /APP_COLOR_PALETTE_DEFAULTS/);
    assert.match(gate, /const resetPalette\s*=\s*\{\s*\.\.\.APP_COLOR_PALETTE_DEFAULTS\s*\}/);
    assert.match(gate, /updateAppColorPalette\(resetPalette\)/);
    assert.match(gate, /setAppColorPalette\(resetPalette\)/);
    assert.match(gate, /setColorReset590\(1\)/);
    assert.match(gate, /role="dialog"/);
    assert.match(gate, /aria-modal="true"/);
    assert.equal((gate.match(/<button\b/g) ?? []).length, 1);
    assert.doesNotMatch(gate, /skip|close|dismiss/i);
});

test("the settings version label uses the package release version", () => {
    const versionLabel = readSource("src-ui/views/app/config_page/version_label/VersionLabel.jsx");

    assert.match(versionLabel, /@root\/package\.json/);
    assert.match(versionLabel, /packageInfo\.version/);
    assert.doesNotMatch(versionLabel, /currentSoftwareVersion\.data/);
});

test("all supported locales explain the mandatory color reset", () => {
    const localeFiles = ["en.yml", "ja.yml", "ko.yml", "th.yml", "zh-Hans.yml", "zh-Hant.yml"];

    for (const localeFile of localeFiles) {
        const locale = readSource(`locales/${localeFile}`);
        assert.match(locale, /color_reset_migration:/, localeFile);
        assert.match(locale, /title:/, localeFile);
        assert.match(locale, /description:/, localeFile);
        assert.match(locale, /action:/, localeFile);
    }
});
