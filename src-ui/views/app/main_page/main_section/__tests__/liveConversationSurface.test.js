import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("the chat panel keeps its glass shadow inside the workspace column", () => {
    const styles = readSource("../MainSection.module.scss");
    const chatPanel = styles.match(/\.chat_panel\s*\{([\s\S]*?)\n\}/)?.[1];

    assert.ok(chatPanel, "chat panel styles should be present");
    assert.match(chatPanel, /@include liquid_glass\(panel,\s*\$outer_shadow:\s*false\)/);
    assert.doesNotMatch(chatPanel, /0\s+1\.4rem\s+4rem\s+rgba\(0,\s*0,\s*0,\s*0\.35\)/);
});
