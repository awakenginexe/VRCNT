import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const views = fileURLToPath(new URL("../../../views/", import.meta.url));
// Out of scope per the Liquid Glass + readability spec: VR/desktop overlay, modals, snackbar, title bar, logo,
// blocking-operation overlay, color-reset gate, confirmations.
const outOfScope = /(^|\/)(desktop_overlay|others\/(modal_controller|snackbar_controller|window_title_bar|blocking_operation_overlay|color_reset_migration_gate)|sidebar_section\/logo)\/|Confirmation\.module\.scss$/;
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith(".module.scss") ? [path.relative(views, full).replaceAll("\\", "/")] : [];
});
const files = walk(views).filter((f) => !outOfScope.test(f));

// Exceptions: {file (relative to src-ui/views), selector (as written, whitespace collapsed), reason}.
const allowed = [
    // Dark text on a bright accent fill: contrast is against the accent, not the surface.
    ...[
        ["app/main_page/engines/EnginesWorkspace.module.scss", ".advanced_button"],
        ["app/main_page/guided_setup/GuidedSetup.module.scss", `.progress li[data-active="true"] span, .progress li[data-complete="true"] span`],
        ["app/main_page/guided_setup/GuidedSetup.module.scss", ".app_language_check"],
        ["app/main_page/guided_setup/GuidedSetup.module.scss", ".language_picker_check"],
        ["app/main_page/guided_setup/GuidedSetup.module.scss", ".primary_button"],
        ["app/main_page/guided_setup/TranscriptionTranslationStep.module.scss", ".inline_button"],
        ["app/main_page/main_section/live_control_rail/SessionPrimaryAction.module.scss", ".button"],
        ["app/main_page/models/ModelsHub.module.scss", `.preset_card[data-active="true"] .preset_button`],
        ["app/main_page/sidebar_section/language_settings/transcription_engine_label/TranscriptionEngineLabel.module.scss", ".option_button.is_selected"],
    ].map(([file, selector]) => ({ file, selector, reason: "dark text on accent fill" })),
    // Disabled controls are exempt from WCAG text contrast and must read as disabled.
    ...[
        ["app/config_page/setting_section/setting_box/_components/radio_button/RadioButton.module.scss", "&.disabled"],
        ["app/config_page/setting_section/setting_box/_components/_atoms/_dropdown_menu/_DropdownMenu.module.scss", ".dropdown_selected_text, .arrow_left_svg"],
        ["app/config_page/setting_section/setting_box/_components/_atoms/_dropdown_menu/_DropdownMenu.module.scss", ".value_text"],
        ["app/config_page/setting_section/setting_box/_components/_atoms/_entry/_Entry.module.scss", "&.is_disabled"],
        ["app/config_page/setting_section/setting_box/_components/threshold_component/threshold_entry/ThresholdEntry.module.scss", "&.is_disable"],
        ["app/config_page/setting_section/setting_box/_components/threshold_component/volume_check_button/VolumeCheckButton.module.scss", ".button_svg, .button_text"],
        ["app/main_page/engines/EnginesWorkspace.module.scss", ".field select:disabled"],
        ["app/main_page/guided_setup/GuidedSetup.module.scss", ".language_picker_trigger:disabled"],
        ["app/main_page/guided_setup/GuidedSetup.module.scss", ".select:disabled"],
        ["app/main_page/sidebar_section/main_function_switch/MainFunctionSwitch.module.scss", "&.is_disabled"],
    ].map(([file, selector]) => ({ file, selector, reason: "disabled/pending state" })),
    { file: "app/config_page/setting_section/setting_box/vr/Vr.module.scss", selector: "& .adjust_button_triangle_svg", reason: "disabled-state icon" },
    { file: "app/config_page/setting_section/setting_box/vr/Vr.module.scss", selector: "&.is_disabled", reason: "disabled state" },
    { file: "app/config_page/setting_section/setting_box/_components/hotkeys_entry/HotkeysEntry.module.scss", selector: "& .delete_svg", reason: "pending (disabled) icon" },
    { file: "common_components/close_button/CloseButton.module.scss", selector: ".x_mark_svg", reason: "icon glyph shared with modals (out of scope)" },
];

// Every rule (any nesting depth) as {selector, body}; body holds only the rule's own declarations, not nested blocks.
const rules = (css) => {
    const out = [];
    const stack = [];
    let buf = "";
    for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")) {
        if (ch === "{") {
            const top = stack[stack.length - 1];
            if (top) top.body += buf.slice(0, buf.lastIndexOf(";") + 1);
            const rule = { selector: buf.slice(buf.lastIndexOf(";") + 1).trim().replace(/\s+/g, " "), body: "" };
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

const fontSize = new RegExp(String.raw`(?<![-\w])font-size:\s*([\d.]+)(rem|px)`, "g");
const darkText = new RegExp(String.raw`(?<![-\w])color:\s*var\(--dark_(\d+)_color`, "g");

test("every in-scope view has readable type: >= 0.9rem / 13px and no gray darker than --dark_400 for text", () => {
    assert.ok(files.length > 50, `directory walk found only ${files.length} files under ${views}`);
    const bad = [];
    const used = new Set();
    for (const file of files) {
        for (const { selector, body } of rules(readFileSync(path.join(views, file), "utf8"))) {
            const problems = [];
            for (const m of body.matchAll(fontSize)) {
                const n = Number(m[1]);
                if (m[2] === "rem" ? n < 0.9 : n < 13) problems.push(`font-size ${m[1]}${m[2]}`);
            }
            for (const m of body.matchAll(darkText)) {
                if (Number(m[1]) > 400) problems.push(`color --dark_${m[1]}`);
            }
            if (!problems.length) continue;
            const ok = allowed.find((a) => a.file === file && a.selector === selector);
            if (ok) used.add(ok);
            else bad.push(`${file} ${selector}: ${problems.join(", ")}`);
        }
    }
    assert.deepEqual(bad, []);
    assert.deepEqual(allowed.filter((a) => !used.has(a)), [], "stale allowlist entries");
});
