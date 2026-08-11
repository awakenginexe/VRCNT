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

test("the compact overlay shell keeps preview and settings side by side before the narrow breakpoint", () => {
    const navigation = readSource("../live_weave_navigation/LiveWeaveNavigation.module.scss");
    const studio = readSource("../../overlay_studio/OverlayStudio.module.scss");

    assert.match(navigation, /@media \(max-width: 80rem\)/);
    assert.match(studio, /@media \(max-width: 80rem\)/);
    assert.match(studio, /\.studio_grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1\.1fr\) minmax\(30rem, 0\.9fr\)/);
    assert.match(studio, /@media \(max-width: 64rem\)[\s\S]*?\.studio_grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});
