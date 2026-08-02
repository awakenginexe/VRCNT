import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
    LOCAL_FLAG_COUNTRY_CODES,
    resolveFlagCountryCode,
} from "../../sidebar_section/language_settings/languageDisplayUtils.js";

const workspaceRoot = process.cwd();
const languageMetadataPath = path.join(
    workspaceRoot,
    "src-python",
    "models",
    "transcription",
    "transcription_languages.py",
);
const packageFlagDirectory = path.join(
    workspaceRoot,
    "node_modules",
    "flag-icons",
    "flags",
    "4x3",
);
const localFlagDirectory = path.join(
    workspaceRoot,
    "src-ui",
    "views",
    "assets",
    "flags",
    "4x3",
);

const selectableEntries = JSON.parse(execFileSync(
    "python",
    ["-c", String.raw`
import ast
import json
import sys

source_path = sys.argv[1]
tree = ast.parse(open(source_path, encoding="utf-8").read())
assignment = next(
    node for node in tree.body
    if isinstance(node, ast.Assign)
    and any(isinstance(target, ast.Name) and target.id == "transcription_lang" for target in node.targets)
)
metadata = ast.literal_eval(assignment.value)
entries = [
    {"language": language, "country": country}
    for language, countries in metadata.items()
    for country in countries
]
print(json.dumps(entries))
`, languageMetadataPath],
    { encoding: "utf8" },
));

const representativeCases = [
    [{ language: "Catalan", country: "Spain" }, "es"],
    [{ language: "Arabic", country: "Egypt" }, "eg"],
    [{ language: "Arabic", country: "Israel" }, "il"],
    [{ language: "Tamil", country: "India" }, "in"],
    [{ language: "Tamil", country: "Sri Lanka" }, "lk"],
    [{ language: "Chinese Simplified", country: "China" }, "cn"],
    [{ language: "Chinese Simplified", country: "Hong Kong" }, "hk"],
    [{ language: "Chinese Traditional", country: "Taiwan" }, "tw"],
    [{ language: "Portuguese", country: "Brazil" }, "br"],
    [{ language: "Portuguese", country: "Portugal" }, "pt"],
    [{ language: "Serbian", country: "Serbia" }, "rs"],
    [{ language: "Sinhala", country: "Sri Lanka" }, "lk"],
];

test("every selectable language-country entry resolves to a usable local flag or an explicit fallback", () => {
    assert.ok(selectableEntries.length > 0, "the selectable language dataset must not be empty");

    const unresolved = [];
    const conflictingCountryMappings = new Map();

    for (const entry of selectableEntries) {
        const resolution = resolveFlagCountryCode(entry);
        const countryKey = entry.country.trim().toLowerCase();

        if (!conflictingCountryMappings.has(countryKey)) {
            conflictingCountryMappings.set(countryKey, new Set());
        }
        conflictingCountryMappings.get(countryKey).add(resolution.countryCode || "fallback");

        if (resolution.kind === "fallback") {
            unresolved.push(entry);
            continue;
        }

        const packageAsset = path.join(packageFlagDirectory, `${resolution.countryCode}.svg`);
        assert.ok(
            existsSync(packageAsset),
            `${entry.language} (${entry.country}) resolved to a missing package flag: ${resolution.countryCode}`,
        );

        if (LOCAL_FLAG_COUNTRY_CODES.has(resolution.countryCode)) {
            const localAsset = path.join(localFlagDirectory, `${resolution.countryCode}.svg`);
            assert.ok(
                existsSync(localAsset),
                `${entry.language} (${entry.country}) requires a worktree-local flag asset: ${resolution.countryCode}`,
            );
        } else {
            assert.ok(
                statSync(packageAsset).size <= 4096,
                `${entry.language} (${entry.country}) would use a blocked shared-node_modules URL without a local asset: ${resolution.countryCode}`,
            );
        }
    }

    assert.deepEqual(unresolved, [], "all current selectable entries have country-specific flags");
    assert.deepEqual(
        [...conflictingCountryMappings.entries()].filter(([, codes]) => codes.size > 1),
        [],
        "a country must not resolve to conflicting flag codes",
    );
});

test("representative language-country variants retain their distinct country flags", () => {
    for (const [entry, expectedCountryCode] of representativeCases) {
        assert.deepEqual(resolveFlagCountryCode(entry), {
            kind: "flag",
            countryCode: expectedCountryCode,
        });
    }
});

test("country aliases normalize before flag resolution", () => {
    assert.deepEqual(resolveFlagCountryCode({ country: "Côte d’Ivoire" }), {
        kind: "flag",
        countryCode: "ci",
    });
    assert.deepEqual(resolveFlagCountryCode({ country: "UAE" }), {
        kind: "flag",
        countryCode: "ae",
    });
    assert.deepEqual(resolveFlagCountryCode({ country: "Macao" }), {
        kind: "flag",
        countryCode: "mo",
    });
});
