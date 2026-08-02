import assert from "node:assert/strict";
import test from "node:test";

import {
    VRCNT_NOTO_FONT_FAMILY,
    buildFontFamilyOptions,
    normalizeManagedFontPreference,
} from "../fontScriptRegistry.js";
import { createManagedFontRuntime } from "../managedFontRuntime.js";

test("VRCNT Noto is the first option and invalid saved preferences use the managed default", () => {
    assert.deepEqual(buildFontFamilyOptions(["Yu Gothic UI", "Arial"]), {
        "VRCNT Noto": "VRCNT Noto (Recommended)",
        "Yu Gothic UI": "Yu Gothic UI",
        Arial: "Arial",
    });
    assert.equal(normalizeManagedFontPreference(), VRCNT_NOTO_FONT_FAMILY);
    assert.equal(normalizeManagedFontPreference(""), VRCNT_NOTO_FONT_FAMILY);
    assert.equal(normalizeManagedFontPreference("Missing font", ["Yu Gothic UI"]), VRCNT_NOTO_FONT_FAMILY);
    assert.equal(normalizeManagedFontPreference("Yu Gothic UI", ["Yu Gothic UI"]), "Yu Gothic UI");
});

test("the managed runtime registers verified asset faces lazily and keeps fallback when FontFace fails", async () => {
    const added = [];
    class FakeFontFace {
        constructor(family, source, descriptors) {
            this.family = family;
            this.source = source;
            this.descriptors = descriptors;
        }

        async load() {
            return this;
        }
    }
    const runtime = createManagedFontRuntime({
        invoke: async (command, args) => {
            assert.equal(command, "resolve_managed_font_assets");
            assert.deepEqual(args, { packIds: ["thai"] });
            return [{ packId: "thai", family: "VRCNT Noto", path: "C:\\fonts\\thai.ttf", weightRange: [100, 900] }];
        },
        convertFileSrc: (path) => `asset:///${path}`,
        document: { fonts: { add: (face) => added.push(face) } },
        FontFace: FakeFontFace,
    });

    assert.equal(await runtime.activatePack("thai"), true);
    assert.equal(await runtime.activatePack("thai"), true);
    assert.equal(added.length, 1);
    assert.equal(added[0].source, "url(asset:///C:\\fonts\\thai.ttf)");
    assert.equal(added[0].descriptors.unicodeRange, "U+0E00-0E7F");

    const unavailable = createManagedFontRuntime({
        invoke: async () => [{ packId: "thai", family: "VRCNT Noto", path: "C:\\fonts\\thai.ttf" }],
        convertFileSrc: (path) => path,
        document: { fonts: { add: () => { throw new Error("FontFace unavailable"); } } },
        FontFace: class { async load() { throw new Error("bad font"); } },
        logger: { warn: () => {} },
    });
    assert.equal(await unavailable.activatePack("thai"), false);
});

test("an unavailable pack can activate from the same runtime after installation", async () => {
    const added = [];
    let installed = false;
    const runtime = createManagedFontRuntime({
        invoke: async () => (installed ? [{ family: "VRCNT Noto", path: "C:\\fonts\\ethiopic.ttf" }] : []),
        convertFileSrc: (path) => path,
        document: { fonts: { add: (face) => added.push(face) } },
        FontFace: class { async load() { return this; } },
    });

    assert.equal(await runtime.activatePack("ethiopic"), false);
    installed = true;
    assert.equal(await runtime.activateAvailablePack({ payload: { packId: "ethiopic" } }), true);
    assert.equal(added.length, 1);
});

test("removing a cached pack removes its registered FontFace from the live document", async () => {
    const added = [];
    const removed = [];
    const runtime = createManagedFontRuntime({
        invoke: async () => [{ packId: "ethiopic", family: "VRCNT Noto", path: "C:\\fonts\\ethiopic.ttf" }],
        convertFileSrc: (path) => path,
        document: {
            fonts: {
                add: (face) => added.push(face),
                delete: (face) => removed.push(face),
            },
        },
        FontFace: class { async load() { return this; } },
    });

    assert.equal(await runtime.activatePack("ethiopic"), true);
    assert.equal(runtime.deactivatePack("ethiopic"), true);
    assert.deepEqual(removed, added);
});
