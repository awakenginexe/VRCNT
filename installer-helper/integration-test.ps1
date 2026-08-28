param(
  [Parameter(Mandatory = $true)][string]$SevenZip,
  [Parameter(Mandatory = $true)][string]$Minisign,
  [ValidateSet('All', 'InvalidTargetPreservation')][string]$Scenario = 'All'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$SevenZip = (Resolve-Path $SevenZip).Path
$Minisign = (Resolve-Path $Minisign).Path
$testRoot = Join-Path $repoRoot 'tmp/release-helper-integration'
$previousLocalAppData = $env:LOCALAPPDATA
$resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
$resolvedRepoRoot = [IO.Path]::GetFullPath($repoRoot) + [IO.Path]::DirectorySeparatorChar
if (-not $resolvedTestRoot.StartsWith($resolvedRepoRoot, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $resolvedTestRoot) -ne 'release-helper-integration') {
  throw "Unsafe integration-test directory: $resolvedTestRoot"
}
if (Test-Path $testRoot) {
  Remove-Item -LiteralPath $testRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$env:LOCALAPPDATA = Join-Path $testRoot 'local-app-data'

function Invoke-Helper([string]$InstallerDirectory, [string]$CacheDirectory, [string]$Destination, [string]$BaseUrl, [string]$Variant = 'cpu') {
  $arguments = @(
    '--version', '4.2.2',
    '--release-base-url', $BaseUrl,
    '--installer-directory', $InstallerDirectory,
    '--cache-directory', $CacheDirectory,
    '--destination', $Destination,
    '--manifest-name', 'package-manifest.json',
    '--signature-name', 'package-manifest.json.sig',
    '--variant', $Variant,
    '--sevenzip', $SevenZip,
    '--minisign', $Minisign
  )
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $script:helperExe
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.Arguments = (($arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' ')
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw 'Release helper process could not be started.' }
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    $output = $stdout + $stderr
    $exitCode = $process.ExitCode
  } finally {
    $process.Dispose()
  }
  return @{ ExitCode = $exitCode; Output = $output }
}

try {
  $payload = Join-Path $testRoot 'payload'
  New-Item -ItemType Directory -Path "$payload/frontend", "$payload/_internal" -Force | Out-Null
  Set-Content -LiteralPath "$payload/VRCNT.exe" -Value 'test executable' -Encoding utf8
  Set-Content -LiteralPath "$payload/VRCNT-backend.exe" -Value 'test backend' -Encoding utf8
  Set-Content -LiteralPath "$payload/VRCNT.runtime.json" -Value '{"product":"VRCNT","version":"4.2.2","variant":"Cpu","architecture":"x64","buildIdentity":"fixture-cpu"}' -Encoding utf8
  Set-Content -LiteralPath "$payload/frontend/index.html" -Value '<html>test</html>' -Encoding utf8
  Set-Content -LiteralPath "$payload/_internal/runtime.txt" -Value 'runtime' -Encoding utf8

  $fixtureProject = Join-Path $testRoot 'fixture-runtime'
  New-Item -ItemType Directory -Path $fixtureProject -Force | Out-Null
  @'
using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;

static string Required(string[] args, string name)
{
    var index = Array.IndexOf(args, name);
    return index >= 0 && index + 1 < args.Length ? args[index + 1] : throw new ArgumentException($"Missing {name}");
}

var executableName = Path.GetFileNameWithoutExtension(Environment.ProcessPath ?? AppContext.BaseDirectory);
if (string.Equals(executableName, "VRCNT", StringComparison.OrdinalIgnoreCase))
{
    var backend = Path.Combine(AppContext.BaseDirectory, "VRCNT-backend.exe");
    var start = new ProcessStartInfo(backend) { UseShellExecute = false };
    foreach (var argument in args) start.ArgumentList.Add(argument);
    Process.Start(start)?.Dispose();
    return;
}

if (!args.Contains("--runtime-activation-pipe", StringComparer.Ordinal)) return;
var pipe = Required(args, "--runtime-activation-pipe");
var token = Required(args, "--runtime-activation-token");
var nonce = Required(args, "--runtime-activation-nonce");
var version = Required(args, "--runtime-activation-app-version");
var variant = Required(args, "--runtime-activation-runtime-variant");
using var client = new NamedPipeClientStream(".", pipe, PipeDirection.Out, PipeOptions.Asynchronous);
await client.ConnectAsync(5000);
await using (var writer = new StreamWriter(client) { AutoFlush = true })
{
    await writer.WriteAsync(JsonSerializer.Serialize(new { ProtocolVersion = 1, Status = "ready", Token = token, Nonce = nonce, BackendPid = Environment.ProcessId, AppVersion = version, RuntimeVariant = variant }) + "\n");
}
await Task.Delay(1000);
'@ | Set-Content -LiteralPath (Join-Path $fixtureProject 'Program.cs') -Encoding utf8

  function Publish-FixtureRuntime([string]$AssemblyName, [string]$OutputDirectory) {
    @"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <AssemblyName>$AssemblyName</AssemblyName>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
"@ | Set-Content -LiteralPath (Join-Path $fixtureProject 'FixtureRuntime.csproj') -Encoding utf8
    dotnet publish (Join-Path $fixtureProject 'FixtureRuntime.csproj') -c Release -r win-x64 --self-contained false -o $OutputDirectory
    if ($LASTEXITCODE -ne 0) { throw "Fixture $AssemblyName runtime build failed." }
  }

  $fixtureApp = Join-Path $fixtureProject 'app'
  $fixtureBackend = Join-Path $fixtureProject 'backend'
  Publish-FixtureRuntime 'VRCNT' $fixtureApp
  Publish-FixtureRuntime 'VRCNT-backend' $fixtureBackend
  Get-ChildItem -LiteralPath $fixtureApp -File | Where-Object { $_.Name -like 'VRCNT*' } | Copy-Item -Destination $payload -Force
  Get-ChildItem -LiteralPath $fixtureBackend -File | Where-Object { $_.Name -like 'VRCNT-backend*' } | Copy-Item -Destination $payload -Force

  $release = Join-Path $testRoot 'release'
  New-Item -ItemType Directory -Path $release -Force | Out-Null
  $cpuArchive = Join-Path $release 'VRCNT_4.2.2_CPU.7z'
  Push-Location $payload
  try {
    & $SevenZip a -t7z -mx=1 $cpuArchive * | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Fixture archive generation failed.' }
  } finally {
    Pop-Location
  }

  $cudaPayload = Join-Path $testRoot 'cuda-payload'
  Copy-Item $payload $cudaPayload -Recurse
  Set-Content -LiteralPath "$cudaPayload/VRCNT-backend.exe" -Value 'test cuda backend' -Encoding utf8
  Set-Content -LiteralPath "$cudaPayload/VRCNT.runtime.json" -Value '{"product":"VRCNT","version":"4.2.2","variant":"Cuda","architecture":"x64","buildIdentity":"fixture-cuda"}' -Encoding utf8
  $cudaArchive = Join-Path $release 'VRCNT_4.2.2_CUDA.7z'
  Push-Location $cudaPayload
  try {
    & $SevenZip a -t7z -mx=1 $cudaArchive * | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'CUDA fixture archive generation failed.' }
  } finally {
    Pop-Location
  }

  $python = @'
import pathlib, sys
sys.path.insert(0, sys.argv[1])
from release import split_to_asset_limit
import hashlib, json
root = pathlib.Path(sys.argv[2])
cpu_payload = pathlib.Path(sys.argv[3])
cuda_payload = pathlib.Path(sys.argv[4])
cpu_parts = split_to_asset_limit(root / "VRCNT_4.2.2_CPU.7z", 2_000_000_000)
cuda_size = (root / "VRCNT_4.2.2_CUDA.7z").stat().st_size
cuda_parts = split_to_asset_limit(root / "VRCNT_4.2.2_CUDA.7z", (cuda_size + 2) // 3 + 1)
if len(cpu_parts) != 1 or len(cuda_parts) != 3:
    raise RuntimeError("Fixture package splitting did not produce one CPU and three CUDA parts.")
def package(variant, parts, payload):
    entries = [{"name": part.name, "size": part.stat().st_size, "sha256": hashlib.sha256(part.read_bytes()).hexdigest()} for part in parts]
    return {"archiveFormat": "7z", "compressedSize": sum(item["size"] for item in entries), "installedSize": 1, "parts": entries, "requiresNvidia": variant == "cuda", "markerPath": "VRCNT.runtime.json", "identity": {"product": "VRCNT", "version": "4.2.2", "variant": variant.title(), "architecture": "x64", "buildIdentity": f"fixture-{variant}", "markerSha256": hashlib.sha256((payload / "VRCNT.runtime.json").read_bytes()).hexdigest()}}
digest = hashlib.sha256(b"fixture").hexdigest()
manifest = {
  "schema": 2, "product": "VRCNT", "version": "4.2.2", "architecture": "x64",
  "bootstrapper": {"name": "VRCNT_4.2.2_Setup.exe", "size": 1, "sha256": digest, "managerProtocol": 1, "manifestSchema": 2, "runtimeStateSchema": 1, "activationProtocol": 1},
  "variants": {"cpu": package("cpu", cpu_parts, cpu_payload), "cuda": package("cuda", cuda_parts, cuda_payload)}
}
(root / "package-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
'@
  $python | python - (Join-Path $repoRoot 'utils') $release $payload $cudaPayload
  if ($LASTEXITCODE -ne 0) { throw 'Fixture multipart generation failed.' }

  $publicKey = Join-Path $testRoot 'manifest.pub'
  $secretKey = Join-Path $testRoot 'manifest.key'
  & $Minisign -G -p $publicKey -s $secretKey -W
  if ($LASTEXITCODE -ne 0) { throw 'Fixture signing key generation failed.' }
  $rawSignature = Join-Path $testRoot 'manifest.minisig'
  & $Minisign -Sm "$release/package-manifest.json" -s $secretKey -x $rawSignature
  if ($LASTEXITCODE -ne 0) { throw 'Fixture manifest signing failed.' }
  [IO.File]::WriteAllText(
    "$release/package-manifest.json.sig",
    [Convert]::ToBase64String([IO.File]::ReadAllBytes($rawSignature))
  )

  $testProject = Join-Path $testRoot 'helper'
  New-Item -ItemType Directory -Path $testProject -Force | Out-Null
  Copy-Item "$PSScriptRoot/VRCNT.ReleaseHelper.csproj" "$testProject/VRCNT.ReleaseHelper.csproj"
  Copy-Item "$PSScriptRoot/Program.cs" "$testProject/Program.cs"
  Copy-Item "$PSScriptRoot/VRCNT.RuntimeCore" "$testProject/VRCNT.RuntimeCore" -Recurse
  Remove-Item -LiteralPath "$testProject/VRCNT.RuntimeCore/bin", "$testProject/VRCNT.RuntimeCore/obj" -Recurse -Force -ErrorAction SilentlyContinue
  $productionKey = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDY4NTYzNUI0QUI2RTI4RkMKUldUOEtHNnJ0RFZXYUt4L1cwOVhIL1NtZXJGQkxzZkVVYXMrWGJZQlZ5NFNPdldRMk9RdUkrVCsK'
  $fixtureKey = [Convert]::ToBase64String([IO.File]::ReadAllBytes($publicKey))
  $verifierPath = "$testProject/VRCNT.RuntimeCore/Security/MinisignVerifier.cs"
  $verifierSource = Get-Content -Raw $verifierPath
  if (-not $verifierSource.Contains($productionKey)) { throw 'Production embedded public key was not found.' }
  Set-Content -LiteralPath $verifierPath -Value $verifierSource.Replace($productionKey, $fixtureKey) -Encoding utf8
  dotnet publish "$testProject/VRCNT.ReleaseHelper.csproj" -c Release -o "$testProject/publish"
  if ($LASTEXITCODE -ne 0) { throw 'Fixture helper build failed.' }
  $script:helperExe = "$testProject/publish/VRCNT.ReleaseHelper.exe"

  $unownedDestination = Join-Path $testRoot 'unowned-install'
  New-Item -ItemType Directory -Path "$unownedDestination/weights", "$unownedDestination/logs" -Force | Out-Null
  Set-Content -LiteralPath "$unownedDestination/VRCNT.exe" -Value 'unowned executable' -Encoding utf8
  Set-Content -LiteralPath "$unownedDestination/VRCNT-backend.exe" -Value 'unowned backend' -Encoding utf8
  Set-Content -LiteralPath "$unownedDestination/VRCNT.runtime.json" -Value '{"product":"VRCNT","version":"4.2.2","variant":"Cpu","architecture":"x64","buildIdentity":"tampered"}' -Encoding utf8
  Set-Content -LiteralPath "$unownedDestination/config.json" -Value '{"legacy":true}' -Encoding utf8
  Set-Content -LiteralPath "$unownedDestination/weights/model.bin" -Value 'legacy weights' -Encoding utf8
  Set-Content -LiteralPath "$unownedDestination/logs/legacy.log" -Value 'legacy log' -Encoding utf8
  $unowned = Invoke-Helper $release (Join-Path $testRoot 'unowned-cache') $unownedDestination 'http://127.0.0.1:1'
  if ($unowned.ExitCode -eq 0) {
    throw "Unowned runtime replacement unexpectedly succeeded:`n$($unowned.Output)"
  }
  if (Test-Path (Join-Path $env:LOCALAPPDATA 'VRCNTData')) {
    throw 'Unowned runtime replacement modified the user-data root before ownership validation.'
  }
  if ($Scenario -eq 'InvalidTargetPreservation') {
    Write-Output 'Release helper invalid-target preservation scenario passed.'
    return
  }

  $localDestination = Join-Path $testRoot 'local-install'
  $local = Invoke-Helper $release (Join-Path $testRoot 'local-cache') $localDestination 'http://127.0.0.1:1'
    if ($local.ExitCode -ne 0 -or -not (Test-Path "$localDestination/VRCNT.exe")) {
    throw "Local multipart installation failed:`n$($local.Output)"
  }
  if ($local.Output -notmatch 'Found all signed manifest-selected package files beside the installer') {
    throw 'Local installation did not select the adjacent package path.'
  }

  $existingExecutable = [IO.File]::ReadAllText("$localDestination/VRCNT.exe")
  $userDataConfig = Join-Path $env:LOCALAPPDATA 'VRCNTData/config.json'
  New-Item -ItemType Directory -Path (Split-Path -Parent $userDataConfig) -Force | Out-Null
  Set-Content -LiteralPath $userDataConfig -Value '{"preserve":true}' -Encoding utf8 -NoNewline
  $lockedExecutable = [IO.File]::Open("$localDestination/VRCNT.exe", [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $interruptedSwitch = Invoke-Helper $release (Join-Path $testRoot 'interrupted-cache') $localDestination 'http://127.0.0.1:1'
  } finally {
    $lockedExecutable.Dispose()
  }
  if ($interruptedSwitch.ExitCode -eq 0 -or [IO.File]::ReadAllText("$localDestination/VRCNT.exe") -ne $existingExecutable -or (Get-Content -Raw $userDataConfig) -ne '{"preserve":true}') {
    throw "Interrupted replacement did not roll back the live runtime and preserve user data:`n$($interruptedSwitch.Output)"
  }
  Set-Content -LiteralPath "$localDestination/VRCNT.runtime.json" -Value '{"product":"VRCNT","version":"4.2.2","variant":"Cpu","architecture":"x64","buildIdentity":"tampered"}' -Encoding utf8
  $blockedReplacement = Invoke-Helper $release (Join-Path $testRoot 'blocked-cache') $localDestination 'http://127.0.0.1:1'
  if ($blockedReplacement.ExitCode -eq 0 -or [IO.File]::ReadAllText("$localDestination/VRCNT.exe") -ne $existingExecutable) {
    throw "Existing runtime replacement was not blocked before overwrite:`n$($blockedReplacement.Output)"
  }

  $portable = Join-Path $testRoot 'portable'
  & $SevenZip x -y "${release}/VRCNT_4.2.2_CPU.7z.001" "-o$portable" | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$portable/VRCNT.exe")) {
    throw 'Manual portable extraction failed.'
  }

  $badHash = Join-Path $testRoot 'bad-hash'
  Copy-Item $release $badHash -Recurse
  $bytes = [IO.File]::ReadAllBytes("$badHash/VRCNT_4.2.2_CPU.7z.001")
  $bytes[0] = $bytes[0] -bxor 1
  [IO.File]::WriteAllBytes("$badHash/VRCNT_4.2.2_CPU.7z.001", $bytes)
  $rejectedHash = Invoke-Helper $badHash (Join-Path $testRoot 'bad-hash-cache') (Join-Path $testRoot 'bad-hash-install') 'http://127.0.0.1:1'
  if ($rejectedHash.ExitCode -eq 0 -or $rejectedHash.Output -notmatch 'SHA-256 mismatch') {
    throw 'Invalid package hash was not rejected clearly.'
  }

  $badSignature = Join-Path $testRoot 'bad-signature'
  Copy-Item $release $badSignature -Recurse
  Set-Content "$badSignature/package-manifest.json.sig" -Value 'not-a-valid-signature' -Encoding ascii
  $rejectedSignature = Invoke-Helper $badSignature (Join-Path $testRoot 'bad-signature-cache') (Join-Path $testRoot 'bad-signature-install') 'http://127.0.0.1:1'
  if ($rejectedSignature.ExitCode -eq 0 -or $rejectedSignature.Output -notmatch 'manifest signature verification failed') {
    throw 'Invalid manifest signature was not rejected before package hashes.'
  }

  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()
  $server = Start-Process node -ArgumentList @("$PSScriptRoot/TestServer.mjs", $release, $port) -PassThru -WindowStyle Hidden
  try {
    Start-Sleep -Milliseconds 500
    $onlineInstaller = Join-Path $testRoot 'online-installer'
    $onlineCache = Join-Path $testRoot 'online-cache'
    New-Item -ItemType Directory -Path $onlineInstaller, $onlineCache -Force | Out-Null
    $firstPart = [IO.File]::ReadAllBytes("$release/VRCNT_4.2.2_CPU.7z.001")
    [IO.File]::WriteAllBytes(
      "$onlineCache/VRCNT_4.2.2_CPU.7z.001.partial",
      $firstPart[0..([Math]::Min(31, $firstPart.Length - 1))]
    )
    $onlineDestination = Join-Path $testRoot 'online-install'
    $online = Invoke-Helper $onlineInstaller $onlineCache $onlineDestination "http://127.0.0.1:$port"
    if ($online.ExitCode -ne 0 -or -not (Test-Path "$onlineDestination/VRCNT.exe")) {
      throw "Online installation failed:`n$($online.Output)"
    }
  } finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
  }

  Write-Output 'Release helper integration scenarios passed: local, online, resume, signature/hash rejection, and portable extraction.'
} finally {
  if ($null -eq $previousLocalAppData) { Remove-Item Env:LOCALAPPDATA -ErrorAction SilentlyContinue } else { $env:LOCALAPPDATA = $previousLocalAppData }
  if (Test-Path $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}
