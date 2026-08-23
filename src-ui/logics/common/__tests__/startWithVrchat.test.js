import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";


const here = path.dirname(fileURLToPath(import.meta.url));
const commonRoot = path.resolve(here, "..");
const moduleUrl = pathToFileURL(path.join(commonRoot, "startWithVrchat.js")).href;

test("Start with VRChat is unavailable in browser preview without loading guest bindings", async () => {
    const { createStartWithVrchatAdapter } = await import(moduleUrl);
    let bindingLoads = 0;
    const adapter = createStartWithVrchatAdapter({
        isTauri: () => false,
        loadBindings: async () => {
            bindingLoads += 1;
            throw new Error("browser preview must not load guest bindings");
        },
    });

    assert.equal(await adapter.getStatus(), false);
    assert.equal(await adapter.enable(), false);
    assert.equal(await adapter.disable(), false);
    assert.equal(bindingLoads, 0);
});

test("Start with VRChat delegates desktop registration status and changes to injected guest bindings", async () => {
    const { createStartWithVrchatAdapter } = await import(moduleUrl);
    let enabled = false;
    const adapter = createStartWithVrchatAdapter({
        isTauri: () => true,
        loadBindings: async () => ({
            isEnabled: async () => enabled,
            enable: async () => {
                enabled = true;
            },
            disable: async () => {
                enabled = false;
            },
        }),
    });

    assert.equal(await adapter.getStatus(), false);
    assert.equal(await adapter.enable(), true);
    assert.equal(await adapter.getStatus(), true);
    assert.equal(await adapter.disable(), false);
    assert.equal(await adapter.getStatus(), false);
});
