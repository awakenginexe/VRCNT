import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const readRequiredSource = (path) => {
    const sourceUrl = new URL(path, import.meta.url);
    assert.ok(existsSync(fileURLToPath(sourceUrl)), `${path} must exist`);
    return readFileSync(sourceUrl, "utf8");
};

const selectSourcePath = "../../../../common_components/custom_select/CustomModernSelect.jsx";
const stylesSourcePath = "../../../../common_components/custom_select/CustomModernSelect.module.scss";
const helperSourcePath = "../../../../common_components/floating_panel/useFloatingPanelPosition.js";

test("CustomModernSelect uses one shared common-components floating panel helper", async () => {
    const select = readRequiredSource(selectSourcePath);
    const helperUrl = new URL(helperSourcePath, import.meta.url);
    const legacyHelperUrl = new URL("../floating_panel/useFloatingPanelPosition.js", import.meta.url);

    assert.ok(existsSync(fileURLToPath(helperUrl)), "shared floating panel helper must exist");
    assert.equal(existsSync(fileURLToPath(legacyHelperUrl)), false, "legacy helper path must be removed");
    assert.match(select, /from\s+"\.\.\/floating_panel\/useFloatingPanelPosition\.js"/);
    assert.doesNotMatch(select, /main_page\/main_section\/floating_panel\/useFloatingPanelPosition/);

    const { calculateFloatingPanelPosition } = await import(helperUrl);
    assert.equal(typeof calculateFloatingPanelPosition, "function");
});

test("CustomModernSelect portals the open listbox with fixed geometry and cleans up position listeners", () => {
    const select = readRequiredSource(selectSourcePath);
    const helper = readRequiredSource(helperSourcePath);
    const styles = readRequiredSource(stylesSourcePath);

    assert.match(select, /const\s+listbox\s*=\s*isOpen\s*\?/);
    assert.match(select, /createPortal\(listbox,\s*document\.body\)/);
    assert.match(select, /style=\{floatingPanelStyle\}/);
    assert.match(styles, /\.dropdown_panel\s*\{[\s\S]*?position:\s*fixed;/);
    assert.match(helper, /const\s+anchorRect\s*=\s*anchorElement\.getBoundingClientRect\(\)/);
    assert.match(helper, /setPosition\(nextPosition\);[\s\S]*setPlacement\(nextPosition\.placement\)/);
    assert.match(helper, /window\.addEventListener\("resize",\s*updatePosition\)/);
    assert.match(helper, /window\.removeEventListener\("resize",\s*updatePosition\)/);
    assert.match(helper, /window\.addEventListener\("scroll",\s*updatePosition,\s*true\)/);
    assert.match(helper, /window\.removeEventListener\("scroll",\s*updatePosition,\s*true\)/);
});

test("CustomModernSelect keeps portaled outside-click and focus-return behavior", () => {
    const select = readRequiredSource(selectSourcePath);
    const styles = readRequiredSource(stylesSourcePath);

    assert.match(
        select,
        /const\s+isInsideContainer\s*=\s*containerRef\.current\?\.contains\(event\.target\);[\s\S]*const\s+isInsideListbox\s*=\s*listboxRef\.current\?\.contains\(event\.target\);[\s\S]*if\s*\(!isInsideContainer\s*&&\s*!isInsideListbox\)\s*\{[\s\S]*setIsOpen\(false\)/,
    );
    assert.match(select, /document\.addEventListener\("mousedown",\s*handleMousedown\)/);
    assert.match(select, /document\.removeEventListener\("mousedown",\s*handleMousedown\)/);
    assert.match(
        select,
        /const\s+handleSelect\s*=\s*\(option\)\s*=>\s*\{[\s\S]*?setIsOpen\(false\);[\s\S]*?triggerRef\.current\.focus\(\);/,
    );
    assert.match(
        select,
        /case\s+"Escape":[\s\S]*?setIsOpen\(false\);[\s\S]*?triggerRef\.current\?\.focus\(\);/,
    );
    assert.doesNotMatch(styles, /&\.is_open\s*\{[\s\S]*?z-index\s*:/);
});

test("CustomModernSelect preserves its listbox accessibility and keyboard contract", () => {
    const select = readRequiredSource(selectSourcePath);

    for (const role of [/role="listbox"/, /role="option"/]) {
        assert.match(select, role);
    }
    for (const attribute of [
        "aria-haspopup",
        "aria-expanded",
        "aria-controls",
        "aria-activedescendant",
        "aria-selected",
        "aria-disabled",
    ]) {
        assert.match(select, new RegExp(attribute));
    }
    for (const key of ["Enter", " ", "ArrowDown", "ArrowUp", "Escape", "Tab"]) {
        assert.match(select, new RegExp(`case\\s+"${key}"`));
    }
    assert.match(select, /setFocusedIndex\(\(prev\)\s*=>/);
    assert.match(select, /optionRefs\.current\[focusedIndex\]\.scrollIntoView/);
});
