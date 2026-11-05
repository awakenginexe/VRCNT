import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const readSource = (relativePath) => readFileSync(path.resolve(import.meta.dirname, relativePath), "utf8");
const nav = readSource("../live_weave_navigation/LiveWeaveNavigation.jsx");
const styles = readSource("../live_weave_navigation/LiveWeaveNavigation.module.scss");
const app = readSource("../../../App.jsx");
// Top-level rules only (grouped selectors share one rule, so a selector may match several blocks).
const rule = (selector) => [...styles.matchAll(new RegExp("\\n" + selector.replace(".", "\\.") + "\\s*(?:,[^{]*)?\\{([\\s\\S]*?)\\n\\}", "g"))].map((m) => m[1]).join("\n");
const remValue = (block, prop) => Number(block.match(new RegExp("(?:^|[\\s;])" + prop + ":\\s*([\\d.]+)rem"))?.[1]);

test("nav is a pill capsule that scrolls instead of clipping", () => {
    const block = rule(".navigation");
    assert.match(block, /border-radius:\s*(999px|var\(--lg_radius_pill\))/);
    assert.match(block, /overflow-x:\s*auto/);
    assert.match(block, /@include liquid_glass\(control/);
});

test("refraction degrades to plain blur", () => {
    const decls = [...rule(".navigation").matchAll(/(?<!-webkit-)backdrop-filter:\s*([^;]+);/g)].map((m) => m[1]);
    const plain = decls.findIndex((v) => !v.includes("url("));
    const refract = decls.findIndex((v) => v.includes("url(#lg-refract)"));
    assert.ok(plain !== -1 && refract !== -1 && plain < refract);
});

test("tabs are text-only and readable", () => {
    assert.doesNotMatch(nav, /navigation_icon/);
    assert.doesNotMatch(styles, /navigation_icon/);
    const block = rule(".navigation_item");
    assert.ok(remValue(block, "font-size") >= 1);
    assert.match(block, /border-radius:\s*(999px|var\(--lg_radius_pill\))/);
    assert.match(block, /color:\s*var\(--dark_(200|150|100)_color\)/);
    assert.doesNotMatch(block, /color:\s*var\(--dark_400_color\)/);
});

test("update and health pills are readable capsules", () => {
    for (const selector of [".update_button", ".session_health"]) {
        const block = rule(selector);
        assert.match(block, /border-radius:\s*999px/);
        assert.ok(remValue(block, "font-size") >= 1);
    }
    assert.ok(remValue(rule(".runtime_badge"), "font-size") >= 0.85);
});

test("App renders the lg-refract filter once", () => {
    assert.equal(app.match(/id="lg-refract"/g)?.length, 1);
});
