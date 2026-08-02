import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { FONT_PACK_DELIVERY, FONT_PACKS } from "../fontScriptRegistry.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const manifestPath = resolve(repositoryRoot, "src-python/models/overlay/fonts/font-packs.v1.json");

const readManifest = () => JSON.parse(readFileSync(manifestPath, "utf8"));

test("bundled Noto assets are present, licensed, and match their manifest integrity facts", () => {
    const manifest = readManifest();
    assert.equal(manifest.schemaVersion, 1);

    const bundledPackIds = Object.values(FONT_PACKS)
        .filter((pack) => pack.delivery === FONT_PACK_DELIVERY.BUNDLED)
        .map((pack) => pack.id)
        .sort();
    assert.deepEqual(Object.keys(manifest.packs).filter((packId) => manifest.packs[packId].bundled).sort(), bundledPackIds);

    for (const packId of bundledPackIds) {
        const pack = manifest.packs[packId];
        assert.equal(pack.licenseSpdx, "OFL-1.1");
        assert.ok(pack.files.some((file) => file.relativePath === "OFL.txt"));
        for (const file of pack.files) {
            const assetPath = resolve(repositoryRoot, "src-python/models/overlay/fonts", packId, file.relativePath);
            assert.ok(existsSync(assetPath), `${packId}/${file.relativePath} is present`);
            const contents = readFileSync(assetPath);
            assert.equal(contents.length, file.expectedBytes, `${packId}/${file.relativePath} byte size`);
            assert.equal(createHash("sha256").update(contents).digest("hex"), file.sha256, `${packId}/${file.relativePath} SHA-256`);
        }
    }
});

test("every script profile that resolves to a bundled pack has a matching bundled manifest entry", () => {
    const manifest = readManifest();
    for (const pack of Object.values(FONT_PACKS).filter((item) => item.delivery === FONT_PACK_DELIVERY.BUNDLED)) {
        assert.equal(manifest.packs[pack.id].bundled, true, `${pack.id} is packaged`);
        assert.deepEqual(manifest.packs[pack.id].scripts, pack.scripts, `${pack.id} script coverage`);
    }
});
