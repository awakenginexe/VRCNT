import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the approved shell keeps visible keyboard focus and reduced-motion support", () => {
    const root = readSource("../../../_index_css/root.css");
    const focusRule = root.match(/:where\(button,[\s\S]*?:focus-visible\s*\{([\s\S]*?)\}/)?.[1];

    assert.ok(focusRule);
    assert.match(focusRule, /outline:/);
    assert.match(root, /@media \(prefers-reduced-motion: reduce\)/);
});

test("the compact desktop shell preserves columns before the narrow single-column breakpoint", () => {
    const navigation = readSource("../live_weave_navigation/LiveWeaveNavigation.module.scss");
    const studio = readSource("../../overlay_studio/OverlayStudio.module.scss");

    assert.match(navigation, /@media \(max-width: 80rem\)/);
    assert.match(studio, /@media \(max-width: 80rem\)/);
    assert.match(studio, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(18rem, 21rem\)/);
    assert.match(studio, /@media \(max-width: 64rem\)[\s\S]*?grid-template-columns:\s*1fr/);
});
