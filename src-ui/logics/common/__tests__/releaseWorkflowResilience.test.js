import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";


const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const workflow = read(".github/workflows/release.yml");
const nsis = read("src-tauri/nsis/template.nsi");
const helper = read("installer-helper/Program.cs");
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const releaseConfig = JSON.parse(read("release.config.json"));


test("release distribution uses GitHub Releases without Hugging Face pipeline dependencies", () => {
    assert.equal(releaseConfig.githubOwner, "awakenginexe");
    assert.equal(releaseConfig.githubRepo, "VRCNT");
    assert.equal(releaseConfig.packagePartCount, 3);
    assert.ok(releaseConfig.maxAssetSizeBytes < 2 * 1024 ** 3);
    assert.doesNotMatch(workflow, /huggingface|HF_TOKEN|hf_hub_download|hf-xet/i);
    assert.doesNotMatch(nsis, /huggingface|Invoke-WebRequest|Expand-Archive/i);
    assert.match(workflow, /gh release upload/);
});


test("updater endpoint moved to GitHub while the existing public key remains unchanged", () => {
    assert.deepEqual(tauriConfig.plugins.updater.endpoints, [
        "https://github.com/awakenginexe/VRCNT/releases/latest/download/latest.json",
    ]);
    assert.equal(
        tauriConfig.plugins.updater.pubkey,
        "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDY4NTYzNUI0QUI2RTI4RkMKUldUOEtHNnJ0RFZXYUt4L1cwOVhIL1NtZXJGQkxzZkVVYXMrWGJZQlZ5NFNPdldRMk9RdUkrVCsK",
    );
    assert.match(helper, new RegExp(tauriConfig.plugins.updater.pubkey));
    assert.equal(tauriConfig.bundle.createUpdaterArtifacts, true);
});


test("thin installer authenticates metadata before hashes and uses bundled 7za", () => {
    assert.match(nsis, /VRCNT\.ReleaseHelper\.exe/);
    assert.match(nsis, /7za\.exe/);
    assert.match(nsis, /minisign\.exe/);
    assert.match(nsis, /\$EXEDIR/);
    assert.match(nsis, /VRCNTInstallerCache/);
    assert.match(helper, /VerifyManifestSignature\(options, manifestPath, signaturePath\)/);
    assert.ok(
        helper.indexOf("VerifyManifestSignature(options, manifestPath, signaturePath)") <
        helper.indexOf("VerifyFileAsync(path, part)"),
        "the manifest signature must be verified before package hashes",
    );
    assert.match(helper, /Task\.WhenAll\(tasks\)/);
    assert.match(helper, /RangeHeaderValue/);
    assert.match(helper, /\[download\].*total/s);
    assert.match(helper, /SHA-256 mismatch/);
});


test("workflow signs and verifies both package and Tauri updater artifacts", () => {
    assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/);
    assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
    assert.doesNotMatch(workflow, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD is required/);
    assert.match(workflow, /tauri signer sign/);
    assert.match(workflow, /minisign.*-Vm/s);
    assert.match(workflow, /Tauri updater signature does not match/);
    assert.match(workflow, /latest\.json has an invalid GitHub updater URL or empty signature/);
    assert.match(workflow, /signed Tauri updater artifact is missing/i);
    assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
    assert.match(workflow, /minisign-0\.12-win64\.zip/);
    assert.match(workflow, /37b600344e20c19314b2e82813db2bfdcc408b77b876f7727889dbd46d539479/);
});


test("workflow fails on missing, oversized, or mismatched release files", () => {
    assert.match(workflow, /files\.Count -ne 3/);
    assert.match(workflow, /Length -ge \[long\]\$env:MAX_ASSET_SIZE/);
    assert.match(workflow, /Get-FileHash .* -Algorithm SHA256/);
    assert.match(workflow, /failed SHA-256 verification/);
    assert.match(workflow, /7zip.* t /is);
    assert.match(workflow, /appears to contain the application payload/);
});


test("installer retains WebView2, upgrade, uninstall, shortcuts, registry, and user-data behavior", () => {
    assert.match(nsis, /Section WebView2/);
    assert.match(nsis, /nsis_tauri_utils::SemverCompare "\$\{VERSION\}"/);
    assert.match(nsis, /Call PreserveLegacyUserData/);
    assert.match(nsis, /Call un\.PreserveLegacyUserData/);
    assert.match(nsis, /CreateDesktopShortcut/);
    assert.match(nsis, /CreateStartMenuShortcut/);
    assert.match(nsis, /WriteRegStr SHCTX "\$\{UNINSTKEY\}" "DisplayVersion"/);
    assert.match(nsis, /WriteUninstaller "\$INSTDIR\\uninstall\.exe"/);
    assert.match(nsis, /\$DeleteAppDataCheckboxState == 1/);
    assert.match(nsis, /RmDir \/r "\$LOCALAPPDATA\\VRCNTData"/);
});


test("every PowerShell release workflow block parses successfully", () => {
    const lines = workflow.split(/\r?\n/);
    const scripts = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (!/^\s{8}run:\s*\|\s*$/.test(lines[index])) continue;
        const block = [];
        for (index += 1; index < lines.length; index += 1) {
            const line = lines[index];
            if (line.trim() && !line.startsWith("          ")) {
                index -= 1;
                break;
            }
            block.push(line.startsWith("          ") ? line.slice(10) : "");
        }
        scripts.push(block.join("\n"));
    }
    const parser = [
        "$source = [Console]::In.ReadToEnd()",
        "$tokens = $null",
        "$errors = $null",
        "[System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors) | Out-Null",
        "if ($errors.Count -gt 0) { $errors | ForEach-Object { [Console]::Error.WriteLine($_) }; exit 1 }",
    ].join("\n");
    for (const [index, script] of scripts.entries()) {
        const result = spawnSync(
            "pwsh",
            ["-NoProfile", "-NonInteractive", "-Command", parser],
            { input: script, encoding: "utf8" },
        );
        assert.equal(result.status, 0, `PowerShell block ${index + 1} failed:\n${result.stderr}`);
    }
});


test("multipart splitter creates exactly three recombinable parts and a complete manifest", () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vrcnt-release-test-"));
    try {
        const script = [
            "import json, pathlib, sys",
            `sys.path.insert(0, ${JSON.stringify(path.join(repoRoot, "utils"))})`,
            "from release import split_exactly, write_manifest",
            `root = pathlib.Path(${JSON.stringify(tempDirectory)})`,
            "archive = root / 'VRCNT_4.2.2.7z'",
            "original = bytes(range(251)) * 4096",
            "archive.write_bytes(original)",
            "parts = split_exactly(archive, 3, 2_000_000_000)",
            "assert len(parts) == 3",
            "assert b''.join(part.read_bytes() for part in parts) == original",
            "manifest = write_manifest('4.2.2', parts, root / 'package-manifest.json')",
            "assert [part['name'] for part in manifest['files']] == ['VRCNT_4.2.2.7z.001', 'VRCNT_4.2.2.7z.002', 'VRCNT_4.2.2.7z.003']",
            "assert all(len(part['sha256']) == 64 for part in manifest['files'])",
        ].join("\n");
        const result = spawnSync("python", ["-c", script], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
    } finally {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
});
