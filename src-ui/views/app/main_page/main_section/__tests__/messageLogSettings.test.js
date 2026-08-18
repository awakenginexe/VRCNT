import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("message log quick settings keep hover affordance calm and scoped", () => {
    const messageContainer = readSource("../message_container/MessageContainer.jsx");
    const styles = readSource(
        "../message_container/message_log_settings_container/MessageLogSettingsContainer.module.scss",
    );

    assert.match(messageContainer, /onMouseEnter=\{\(\) => setIsHovered\(true\)\}/);
    assert.match(messageContainer, /onMouseLeave=\{\(\) => setIsHovered\(false\)\}/);
    assert.doesNotMatch(messageContainer, /onMouseOver=/);
    assert.doesNotMatch(styles, /0 0 1\.6rem rgba\(56, 189, 248, 0\.35\)/);
    assert.doesNotMatch(styles, /rotate\(60deg\)/);
});

test("message log font-size popover gives its label and slider room to breathe", () => {
    const styles = readSource(
        "../message_container/message_log_settings_container/MessageLogSettingsContainer.module.scss",
    );

    assert.match(styles, /\.settings_card\s*\{[\s\S]*?width:\s*min\(46rem,\s*calc\(100vw - 2rem\)\)/);
    assert.match(styles, /\.card_content\s*\{[\s\S]*?min-width:\s*0/);
    assert.match(styles, /\.card_content\s*\{[\s\S]*?>\s*:global\(\.container\)\s*\{[\s\S]*?>\s*:first-child/);
    assert.match(styles, /flex:\s*0 0 12rem/);
    assert.match(styles, /\.card_content\s*\{[\s\S]*?>\s*:global\(\.container\)\s*\{[\s\S]*?>\s*:last-child/);
    assert.match(styles, /flex:\s*1 1 0/);
});
