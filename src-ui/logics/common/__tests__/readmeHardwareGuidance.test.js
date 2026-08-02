import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const readReadme = () => readFileSync(new URL("../../../../README.md", import.meta.url), "utf8");

test("README gives normal users accurate CPU, GPU, model, and cloud guidance", () => {
    const readme = readReadme();

    assert.match(
        readme,
        /VRCNT works on CPU-only systems, but an NVIDIA GPU provides the best real-time performance\./,
    );
    assert.match(readme, /local AI runtime dependencies/i);
    assert.match(readme, /application package is large/i);
    assert.match(readme, /Speech models may require additional downloads/i);
    assert.match(readme, /Larger models require more RAM or VRAM/i);
    assert.match(readme, /CPU-only mode is supported but may have higher latency/i);
    assert.match(readme, /Cloud engines can help weaker computers but require internet access/i);
});
