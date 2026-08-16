import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const wrapperUrl = new URL("../CTranslate2ComputeDevice.jsx", import.meta.url);

test("CTranslate2 compute-device wrapper maps translation settings into ComputeDevice", () => {
    assert.equal(
        existsSync(wrapperUrl),
        true,
        "CTranslate2ComputeDevice.jsx must provide the shared translation wrapper",
    );

    const source = readFileSync(wrapperUrl, "utf8");
    const translationSettings = source.match(
        /const\s*\{([\s\S]*?)\}\s*=\s*useTranslation\(\);/,
    )?.[1] ?? "";
    const computeDevice = source.match(/<ComputeDevice\b[\s\S]*?\/>/)?.[0] ?? "";

    assert.match(
        source,
        /import\s+\{\s*ComputeDevice\s*\}\s+from\s+["']\.\.\/_components\/compute_device\/ComputeDevice["'];/,
    );
    assert.match(source, /import\s+\{\s*useTranslation\s*\}\s+from\s+["']@logics_configs["'];/);

    for (const setting of [
        "currentSelectableTranslationComputeDeviceList",
        "currentSelectedTranslationComputeDevice",
        "setSelectedTranslationComputeDevice",
        "currentSelectedTranslationComputeType",
        "setSelectedTranslationComputeType",
    ]) {
        assert.match(
            translationSettings,
            new RegExp(`\\b${setting}\\b`),
            `useTranslation must provide ${setting}`,
        );
        assert.match(
            computeDevice,
            new RegExp(`\\b${setting}\\b`),
            `ComputeDevice must receive ${setting}`,
        );
    }

    for (const [prop, setting] of Object.entries({
        currentDeviceList: "currentSelectableTranslationComputeDeviceList",
        currentSelectedDevice: "currentSelectedTranslationComputeDevice",
        setSelectedDevice: "setSelectedTranslationComputeDevice",
        currentSelectedComputeType: "currentSelectedTranslationComputeType",
        setSelectedComputeType: "setSelectedTranslationComputeType",
    })) {
        assert.match(
            computeDevice,
            new RegExp(`${prop}\\s*=\\s*\\{\\s*${setting}\\s*\\}`),
            `ComputeDevice must map ${prop} from ${setting}`,
        );
    }

    assert.match(computeDevice, /dropdownIdPrefix\s*=\s*["']translation["']/);
    assert.match(
        computeDevice,
        /label=\{t\(\s*["']config_page\.translation\.translation_compute_device\.label["']\s*\)\}/,
    );
});
