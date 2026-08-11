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

test("the compact overlay shell preserves a wide control row before the narrow breakpoint", () => {
    const navigation = readSource("../live_weave_navigation/LiveWeaveNavigation.module.scss");
    const studio = readSource("../../overlay_studio/OverlayStudio.module.scss");

    assert.match(navigation, /@media \(max-width: 80rem\)/);
    assert.match(studio, /@media \(max-width: 80rem\)/);
    assert.match(studio, /\.control_grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(19rem, 0\.85fr\) minmax\(0, 1\.5fr\)/);
    assert.match(studio, /@media \(max-width: 64rem\)[\s\S]*?\.control_grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});
