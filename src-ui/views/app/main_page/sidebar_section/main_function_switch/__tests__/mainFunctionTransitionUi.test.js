import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../../../../../..");
const readSource = (relativePath) => (
    fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
);

const switchPath = (
    "src-ui/views/app/main_page/sidebar_section/main_function_switch/"
    + "MainFunctionSwitch.jsx"
);
const stylesPath = (
    "src-ui/views/app/main_page/sidebar_section/main_function_switch/"
    + "MainFunctionSwitch.module.scss"
);

test("the initiating switch exposes a direction-aware transition state", () => {
    const source = readSource(switchPath);

    assert.match(source, /data-transition=\{transition\}/);
    assert.match(
        source,
        /currentState\.state\s*===\s*["']pending["'][\s\S]*?currentState\.data\s*===\s*true[\s\S]*?["']stopping["'][\s\S]*?["']starting["']/,
    );
    assert.match(
        source,
        /getMainFunctionPendingCopyKey\([\s\S]*?switch_id,[\s\S]*?pending_elapsed_ms,[\s\S]*?currentState\.data\s*===\s*true/,
    );
    assert.match(
        source,
        /aria-disabled=\{currentState\.state\s*===\s*["']pending["']\}/,
    );
    assert.match(
        source,
        /disabled=\{isDisabled\s*\|\|\s*currentState\.state\s*===\s*["']pending["']\}/,
    );
});

test("pending switches use a soft blink instead of a rotating loader", () => {
    const source = readSource(switchPath);
    const styles = readSource(stylesPath);

    assert.match(source, /styles\.state_mark/);
    assert.doesNotMatch(source, /styles\.loader/);
    assert.match(
        styles,
        /&\[data-transition=["']starting["']\][\s\S]*?animation:\s*[\w-]+\s+[\w.-]+\s+ease-in-out\s+infinite/,
    );
    assert.match(styles, /\.state_mark[\s\S]*?&\.is_pending[\s\S]*?animation:\s*[\w-]+\s+[\w.-]+\s+ease-in-out\s+infinite/);
    assert.match(styles, /@keyframes\s+main_function_switch_pending_breathe[\s\S]*?border-color[\s\S]*?background/);
    assert.match(styles, /@keyframes\s+main_function_switch_pending_blink[\s\S]*?opacity[\s\S]*?box-shadow/);
    assert.match(
        styles,
        /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation:\s*none/,
    );
});
