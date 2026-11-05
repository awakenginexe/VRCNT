import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const base = "../../../views/app/main_page/";
const lang = "sidebar_section/language_settings/";
const rail = "main_section/live_control_rail/";
const targets = [
    [rail + "LiveControlRail", "eyebrow"],
    [rail + "LiveControlRail", "section_label"],
    [rail + "LiveControlRail", "output_button"],
    [rail + "LiveControlRail", "output_status"],
    [rail + "LiveTranscriptionReadinessBadge", "label"],
    [lang + "language_profile_group/LanguageProfileGroup", "helper_text"],
    [lang + "language_profile_group/LanguageProfileGroup", "language_count"],
    [lang + "transcription_engine_label/TranscriptionEngineLabel", "live_role_change"],
    ["main_section/pipeline_status/PipelineStatus", "health"],
    ["main_section/resource_monitor/ResourceMonitor", "value"],
].map(([file, selector]) => ({ file: file + ".module.scss", selector }));

// Bodies (own declarations, up to the first nested block) of every rule whose selector list names `.selector`.
const blocks = (css, selector) => {
    const found = [];
    const rule = /([^{};]+)\{([^{}]*)/g;
    const name = new RegExp(String.raw`\.${selector}(?![\w-])`);
    for (const m of css.matchAll(rule)) if (name.test(m[1])) found.push(m[2]);
    return found;
};

test("no small label is below 0.9rem or uses a too-dark gray", () => {
    const bad = [];
    for (const { file, selector } of targets) {
        const found = blocks(readFileSync(new URL(base + file, import.meta.url), "utf8"), selector);
        assert.ok(found.length > 0, `${file}: no block for .${selector}`);
        for (const body of found) {
            for (const m of body.matchAll(/font-size:\s*([\d.]+)rem/g)) {
                if (Number(m[1]) < 0.9) bad.push(`${file} .${selector}: font-size ${m[1]}rem < 0.9rem`);
            }
            for (const m of body.matchAll(/(?<![-\w])color:\s*var\(--dark_(\d+)_color\)/g)) {
                if (Number(m[1]) > 400) bad.push(`${file} .${selector}: color --dark_${m[1]} too dark`);
            }
        }
    }
    assert.deepEqual(bad, []);
});
