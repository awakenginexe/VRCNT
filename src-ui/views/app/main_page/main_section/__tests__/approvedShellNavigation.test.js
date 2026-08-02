import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "../../..");
const repoRoot = path.resolve(appRoot, "../../..");
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), "utf8");

test("the approved shell exposes every top-level destination through one route atom", () => {
    const store = read("src-ui", "logics", "store.js");
    const navigation = read(
        "src-ui", "views", "app", "main_page", "main_section",
        "live_weave_navigation", "LiveWeaveNavigation.jsx",
    );

    assert.match(store, /Atom_ExperienceRoute/);
    assert.match(store, /useStore_ExperienceRoute/);
    assert.match(navigation, /useStore_ExperienceRoute/);
    assert.match(navigation, /aria-current=\{isActive \? "page" : undefined\}/);

    for (const route of [
        "live",
        "setup",
        "engines",
        "models",
        "overlay",
        "history",
        "settings",
    ]) {
        assert.match(navigation, new RegExp(`id:\\s*"${route}"`));
    }
});

test("runtime state starts without prototype telemetry, languages, or conversation messages", () => {
    const store = read("src-ui", "logics", "store.js");

    assert.doesNotMatch(store, /PREVIEW_RESOURCE_USAGE/);
    assert.doesNotMatch(store, /PREVIEW_MESSAGE_LOGS/);
    assert.doesNotMatch(store, /createPreviewYourLanguagePresetMap/);
    assert.doesNotMatch(store, /createPreviewTargetLanguagePresetMap/);
    assert.doesNotMatch(store, /generateTestConversationData/);
});

test("Vite keeps its cache inside the isolated worktree rather than the shared dependency junction", () => {
    const viteConfig = read("vite.config.js");

    assert.match(viteConfig, /cacheDir:\s*path\.resolve\(__dirname,\s*"\.vite-cache"\)/);
});

test("closing legacy settings returns the approved shell to the Live route", () => {
    const configPage = read("src-ui", "views", "app", "config_page", "ConfigPage.jsx");
    const topbar = read("src-ui", "views", "app", "config_page", "topbar", "Topbar.jsx");

    assert.match(configPage, /const closeConfigPage = [\s\S]*?setIsOpenedConfigPage\(false\);[\s\S]*?updateExperienceRoute\("live"\);/);
    assert.match(configPage, /<Topbar[\s\S]*?onClose=\{closeConfigPage\}/);
    assert.match(topbar, /export const Topbar = \(\{ searchQuery, setSearchQuery, onClose \}\)/);
    assert.match(topbar, /onClick=\{onClose\}/);
});
