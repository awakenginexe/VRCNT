import assert from "node:assert/strict";
import test from "node:test";

import { FONT_DOWNLOAD_POLICY } from "../fontPackDownloads.js";

import {
    applyFontPackProgress,
    createFontPackManagementState,
    formatFontBytes,
    getRequiredOptionalPackIds,
    normalizeFontDownloadPolicy,
    removeOptionalFontPack,
    requestRequiredOptionalFontPack,
} from "../fontPackManagement.js";

test("font download policy defaults safely and persists approved values", () => {
    assert.equal(normalizeFontDownloadPolicy(), FONT_DOWNLOAD_POLICY.ASK);
    assert.equal(normalizeFontDownloadPolicy("never"), FONT_DOWNLOAD_POLICY.NEVER);
    assert.equal(normalizeFontDownloadPolicy("invalid"), FONT_DOWNLOAD_POLICY.ASK);
});

test("only language-required optional packs are eligible for Ask or Automatic download", () => {
    assert.deepEqual(getRequiredOptionalPackIds([{ language: "Amharic" }, { language: "Thai" }]), ["ethiopic"]);
    assert.deepEqual(getRequiredOptionalPackIds([{ language: "English" }]), []);
});

test("management state presents optional packs, honest fallback, and verified cache size", () => {
    const state = createFontPackManagementState({
        totalBytes: 4096,
        packs: [
            { id: "ethiopic", displayName: "Noto Sans Ethiopic", scripts: ["Ethi"], packVersion: "1.0.0", sizeBytes: 1024, installed: false },
            { id: "urdu", displayName: "Noto Nastaliq Urdu", scripts: ["Arab"], packVersion: "1.0.0", sizeBytes: 3072, installed: true },
        ],
    }, { managedFamilySelected: true });

    assert.equal(state.totalSizeLabel, "4.0 KB");
    assert.equal(state.packs[0].writingSystems, "Ethiopic");
    assert.equal(state.packs[0].activationStatus, "System fallback");
    assert.equal(state.packs[1].activationStatus, "Ready for managed activation");
    assert.equal(formatFontBytes(1_572_864), "1.5 MB");
});

test("an installed pack is not reported active when the user selected a system family", () => {
    const state = createFontPackManagementState({
        totalBytes: 10,
        packs: [{ id: "ethiopic", scripts: ["Ethi"], installed: true, sizeBytes: 10 }],
    }, { managedFamilySelected: false });

    assert.equal(state.packs[0].activationStatus, "System font selected");
});

test("progress and failure keep fallback visible and allow retry", () => {
    const downloading = applyFontPackProgress({}, {
        packId: "ethiopic", state: "downloading", receivedBytes: 40, totalBytes: 100,
    });
    assert.deepEqual(downloading.ethiopic, { state: "downloading", receivedBytes: 40, totalBytes: 100, error: null });

    const failed = applyFontPackProgress(downloading, {
        packId: "ethiopic", state: "failed", receivedBytes: 0, totalBytes: 100, error: "offline",
    });
    assert.equal(failed.ethiopic.state, "failed");
    assert.equal(failed.ethiopic.error, "offline");
});

test("removing an optional pack refreshes the authoritative cache catalog", async () => {
    const calls = [];
    const catalog = await removeOptionalFontPack(async (command, args) => {
        calls.push([command, args]);
        return { totalBytes: 0, packs: [] };
    }, "ethiopic");

    assert.deepEqual(calls, [["remove_optional_font_pack", { packId: "ethiopic" }]]);
    assert.deepEqual(catalog, { totalBytes: 0, packs: [] });
});

test("Ask prompts only when Rust reports that the required pack is missing", async () => {
    const prompts = [];
    const installed = await requestRequiredOptionalFontPack(
        async () => ({ action: "available", result: { installed: true } }),
        "ethiopic",
        FONT_DOWNLOAD_POLICY.ASK,
        (packId) => prompts.push(packId),
    );
    assert.equal(installed.action, "available");
    assert.deepEqual(prompts, []);

    const missing = await requestRequiredOptionalFontPack(
        async () => ({ action: "ask", result: null }),
        "ethiopic",
        FONT_DOWNLOAD_POLICY.ASK,
        (packId) => prompts.push(packId),
    );
    assert.equal(missing.action, "ask");
    assert.deepEqual(prompts, ["ethiopic"]);
});
