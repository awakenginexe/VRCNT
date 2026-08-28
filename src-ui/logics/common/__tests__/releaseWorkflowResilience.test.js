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
const manifestLoader = read("installer-helper/VRCNT.RuntimeCore/Manifest/ManifestLoader.cs");
const minisignVerifier = read("installer-helper/VRCNT.RuntimeCore/Security/MinisignVerifier.cs");
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const releaseConfig = JSON.parse(read("release.config.json"));


test("release distribution uses GitHub Releases without Hugging Face pipeline dependencies", () => {
    assert.equal(releaseConfig.githubOwner, "awakenginexe");
    assert.equal(releaseConfig.githubRepo, "VRCNT");
    assert.equal(Object.hasOwn(releaseConfig, "packagePartCount"), false);
    assert.equal(releaseConfig.packageNamePattern, "VRCNT_${version}_${variant}.7z");
    assert.equal(releaseConfig.installerNamePattern, "VRCNT_${version}_Setup.exe");
    assert.ok(releaseConfig.maxAssetSizeBytes < 2 * 1024 ** 3);
    assert.doesNotMatch(workflow, /huggingface|HF_TOKEN|hf_hub_download|hf-xet/i);
    assert.doesNotMatch(nsis, /huggingface|Invoke-WebRequest|Expand-Archive/i);
    assert.match(workflow, /gh release upload/);
});

test("workflow places the installer first while keeping its public display name", () => {
    const installerUpload = workflow.indexOf(
        "gh release upload $env:RELEASE_TAG --repo $env:RELEASE_REPOSITORY --clobber $installerUpload",
    );
    const signatureUpload = workflow.indexOf(
        "gh release upload $env:RELEASE_TAG --repo $env:RELEASE_REPOSITORY --clobber $installerSignatureUpload",
    );
    const supportingUpload = workflow.indexOf(
        "gh release upload $env:RELEASE_TAG --repo $env:RELEASE_REPOSITORY --clobber $supportingAssets",
    );

    assert.match(workflow, /\$installerReleaseAssetName = "00_\$installerName"/);
    assert.match(workflow, /INSTALLER_RELEASE_ASSET_NAME=\$installerReleaseAssetName/);
    assert.match(workflow, /--updater-name \$env:INSTALLER_RELEASE_ASSET_NAME/);
    assert.match(workflow, /\$installerAsset = Join-Path \$env:ASSET_DIR \$env:INSTALLER_RELEASE_ASSET_NAME/);
    assert.match(workflow, /\$installerUpload = "\$installerAsset#\$env:INSTALLER_NAME"/);
    assert.match(workflow, /\$installerSignatureUpload = "\$installerSignatureAsset#\$env:INSTALLER_NAME\.sig"/);
    assert.match(workflow, /\$supportingAssets = @\(/);
    assert.match(workflow, /Sort-Object Name/);
    assert.ok(installerUpload >= 0, "installer upload must be present");
    assert.ok(signatureUpload > installerUpload, "signature must upload after installer");
    assert.ok(supportingUpload > signatureUpload, "supporting assets must upload last");
    assert.match(workflow, /The installer is not the first release asset/);
    assert.match(workflow, /The installer display label is incorrect/);
});


test("updater endpoint moved to GitHub while the existing public key remains unchanged", () => {
    assert.deepEqual(tauriConfig.plugins.updater.endpoints, [
        "https://github.com/awakenginexe/VRCNT/releases/latest/download/latest.json",
    ]);
    assert.equal(
        tauriConfig.plugins.updater.pubkey,
        "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDY4NTYzNUI0QUI2RTI4RkMKUldUOEtHNnJ0RFZXYUt4L1cwOVhIL1NtZXJGQkxzZkVVYXMrWGJZQlZ5NFNPdldRMk9RdUkrVCsK",
    );
    assert.match(minisignVerifier, new RegExp(tauriConfig.plugins.updater.pubkey));
    assert.equal(tauriConfig.bundle.createUpdaterArtifacts, true);
});


test("release helper uses the shared signed manifest loader before selecting variable parts", () => {
    assert.match(nsis, /VRCNT\.ReleaseHelper\.exe/);
    assert.match(nsis, /7za\.exe/);
    assert.match(nsis, /minisign\.exe/);
    assert.match(nsis, /\$EXEDIR/);
    assert.match(nsis, /VRCNTInstallerCache/);
    assert.match(helper, /new ManifestLoader\(new MinisignVerifier\(options\.MinisignPath\)\)\.LoadAndVerifyAsync/);
    assert.ok(
        helper.indexOf("LoadAndVerifyAsync") < helper.indexOf("verified.Manifest.Variants"),
        "the manifest signature must be verified before selecting a package",
    );
    assert.match(helper, /package\.Parts\.All\(part => File\.Exists/);
    assert.match(helper, /new RuntimeTransactionEngine\(/);
    assert.doesNotMatch(helper, /ExtractToDirectory|Directory\.Delete\(options\.Destination/);
    assert.match(manifestLoader, /manifest\.Schema != 2/);
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


test("workflow bootstraps x64 7-Zip from pinned official archives", () => {
    assert.doesNotMatch(workflow, /choco install 7zip\.commandline/i);
    assert.match(workflow, /github\.com\/ip7z\/7zip\/releases\/download\/26\.02\/7zr\.exe/);
    assert.match(workflow, /github\.com\/ip7z\/7zip\/releases\/download\/26\.02\/7z2602-extra\.7z/);
    assert.match(workflow, /56b8cc9f4971cef253644fafe54063ed7fdca551d4dee0f8c6baa81b855acd72/);
    assert.match(workflow, /081df9e9311dfd9c9e0e98c1c80180b99bb51e4cb24156b5f3057fe3c259d70a/);
    assert.match(workflow, /x64[\\/]7za\.exe/);
    assert.match(workflow, /Get-FileHash .* -Algorithm SHA256/);
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


test("variant multipart splitter creates variable parts and a schema-two combined manifest", () => {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vrcnt-release-test-"));
    try {
        const script = [
            "import json, pathlib, sys",
            `sys.path.insert(0, ${JSON.stringify(path.join(repoRoot, "utils"))})`,
            "from release import split_to_asset_limit, write_combined_manifest",
            `root = pathlib.Path(${JSON.stringify(tempDirectory)})`,
            "def metadata(directory, variant, parts):",
            "  entries = [{'name': part.name, 'size': part.stat().st_size, 'sha256': __import__('hashlib').sha256(part.read_bytes()).hexdigest()} for part in parts]",
            "  (directory / 'package-metadata.json').write_text(json.dumps({'variant': variant, 'archiveFormat': '7z', 'compressedSize': sum(item['size'] for item in entries), 'installedSize': 42, 'parts': entries, 'requiresNvidia': variant == 'cuda', 'markerPath': 'VRCNT.runtime.json', 'identity': {'product': 'VRCNT', 'version': '4.2.2', 'variant': variant.title(), 'architecture': 'x64', 'buildIdentity': variant + '-fixture', 'markerSha256': 'a' * 64}}))",
            "cpu = root / 'cpu'; cuda = root / 'cuda'; cpu.mkdir(); cuda.mkdir()",
            "cpu_archive = cpu / 'VRCNT_4.2.2_CPU.7z'; cuda_archive = cuda / 'VRCNT_4.2.2_CUDA.7z'",
            "cpu_archive.write_bytes(b'cpu'); cuda_archive.write_bytes(b'cuda-payload')",
            "cpu_parts = split_to_asset_limit(cpu_archive, 4); cuda_parts = split_to_asset_limit(cuda_archive, 5)",
            "assert len(cpu_parts) == 1; assert len(cuda_parts) == 3",
            "metadata(cpu, 'cpu', cpu_parts); metadata(cuda, 'cuda', cuda_parts)",
            "setup = root / 'VRCNT_4.2.2_Setup.exe'; setup.write_bytes(b'setup')",
            "manifest = write_combined_manifest('4.2.2', cpu, cuda, setup, root / 'package-manifest.json')",
            "assert manifest['schema'] == 2",
            "assert manifest['bootstrapper']['name'] == 'VRCNT_4.2.2_Setup.exe'",
            "assert len(manifest['variants']['cpu']['parts']) == 1",
            "assert len(manifest['variants']['cuda']['parts']) == 3",
        ].join("\n");
        const result = spawnSync("python", ["-c", script], { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
    } finally {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
});
