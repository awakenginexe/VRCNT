import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../../../");
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), "utf8");

test("OSC Studio is a first-class route between Overlay Studio and Customize", () => {
    const mainPage = read("src-ui", "views", "app", "main_page", "MainPage.jsx");
    const navigation = read(
        "src-ui", "views", "app", "main_page", "main_section",
        "live_weave_navigation", "LiveWeaveNavigation.jsx",
    );
    const studio = read("src-ui", "views", "app", "main_page", "osc_studio", "OscStudio.jsx");
    const styles = read("src-ui", "views", "app", "main_page", "osc_studio", "OscStudio.module.scss");

    assert.match(mainPage, /currentExperienceRoute\.data === "osc"/);
    assert.match(mainPage, /<OscStudio\s*\/>/);
    assert.match(navigation, /\{ id: "osc"/);
    assert.ok(navigation.indexOf('id: "overlay"') < navigation.indexOf('id: "osc"'));
    assert.ok(navigation.indexOf('id: "osc"') < navigation.indexOf('id: "customize"'));
    assert.match(navigation, /item\.id === "osc"[\s\S]*?setIsOpenedConfigPage\(false\)/);
    assert.match(studio, /useOthers/);
    assert.match(studio, /useAdvancedSettings/);
    assert.match(studio, /useIsOscAvailable/);
    assert.equal((studio.match(/<MessageFormatContainer/g) ?? []).length, 2);
    assert.match(studio, /format_id="send"/);
    assert.match(studio, /format_id="received"/);
    assert.match(studio, /speaker_title/);
    assert.doesNotMatch(studio, /Atom_[A-Za-z]/);
    assert.match(styles, /@media \(max-width: 62rem\)/);
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("OSC Studio labels remain present in every shipped locale", () => {
    for (const locale of ["en", "ja", "ko", "th", "zh-Hans", "zh-Hant"]) {
        const source = read("locales", `${locale}.yml`);
        assert.match(source, /\sosc:\s/, `${locale} is missing the OSC navigation label`);
        assert.match(source, /osc_studio:/, `${locale} is missing OSC Studio copy`);
        assert.match(source, /session_stop_partial:/, `${locale} is missing partial stop feedback`);
    }
});
