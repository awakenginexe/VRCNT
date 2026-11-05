import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../../..");
const readSource = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");
const variables = readSource("src-ui/views/app/_index_css/variables.css");
const getBlock = (selector) => variables.slice(variables.indexOf(selector + " {"), variables.indexOf("\n}", variables.indexOf(selector + " {")));
const getToken = (block, name) => block.match(new RegExp(name + String.raw`:\s*([^;]+);`))?.[1];

test("glass tokens derive from the palette", () => {
    const rootBlock = getBlock(":root");
    for (const name of ["--lg_tint", "--lg_tint_dense", "--lg_tint_popover"]) {
        const value = getToken(rootBlock, name);
        assert.match(value, /var\(--palette_surface_[123]_color\)/);
        assert.doesNotMatch(value, /rgba?\(\s*\d+,\s*\d+,\s*\d+/);
    }
});

test("performance mode flattens every glass token", () => {
    const perf = getBlock(".performance_mode");
    for (const name of ["--lg_blur", "--lg_sheen", "--lg_edge_shadow"]) {
        assert.equal(getToken(perf, name).trim(), "none");
    }
    for (const name of ["--lg_tint", "--lg_tint_dense", "--lg_tint_popover"]) {
        assert.doesNotMatch(getToken(perf, name), /transparent/);
    }
});

test("liquid_glass mixin exists with levels and optional outer shadow", () => {
    const mixins = readSource("src-ui/views/common_css/mixins.scss");
    assert.match(mixins, /@mixin liquid_glass\(\$level:\s*panel,\s*\$outer_shadow:\s*true\)/);
    assert.match(mixins, /\$level == popover/);
    for (const needle of ["var(--lg_blur)", "var(--lg_sheen)", "-webkit-backdrop-filter"]) {
        assert.ok(mixins.includes(needle), needle);
    }
});
