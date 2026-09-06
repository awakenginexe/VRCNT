import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const readReadme = () => readFileSync(new URL("../../../../README.md", import.meta.url), "utf8");

test("README gives normal users accurate CPU, GPU, model, and cloud guidance", () => {
    const readme = readReadme();

    assert.match(
        readme,
        /VRCNT offers a smaller CPU-only runtime and a separate NVIDIA CUDA runtime\./,
    );
    assert.match(readme, /local AI runtime dependencies/i);
    assert.match(readme, /application package is large/i);
    assert.match(readme, /Speech models may require additional downloads/i);
    assert.match(readme, /Larger models require more RAM or VRAM/i);
    assert.match(readme, /CPU-only installs avoid CUDA-specific runtime libraries/i);
    assert.match(readme, /active runtime can be changed later from \*\*Settings → Others → Runtime\*\*/i);
    assert.match(readme, /signed\s+manifest selects the exact number of CPU or CUDA archive parts/i);
    assert.match(readme, /variants do not need the same number of parts/i);
    assert.match(readme, /Cloud engines can help weaker computers but require internet access/i);
});
