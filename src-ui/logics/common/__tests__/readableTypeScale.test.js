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
    [rail + "LiveTranscriptionReadinessBadge", "detail"],
    ["sidebar_section/main_function_switch/MainFunctionSwitch", "state_badge"],
    ["main_section/pipeline_status/PipelineStatus", "label"],
    [lang + "language_profile_group/LanguageProfileGroup", "role_title"],
    [lang + "transcription_engine_label/TranscriptionEngineLabel", "live_role_heading"],
    [lang + "language_profile_group/LanguageProfileGroup", "helper_text"],
    [lang + "language_profile_group/LanguageProfileGroup", "language_count"],
    [lang + "transcription_engine_label/TranscriptionEngineLabel", "live_role_change"],
    ["main_section/pipeline_status/PipelineStatus", "health"],
    ["main_section/resource_monitor/ResourceMonitor", "value"],
].map(([file, selector]) => ({ file: file + ".module.scss", selector }));

// Every rule (any nesting depth) as {selector, body}; body holds only the rule's own declarations, not nested blocks.
const rules = (css) => {
    const out = [];
    const stack = [];
    let buf = "";
    for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
        if (ch === "{") {
            const top = stack[stack.length - 1];
            if (top) top.body += buf.slice(0, buf.lastIndexOf(";") + 1);
            const rule = { selector: buf.slice(buf.lastIndexOf(";") + 1).trim(), body: "" };
            stack.push(rule);
            out.push(rule);
            buf = "";
        } else if (ch === "}") {
            if (stack.length) stack.pop().body += buf;
            buf = "";
        } else buf += ch;
    }
    return out;
};
const blocks = (css, selector) => {
    const name = new RegExp(String.raw`\.${selector}(?![\w-])`);
    return rules(css).filter((r) => name.test(r.selector)).map((r) => r.body);
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
