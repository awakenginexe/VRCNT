import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";


const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const workflow = read(".github/workflows/release.yml");
const candidateWorkflow = read(".github/workflows/test-candidate.yml");
const setupPublishValidator = read("scripts/validate_setup_publish.ps1");
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

test("release workflow builds one shared shell, packages CPU and CUDA independently, then publishes one WPF setup", () => {
    assert.match(workflow, /^  shared-shell:/m);
    assert.match(workflow, /^  backend-cpu:/m);
    assert.match(workflow, /^  backend-cuda:/m);
    assert.match(workflow, /^  package-and-publish:/m);
    assert.match(workflow, /needs:\s*\[validate, installer-tools, shared-shell, backend-cpu, backend-cuda\]/);
    assert.match(workflow, /npm run build-runtime-shell/);
    assert.match(workflow, /npm run build-backend:cpu/);
    assert.match(workflow, /npm run build-backend:cuda/);
    assert.match(workflow, /release\.py package[\s\S]*--variant cpu[\s\S]*--source-dir/);
    assert.match(workflow, /release\.py package[\s\S]*--variant cuda[\s\S]*--source-dir/);
    assert.match(workflow, /release\.py manifest[\s\S]*--cpu-dir[\s\S]*--cuda-dir[\s\S]*--setup/);
    assert.match(workflow, /installerName = \$config\.installerNamePattern\.Replace/);
    assert.match(workflow, /dotnet publish \.\/installer-helper\/VRCNT\.Setup\/VRCNT\.Setup\.csproj/);
    assert.doesNotMatch(workflow, /packagePartCount|exactly three|Create three-part portable package|npm run build-cuda|bundle\/nsis/i);
});

test("test candidate workflow uploads a complete artifact without publishing a release", () => {
    assert.match(candidateWorkflow, /branches:\s*[\s\S]*test\/5\.15\.0-runtime-installer/);
    assert.match(candidateWorkflow, /workflow_dispatch:/);
    assert.match(candidateWorkflow, /shared-shell:[\s\S]*needs: \[validate, backend-cpu\]/);
    assert.match(candidateWorkflow, /Download CPU backend[\s\S]*name: backend-cpu[\s\S]*path: src-tauri\/bin/);
    assert.match(candidateWorkflow, /Upload signed test candidate[\s\S]*actions\/upload-artifact@v4[\s\S]*path: release-assets/);
    assert.doesNotMatch(candidateWorkflow, /gh release (create|edit|upload)/);
    assert.doesNotMatch(candidateWorkflow, /contents:\s*write/);
});

test("signing workflows map secrets to the environment names used by the pinned Tauri signer", () => {
    const command = process.platform === "win32"
        ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run tauri -- signer sign --help"]]
        : ["npm", ["run", "tauri", "--", "signer", "sign", "--help"]];
    const help = spawnSync(
        command[0],
        command[1],
        { cwd: repoRoot, encoding: "utf8" },
    );
    assert.equal(help.status, 0, help.error?.message ?? help.stderr);
    const signerHelp = `${help.stdout}\n${help.stderr}`;
    assert.match(signerHelp, /\[env: TAURI_PRIVATE_KEY=\]/);
    assert.match(signerHelp, /\[env: TAURI_PRIVATE_KEY_PASSWORD=\]/);

    for (const candidate of [workflow, candidateWorkflow]) {
        const signingStep = candidate.slice(candidate.indexOf("Sign and verify setup and combined manifest"));
        assert.match(signingStep, /TAURI_PRIVATE_KEY:\s*\$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/);
        assert.match(signingStep, /TAURI_PRIVATE_KEY_PASSWORD:\s*\$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD \}\}/);
        assert.doesNotMatch(signingStep, /TAURI_SIGNING_PRIVATE_KEY:\s*\$\{\{/);
        assert.doesNotMatch(signingStep, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD:\s*\$\{\{/);
    }
});

test("release workflow rejects WPF setup publishes that leave native runtime sidecars", () => {
    assert.match(workflow, /scripts[\\/]validate_setup_publish\.ps1/);
    assert.match(workflow, /-ProjectPath \.\/installer-helper[\\/]VRCNT\.Setup[\\/]VRCNT\.Setup\.csproj/);
    assert.match(workflow, /-PublishOutputPath \.\/build[\\/]setup/);
    for (const nativeLibrary of [
        "PresentationNative_cor3.dll",
        "wpfgfx_cor3.dll",
        "PenImc_cor3.dll",
        "D3DCompiler_47_cor3.dll",
        "vcruntime140_cor3.dll",
    ]) {
        assert.match(setupPublishValidator, new RegExp(nativeLibrary.replaceAll(".", "\\.")));
    }
});

test("combined release validation accepts every signed variant part without fixed counts", () => {
    assert.match(workflow, /foreach \(\$variant in \$manifest\.variants\.PSObject\.Properties\)/);
    assert.match(workflow, /foreach \(\$entry in \$variant\.Value\.parts\)/);
    assert.match(workflow, /Signed package manifest could not be verified/);
    assert.match(workflow, /WPF updater setup signing failed/);
    assert.doesNotMatch(workflow, /\.files\.Count\s*-ne\s*3|packagePartCount|all three VRCNT_/i);
});

test("published release assets exclude duplicate per-variant package metadata", () => {
    const releaseAssetEnumerations = workflow.match(/Get-ChildItem (?:\.\/)?release-assets -File -Recurse[^\r\n]*/g) || [];

    assert.equal(releaseAssetEnumerations.length, 2, "hashing and publication must enumerate the same release assets");
    assert.ok(
        releaseAssetEnumerations.every((enumeration) => /-Exclude ['"]?package-metadata\.json['"]?/i.test(enumeration)),
        "per-variant package metadata has duplicate leaf names and must remain internal to combined-manifest creation",
    );
    assert.match(workflow, /\$expected = Get-ChildItem \.\/release-assets -File -Recurse -Exclude package-metadata\.json/);
});

test("release hashes are generated after VirusTotal adds its public report", () => {
    const virusTotalScan = workflow.indexOf("python ./utils/virustotal.py scan");
    const generateHashes = workflow.lastIndexOf("python ./utils/release.py hashes");

    assert.ok(virusTotalScan >= 0, "the release must scan the approved portable executables");
    assert.ok(generateHashes > virusTotalScan, "SHA256SUMS.txt must include the public VirusTotal report as well as payload and signature artifacts");
});

test("workflow publishes the WPF setup under its exact updater filename without NSIS labels", () => {
    assert.match(workflow, /--updater-name \$env:INSTALLER_NAME/);
    assert.match(workflow, /\$setup = Join-Path \$assetDir \$env:INSTALLER_NAME/);
    assert.match(workflow, /gh release upload \$env:RELEASE_TAG --repo \$env:RELEASE_REPOSITORY --clobber \$releaseAssets/);
    assert.doesNotMatch(workflow, /INSTALLER_RELEASE_ASSET_NAME|00_\$installerName|installerUpload|installerSignatureUpload/);
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
    assert.equal(tauriConfig.bundle.active, false);
    assert.equal(tauriConfig.bundle.createUpdaterArtifacts, false);
    assert.deepEqual(tauriConfig.plugins.updater.windows.installerArgs, ["--tauri-update-contract-v1", "/passive", "--repair-manager"]);
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
    assert.match(workflow, /Sign and verify setup and combined manifest[\s\S]*TAURI_PRIVATE_KEY:\s*\$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}[\s\S]*TAURI_PRIVATE_KEY_PASSWORD:\s*\$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD \}\}/);
    assert.doesNotMatch(workflow, /Sign and verify setup and combined manifest[\s\S]*TAURI_SIGNING_PRIVATE_KEY:\s*\$\{\{/);
    assert.doesNotMatch(workflow, /Sign and verify setup and combined manifest[\s\S]*TAURI_SIGNING_PRIVATE_KEY_PASSWORD:\s*\$\{\{/);
    assert.doesNotMatch(workflow, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD is required/);
    assert.match(workflow, /tauri signer sign/);
    assert.match(workflow, /minisign.*-Vm/s);
    assert.match(workflow, /WPF updater setup signing failed/);
    assert.match(workflow, /latest\.json has an invalid GitHub updater URL or empty signature/);
    assert.match(workflow, /Signed artifact .* could not be verified/);
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


test("published WPF setup embeds verified helper inputs instead of releasing helper sidecars", () => {
    const setupProject = read("installer-helper/VRCNT.Setup/VRCNT.Setup.csproj");

    assert.match(setupProject, /EmbeddedResource Include="\$\(SetupToolSourceDirectory\)\\minisign\.exe" LogicalName="VRCNT\.Setup\.Tools\.minisign\.exe"/);
    assert.match(setupProject, /EmbeddedResource Include="\$\(SetupToolSourceDirectory\)\\7za\.exe" LogicalName="VRCNT\.Setup\.Tools\.7za\.exe"/);
    assert.doesNotMatch(setupProject, /Copy SourceFiles="@\(AuthenticatedSetupTool\)"/);
    assert.match(workflow, /'7za\.exe' = '35d4d69d7cd6cb44558f208c3b1334268013f9daf82d2dda848893a1c30c59c2'/);
    assert.match(workflow, /'minisign\.exe' = '5535be9e4e123831ebe6ef324aafe9dde507015c176191f9e20c3ad60567f9e1'/);
    assert.match(workflow, /Published WPF setup must embed \$tool instead of shipping it as a sidecar/);
    assert.match(workflow, /bootstrapper SHA-256 does not match the exact published WPF setup/);
});


test("workflow fails on missing, oversized, or mismatched release files", () => {
    assert.match(workflow, /Length -ge \[long\]\$env:MAX_ASSET_SIZE/);
    assert.match(workflow, /Get-FileHash .* -Algorithm SHA256/);
    assert.match(workflow, /failed SHA-256 verification/);
    assert.match(workflow, /7za\.exe'\) t \$firstPart/);
    assert.match(workflow, /Combined manifest does not identify the exact WPF setup/);
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
